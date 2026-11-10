package service

import (
	"bytes"
	"crypto/hmac"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"tpm-msk/internal/audit"
	"tpm-msk/internal/delivery"
	"tpm-msk/internal/envelope"
	"tpm-msk/internal/kek"
)

type fakeHMAC struct{}

func (fakeHMAC) HMAC(msg []byte) ([]byte, error) {
	m := hmac.New(sha256.New, []byte("unit-test-only-fixed-key"))
	_, _ = m.Write(msg)
	return m.Sum(nil), nil
}

type fakeAudit struct {
	mu      sync.Mutex
	records []audit.Record
}

func (a *fakeAudit) Append(r audit.Record) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.records = append(a.records, r)
	return nil
}

var (
	rsaOnce  sync.Once
	testPriv *rsa.PrivateKey
	rsaErr   error
)

func testRSA(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	rsaOnce.Do(func() { testPriv, rsaErr = rsa.GenerateKey(rand.Reader, 3072) })
	if rsaErr != nil {
		t.Fatal("RSA key generation failed")
	}
	return testPriv
}

// testHandler returns the handler and the KEK file path it reads.
func testHandler(t *testing.T, allow map[string]bool, burst int, rate float64, logger *fakeAudit) (http.Handler, string) {
	t.Helper()
	path := t.TempDir() + "/keks.json"
	if _, err := kek.Create(path, fakeHMAC{}, "primary"); err != nil {
		t.Fatal("KEK fixture creation failed")
	}
	priv := testRSA(t)
	h := NewHandler(Config{
		KEKPath: path, AllowKEK: allow, Rate: rate, Burst: burst, Audit: logger,
		HMAC: fakeHMAC{}, ActivePub: func() *rsa.PublicKey { return &priv.PublicKey },
	})
	return h, path
}

// fixtureKEK returns the plaintext KEK of kek_id "primary" version 1. Caller zeroes it.
func fixtureKEK(t *testing.T, path string) []byte {
	t.Helper()
	f, err := kek.Load(path)
	if err != nil {
		t.Fatal("KEK fixture load failed")
	}
	env, ok := kek.Lookup(f, "primary", 1)
	if !ok {
		t.Fatal("fixture entry missing")
	}
	kekPlain, _, err := envelope.Unwrap(fakeHMAC{}, env)
	if err != nil {
		t.Fatal("fixture unwrap failed")
	}
	return kekPlain
}

func request(t *testing.T, h http.Handler, cn string, nonce []byte, id string) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(struct {
		KEKID   string `json:"kek_id"`
		Version int    `json:"version"`
		Nonce   []byte `json:"nonce"`
	}{id, 1, nonce})
	if err != nil {
		t.Fatal("request encoding failed")
	}
	r := httptest.NewRequest("POST", routePath, bytes.NewReader(body))
	r.Header.Set("X-Request-ID", "test-request-0001")
	r.TLS = &tls.ConnectionState{PeerCertificates: []*x509.Certificate{{Subject: pkix.Name{CommonName: cn}}}}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestIdentityDenied(t *testing.T) {
	h, _ := testHandler(t, map[string]bool{"primary": true}, 10, 100, &fakeAudit{})
	w := request(t, h, "other", bytes.Repeat([]byte{1}, 32), "primary")
	if w.Code != 403 || w.Body.String() != bodyUnauthorized {
		t.Fatal("identity denial response mismatch")
	}
}

func TestKEKNotAllowed(t *testing.T) {
	h, _ := testHandler(t, map[string]bool{}, 10, 100, &fakeAudit{})
	w := request(t, h, peerCN, bytes.Repeat([]byte{2}, 32), "primary")
	if w.Code != 403 || w.Body.String() != bodyUnauthorized {
		t.Fatal("KEK authorization response mismatch")
	}
}

func TestValidWrapRoundTrip(t *testing.T) {
	h, path := testHandler(t, map[string]bool{"primary": true}, 100, 1000, &fakeAudit{})
	nonce := bytes.Repeat([]byte{3}, 32)
	w := request(t, h, peerCN, nonce, "primary")
	if w.Code != 200 {
		t.Fatal("valid request failed")
	}
	var result struct {
		KEKID      string `json:"kek_id"`
		Version    int    `json:"version"`
		WrappedKEK string `json:"wrapped_kek"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal("success response is invalid JSON")
	}
	wrapped, err := base64.StdEncoding.DecodeString(result.WrappedKEK)
	if err != nil {
		t.Fatal("wrapped KEK is invalid base64")
	}
	got, err := delivery.Unwrap(testRSA(t), wrapped, "primary", 1, nonce)
	if err != nil {
		t.Fatal("delivery unwrap failed")
	}
	defer clear(got)

	expected := fixtureKEK(t, path)
	defer clear(expected)
	if !bytes.Equal(got, expected) {
		t.Fatal("round-trip KEK mismatch")
	}
}

func TestNonceValidation(t *testing.T) {
	for _, nonce := range [][]byte{nil, bytes.Repeat([]byte{4}, 31), bytes.Repeat([]byte{5}, 33)} {
		h, _ := testHandler(t, map[string]bool{"primary": true}, 10, 100, &fakeAudit{})
		w := request(t, h, peerCN, nonce, "primary")
		if w.Code != 400 || w.Body.String() != bodyBadRequest {
			t.Fatal("nonce validation response mismatch")
		}
	}
}

func TestRateLimit(t *testing.T) {
	h, _ := testHandler(t, map[string]bool{"primary": true}, 1, 0.000001, &fakeAudit{})
	nonce := bytes.Repeat([]byte{6}, 32)
	if w := request(t, h, peerCN, nonce, "primary"); w.Code != 200 {
		t.Fatal("first request should pass")
	}
	w := request(t, h, peerCN, nonce, "primary")
	if w.Code != 429 || w.Body.String() != bodyRateLimited {
		t.Fatal("rate limit response mismatch")
	}
}

func TestAuditDoesNotContainSecrets(t *testing.T) {
	logger := &fakeAudit{}
	h, path := testHandler(t, map[string]bool{}, 10, 100, logger)
	nonce := bytes.Repeat([]byte{7}, 32)
	w := request(t, h, peerCN, nonce, "primary")
	if w.Code != 403 || w.Body.String() != bodyUnauthorized {
		t.Fatal("expected kek_not_allowed denial response")
	}
	kekPlain := fixtureKEK(t, path)
	defer clear(kekPlain)
	logger.mu.Lock()
	defer logger.mu.Unlock()
	var sb strings.Builder
	denied := false
	for _, r := range logger.records {
		if r.Result == "denied:kek_not_allowed" {
			denied = true
		}
		b, err := json.Marshal(r)
		if err != nil {
			t.Fatal("audit record encoding failed")
		}
		sb.Write(b)
	}
	joined := sb.String()
	if len(logger.records) == 0 {
		t.Fatal("no audit record written")
	}
	if !denied {
		t.Fatal("no denied:kek_not_allowed audit record written")
	}
	if strings.Contains(joined, base64.StdEncoding.EncodeToString(nonce)) ||
		strings.Contains(joined, hex.EncodeToString(kekPlain)) ||
		strings.Contains(joined, base64.StdEncoding.EncodeToString(kekPlain)) {
		t.Fatal("audit record contains sensitive data")
	}
}

// marshalRequest mirrors the request struct used by request(). Goroutine-safe: no t calls.
func marshalRequest(id string, nonce []byte) ([]byte, error) {
	return json.Marshal(struct {
		KEKID   string `json:"kek_id"`
		Version int    `json:"version"`
		Nonce   []byte `json:"nonce"`
	}{id, 1, nonce})
}

// rawRequest posts body verbatim (no re-encoding) with the same TLS peer setup as request().
func rawRequest(t *testing.T, h http.Handler, cn, body string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest("POST", routePath, strings.NewReader(body))
	r.Header.Set("X-Request-ID", "test-request-0001")
	r.TLS = &tls.ConnectionState{PeerCertificates: []*x509.Certificate{{Subject: pkix.Name{CommonName: cn}}}}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestTrailingJSONRejected(t *testing.T) {
	h, _ := testHandler(t, map[string]bool{"primary": true}, 100, 1000, &fakeAudit{})
	valid, err := marshalRequest("primary", bytes.Repeat([]byte{8}, 32))
	if err != nil {
		t.Fatal("request encoding failed")
	}
	for _, tc := range []struct{ name, body string }{
		{"object_then_empty_object", string(valid) + " {}"},
		{"object_then_garbage", string(valid) + " x"},
		{"object_then_second_object_next_line", string(valid) + "\n" + string(valid)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := rawRequest(t, h, peerCN, tc.body)
			if w.Code != 400 || w.Body.String() != bodyBadRequest {
				t.Fatal("trailing data response mismatch")
			}
		})
	}
}

func TestLabelMismatchDenied(t *testing.T) {
	path := t.TempDir() + "/keks.json"
	// Entry claims kek_id "primary" version 1 but the envelope is bound to label "kek/other/1".
	env, err := envelope.Wrap(fakeHMAC{}, "kek/other/1", bytes.Repeat([]byte{9}, 32))
	if err != nil {
		t.Fatal("envelope wrap failed")
	}
	f := kek.File{V: 1, Keks: []kek.Entry{{KEKID: "primary", Version: 1, Created: "2026-01-01T00:00:00Z", Envelope: env}}}
	if err := kek.Save(path, f); err != nil {
		t.Fatal("KEK file save failed")
	}
	logger := &fakeAudit{}
	priv := testRSA(t)
	h := NewHandler(Config{
		KEKPath: path, AllowKEK: map[string]bool{"primary": true}, Rate: 100, Burst: 10,
		Audit: logger, HMAC: fakeHMAC{}, ActivePub: func() *rsa.PublicKey { return &priv.PublicKey },
	})
	w := request(t, h, peerCN, bytes.Repeat([]byte{11}, 32), "primary")
	if w.Code != 403 || w.Body.String() != bodyUnauthorized {
		t.Fatal("label mismatch response mismatch")
	}
	if strings.Contains(w.Body.String(), "wrapped_kek") {
		t.Fatal("label mismatch response contains wrapped KEK")
	}
	logger.mu.Lock()
	defer logger.mu.Unlock()
	found := false
	for _, r := range logger.records {
		if r.Result == "denied:label_mismatch" {
			found = true
		}
	}
	if !found {
		t.Fatal("no denied:label_mismatch audit record written")
	}
}

func TestKEKStdoutLines(t *testing.T) {
	path := t.TempDir() + "/keks.json"
	if _, err := kek.Create(path, fakeHMAC{}, "primary"); err != nil {
		t.Fatal("KEK fixture creation failed")
	}
	priv := testRSA(t)
	var out bytes.Buffer
	h := NewHandler(Config{
		KEKPath: path, AllowKEK: map[string]bool{"primary": true}, Rate: 100, Burst: 10,
		Audit: &fakeAudit{}, HMAC: fakeHMAC{}, ActivePub: func() *rsa.PublicKey { return &priv.PublicKey }, Out: &out,
	})
	if w := request(t, h, peerCN, bytes.Repeat([]byte{12}, 32), "primary"); w.Code != 200 {
		t.Fatal("valid request failed")
	}
	if !strings.Contains(out.String(), "[kek] delivered ") {
		t.Fatal("success stdout line missing")
	}

	out.Reset()
	h = NewHandler(Config{
		KEKPath: path, AllowKEK: map[string]bool{}, Rate: 100, Burst: 10,
		Audit: &fakeAudit{}, HMAC: fakeHMAC{}, ActivePub: func() *rsa.PublicKey { return &priv.PublicKey }, Out: &out,
	})
	if w := request(t, h, peerCN, bytes.Repeat([]byte{13}, 32), "primary"); w.Code != 403 {
		t.Fatal("expected kek_not_allowed denial")
	}
	if !strings.Contains(out.String(), "[kek] failed denied:kek_not_allowed") {
		t.Fatal("denial stdout line missing")
	}
}

// failingAudit rejects every record, simulating a broken audit sink.
type failingAudit struct{}

func (failingAudit) Append(audit.Record) error { return errors.New("audit disk full") }

func TestAuditFailureFailsClosed(t *testing.T) {
	path := t.TempDir() + "/keks.json"
	if _, err := kek.Create(path, fakeHMAC{}, "primary"); err != nil {
		t.Fatal("KEK fixture creation failed")
	}
	priv := testRSA(t)
	h := NewHandler(Config{
		KEKPath: path, AllowKEK: map[string]bool{"primary": true}, Rate: 100, Burst: 10,
		Audit: failingAudit{}, HMAC: fakeHMAC{}, ActivePub: func() *rsa.PublicKey { return &priv.PublicKey },
	})
	w := request(t, h, peerCN, bytes.Repeat([]byte{10}, 32), "primary")
	// 503, not 500: the failure is transient and retryable, and the body reveals no internals.
	// 503, not 403: authorization already passed; this is an internal recording failure.
	// The KEK is not delivered because the success record could not be written (fail-closed).
	if w.Code != 503 || w.Body.String() != bodyUnavailable {
		t.Fatal("audit failure response mismatch")
	}
	if strings.Contains(w.Body.String(), "wrapped_kek") {
		t.Fatal("KEK delivered without a success audit record")
	}
}

// postConcurrent is goroutine-safe: it returns errors instead of calling t methods.
func postConcurrent(h http.Handler, id string, nonce []byte) (int, string, error) {
	body, err := marshalRequest(id, nonce)
	if err != nil {
		return 0, "", err
	}
	r := httptest.NewRequest("POST", routePath, bytes.NewReader(body))
	r.Header.Set("X-Request-ID", "test-request-0001")
	r.TLS = &tls.ConnectionState{PeerCertificates: []*x509.Certificate{{Subject: pkix.Name{CommonName: peerCN}}}}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w.Code, w.Body.String(), nil
}

func TestConcurrentRequests(t *testing.T) {
	logger := &fakeAudit{}
	// testHandler calls testRSA on this goroutine before any worker starts.
	h, _ := testHandler(t, map[string]bool{"primary": true}, 1000, 1000, logger)
	const n = 32
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			nonce := bytes.Repeat([]byte{byte(i + 1)}, 32)
			code, body, err := postConcurrent(h, "primary", nonce)
			if err != nil {
				t.Errorf("goroutine %d: request encoding failed", i)
				return
			}
			if code != 200 {
				t.Errorf("goroutine %d: status %d, want 200", i, code)
				return
			}
			var result struct {
				KEKID   string `json:"kek_id"`
				Version int    `json:"version"`
			}
			if err := json.Unmarshal([]byte(body), &result); err != nil {
				t.Errorf("goroutine %d: success response is invalid JSON", i)
				return
			}
			if result.KEKID != "primary" || result.Version != 1 {
				t.Errorf("goroutine %d: kek_id/version mismatch", i)
			}
		}(i)
	}
	wg.Wait()
	logger.mu.Lock()
	defer logger.mu.Unlock()
	ok := 0
	for _, r := range logger.records {
		if r.Result == "ok" {
			ok++
		}
	}
	if ok != n {
		t.Errorf("success audit records = %d, want %d", ok, n)
	}
}
