package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"testing"
	"time"

	"tpm-msk/internal/audit"
	"tpm-msk/internal/kek"
	"tpm-msk/internal/service"
)

// softHMAC stands in for tpm.Handle in this test only. Key is persisted in the run dir (soft.key).
// Never reachable from production code: this file is _test.go.
type softHMAC struct{ key []byte }

func (s softHMAC) HMAC(msg []byte) ([]byte, error) {
	m := hmac.New(sha256.New, s.key)
	_, _ = m.Write(msg)
	return m.Sum(nil), nil
}

// TestTPMMSKE2E runs the real HTTPS service (loadTLSConfig, newHTTPServer, service.NewHandler, audit logger)
// with softHMAC instead of the TPM. Skipped unless TPM_MSK_E2E_RUN is set.
//
// Env:
//
//	TPM_MSK_E2E_RUN      run dir; expects <run>/pki, writes <run>/audit/tpm/audit.jsonl, stop file <run>/stop
//	TPM_MSK_E2E_LISTEN   listen address (default 127.0.0.1:2798)
//	TPM_MSK_E2E_SECONDS  max run time in seconds (default 600)
func TestTPMMSKE2E(t *testing.T) {
	runDir := os.Getenv("TPM_MSK_E2E_RUN")
	if runDir == "" {
		t.Skip("set TPM_MSK_E2E_RUN to run the TestTPMMSKE2E HTTPS e2e harness")
	}
	listen := os.Getenv("TPM_MSK_E2E_LISTEN")
	if listen == "" {
		listen = "127.0.0.1:2798"
	}
	seconds := 600
	if raw := os.Getenv("TPM_MSK_E2E_SECONDS"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n <= 0 {
			t.Fatalf("invalid TPM_MSK_E2E_SECONDS %q", raw)
		}
		seconds = n
	}

	tlsConfig, err := loadTLSConfig(filepath.Join(runDir, "pki"))
	if err != nil {
		t.Fatal(err)
	}

	key, err := loadOrCreateSoftKey(filepath.Join(runDir, "soft.key"))
	if err != nil {
		t.Fatal(err)
	}
	defer clear(key)
	hm := softHMAC{key: key}

	kekPath := filepath.Join(runDir, "kek", "keks.json")
	if err := os.MkdirAll(filepath.Dir(kekPath), 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(kekPath); errors.Is(err, os.ErrNotExist) {
		if v, err := kek.Create(kekPath, hm, "kek-01"); err != nil || v != 1 {
			t.Fatalf("kek create kek-01: version=%d err=%v", v, err)
		}
	} else if err != nil {
		t.Fatal(err)
	}

	auditPath := filepath.Join(runDir, "audit", "tpm", "audit.jsonl")
	if err := os.MkdirAll(filepath.Dir(auditPath), 0700); err != nil {
		t.Fatal(err)
	}
	logger, err := audit.Open(auditPath, hm)
	if err != nil {
		t.Fatal(err)
	}
	defer logger.Close()
	rec := func(action, result string) error {
		return logger.Append(audit.Record{RequestID: "-", Service: "tpm-service", Identity: "-", KeyID: "-", Action: action, Result: result})
	}
	if err := rec("service.start", "ok"); err != nil {
		t.Fatal(err)
	}

	var activeMu sync.RWMutex
	var active *rsa.PublicKey
	getActive := func() *rsa.PublicKey {
		activeMu.RLock()
		defer activeMu.RUnlock()
		return active
	}
	handler := service.NewHandler(service.Config{
		KEKPath: kekPath, AllowKEK: map[string]bool{"kek-01": true}, Rate: 50, Burst: 100,
		Audit: logger, HMAC: hm, ActivePub: getActive,
	})
	srv := newHTTPServer(listen, handler, tlsConfig)
	ln, err := net.Listen("tcp", listen)
	if err != nil {
		t.Fatal(err)
	}
	serveErr := make(chan error, 1)
	go func() { serveErr <- srv.ServeTLS(ln, "", "") }()

	// Test-only shortcut: auto-approve the delivery pubkey instead of the console prompt.
	ctx, cancel := context.WithCancel(context.Background())
	approvalDone := make(chan struct{})
	go func() {
		defer close(approvalDone)
		approvePubkeyFile(ctx, filepath.Join(runDir, "keyd-pub", "delivery.pub.pem"), rec, &activeMu, &active, t)
	}()

	waitErr := waitForStop(filepath.Join(runDir, "stop"), time.Duration(seconds)*time.Second, serveErr)

	cancel()
	<-approvalDone
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		t.Errorf("shutdown: %v", err)
	}
	if waitErr != nil {
		t.Fatal(waitErr)
	}
	if err := rec("service.stop", "ok"); err != nil {
		t.Fatal(err)
	}
}

// loadOrCreateSoftKey reuses a 32-byte key at path, or creates one if missing.
func loadOrCreateSoftKey(path string) ([]byte, error) {
	data, err := os.ReadFile(path)
	if err == nil {
		if len(data) != 32 {
			return nil, fmt.Errorf("soft key %s: want 32 bytes, got %d", path, len(data))
		}
		return data, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, err
	}
	if err := os.WriteFile(path, key, 0600); err != nil {
		return nil, err
	}
	return key, nil
}

// waitForStop returns nil on stop file, timeout, or clean server exit. A serve error is returned.
func waitForStop(stopPath string, max time.Duration, serveErr <-chan error) error {
	deadline := time.NewTimer(max)
	defer deadline.Stop()
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case err := <-serveErr:
			if err != nil && !errors.Is(err, http.ErrServerClosed) {
				return err
			}
			return nil
		case <-deadline.C:
			return nil
		case <-ticker.C:
			_, err := os.Stat(stopPath)
			if err == nil {
				return nil
			}
			if !errors.Is(err, os.ErrNotExist) {
				return err
			}
		}
	}
}

// approvePubkeyFile mirrors approvalLoop's audit and activation semantics without the console.
// Content change: revoke, then approve the new key. Missing or invalid file: revoke only.
func approvePubkeyFile(ctx context.Context, path string, rec func(action, result string) error, mu *sync.RWMutex, active **rsa.PublicKey, t *testing.T) {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	var last [32]byte
	seen := false
	for {
		data, readErr := os.ReadFile(path)
		cur := [32]byte{}
		if readErr == nil {
			cur = sha256.Sum256(data)
		}
		if readErr != nil || !seen || cur != last {
			seen = true
			last = cur
			mu.Lock()
			wasActive := *active != nil
			*active = nil
			mu.Unlock()
			if wasActive {
				if err := rec("pubkey.revoke", "ok"); err != nil {
					t.Errorf("audit pubkey.revoke: %v", err)
				}
			}
			if readErr == nil {
				if pub := parseDeliveryPub(data); pub != nil {
					block, _ := pem.Decode(bytes.TrimSpace(data))
					fpHash := sha256.Sum256(block.Bytes)
					fp := "sha256:" + hex.EncodeToString(fpHash[:])
					t.Logf("auto-approving delivery key %s", fp)
					if err := rec("pubkey.approve", "ok"); err != nil {
						t.Errorf("audit pubkey.approve: %v", err)
					} else {
						mu.Lock()
						*active = pub
						mu.Unlock()
					}
				}
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func parseDeliveryPub(data []byte) *rsa.PublicKey {
	block, _ := pem.Decode(bytes.TrimSpace(data))
	if block == nil || block.Type != "PUBLIC KEY" {
		return nil
	}
	parsed, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil
	}
	pub, ok := parsed.(*rsa.PublicKey)
	if !ok || pub.N.BitLen() != 3072 {
		return nil
	}
	return pub
}
