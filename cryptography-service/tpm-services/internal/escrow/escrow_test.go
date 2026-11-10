package escrow

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"testing"

	"tpm-msk/internal/envelope"
	"tpm-msk/internal/shamir"
)

type testHMAC struct{ key []byte }

func (h testHMAC) HMAC(msg []byte) ([]byte, error) {
	m := hmac.New(sha256.New, h.key)
	_, _ = m.Write(msg)
	return m.Sum(nil), nil
}

func TestSealOpenAndValidation(t *testing.T) {
	m := bytes.Repeat([]byte{1}, 32)
	k := bytes.Repeat([]byte{2}, 32)
	e, err := Seal(m, k, "0123456789abcdef0123456789abcdef", "key-id")
	if err != nil {
		t.Fatal("seal failed")
	}
	data, err := json.Marshal(e)
	if err != nil {
		t.Fatal("marshal failed")
	}
	got, _, _, err := Open(k, data)
	if err != nil || !bytes.Equal(got, m) {
		t.Fatal("seal/open round trip failed")
	}
	zero(got)

	shares, err := shamir.Split(k, Threshold, Shares)
	if err != nil {
		t.Fatal("share split failed")
	}
	defer func() {
		for _, s := range shares {
			zero(s)
		}
	}()
	if _, err := shamir.Combine(shares[:2], Threshold); err == nil {
		t.Fatal("two shares unexpectedly combined")
	}
	if _, err := ParseShare(FormatShare(1, "other", shares[0]), "0123456789abcdef0123456789abcdef"); err == nil {
		t.Fatal("wrong bundle_id accepted")
	}
	if err := VerifyFile([]byte("changed"), SHA256Hex(data)); err == nil {
		t.Fatal("sha mismatch accepted")
	}

	var tampered Escrow
	if err := json.Unmarshal(data, &tampered); err != nil {
		t.Fatal("unmarshal failed")
	}
	ct, err := base64.StdEncoding.DecodeString(tampered.CT)
	if err != nil {
		t.Fatal("decode ciphertext failed")
	}
	ct[0] ^= 1
	tampered.CT = base64.StdEncoding.EncodeToString(ct)
	bad, _ := json.Marshal(tampered)
	if _, _, _, err := Open(k, bad); err == nil {
		t.Fatal("tampered ciphertext accepted")
	}
}

func TestCombineOpenRoundTrip(t *testing.T) {
	m := bytes.Repeat([]byte{5}, 32)
	k := bytes.Repeat([]byte{6}, 32)
	e, err := Seal(m, k, "bundle", "key")
	if err != nil {
		t.Fatal("seal failed")
	}
	data, err := json.Marshal(e)
	if err != nil {
		t.Fatal("marshal failed")
	}
	shares, err := shamir.Split(k, Threshold, Shares)
	if err != nil {
		t.Fatal("split failed")
	}
	defer func() {
		for _, share := range shares {
			zero(share)
		}
	}()
	combined, err := shamir.Combine(shares[:Threshold], Threshold)
	if err != nil {
		t.Fatal("combine failed")
	}
	defer zero(combined)
	got, _, _, err := Open(combined, data)
	if err != nil || !bytes.Equal(got, m) {
		t.Fatal("combine/open round trip failed")
	}
	zero(got)
	zero(m)
	zero(k)
}

func TestVerifyFileRejectsTamperedKEKsBytes(t *testing.T) {
	keks := []byte(`{"keks":[]}`)
	want := SHA256Hex(keks)
	tampered := append([]byte(nil), keks...)
	tampered[len(tampered)-2] ^= 1
	if err := VerifyFile(tampered, want); err == nil {
		t.Fatal("tampered keks.json passed manifest SHA check")
	}
}

func TestVerifyFileRejectsTamperedManifestSHAEntry(t *testing.T) {
	keks := []byte(`{"keks":[]}`)
	// Manifest sha entry for keks.json replaced by the digest of other content.
	tamperedEntry := SHA256Hex([]byte("other content"))
	if SHA256Hex(keks) == tamperedEntry {
		t.Fatal("test setup: digests must differ")
	}
	if err := VerifyFile(keks, tamperedEntry); err == nil {
		t.Fatal("keks.json accepted against tampered manifest sha entry")
	}
}

func TestWrapUnwrapWithFakeHMACKeyedByM(t *testing.T) {
	m := bytes.Repeat([]byte{0x5a}, 32)
	dek := bytes.Repeat([]byte{0xc3}, 32)
	env, err := envelope.Wrap(testHMAC{m}, "kek/kek-01/1", dek)
	if err != nil {
		t.Fatal("wrap failed")
	}
	// Fresh HMAC recreated from the same M, as restore does.
	got, label, err := envelope.Unwrap(testHMAC{append([]byte(nil), m...)}, env)
	if err != nil || label != "kek/kek-01/1" || !bytes.Equal(got, dek) {
		t.Fatal("unwrap with HMAC recreated from M did not return original DEK")
	}
	zero(got)
	zero(m)
	zero(dek)
}

func TestValidateDEKsRejectsNullPurposeAndUnknownField(t *testing.T) {
	for _, data := range []string{
		`{"v":1,"deks":[{"dek_id":"d","purpose":null,"kek_id":"k","kek_version":1,"created":"2026-01-01T00:00:00Z","iv":"AAAA","ct":"AAAA"}]}`,
		`{"v":1,"deks":[{"dek_id":"d","purpose":"p","kek_id":"k","kek_version":1,"created":"2026-01-01T00:00:00Z","iv":"AAAA","ct":"AAAA","extra":true}]}`,
	} {
		if _, err := ValidateDEKs([]byte(data)); err == nil {
			t.Fatal("invalid DEK entry accepted")
		}
	}
}

func TestValidateDEKsKeydShape(t *testing.T) {
	const good = `{"dek_id":"d","purpose":"p","kek_id":"kek-01","kek_version":1,"created":"2026-01-01T00:00:00Z","iv":"AAAA","ct":"AAAA"}`
	cases := []struct {
		name  string
		entry string
		ok    bool
	}{
		{"keyd exact shape", good, true},
		{"extra unknown field", `{"dek_id":"d","purpose":"p","kek_id":"kek-01","kek_version":1,"created":"2026-01-01T00:00:00Z","iv":"AAAA","ct":"AAAA","extra":1}`, false},
		{"missing ct", `{"dek_id":"d","purpose":"p","kek_id":"kek-01","kek_version":1,"created":"2026-01-01T00:00:00Z","iv":"AAAA"}`, false},
	}
	for _, c := range cases {
		_, err := ValidateDEKs([]byte(`{"v":1,"deks":[` + c.entry + `]}`))
		if (err == nil) != c.ok {
			t.Fatalf("%s: got err %v, want ok=%v", c.name, err, c.ok)
		}
	}
}

func TestRestoredEnvelopeAndKeyID(t *testing.T) {
	m := bytes.Repeat([]byte{3}, 32)
	h1, h2 := testHMAC{m}, testHMAC{append([]byte(nil), m...)}
	dek := bytes.Repeat([]byte{4}, 32)
	env, err := envelope.Wrap(h1, "kek/kek-01/1", dek)
	if err != nil {
		t.Fatal("envelope wrap failed")
	}
	got, _, err := envelope.Unwrap(h2, env)
	if err != nil || !bytes.Equal(got, dek) {
		t.Fatal("restored envelope unwrap failed")
	}
	zero(got)
	id1, err := h1.HMAC([]byte("tpm-msk/key-id/v1"))
	if err != nil {
		t.Fatal("key id computation failed")
	}
	id2, err := h2.HMAC([]byte("tpm-msk/key-id/v1"))
	if err != nil || !bytes.Equal(id1, id2) {
		t.Fatal("restored key id mismatch")
	}
	zero(m)
	zero(h2.key)
	zero(dek)
	zero(id1)
	zero(id2)
}

func TestOpenRejectsWrongAAD(t *testing.T) {
	m := bytes.Repeat([]byte{7}, 32)
	k := bytes.Repeat([]byte{8}, 32)
	e, err := Seal(m, k, "bundle-a", "key-a")
	if err != nil {
		t.Fatal("seal failed")
	}
	e.BundleID = "bundle-b" // AAD binds bundle_id, so this must not authenticate
	data, _ := json.Marshal(e)
	if _, _, _, err := Open(k, data); err == nil {
		t.Fatal("wrong AAD accepted")
	}
}

func TestParseShareForms(t *testing.T) {
	const id = "bundle"
	share := []byte{1, 2, 3}
	for _, line := range []string{
		"bundle:010203",
		"share 2/5 bundle:010203",
	} {
		b, err := ParseShare(line, id)
		if err != nil || !bytes.Equal(b, share) {
			t.Fatalf("ParseShare(%q) failed: %v", line, err)
		}
	}
	if _, err := ParseShare("share 6/5 bundle:010203", id); err == nil {
		t.Fatal("out-of-range index accepted")
	}
}

func TestCombineRejectsDuplicateShare(t *testing.T) {
	k := bytes.Repeat([]byte{9}, 32)
	shares, err := shamir.Split(k, Threshold, Shares)
	if err != nil {
		t.Fatal("split failed")
	}
	dup := [][]byte{shares[0], shares[0], shares[1]}
	if _, err := shamir.Combine(dup, Threshold); err == nil {
		t.Fatal("duplicate share accepted")
	}
	zero(k)
}

func TestSameKEKRefs(t *testing.T) {
	a := []KEKRef{{KEKID: "kek-01", Version: 1}, {KEKID: "kek-01", Version: 2}}
	if !SameKEKRefs(a, []KEKRef{{KEKID: "kek-01", Version: 2}, {KEKID: "kek-01", Version: 1}}) {
		t.Fatal("same refs in other order rejected")
	}
	if SameKEKRefs(a, a[:1]) {
		t.Fatal("different length accepted")
	}
	if SameKEKRefs(a, []KEKRef{{KEKID: "kek-01", Version: 1}, {KEKID: "kek-01", Version: 1}}) {
		t.Fatal("duplicate ref accepted in place of distinct one")
	}
	if !SameKEKRefs(nil, nil) {
		t.Fatal("empty refs rejected")
	}
}

func TestCheckDEKRefs(t *testing.T) {
	refs := []KEKRef{{KEKID: "kek-01", Version: 1}}
	ok := []byte(`{"v":1,"deks":[{"dek_id":"d","purpose":"p","kek_id":"kek-01","kek_version":1,"created":"2026-01-01T00:00:00Z","iv":"AAAA","ct":"AAAA"}]}`)
	bad := []byte(`{"v":1,"deks":[{"dek_id":"d","purpose":"p","kek_id":"kek-01","kek_version":2,"created":"2026-01-01T00:00:00Z","iv":"AAAA","ct":"AAAA"}]}`)
	empty := []byte(`{"v":1,"deks":[]}`)
	if err := CheckDEKRefs(ok, refs); err != nil {
		t.Fatalf("valid ref rejected: %v", err)
	}
	if err := CheckDEKRefs(bad, refs); err == nil {
		t.Fatal("missing version accepted")
	}
	if err := CheckDEKRefs(bad, nil); err == nil {
		t.Fatal("ref with no KEKs accepted")
	}
	if err := CheckDEKRefs(empty, nil); err != nil {
		t.Fatalf("empty deks with no KEKs rejected: %v", err)
	}
}

// Restore path without TPM: text shares (as printed by init --escrow) -> ParseShare -> Combine -> Open.
func TestRestoreFromTextSharesSubsetsAndFailures(t *testing.T) {
	const bundle = "bundle-restore"
	m := bytes.Repeat([]byte{0x11}, 32)
	k := bytes.Repeat([]byte{0x22}, 32)
	e, err := Seal(m, k, bundle, "key-restore")
	if err != nil {
		t.Fatal("seal failed")
	}
	data, _ := json.Marshal(e)
	shares, err := shamir.Split(k, Threshold, Shares)
	if err != nil {
		t.Fatal("split failed")
	}
	defer func() {
		for _, s := range shares {
			zero(s)
		}
	}()
	lines := make([]string, Shares)
	for i, s := range shares {
		lines[i] = FormatShare(i+1, bundle, s)
	}
	restore := func(idx ...int) ([]byte, error) {
		var parsed [][]byte
		for _, i := range idx {
			b, err := ParseShare(lines[i], bundle)
			if err != nil {
				return nil, err
			}
			parsed = append(parsed, b)
		}
		kk, err := shamir.Combine(parsed, Threshold)
		if err != nil {
			return nil, err
		}
		got, _, _, err := Open(kk, data)
		zero(kk)
		return got, err
	}
	for _, idx := range [][]int{{0, 2, 4}, {1, 3, 4}} {
		got, err := restore(idx...)
		if err != nil || !bytes.Equal(got, m) {
			t.Fatalf("subset %v failed to restore: %v", idx, err)
		}
		zero(got)
	}
	if _, err := restore(0, 1); err == nil {
		t.Fatal("two shares restored")
	}
	foreign := FormatShare(1, "other-bundle", shares[0])
	if _, err := ParseShare(foreign, bundle); err == nil {
		t.Fatal("foreign bundle share accepted")
	}
	tampered := append([]byte(nil), data...)
	tampered[len(tampered)/2] ^= 1
	if err := VerifyFile(tampered, SHA256Hex(data)); err == nil {
		t.Fatal("tampered file passed sha check")
	}
	zero(m)
}
