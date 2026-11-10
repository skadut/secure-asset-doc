package main

import (
	"context"
	"encoding/base32"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func setup(t *testing.T, _ bool) http.Handler {
	t.Helper()
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

// /seal -> label skadut-; /unseal terima dengan dan tanpa label.
func TestSealLabelRoundTrip(t *testing.T) {
	h := setupTPM(t, "")
	s := call(t, h, "/seal", `{"Plaintext":[{"Text":"label"}]}`)
	var v struct{ Ciphertext []textItem }
	if s.Code != 200 || json.Unmarshal(s.Body.Bytes(), &v) != nil || len(v.Ciphertext) != 1 || !strings.HasPrefix(v.Ciphertext[0].Text, "skadut-t1:") {
		t.Fatalf("seal: %d %s", s.Code, s.Body)
	}
	raw := v.Ciphertext[0].Text
	for _, in := range []string{raw, strings.TrimPrefix(raw, "skadut-")} {
		u := call(t, h, "/unseal", jsonOf(map[string]any{"Ciphertext": []textItem{{in}}}))
		if u.Code != 200 || !strings.Contains(u.Body.String(), `"text":"label"`) {
			t.Fatalf("unseal %q: %d %s", in, u.Code, u.Body)
		}
	}
}

func TestTOTPVectorsAndWindow(t *testing.T) {
	secret := []byte("12345678901234567890")
	vectors := []struct {
		seconds int64
		want    string
	}{
		{59, "287082"}, {1111111109, "081804"}, {1111111111, "050471"},
		{1234567890, "005924"}, {2000000000, "279037"}, {20000000000, "353130"},
	}
	for _, v := range vectors {
		if got := totpAt(secret, v.seconds/30); got != v.want {
			t.Fatalf("totpAt(%d): got %s want %s", v.seconds, got, v.want)
		}
	}
	step := int64(100)
	code := totpAt(secret, step)
	if got, ok := totpMatch(secret, code, step+1); !ok || got != step {
		t.Fatal("previous step not accepted")
	}
	if got, ok := totpMatch(secret, totpAt(secret, step+1), step); !ok || got != step+1 {
		t.Fatal("next step not accepted")
	}
	if _, ok := totpMatch(secret, totpAt(secret, step-2), step); ok {
		t.Fatal("two-step-old code accepted")
	}
	if _, ok := totpMatch(secret, totpAt(secret, step+2), step); ok {
		t.Fatal("two-step-future code accepted")
	}
	if _, ok := totpMatch(secret[:19], code, step); ok {
		t.Fatal("wrong-length secret accepted")
	}
	for _, bad := range []string{"abc123", "12345", "1234567"} {
		if _, ok := totpMatch(secret, bad, step); ok {
			t.Fatalf("accepted invalid code %q", bad)
		}
	}
}

func TestTOTPReplayAndURI(t *testing.T) {
	secret := []byte("12345678901234567890")
	now := time.Unix(3000, 0)
	step, ok := totpMatch(secret, totpAt(secret, now.Unix()/30), now.Unix()/30)
	if !ok || !totpConsume(secret, step, now) || totpConsume(secret, step, now) || !totpConsume(secret, step+1, now) {
		t.Fatal("replay cache behavior mismatch")
	}
	h := setupTPM(t, "")
	generated := call(t, h, "/totpgenerate", `{"AccountName":"bob@example.com"}`)
	var out map[string]string
	if generated.Code != 200 || json.Unmarshal(generated.Body.Bytes(), &out) != nil {
		t.Fatalf("generate: %d %s", generated.Code, generated.Body)
	}
	uri := out["TOTP Key"]
	// url.PathEscape tidak mengescape '@' (sah di segmen path); label mengikuti rumus spec.
	label := url.PathEscape("Skadut") + ":" + url.PathEscape("bob@example.com")
	if !strings.HasPrefix(uri, "otpauth://totp/"+label+"?") || !strings.Contains(uri, "issuer=Skadut") || !strings.Contains(uri, "algorithm=SHA1&digits=6") || !strings.Contains(uri, "period=30") {
		t.Fatalf("unexpected otpauth URI: %s", uri)
	}
	parts := strings.Split(uri, "secret=")
	if len(parts) != 2 || strings.Contains(parts[1], "=") {
		t.Fatalf("invalid base32 secret: %s", uri)
	}
	secret, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(parts[1])
	if err != nil || len(secret) != 20 {
		t.Fatalf("invalid encoded secret: len=%d err=%v", len(secret), err)
	}
	sealValue := strings.TrimPrefix(out["SecretEncrypted"], outLabel)
	plain, err := unseal(context.Background(), sealValue)
	if err != nil {
		t.Fatal(err)
	}
	code := totpAt([]byte(plain), time.Now().Unix()/30)
	valid := call(t, h, "/totpvalidate", jsonOf(map[string]string{"SecretEncrypted": out["SecretEncrypted"], "CodeOTP": code}))
	if valid.Code != 200 || !strings.Contains(valid.Body.String(), `"valid":true`) {
		t.Fatalf("validate: %d %s", valid.Code, valid.Body)
	}
}

func TestTOTPAuditRoutes(t *testing.T) {
	h := setupTPM(t, "")
	var logs strings.Builder
	ah := auditHandler(&auditLog{prev: strings.Repeat("0", 64), out: &logs}, h)
	for _, tc := range []struct{ path, body string }{
		{"/totpgenerate", `{"AccountName":"audit-test"}`},
		{"/totpvalidate", `{"SecretEncrypted":"bad","CodeOTP":"123456"}`},
	} {
		_ = call(t, ah, tc.path, tc.body)
	}
	recs := auditRecords(t, logs.String())
	if len(recs) != 2 || recs[0].Action != "op.totpgenerate" || recs[1].Action != "op.totpvalidate" {
		t.Fatalf("TOTP audit records: %+v", recs)
	}
}
