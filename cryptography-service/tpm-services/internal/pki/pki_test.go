package pki

import (
	"crypto/x509"
	"encoding/pem"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

var allPaths = []string{
	"keyzone/ca.pem", "keyzone/ca-key.pem", "keyzone/tpm-service.pem", "keyzone/tpm-service-key.pem",
	"keyzone/crypto-service.pem", "keyzone/crypto-service-key.pem", "api/ca.pem", "api/ca-key.pem",
	"api/crypto-api.pem", "api/crypto-api-key.pem", "api/app-cert.pem", "api/app-cert-key.pem",
}

func readCert(t *testing.T, path string) *x509.Certificate {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	blk, _ := pem.Decode(b)
	if blk == nil || blk.Type != "CERTIFICATE" {
		t.Fatalf("%s: not a CERTIFICATE PEM", path)
	}
	c, err := x509.ParseCertificate(blk.Bytes)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func pool(t *testing.T, c *x509.Certificate) *x509.CertPool {
	p := x509.NewCertPool()
	p.AddCert(c)
	return p
}

func TestGenerateChains(t *testing.T) {
	out := t.TempDir()
	if err := Generate(out, false); err != nil {
		t.Fatal(err)
	}
	kzCA := readCert(t, filepath.Join(out, "keyzone/ca.pem"))
	apiCA := readCert(t, filepath.Join(out, "api/ca.pem"))

	tpmSvc := readCert(t, filepath.Join(out, "keyzone/tpm-service.pem"))
	cryptoSvc := readCert(t, filepath.Join(out, "keyzone/crypto-service.pem"))
	cryptoAPI := readCert(t, filepath.Join(out, "api/crypto-api.pem"))
	app := readCert(t, filepath.Join(out, "api/app-cert.pem"))

	verify := func(leaf, ca *x509.Certificate, dns string) error {
		_, err := leaf.Verify(x509.VerifyOptions{
			Roots:     pool(t, ca),
			DNSName:   dns,
			KeyUsages: leaf.ExtKeyUsage,
		})
		return err
	}

	if err := verify(tpmSvc, kzCA, "localhost"); err != nil {
		t.Errorf("tpm-service under keyzone CA: %v", err)
	}
	if err := verify(cryptoSvc, kzCA, ""); err != nil {
		t.Errorf("crypto-service under keyzone CA: %v", err)
	}
	if err := verify(cryptoAPI, apiCA, "localhost"); err != nil {
		t.Errorf("crypto-api under api CA: %v", err)
	}
	if err := verify(app, apiCA, ""); err != nil {
		t.Errorf("app under api CA: %v", err)
	}
	if err := verify(cryptoSvc, apiCA, ""); err == nil {
		t.Error("keyzone client chained under api CA")
	}
	if err := verify(app, kzCA, ""); err == nil {
		t.Error("api client chained under keyzone CA")
	}
}

func TestGenerateCNAndSANs(t *testing.T) {
	out := t.TempDir()
	if err := Generate(out, false); err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		file, cn string
		dns      []string
	}{
		{"keyzone/tpm-service.pem", "tpm-service", []string{"host.docker.internal", "localhost"}},
		{"api/crypto-api.pem", "crypto-api", []string{"crypto-api", "localhost"}},
	}
	for _, c := range cases {
		cert := readCert(t, filepath.Join(out, c.file))
		if cert.Subject.CommonName != c.cn {
			t.Errorf("%s CN = %q, want %q", c.file, cert.Subject.CommonName, c.cn)
		}
		if strings.Join(cert.DNSNames, ",") != strings.Join(c.dns, ",") {
			t.Errorf("%s DNSNames = %v, want %v", c.file, cert.DNSNames, c.dns)
		}
		if len(cert.IPAddresses) != 1 || cert.IPAddresses[0].String() != "127.0.0.1" {
			t.Errorf("%s IPAddresses = %v, want [127.0.0.1]", c.file, cert.IPAddresses)
		}
	}
}

func TestGenerateRefusesOverwrite(t *testing.T) {
	out := t.TempDir()
	if err := Generate(out, false); err != nil {
		t.Fatal(err)
	}
	before := map[string][]byte{}
	for _, p := range allPaths {
		b, err := os.ReadFile(filepath.Join(out, p))
		if err != nil {
			t.Fatal(err)
		}
		before[p] = b
	}

	if err := Generate(out, false); err == nil || !strings.HasPrefix(err.Error(), "path already exists: ") {
		t.Fatalf("second Generate err = %v, want path already exists", err)
	}
	for _, p := range allPaths {
		b, err := os.ReadFile(filepath.Join(out, p))
		if err != nil {
			t.Fatal(err)
		}
		if string(b) != string(before[p]) {
			t.Errorf("%s changed after refused Generate", p)
		}
	}

	// Partial existence: nothing else may be written.
	partial := t.TempDir()
	if err := os.MkdirAll(filepath.Join(partial, "api"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(partial, "api/app-cert-key.pem"), []byte("x"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := Generate(partial, false); err == nil {
		t.Fatal("Generate with one existing file succeeded")
	}
	if _, err := os.Stat(filepath.Join(partial, "keyzone/ca.pem")); !os.IsNotExist(err) {
		t.Errorf("keyzone/ca.pem written despite refusal: %v", err)
	}
}

func TestGenerateForce(t *testing.T) {
	out := t.TempDir()
	if err := Generate(out, false); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(filepath.Join(out, "keyzone/ca.pem"))
	if err != nil {
		t.Fatal(err)
	}
	if err := Generate(out, true); err != nil {
		t.Fatalf("Generate force=true: %v", err)
	}
	after, err := os.ReadFile(filepath.Join(out, "keyzone/ca.pem"))
	if err != nil {
		t.Fatal(err)
	}
	if string(before) == string(after) {
		t.Error("keyzone/ca.pem unchanged after force regenerate")
	}
}
