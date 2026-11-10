package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

var (
	testMaster = bytes.Repeat([]byte{0x42}, 32)
	testDEK    = bytes.Repeat([]byte{0x24}, 32)
)

func setup(t *testing.T, safe bool) http.Handler {
	t.Helper()
	oldMode, oldVersion, oldTTL, oldKey, oldManager, oldVault := mode, version, keyTTL, masterKey, keyManager, vault
	t.Cleanup(func() {
		mode, version, keyTTL, masterKey, keyManager, vault = oldMode, oldVersion, oldTTL, oldKey, oldManager, oldVault
	})
	masterKey = append([]byte(nil), testMaster...)
	version, keyTTL, vault, keyManager, mode = "s0", time.Minute, nil, nil, "unsafe"
	if safe {
		mode, version = "safe", "k1"
	}
	r, err := routes()
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func call(t *testing.T, h http.Handler, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodPost, path, strings.NewReader(body)))
	return w
}

func jsonOf(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func rawOf(t *testing.T, s string) []byte {
	t.Helper()
	b, err := unb64(s)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func fakeVault(t *testing.T, failUnwrap bool) (*VaultClient, *int) {
	t.Helper()
	unwraps := 0
	const wrapped = "vault:v1:dummy"
	s := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/auth/cert/login":
			fmt.Fprint(w, `{"auth":{"client_token":"test-token","lease_duration":3600}}`)
		case "/v1/transit/datakey/wrapped/crypto-module-kek":
			fmt.Fprintf(w, `{"data":{"ciphertext":%q}}`, wrapped)
		case "/v1/transit/decrypt/crypto-module-kek":
			unwraps++
			if failUnwrap {
				w.WriteHeader(503)
				fmt.Fprint(w, `{"errors":["unavailable"]}`)
				return
			}
			fmt.Fprintf(w, `{"data":{"plaintext":%q}}`, b64(testDEK))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(s.Close)
	return &VaultClient{addresses: []string{s.URL}, http: &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}}}, &unwraps
}

func TestUnsafeRoutesRoundTrip(t *testing.T) {
	h := setup(t, false)
	enc := call(t, h, "/encrypt", `{"Plaintext":[{"Text":"roundtrip"}]}`)
	var e struct{ Ciphertext []encItem }
	if enc.Code != 200 || json.Unmarshal(enc.Body.Bytes(), &e) != nil || len(e.Ciphertext) != 1 {
		t.Fatalf("encrypt: %d %s", enc.Code, enc.Body)
	}
	ct := e.Ciphertext[0]
	if ct.Versionkey != "s0" || bytes.Contains(rawOf(t, ct.Text), []byte("roundtrip")) {
		t.Fatalf("unsafe item: vk=%q or plaintext visible", ct.Versionkey)
	}
	dec := call(t, h, "/decrypt", jsonOf(map[string]any{"Ciphertext": e.Ciphertext}))
	if dec.Code != 200 || !strings.Contains(dec.Body.String(), `"text":"roundtrip"`) {
		t.Fatalf("decrypt: %d %s", dec.Code, dec.Body)
	}
	raw := rawOf(t, ct.Text)
	raw[0] ^= 1
	tampered := ct
	tampered.Text = b64(raw)
	if got := call(t, h, "/decrypt", jsonOf(map[string]any{"Ciphertext": []encItem{tampered}})); got.Code != 501 {
		t.Fatalf("tampered ciphertext accepted: %d", got.Code)
	}
	sealed := call(t, h, "/seal", `{"Plaintext":[{"Text":"secret"}]}`)
	var s struct{ Ciphertext []textItem }
	if sealed.Code != 200 || json.Unmarshal(sealed.Body.Bytes(), &s) != nil || len(s.Ciphertext) != 1 || !strings.HasPrefix(s.Ciphertext[0].Text, "s0:") {
		t.Fatalf("seal: %d %s", sealed.Code, sealed.Body)
	}
	if bytes.Contains(rawOf(t, strings.TrimPrefix(s.Ciphertext[0].Text, "s0:")), []byte("secret")) {
		t.Fatal("seal: plaintext visible")
	}
	unsealed := call(t, h, "/unseal", jsonOf(map[string]any{"Ciphertext": s.Ciphertext}))
	if unsealed.Code != 200 || !strings.Contains(unsealed.Body.String(), `"text":"secret"`) {
		t.Fatalf("unseal: %d %s", unsealed.Code, unsealed.Body)
	}
	macResp := call(t, h, "/hmac", `{"Message":"signed"}`)
	var m struct{ Value string }
	if macResp.Code != 200 || json.Unmarshal(macResp.Body.Bytes(), &m) != nil || m.Value == "" {
		t.Fatalf("hmac: %d %s", macResp.Code, macResp.Body)
	}
	if v := call(t, h, "/verifyhmac", jsonOf(map[string]any{"Message": "signed", "HMACstring": m.Value})); !strings.Contains(v.Body.String(), `"Value":true`) {
		t.Fatalf("verify: %d %s", v.Code, v.Body)
	}
	if v := call(t, h, "/verifyhmac", jsonOf(map[string]any{"Message": "other", "HMACstring": m.Value})); !strings.Contains(v.Body.String(), `"Value":false`) {
		t.Fatalf("wrong message not rejected: %d %s", v.Code, v.Body)
	}
	token := call(t, h, "/tokenize", `{"Masking":[{"Text":"123456","Format":"RIGHT","Length":2}]}`)
	var tok struct{ Ciphertext []textItem }
	if token.Code != 200 || json.Unmarshal(token.Body.Bytes(), &tok) != nil || len(tok.Ciphertext) != 1 || !strings.HasPrefix(tok.Ciphertext[0].Text, "1234**:s0:") {
		t.Fatalf("tokenize: %d %s", token.Code, token.Body)
	}
	detok := call(t, h, "/detokenize", jsonOf(map[string]any{"Masking": tok.Ciphertext}))
	if detok.Code != 200 || !strings.Contains(detok.Body.String(), `"text":"123456"`) {
		t.Fatalf("detokenize: %d %s", detok.Code, detok.Body)
	}
}

func TestSafeRoutesRoundTrip(t *testing.T) {
	h := setup(t, true)
	v, _ := fakeVault(t, false)
	keyManager = &Manager{ttl: time.Minute, keys: map[string]keyEntry{}, vault: v}
	enc := call(t, h, "/encrypt", `{"Plaintext":[{"Text":"safe"}]}`)
	var e struct{ Ciphertext []encItem }
	if enc.Code != 200 || json.Unmarshal(enc.Body.Bytes(), &e) != nil || len(e.Ciphertext) != 1 {
		t.Fatalf("safe encrypt: %d %s", enc.Code, enc.Body)
	}
	if !strings.HasPrefix(e.Ciphertext[0].Versionkey, "k1:") {
		t.Fatalf("safe versionkey: %q", e.Ciphertext[0].Versionkey)
	}
	dec := call(t, h, "/decrypt", jsonOf(map[string]any{"Ciphertext": e.Ciphertext}))
	if dec.Code != 200 || !strings.Contains(dec.Body.String(), `"text":"safe"`) {
		t.Fatalf("safe decrypt: %d %s", dec.Code, dec.Body)
	}
	sealed := call(t, h, "/seal", `{"Plaintext":[{"Text":"safe-seal"}]}`)
	var s struct{ Ciphertext []textItem }
	if sealed.Code != 200 || json.Unmarshal(sealed.Body.Bytes(), &s) != nil || len(s.Ciphertext) != 1 {
		t.Fatalf("safe seal: %d %s", sealed.Code, sealed.Body)
	}
	parts := strings.Split(s.Ciphertext[0].Text, ":")
	if len(parts) != 3 || parts[0] != "k1" || !strings.HasPrefix(string(rawOf(t, parts[1])), "vault:") {
		t.Fatalf("safe seal token shape: %q", s.Ciphertext[0].Text)
	}
	unsealed := call(t, h, "/unseal", jsonOf(map[string]any{"Ciphertext": s.Ciphertext}))
	if unsealed.Code != 200 || !strings.Contains(unsealed.Body.String(), `"text":"safe-seal"`) {
		t.Fatalf("safe unseal: %d %s", unsealed.Code, unsealed.Body)
	}
}

func TestCrossModeRejects(t *testing.T) {
	unsafeH := setup(t, false)
	if got := call(t, unsafeH, "/unseal", `{"Ciphertext":[{"Text":"k1:Zm9v:YmFy"}]}`); got.Code != 501 {
		t.Fatalf("safe-format seal accepted in unsafe mode: %d", got.Code)
	}
	if got := call(t, unsafeH, "/decrypt", `{"Ciphertext":[{"versionkey":"k1:Zm9v","text":"AA==","mac":"AAAAAAAAAAAAAAAAAAAAAA==","iv":"AAAAAAAAAAAAAAAA"}]}`); got.Code != 501 {
		t.Fatalf("safe-format decrypt accepted in unsafe mode: %d", got.Code)
	}
	safeH := setup(t, true)
	v, _ := fakeVault(t, false)
	keyManager = &Manager{ttl: time.Minute, keys: map[string]keyEntry{}, vault: v}
	if got := call(t, safeH, "/decrypt", `{"Ciphertext":[{"versionkey":"s0","text":"AA==","mac":"AAAAAAAAAAAAAAAAAAAAAA==","iv":"AAAAAAAAAAAAAAAA"}]}`); got.Code != 501 {
		t.Fatalf("unsafe-format accepted in safe mode: %d", got.Code)
	}
	if got := call(t, safeH, "/unseal", `{"Ciphertext":[{"Text":"s0:AA=="}]}`); got.Code != 501 {
		t.Fatalf("unsafe-format unseal accepted in safe mode: %d", got.Code)
	}
}

func TestManagerTTLExpiry(t *testing.T) {
	v, unwraps := fakeVault(t, false)
	m := &Manager{ttl: 10 * time.Millisecond, keys: map[string]keyEntry{}, vault: v}
	key, err := m.get(context.Background(), "wrapped")
	if err != nil || !bytes.Equal(key, testDEK) {
		t.Fatalf("first unwrap: %v", err)
	}
	wipe(key)
	cached := m.keys["wrapped"].key
	time.Sleep(20 * time.Millisecond)
	if _, err = m.get(context.Background(), "wrapped"); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(cached, make([]byte, len(cached))) {
		t.Fatal("expired DEK buffer not zeroed")
	}
	if *unwraps != 2 {
		t.Fatalf("no fresh Vault call after expiry: unwraps=%d", *unwraps)
	}
	if _, _, err = m.currentKey(context.Background()); err != nil {
		t.Fatal(err)
	}
	generated := *unwraps
	m.keys[m.current] = keyEntry{key: bytes.Repeat([]byte{1}, 32), expires: time.Now().Add(-time.Second)}
	if _, _, err = m.currentKey(context.Background()); err != nil || *unwraps <= generated {
		t.Fatalf("expired current DEK not regenerated: %v", err)
	}
}

func TestVaultError503Purges(t *testing.T) {
	badVault, _ := fakeVault(t, true)
	h := setup(t, true)
	cached := bytes.Repeat([]byte{3}, 32)
	keyManager = &Manager{ttl: time.Minute, keys: map[string]keyEntry{"cached": {key: cached, expires: time.Now().Add(time.Minute)}}, current: "cached", vault: badVault}
	if len(keyManager.keys) != 1 || keyManager.current != "cached" {
		t.Fatal("cache seed failed")
	}
	w := call(t, h, "/decrypt", `{"Ciphertext":[{"versionkey":"k1:missing","text":"AA==","mac":"AAAAAAAAAAAAAAAAAAAAAA==","iv":"AAAAAAAAAAAAAAAA"}]}`)
	if w.Code != 503 || strings.TrimSpace(w.Body.String()) != `{"fault":{"code":503,"message":"key zone unavailable"}}` {
		t.Fatalf("503 response: %d %s", w.Code, w.Body)
	}
	if len(keyManager.keys) != 0 || keyManager.current != "" {
		t.Fatalf("cache not purged: keys=%d current=%q", len(keyManager.keys), keyManager.current)
	}
	if !bytes.Equal(cached, make([]byte, len(cached))) {
		t.Fatal("cached DEK buffer not zeroed on 503")
	}
}

func TestTTLValidation(t *testing.T) {
	t.Setenv("CRYPTO_MODE", "unsafe")
	for _, value := range []string{"wat", "0s", "-1s", "5m1s", "6m"} {
		t.Setenv("CRYPTO_KEY_TTL", value)
		if _, err := loadConfig(); err == nil {
			t.Errorf("TTL %q accepted", value)
		}
	}
	t.Setenv("CRYPTO_KEY_TTL", "5m")
	if _, err := loadConfig(); err != nil {
		t.Fatalf("maximum TTL rejected: %v", err)
	}
}

func TestFileRoutesRoundTrip(t *testing.T) {
	raw := []byte{0x00, 0xff, 0x00, 0x7f, 0x80, 0x01}
	for _, safe := range []bool{false, true} {
		h := setup(t, safe)
		if safe {
			v, _ := fakeVault(t, false)
			keyManager = &Manager{ttl: time.Minute, keys: map[string]keyEntry{}, vault: v}
		}
		sealed := call(t, h, "/sealfile", jsonOf(map[string]string{"Data": b64(raw)}))
		var s struct{ Ciphertext string }
		if sealed.Code != 200 || json.Unmarshal(sealed.Body.Bytes(), &s) != nil || !strings.HasPrefix(s.Ciphertext, version+":") {
			t.Fatalf("sealfile safe=%v: %d %s", safe, sealed.Code, sealed.Body)
		}
		unsealed := call(t, h, "/unsealfile", jsonOf(map[string]string{"Ciphertext": s.Ciphertext}))
		var u struct{ Data string }
		if unsealed.Code != 200 || json.Unmarshal(unsealed.Body.Bytes(), &u) != nil || !bytes.Equal(rawOf(t, u.Data), raw) {
			t.Fatalf("unsealfile safe=%v: %d %s", safe, unsealed.Code, unsealed.Body)
		}
	}
}

func TestFileRoutesRejects(t *testing.T) {
	h := setup(t, false)
	for _, body := range []string{`{"Data":""}`, `{"Data":"!!notbase64"}`} {
		if got := call(t, h, "/sealfile", body); got.Code != 400 {
			t.Fatalf("sealfile %s: %d", body, got.Code)
		}
	}
	if got := call(t, h, "/sealfile", jsonOf(map[string]string{"Data": b64(make([]byte, maxFile+1))})); got.Code != 400 {
		t.Fatalf("oversize sealfile: %d", got.Code)
	}
	if got := call(t, h, "/sealfile", jsonOf(map[string]string{"Data": b64(make([]byte, maxFile))})); got.Code != 200 {
		t.Fatalf("max-size sealfile rejected: %d", got.Code)
	}
	if got := call(t, h, "/unsealfile", `{"Ciphertext":"k1:Zm9v:YmFy"}`); got.Code != 501 {
		t.Fatalf("safe-format unsealfile accepted in unsafe mode: %d", got.Code)
	}
	sealed := call(t, h, "/sealfile", jsonOf(map[string]string{"Data": b64([]byte("tamper"))}))
	var s struct{ Ciphertext string }
	if sealed.Code != 200 || json.Unmarshal(sealed.Body.Bytes(), &s) != nil {
		t.Fatalf("sealfile: %d %s", sealed.Code, sealed.Body)
	}
	raw := rawOf(t, strings.TrimPrefix(s.Ciphertext, "s0:"))
	raw[0] ^= 1
	if got := call(t, h, "/unsealfile", jsonOf(map[string]string{"Ciphertext": "s0:" + b64(raw)})); got.Code != 501 {
		t.Fatalf("tampered unsealfile accepted: %d", got.Code)
	}
	safeH := setup(t, true)
	v, _ := fakeVault(t, false)
	keyManager = &Manager{ttl: time.Minute, keys: map[string]keyEntry{}, vault: v}
	if got := call(t, safeH, "/unsealfile", `{"Ciphertext":"s0:AA=="}`); got.Code != 501 {
		t.Fatalf("unsafe-format unsealfile accepted in safe mode: %d", got.Code)
	}
}

func TestNoSecretsInLogs(t *testing.T) {
	var output bytes.Buffer
	oldLog, oldAccess := log.Writer(), accessLogger.Writer()
	log.SetOutput(&output)
	accessLogger.SetOutput(&output)
	t.Cleanup(func() { log.SetOutput(oldLog); accessLogger.SetOutput(oldAccess) })
	const plain = "plain-test-key-not-for-logs"
	body := jsonOf(map[string]any{"Plaintext": []textItem{{plain}}})
	call(t, setup(t, false), "/encrypt", body)
	h := setup(t, true)
	v, _ := fakeVault(t, false)
	keyManager = &Manager{ttl: time.Minute, keys: map[string]keyEntry{}, vault: v}
	call(t, h, "/encrypt", body)
	keyManager.purge("test")
	if output.Len() == 0 {
		t.Fatal("no log output captured")
	}
	logs := output.String()
	for _, secret := range []string{plain, hex.EncodeToString(testMaster), b64(testMaster), hex.EncodeToString(testDEK), b64(testDEK)} {
		if strings.Contains(logs, secret) {
			t.Errorf("secret value found in logs (len %d)", len(secret))
		}
	}
}
