// Package pki generates a dev PKI: two ECDSA P-256 CAs with server and client leaves.
package pki

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"time"

	"tpm-msk/internal/tpm"
)

type leafSpec struct {
	name, cn string
	dns      []string
	ips      []net.IP
	usage    x509.ExtKeyUsage
}

type caSpec struct {
	dir, cn string
	leaves  []leafSpec
}

var specs = []caSpec{
	{"keyzone", "keyzone-ca", []leafSpec{
		{"tpm-service", "tpm-service", []string{"host.docker.internal", "localhost"}, []net.IP{net.ParseIP("127.0.0.1")}, x509.ExtKeyUsageServerAuth},
		{"crypto-service", "crypto-service", nil, nil, x509.ExtKeyUsageClientAuth},
	}},
	{"api", "crypto-api-ca", []leafSpec{
		{"crypto-api", "crypto-api", []string{"crypto-api", "localhost"}, []net.IP{net.ParseIP("127.0.0.1")}, x509.ExtKeyUsageServerAuth},
		{"app-cert", "app", nil, nil, x509.ExtKeyUsageClientAuth},
	}},
}

type output struct {
	path string
	data []byte
}

// Generate writes the dev PKI under outDir. Without force it refuses to touch
// any existing file and writes nothing.
func Generate(outDir string, force bool) error {
	var outs []output
	for _, s := range specs {
		caOuts, caTpl, caKey, err := genCA(s)
		if err != nil {
			return err
		}
		outs = append(outs, caOuts...)
		for _, l := range s.leaves {
			lo, err := genLeaf(s.dir, l, caTpl, caKey)
			if err != nil {
				return err
			}
			outs = append(outs, lo...)
		}
	}

	for _, o := range outs {
		if err := tpm.CheckAbsent(filepath.Join(outDir, o.path), force); err != nil {
			return err
		}
	}
	for _, s := range specs {
		dir := filepath.Join(outDir, s.dir)
		if _, err := os.Stat(dir); os.IsNotExist(err) {
			if err := os.MkdirAll(dir, 0700); err != nil {
				return err
			}
			if err := tpm.RestrictToCurrentUser(dir, true); err != nil {
				return err
			}
		} else if err != nil {
			return err
		}
	}
	for _, o := range outs {
		if err := tpm.WriteAtomic(filepath.Join(outDir, o.path), o.data, force); err != nil {
			return err
		}
	}
	return nil
}

func genCA(s caSpec) ([]output, *x509.Certificate, *ecdsa.PrivateKey, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, nil, nil, err
	}
	sn, err := serial()
	if err != nil {
		return nil, nil, nil, err
	}
	now := time.Now()
	tpl := &x509.Certificate{
		SerialNumber:          sn,
		Subject:               pkix.Name{CommonName: s.cn},
		NotBefore:             now.Add(-5 * time.Minute),
		NotAfter:              now.AddDate(2, 0, 0),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &key.PublicKey, key)
	if err != nil {
		return nil, nil, nil, err
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		return nil, nil, nil, err
	}
	keyPEM, err := marshalKey(key)
	if err != nil {
		return nil, nil, nil, err
	}
	return []output{
		{filepath.Join(s.dir, "ca.pem"), pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})},
		{filepath.Join(s.dir, "ca-key.pem"), keyPEM},
	}, cert, key, nil
}

func genLeaf(dir string, l leafSpec, ca *x509.Certificate, caKey *ecdsa.PrivateKey) ([]output, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, err
	}
	sn, err := serial()
	if err != nil {
		return nil, err
	}
	now := time.Now()
	tpl := &x509.Certificate{
		SerialNumber: sn,
		Subject:      pkix.Name{CommonName: l.cn},
		NotBefore:    now.Add(-5 * time.Minute),
		NotAfter:     now.AddDate(2, 0, 0),
		DNSNames:     l.dns,
		IPAddresses:  l.ips,
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{l.usage},
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, ca, &key.PublicKey, caKey)
	if err != nil {
		return nil, err
	}
	keyPEM, err := marshalKey(key)
	if err != nil {
		return nil, err
	}
	return []output{
		{filepath.Join(dir, l.name+".pem"), pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})},
		{filepath.Join(dir, l.name+"-key.pem"), keyPEM},
	}, nil
}

func serial() (*big.Int, error) {
	return rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
}

func marshalKey(key *ecdsa.PrivateKey) ([]byte, error) {
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return nil, err
	}
	return pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}), nil
}
