package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"golang.org/x/term"

	"tpm-msk/internal/audit"
	"tpm-msk/internal/kek"
	"tpm-msk/internal/service"
	"tpm-msk/internal/shamir"
	"tpm-msk/internal/tpm"
)

func cmdServe(args []string, stdout, stderr io.Writer) int {
	fs := newFlags("serve", "Serve the TPM-backed KEK delivery API.", stderr)
	listen := fs.String("listen", "127.0.0.1:2798", "listen address")
	pkiDir := fs.String("pki-dir", "", "PKI directory (required)")
	pubkeyFile := fs.String("pubkey-file", "", "delivery public key file (default <pki-dir>/../keyd-pub/delivery.pub.pem)")
	allowKEK := fs.String("allow-kek", "kek-01", "comma-separated allowed KEK IDs")
	appData := os.Getenv("APPDATA")
	if appData == "" {
		appData, _ = os.UserConfigDir()
	}
	auditFile := fs.String("audit-file", filepath.Join(appData, "tpm-msk", "audit.jsonl"), "audit log file")
	rate := fs.Float64("rate", 50, "request rate per second")
	demo := fs.Bool("demo-ceremony", true, "print throwaway Shamir ceremony shares")
	auditEcho := fs.Bool("audit-echo", true, "print audit records to the console")
	key := fs.String("key", "", "TPM key file path")
	approveFP := fs.String("approve-fingerprint", "", "auto-approve the delivery key only if its fingerprint equals this value (sha256:<64 hex>)")
	if code, ok := parse(fs, args); !ok {
		return code
	}
	if *pkiDir == "" {
		fmt.Fprintln(stderr, "serve requires --pki-dir")
		return 2
	}
	if *pubkeyFile == "" {
		*pubkeyFile = filepath.Join(filepath.Dir(filepath.Clean(*pkiDir)), "keyd-pub", "delivery.pub.pem")
	}
	pinnedFP := strings.ToLower(strings.TrimSpace(*approveFP))
	if pinnedFP != "" {
		hexPart, ok := strings.CutPrefix(pinnedFP, "sha256:")
		raw, err := hex.DecodeString(hexPart)
		if !ok || err != nil || len(raw) != 32 {
			fmt.Fprintln(stderr, "invalid --approve-fingerprint")
			return 2
		}
	}

	// PKI checks run before the PIN prompt and TPM open: they do not need the TPM.
	tlsConfig, err := loadTLSConfig(*pkiDir)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}

	// Audit opens unsigned so start failures and wrong PINs are recorded before the TPM is open.
	// It is reopened with the TPM as signer after tpm.Open and KeyID succeed.
	logger, err := audit.Open(*auditFile, nil)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	// startFail appends service.start with a short error token. result never carries the PIN or free text.
	startFail := func(result string, err error) int {
		if aerr := logger.Append(audit.Record{RequestID: "-", Service: "tpm-service", Identity: "-", KeyID: "-", Action: "service.start", Result: result}); aerr != nil {
			fmt.Fprintln(stderr, aerr)
		}
		_ = logger.Close()
		fmt.Fprintln(stderr, err)
		return 1
	}

	pin, err := readPIN(stderr, "PIN: ")
	if err != nil {
		return startFail("error:pin", err)
	}
	keyPath, err := resolveKey(*key)
	if err != nil {
		zero(pin)
		return startFail("error:key_path", err)
	}
	handle, err := tpm.Open(keyPath, pin)
	zero(pin)
	if err != nil {
		if isWrongPIN(err) {
			if aerr := logger.Append(audit.Record{RequestID: "-", Service: "tpm-service", Identity: "-", KeyID: "-", Action: "pin.fail", Result: "error:auth"}); aerr != nil {
				fmt.Fprintln(stderr, aerr)
			}
			_ = logger.Close()
			fmt.Fprintln(stderr, err)
			return 1
		}
		return startFail("error:tpm_open", err)
	}
	kid, err := handle.KeyID()
	if err != nil {
		_ = handle.Close()
		if isWrongPIN(err) {
			if aerr := logger.Append(audit.Record{RequestID: "-", Service: "tpm-service", Identity: "-", KeyID: "-", Action: "pin.fail", Result: "error:auth"}); aerr != nil {
				fmt.Fprintln(stderr, aerr)
			}
			_ = logger.Close()
			fmt.Fprintln(stderr, err)
			return 1
		}
		return startFail("error:key_id", err)
	}
	fmt.Fprintf(stdout, "Key ID: %s\n", kid)

	// Reopen with the TPM as signer. Records appended unsigned above stay in the chain.
	if err := logger.Close(); err != nil {
		_ = handle.Close()
		fmt.Fprintln(stderr, err)
		return 1
	}
	logger, err = audit.Open(*auditFile, handle)
	if err != nil {
		_ = handle.Close()
		fmt.Fprintln(stderr, err)
		return 1
	}
	if *auditEcho {
		logger.Echo = stdout
	}
	closeResources := func() {
		_ = logger.Close()
		_ = handle.Close()
	}
	if err := logger.Append(audit.Record{RequestID: "-", Service: "tpm-service", Identity: "-", KeyID: kid, Action: "service.start", Result: "ok"}); err != nil {
		closeResources()
		fmt.Fprintln(stderr, err)
		return 1
	}
	if *demo {
		secret := make([]byte, 32)
		if _, err := rand.Read(secret); err != nil {
			zero(secret)
			closeResources()
			fmt.Fprintln(stderr, err)
			return 1
		}
		shares, err := shamir.Split(secret, 2, 3)
		zero(secret)
		if err != nil {
			closeResources()
			fmt.Fprintln(stderr, err)
			return 1
		}
		fmt.Fprintln(stdout, "[DEMO] Initial ceremony: 3 Shamir shares, quorum 2 of 3")
		fmt.Fprintln(stdout, "[DEMO] These shares belong to a throwaway key. They cannot rebuild the MSK.")
		for i, share := range shares {
			fmt.Fprintf(stdout, "[DEMO] Share %d: %s\n", i+1, hex.EncodeToString(share))
			zero(share)
		}
	}

	var console *os.File
	var consoleFile *os.File = os.Stdin
	var source io.Reader = os.Stdin
	if !term.IsTerminal(int(os.Stdin.Fd())) {
		console, err = os.OpenFile("CONIN$", os.O_RDWR, 0)
		if err != nil {
			closeResources()
			fmt.Fprintln(stderr, "cannot open console")
			return 1
		}
		// Do not close CONIN$: closing during a blocked read can hang on Windows; process exit releases it.
		source = console
		consoleFile = console
	}
	reader := bufio.NewReader(source)
	restore, err := keyModeEnter(consoleFile)
	if err != nil {
		fmt.Fprintf(stderr, "single-key approval unavailable (%v); press y then Enter\n", err)
	} else {
		defer restore()
	}

	kekPath, err := kek.DefaultPath()
	if err != nil {
		closeResources()
		fmt.Fprintln(stderr, err)
		return 1
	}
	allowed := make(map[string]bool)
	for _, id := range strings.Split(*allowKEK, ",") {
		id = strings.TrimSpace(id)
		if id != "" {
			allowed[id] = true
		}
	}
	var activeMu sync.RWMutex
	var active *rsa.PublicKey
	getActive := func() *rsa.PublicKey {
		activeMu.RLock()
		defer activeMu.RUnlock()
		return active
	}
	handler := service.NewHandler(service.Config{KEKPath: kekPath, AllowKEK: allowed, Rate: *rate, Burst: 100, Audit: logger, HMAC: handle, ActivePub: getActive, Out: os.Stdout})
	srv := newHTTPServer(*listen, handler, tlsConfig)
	ln, err := net.Listen("tcp", *listen)
	if err != nil {
		closeResources()
		fmt.Fprintln(stderr, err)
		return 1
	}
	serveErr := make(chan error, 1)
	go func() { serveErr <- srv.ServeTLS(ln, "", "") }()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	approvalDone := make(chan struct{})
	go approvalLoop(ctx, *pubkeyFile, reader, stdout, logger, &activeMu, &active, pinnedFP, approvalDone)
	select {
	case <-ctx.Done():
	case err := <-serveErr:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			fmt.Fprintln(stderr, err)
			stop()
		}
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	_ = srv.Shutdown(shutdownCtx)
	cancel()
	// approvalLoop returns on ctx.Done. Bounded wait in case it is mid-audit append. The console reader goroutine is never joined.
	select {
	case <-approvalDone:
	case <-time.After(2 * time.Second):
	}
	_ = logger.Append(audit.Record{RequestID: "-", Service: "tpm-service", Identity: "-", KeyID: "-", Action: "service.stop", Result: "ok"})
	closeResources()
	return 0
}

// loadTLSConfig loads the tpm-service leaf and CA from <pkiDir>/keyzone. Shared by serve and the e2e harness.
func loadTLSConfig(pkiDir string) (*tls.Config, error) {
	cert, err := tls.LoadX509KeyPair(filepath.Join(pkiDir, "keyzone", "tpm-service.pem"), filepath.Join(pkiDir, "keyzone", "tpm-service-key.pem"))
	if err != nil {
		return nil, err
	}
	caPEM, err := os.ReadFile(filepath.Join(pkiDir, "keyzone", "ca.pem"))
	if err != nil {
		return nil, err
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(caPEM) {
		return nil, errors.New("invalid CA certificate")
	}
	return service.TLSConfig(cert, pool), nil
}

// newHTTPServer builds the production HTTPS server. Shared by serve and the e2e harness.
func newHTTPServer(addr string, handler http.Handler, tlsConfig *tls.Config) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           handler,
		TLSConfig:         tlsConfig,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
}

// isWrongPIN matches tpm.Open's wrong-PIN error. tpm.mapAuthErr formats the message with lockout counts and does not wrap ErrWrongPIN, so the prefix is also checked.
func isWrongPIN(err error) bool {
	return errors.Is(err, tpm.ErrWrongPIN) || strings.HasPrefix(err.Error(), "wrong PIN")
}

type consoleAnswer struct {
	b   byte
	err error
}

func approvalLoop(ctx context.Context, path string, reader *bufio.Reader, stdout io.Writer, logger *audit.Logger, mu *sync.RWMutex, active **rsa.PublicKey, pinned string, done chan<- struct{}) {
	defer close(done)
	answers := make(chan consoleAnswer)
	// Reader goroutine owns the console. It is not joined on shutdown: a blocked console read cannot be interrupted; process exit ends it.
	go func() {
		for {
			b, err := reader.ReadByte()
			select {
			case answers <- consoleAnswer{b, err}:
			case <-ctx.Done():
				return
			}
			if err != nil {
				return
			}
		}
	}()
	rec := func(action, result string) error {
		return logger.Append(audit.Record{RequestID: "-", Service: "tpm-service", Identity: "-", KeyID: "-", Action: action, Result: result})
	}

	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	ch := answers // set to nil after console EOF/error so the select stops picking it
	last := ""    // hex SHA-256 of last seen file content; "" = missing
	prompting := false
	var pendingPub *rsa.PublicKey
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			data, err := os.ReadFile(path)
			cur := ""
			if err == nil {
				sum := sha256.Sum256(data)
				cur = hex.EncodeToString(sum[:])
			}
			if cur == last {
				continue
			}
			last = cur
			if prompting {
				prompting = false
				pendingPub = nil
				if err := rec("pubkey.cancel", "ok"); err != nil {
					fmt.Fprintln(stdout, "audit pubkey.cancel failed:", err)
				}
			}
			mu.Lock()
			wasActive := *active != nil
			*active = nil
			mu.Unlock()
			if wasActive {
				if err := rec("pubkey.revoke", "ok"); err != nil {
					fmt.Fprintln(stdout, "audit pubkey.revoke failed, key stays inactive:", err)
				}
			}
			if err != nil {
				continue
			}
			block, _ := pem.Decode(data)
			if block == nil || block.Type != "PUBLIC KEY" {
				continue
			}
			parsed, err := x509.ParsePKIXPublicKey(block.Bytes)
			pub, ok := parsed.(*rsa.PublicKey)
			if err != nil || !ok || pub.N.BitLen() != 3072 {
				continue
			}
			fpBytes := sha256.Sum256(block.Bytes)
			fp := "sha256:" + hex.EncodeToString(fpBytes[:])
			fmt.Fprintf(stdout, "Delivery key fingerprint: %s\n", fp)
			if pinned != "" && fp == pinned {
				// Audit first; activate only if the approve record was written.
				if err := rec("pubkey.approve", "ok"); err != nil {
					fmt.Fprintln(stdout, "audit pubkey.approve failed, key stays inactive:", err)
				} else {
					mu.Lock()
					*active = pub
					mu.Unlock()
					fmt.Fprintln(stdout, "Delivery key approved by --approve-fingerprint")
				}
				continue
			}
			if pinned != "" {
				fmt.Fprintln(stdout, "Delivery key fingerprint does not match --approve-fingerprint; manual approval required")
			}
			fmt.Fprintf(stdout, "Approve delivery key %s? [y/N] ", fp)
			prompting = true
			pendingPub = pub
		case a := <-ch:
			if a.err != nil {
				fmt.Fprintf(stdout, "console input closed: %v; approve with --approve-fingerprint\n", a.err)
				prompting = false
				pendingPub = nil
				ch = nil
				continue
			}
			if a.b == '\r' || a.b == '\n' || a.b == 0x03 {
				continue
			}
			if !prompting || a.b < 0x20 || a.b > 0x7e {
				continue
			}
			if a.b == 'y' || a.b == 'Y' {
				// Audit first; activate only if the approve record was written.
				if err := rec("pubkey.approve", "ok"); err != nil {
					fmt.Fprintln(stdout, "audit pubkey.approve failed, key stays inactive:", err)
				} else {
					mu.Lock()
					*active = pendingPub
					mu.Unlock()
				}
			} else if err := rec("pubkey.reject", "reject"); err != nil {
				fmt.Fprintln(stdout, "audit pubkey.reject failed:", err)
			}
			prompting = false
			pendingPub = nil
			fmt.Fprintln(stdout)
		}
	}
}
