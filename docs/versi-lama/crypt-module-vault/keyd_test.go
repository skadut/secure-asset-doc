package main

import (
	"bufio"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"strings"
	"sync"
	"testing"
)

const fakeDekID = "d0123456789abcdef"

type fakeKeyd struct {
	mu       sync.Mutex
	fail     string
	down     bool
	badDek   bool
	requests int
	lastID   string
	key      []byte
	aead     cipher.AEAD
}

func newFakeKeyd(t *testing.T) (*keydClient, *fakeKeyd) {
	t.Helper()
	f := &fakeKeyd{key: make([]byte, 32)}
	if _, err := rand.Read(f.key); err != nil {
		t.Fatalf("random AES key: %v", err)
	}
	block, err := aes.NewCipher(f.key)
	if err != nil {
		t.Fatalf("AES cipher: %v", err)
	}
	f.aead, err = cipher.NewGCM(block)
	if err != nil {
		t.Fatalf("GCM: %v", err)
	}
	return newKeydClientDial(func(ctx context.Context) (net.Conn, error) {
		f.mu.Lock()
		down := f.down
		f.mu.Unlock()
		if down {
			return nil, errors.New("fake keyd down")
		}
		client, server := net.Pipe()
		go f.serve(server)
		return client, nil
	}), f
}

func (f *fakeKeyd) serve(c net.Conn) {
	defer c.Close()
	br := bufio.NewReader(c)
	for {
		line, err := br.ReadBytes('\n')
		if err != nil {
			return
		}
		var req map[string]string
		if json.Unmarshal(line, &req) != nil {
			return
		}
		f.mu.Lock()
		f.requests++
		f.lastID = req["id"]
		fail, badDek := f.fail, f.badDek
		f.mu.Unlock()
		var resp map[string]any
		if fail != "" {
			resp = map[string]any{"ok": false, "error": fail}
		} else {
			dekID := fakeDekID
			if badDek && req["op"] == "encrypt" {
				dekID = "xyz"
			}
			resp, err = f.respond(req, dekID)
			if err != nil {
				resp = map[string]any{"ok": false, "error": "bad_cipher"}
			}
		}
		if id := req["id"]; id != "" {
			resp["id"] = id
		}
		b, _ := json.Marshal(resp)
		if _, err := c.Write(append(b, '\n')); err != nil {
			return
		}
	}
}

func (f *fakeKeyd) respond(req map[string]string, dekID string) (map[string]any, error) {
	switch req["op"] {
	case "encrypt":
		pt, err := base64.StdEncoding.DecodeString(req["plaintext"])
		if err != nil {
			return nil, err
		}
		iv := make([]byte, 12)
		if _, err := rand.Read(iv); err != nil {
			return nil, err
		}
		ct := f.aead.Seal(nil, iv, pt, nil)
		return map[string]any{"ok": true, "dek_id": dekID, "iv": base64.StdEncoding.EncodeToString(iv), "ct": base64.StdEncoding.EncodeToString(ct)}, nil
	case "decrypt":
		iv, e1 := base64.StdEncoding.DecodeString(req["iv"])
		ct, e2 := base64.StdEncoding.DecodeString(req["ct"])
		if e1 != nil || e2 != nil || req["dek_id"] != fakeDekID {
			return nil, errors.New("bad decrypt request")
		}
		pt, err := f.aead.Open(nil, iv, ct, nil)
		if err != nil {
			return nil, err
		}
		return map[string]any{"ok": true, "plaintext": base64.StdEncoding.EncodeToString(pt)}, nil
	case "hmac":
		msg, err := base64.StdEncoding.DecodeString(req["message"])
		if err != nil || (req["dek_id"] != "" && req["dek_id"] != fakeDekID) {
			return nil, errors.New("bad hmac request")
		}
		mac := hmac.New(sha256.New, []byte("fixed fake hmac key"))
		_, _ = mac.Write(msg)
		return map[string]any{"ok": true, "dek_id": dekID, "mac": base64.StdEncoding.EncodeToString(mac.Sum(nil))}, nil
	default:
		return nil, errors.New("unknown op")
	}
}

func setFake(t *testing.T, f *fakeKeyd, field string, value any) {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	switch field {
	case "fail":
		f.fail = value.(string)
	case "down":
		f.down = value.(bool)
	case "badDek":
		f.badDek = value.(bool)
	}
}

func TestKeydEncryptDecryptRoundTrip(t *testing.T) {
	client, _ := newFakeKeyd(t)
	old := keyd
	keyd = client
	defer func() { keyd = old }()
	pt := []byte("keyd round trip")
	dek, iv, ct, err := keydEncrypt(context.Background(), pt)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if !keydDekRe.MatchString(dek) {
		t.Fatalf("invalid dek id %q", dek)
	}
	got, err := keydDecrypt(context.Background(), dek, iv, ct)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	defer wipe(got)
	if string(got) != string(pt) {
		t.Fatalf("plaintext mismatch: got %q", got)
	}
}

func TestKeydHMAC(t *testing.T) {
	client, f := newFakeKeyd(t)
	old := keyd
	keyd = client
	defer func() { keyd = old }()
	msg := []byte("authenticated message")
	dek, got, err := keydHMAC(context.Background(), msg, "")
	if err != nil {
		t.Fatalf("hmac without dek id: %v", err)
	}
	want := hmac.New(sha256.New, []byte("fixed fake hmac key"))
	_, _ = want.Write(msg)
	if dek != fakeDekID || !hmac.Equal(got, want.Sum(nil)) || len(got) != 32 {
		t.Fatalf("unexpected HMAC result: dek=%q mac=%x", dek, got)
	}
	if _, _, err := keydHMAC(context.Background(), msg, fakeDekID); err != nil {
		t.Fatalf("hmac with dek id: %v", err)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.requests != 2 {
		t.Fatalf("expected two requests, got %d", f.requests)
	}
}

func TestKeydUnavailable(t *testing.T) {
	client, f := newFakeKeyd(t)
	old := keyd
	keyd = client
	defer func() { keyd = old }()
	setFake(t, f, "fail", "unavailable")
	_, _, _, err := keydEncrypt(context.Background(), []byte("x"))
	if !errors.Is(err, errZone) {
		t.Fatalf("expected errZone, got %v", err)
	}
}

func TestKeydBadCipher(t *testing.T) {
	client, f := newFakeKeyd(t)
	old := keyd
	keyd = client
	defer func() { keyd = old }()
	setFake(t, f, "fail", "bad_cipher")
	_, _, _, err := keydEncrypt(context.Background(), []byte("x"))
	if !errors.Is(err, errBadCipher) {
		t.Fatalf("expected errBadCipher, got %v", err)
	}
}

func TestKeydInternalError(t *testing.T) {
	client, f := newFakeKeyd(t)
	old := keyd
	keyd = client
	defer func() { keyd = old }()
	setFake(t, f, "fail", "internal")
	_, _, _, err := keydEncrypt(context.Background(), []byte("x"))
	if err == nil || errors.Is(err, errZone) || errors.Is(err, errBadCipher) {
		t.Fatalf("expected generic rejection, got %v", err)
	}
}

func TestKeydDialFailure(t *testing.T) {
	client, f := newFakeKeyd(t)
	old := keyd
	keyd = client
	defer func() { keyd = old }()
	setFake(t, f, "down", true)
	_, _, _, err := keydEncrypt(context.Background(), []byte("x"))
	if !errors.Is(err, errZone) {
		t.Fatalf("expected errZone, got %v", err)
	}
}

func TestKeydInvalidDekDoesNotSend(t *testing.T) {
	client, f := newFakeKeyd(t)
	old := keyd
	keyd = client
	defer func() { keyd = old }()
	_, err := keydDecrypt(context.Background(), "bad", nil, nil)
	if !errors.Is(err, errBadCipher) {
		t.Fatalf("expected errBadCipher, got %v", err)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.requests != 0 {
		t.Fatalf("expected zero requests, got %d", f.requests)
	}
}

func TestKeydMalformedDek(t *testing.T) {
	client, f := newFakeKeyd(t)
	old := keyd
	keyd = client
	defer func() { keyd = old }()
	setFake(t, f, "badDek", true)
	dek, _, _, err := keydEncrypt(context.Background(), []byte("x"))
	if err == nil || dek != "" {
		t.Fatalf("expected invalid response and empty dek id, got dek=%q err=%v", dek, err)
	}
}

func TestKeydPoolSequential(t *testing.T) {
	client, _ := newFakeKeyd(t)
	old := keyd
	keyd = client
	defer func() { keyd = old }()
	for i := 0; i < 20; i++ {
		if _, _, _, err := keydEncrypt(context.Background(), []byte(fmt.Sprint(i))); err != nil {
			t.Fatalf("encrypt %d: %v", i, err)
		}
	}
}

func TestKeydRequestID(t *testing.T) {
	client, f := newFakeKeyd(t)
	old := keyd
	keyd = client
	defer func() { keyd = old }()
	ctx := withReqID(context.Background(), "req-abc12345")
	if got := reqIDFrom(ctx); got != "req-abc12345" {
		t.Fatalf("request id mismatch: %q", got)
	}
	if _, _, _, err := keydEncrypt(ctx, []byte("x")); err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.lastID != "req-abc12345" {
		t.Fatalf("server saw request id %q", f.lastID)
	}
}

func TestKeydReadLineLimit(t *testing.T) {
	r := bufio.NewReader(strings.NewReader(strings.Repeat("x", keydMaxLine+1) + "\n"))
	if _, err := readKeydLine(r); err == nil {
		t.Fatal("expected oversized line error")
	}
}
