package envelope

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"testing"
)

var testKey = []byte("0123456789abcdef0123456789abcdef")

type fakeHMAC struct{ key []byte }

func (f fakeHMAC) HMAC(msg []byte) ([]byte, error) {
	m := hmac.New(sha256.New, f.key)
	m.Write(msg)
	return m.Sum(nil), nil
}

var testDEK = []byte("dek-dek-dek-dek-dek-dek-dek-dek!")

func mustWrap(t *testing.T, h HMACer, label string, dek []byte) []byte {
	t.Helper()
	env, err := Wrap(h, label, dek)
	if err != nil {
		t.Fatal(err)
	}
	return env
}

func decodeMap(t *testing.T, env []byte) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(env, &m); err != nil {
		t.Fatal(err)
	}
	return m
}

func encodeMap(t *testing.T, m map[string]any) []byte {
	t.Helper()
	out, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func decodeField(t *testing.T, m map[string]any, field string) []byte {
	t.Helper()
	b, err := base64.StdEncoding.DecodeString(m[field].(string))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestRoundtrip(t *testing.T) {
	h := fakeHMAC{testKey}
	env := mustWrap(t, h, "vault/key1", testDEK)
	dek, label, err := Unwrap(h, env)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(dek, testDEK) || label != "vault/key1" {
		t.Fatalf("got dek %q label %q", dek, label)
	}
}

func TestTamperedCT(t *testing.T) {
	h := fakeHMAC{testKey}
	m := decodeMap(t, mustWrap(t, h, "vault/key1", testDEK))
	ct := decodeField(t, m, "ct")
	ct[0] ^= 0x01
	m["ct"] = base64.StdEncoding.EncodeToString(ct)
	if _, _, err := Unwrap(h, encodeMap(t, m)); err == nil {
		t.Fatal("tampered ct accepted")
	}
}

func TestWrongLabel(t *testing.T) {
	h := fakeHMAC{testKey}
	m := decodeMap(t, mustWrap(t, h, "vault/key1", testDEK))
	m["label"] = "vault/key2"
	if _, _, err := Unwrap(h, encodeMap(t, m)); err == nil {
		t.Fatal("wrong label accepted")
	}
}

func TestTruncatedEnvelope(t *testing.T) {
	h := fakeHMAC{testKey}
	env := mustWrap(t, h, "vault/key1", testDEK)
	if _, _, err := Unwrap(h, env[:len(env)/2]); err == nil {
		t.Fatal("truncated envelope accepted")
	}
}

func TestTruncatedCT(t *testing.T) {
	h := fakeHMAC{testKey}
	m := decodeMap(t, mustWrap(t, h, "vault/key1", testDEK))
	ct := decodeField(t, m, "ct")
	m["ct"] = base64.StdEncoding.EncodeToString(ct[:len(ct)-1])
	if _, _, err := Unwrap(h, encodeMap(t, m)); err == nil {
		t.Fatal("truncated ct accepted")
	}
}

func TestDEKTooLarge(t *testing.T) {
	h := fakeHMAC{testKey}
	if _, err := Wrap(h, "vault/key1", make([]byte, 1025)); err == nil {
		t.Fatal("1025-byte dek accepted")
	}
	if _, err := Wrap(h, "vault/key1", make([]byte, 1024)); err != nil {
		t.Fatal(err)
	}
}
