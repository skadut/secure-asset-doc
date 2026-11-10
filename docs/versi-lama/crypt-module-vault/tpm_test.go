package main

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func setupTPM(t *testing.T, fail string) http.Handler {
	t.Helper()
	oldMode, oldVersion, oldKeyd, oldManager, oldMaster, oldVault := mode, version, keyd, keyManager, masterKey, vault
	t.Cleanup(func() {
		mode, version, keyd, keyManager, masterKey, vault = oldMode, oldVersion, oldKeyd, oldManager, oldMaster, oldVault
	})
	client, f := newFakeKeyd(t)
	if fail != "" {
		setFake(t, f, "fail", fail)
	}
	mode, version, keyd, keyManager, masterKey, vault = "tpm", "t1", client, nil, nil, nil
	r, err := routes()
	if err != nil {
		t.Fatal(err)
	}
	return r
}

// auditRecords: parse setiap baris JSON audit dari buffer.
func auditRecords(t *testing.T, s string) []auditRecord {
	t.Helper()
	var recs []auditRecord
	for _, line := range strings.Split(s, "\n") {
		if line == "" {
			continue
		}
		var rec auditRecord
		if err := json.Unmarshal([]byte(line), &rec); err != nil {
			t.Fatalf("bad audit line %q: %v", line, err)
		}
		recs = append(recs, rec)
	}
	return recs
}

// failNth: writer yang gagal pada write ke-n, write lain masuk buf.
type failNth struct {
	n, calls int
	buf      strings.Builder
}

func (f *failNth) Write(p []byte) (int, error) {
	f.calls++
	if f.calls == f.n {
		return 0, errors.New("disk penuh")
	}
	return f.buf.Write(p)
}

func TestTPMEncryptDecryptRoundTrip(t *testing.T) {
	h := setupTPM(t, "")
	enc := call(t, h, "/encrypt", `{"Plaintext":[{"Text":"hello"}]}`)
	var e struct{ Ciphertext []encItem }
	if enc.Code != 200 || json.Unmarshal(enc.Body.Bytes(), &e) != nil {
		t.Fatalf("encrypt: %d %s", enc.Code, enc.Body)
	}
	dec := call(t, h, "/decrypt", jsonOf(map[string]any{"Ciphertext": e.Ciphertext}))
	if dec.Code != 200 || !strings.Contains(dec.Body.String(), `"text":"hello"`) {
		t.Fatalf("decrypt: %d %s", dec.Code, dec.Body)
	}
}

func TestTPMSealUnseal(t *testing.T) {
	h := setupTPM(t, "")
	s := call(t, h, "/seal", `{"Plaintext":[{"Text":"sealed"}]}`)
	var v struct{ Ciphertext []textItem }
	if s.Code != 200 || json.Unmarshal(s.Body.Bytes(), &v) != nil {
		t.Fatalf("seal: %d %s", s.Code, s.Body)
	}
	u := call(t, h, "/unseal", jsonOf(map[string]any{"Ciphertext": v.Ciphertext}))
	if u.Code != 200 || !strings.Contains(u.Body.String(), `"text":"sealed"`) {
		t.Fatalf("unseal: %d %s", u.Code, u.Body)
	}
}

func TestTPMHMACVerify(t *testing.T) {
	h := setupTPM(t, "")
	m := call(t, h, "/hmac", `{"Message":"signed"}`)
	var v struct{ Value string }
	if m.Code != 200 || json.Unmarshal(m.Body.Bytes(), &v) != nil {
		t.Fatalf("hmac: %d %s", m.Code, m.Body)
	}
	verify := func(message, mac string) bool {
		w := call(t, h, "/verifyhmac", jsonOf(map[string]string{"Message": message, "HMACstring": mac}))
		return strings.Contains(w.Body.String(), `"Value":true`)
	}
	if !verify("signed", v.Value) || verify("other", v.Value) || verify("signed", strings.Replace(v.Value, fakeDekID, "d1123456789abcdef", 1)) {
		t.Fatal("TPM HMAC verification mismatch")
	}
}

func TestTPMBadDekID(t *testing.T) {
	h := setupTPM(t, "")
	w := call(t, h, "/decrypt", `{"Ciphertext":[{"versionkey":"t1:bad","text":"AA==","mac":"AAAAAAAAAAAAAAAAAAAAAA==","iv":"AAAAAAAAAAAAAAAA"}]}`)
	if w.Code != 501 {
		t.Fatalf("bad DEK status=%d: %s", w.Code, w.Body)
	}
}

func TestTPMKeydUnavailable(t *testing.T) {
	h := setupTPM(t, "unavailable")
	w := call(t, h, "/encrypt", `{"Plaintext":[{"Text":"x"}]}`)
	if w.Code != 503 || !strings.Contains(w.Body.String(), "key zone unavailable") {
		t.Fatalf("unavailable: %d %s", w.Code, w.Body)
	}
}

func certCN(cn string) *x509.Certificate {
	return &x509.Certificate{Subject: pkix.Name{CommonName: cn}}
}

func TestTPMAuthzForbidden(t *testing.T) {
	var logs strings.Builder
	a := &auditLog{prev: strings.Repeat("0", 64), out: &logs}
	h := authzHandler([]string{"app"}, a, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(200) }))
	r := httptest.NewRequest("GET", "/", nil)
	r.TLS = &tls.ConnectionState{PeerCertificates: []*x509.Certificate{certCN("intruder")}}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 403 || !strings.Contains(w.Body.String(), `"message":"forbidden"`) {
		t.Fatalf("authz: %d %s", w.Code, w.Body)
	}
	recs := auditRecords(t, logs.String())
	if len(recs) != 1 || recs[0].Action != "authz" || recs[0].Result != "denied" {
		t.Fatalf("audit records: %+v", recs)
	}
}

func TestTPMAuthzAllowed(t *testing.T) {
	h := authzHandler([]string{"app"}, nil, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(200) }))
	r := httptest.NewRequest("GET", "/", nil)
	r.TLS = &tls.ConnectionState{PeerCertificates: []*x509.Certificate{certCN("app")}}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatalf("authz allowed status=%d", w.Code)
	}
}

func TestAuditHashVector(t *testing.T) {
	prev := strings.Repeat("0", 64)
	tm, req, service, identity, keyID, action, result := "2026-11-03T10:00:00.123456789Z", "req-abc12345", "crypto-api", "app", "d0123456789abcdef", "op.encrypt", "ok"
	input := prev + "|" + tm + "|" + req + "|" + service + "|" + identity + "|" + keyID + "|0|" + action + "|" + result
	sum := sha256.Sum256([]byte(input))
	if auditHash(prev, tm, req, service, identity, keyID, 0, action, result) != hex.EncodeToString(sum[:]) {
		t.Fatal("audit vector mismatch")
	}
	// Sanitasi: field berisi delimiter dan newline.
	sanitized := auditSanitize.Replace("time|bad\n")
	want := sha256.Sum256([]byte(prev + "|" + sanitized + "|req|svc|id|key|0|act|ok"))
	if auditHash(prev, "time|bad\n", "req", "svc", "id", "key", 0, "act", "ok") != hex.EncodeToString(want[:]) {
		t.Fatal("audit sanitization mismatch")
	}
}

func TestAuditChainResume(t *testing.T) {
	path := filepath.Join(t.TempDir(), "audit.log")
	a, err := newAuditLog(path)
	if err != nil {
		t.Fatal(err)
	}
	a.out = nil
	a.log("request-0001", "app", "", "op.encrypt", "ok")
	first := a.prev
	a.log("request-0002", "app", "", "op.decrypt", "ok")
	if err := a.file.Close(); err != nil {
		t.Fatal(err)
	}
	b, err := newAuditLog(path)
	if err != nil {
		t.Fatal(err)
	}
	defer b.file.Close()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	var second auditRecord
	if err := json.Unmarshal([]byte(lines[1]), &second); err != nil {
		t.Fatal(err)
	}
	if second.PrevHash != first || b.prev != second.Hash {
		t.Fatalf("chain resume mismatch: %q %q", second.PrevHash, first)
	}
}

// Write gagal: record berikutnya harus rantai ke record terakhir yang benar-benar tertulis.
func TestAuditChainSkipsFailedWrite(t *testing.T) {
	w := &failNth{n: 2}
	a := &auditLog{prev: strings.Repeat("0", 64), out: w}
	a.log("request-0001", "app", "", "op.encrypt", "ok")
	a.log("request-0002", "app", "", "op.decrypt", "ok") // gagal tulis, prev tidak maju
	a.log("request-0003", "app", "", "op.seal", "ok")
	recs := auditRecords(t, w.buf.String())
	if len(recs) != 2 || recs[1].PrevHash != recs[0].Hash || a.prev != recs[1].Hash {
		t.Fatalf("chain after failed write: %+v", recs)
	}
}

// /encrypt tpm: key_id di audit harus sama dengan DEK id di prefix t1 respons.
func TestTPMEncryptAuditKeyID(t *testing.T) {
	h := setupTPM(t, "")
	var logs strings.Builder
	ah := auditHandler(&auditLog{prev: strings.Repeat("0", 64), out: &logs}, h)
	enc := call(t, ah, "/encrypt", `{"Plaintext":[{"Text":"audit"}]}`)
	var e struct{ Ciphertext []encItem }
	if enc.Code != 200 || json.Unmarshal(enc.Body.Bytes(), &e) != nil || len(e.Ciphertext) != 1 {
		t.Fatalf("encrypt: %d %s", enc.Code, enc.Body)
	}
	want := strings.TrimPrefix(e.Ciphertext[0].Versionkey, "t1:")
	recs := auditRecords(t, logs.String())
	if want == "" || len(recs) != 1 || recs[0].Action != "op.encrypt" || recs[0].KeyID != want {
		t.Fatalf("audit key_id: want %q, records %+v", want, recs)
	}
}

// Audit gagal tulis: fail-closed 503, request berikutnya tetap diaudit.
func TestTPMAuditFailClosed(t *testing.T) {
	h := setupTPM(t, "")
	w := &failNth{n: 1}
	ah := auditHandler(&auditLog{prev: strings.Repeat("0", 64), out: w}, h)
	r1 := call(t, ah, "/encrypt", `{"Plaintext":[{"Text":"x"}]}`)
	if r1.Code != 503 || strings.TrimSpace(r1.Body.String()) != `{"fault":{"code":503,"message":"audit unavailable"}}` || strings.Contains(r1.Body.String(), "versionkey") {
		t.Fatalf("audit fail-closed: %d %s", r1.Code, r1.Body)
	}
	r2 := call(t, ah, "/encrypt", `{"Plaintext":[{"Text":"y"}]}`)
	if r2.Code != 200 {
		t.Fatalf("second request: %d %s", r2.Code, r2.Body)
	}
	recs := auditRecords(t, w.buf.String())
	if len(recs) != 1 || recs[0].Action != "op.encrypt" {
		t.Fatalf("audit records: %+v", recs)
	}
}

// Koneksi pool diputus sisi server: panggilan kedua harus sukses lewat satu dial ulang.
func TestKeydStalePooledConnRetry(t *testing.T) {
	_, f := newFakeKeyd(t)
	var mu sync.Mutex
	var servers []net.Conn
	client := newKeydClientDial(func(ctx context.Context) (net.Conn, error) {
		c, s := net.Pipe()
		mu.Lock()
		servers = append(servers, s)
		mu.Unlock()
		go f.serve(s)
		return c, nil
	})
	old := keyd
	keyd = client
	defer func() { keyd = old }()
	if _, _, _, err := keydEncrypt(context.Background(), []byte("first")); err != nil {
		t.Fatalf("first call: %v", err)
	}
	mu.Lock()
	servers[0].Close() // keyd memutus koneksi yang masih ada di pool
	mu.Unlock()
	if _, _, _, err := keydEncrypt(context.Background(), []byte("second")); err != nil {
		t.Fatalf("second call on stale pooled conn: %v", err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(servers) != 2 {
		t.Fatalf("expected one fresh dial for retry, got %d dials", len(servers))
	}
}

func TestTPMNoKeyMaterial(t *testing.T) {
	setupTPM(t, "")
	if masterKey != nil || keyManager != nil {
		t.Fatal("TPM mode has local key material")
	}
}

func TestConfigTPM(t *testing.T) {
	t.Setenv("CRYPTO_MODE", "tpm")
	t.Setenv("APP_IDENTITIES", "a, b,,")
	c, err := loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(c.AppIDs, ",") != "a,b" || c.KeydSocket == "" || c.TLSCert == "" || c.TLSKey == "" || c.TLSClientCA == "" {
		t.Fatalf("config=%+v", c)
	}
	t.Setenv("APP_IDENTITIES", ", ,")
	c, err = loadConfig()
	if err != nil || len(c.AppIDs) != 1 || c.AppIDs[0] != "app" {
		t.Fatalf("default identities: %+v %v", c, err)
	}
	t.Setenv("CRYPTO_MODE", "x")
	if _, err = loadConfig(); err == nil || !strings.Contains(err.Error(), "CRYPTO_MODE harus safe, unsafe, atau tpm") {
		t.Fatalf("invalid mode error: %v", err)
	}
}
