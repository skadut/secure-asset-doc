// Package envelope wraps a DEK under a KEK derived from a TPM HMAC.
package envelope

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

// ErrUnwrap is returned by Unwrap for any parse, validation or authentication failure.
var ErrUnwrap = errors.New("unwrap failed")

// HMACer is the only TPM dependency of this package.
type HMACer interface {
	HMAC(msg []byte) ([]byte, error)
}

const (
	maxDEK    = 1024
	kdfPrefix = "tpm-msk/kek/v1"
	aadPrefix = "tpm-msk/v1"
	maxLabel  = 256
	algName   = "HMAC-SHA256+AES-256-GCM"
)

type envelopeJSON struct {
	V     int    `json:"v"`
	Alg   string `json:"alg"`
	Label string `json:"label"`
	Nonce string `json:"nonce"`
	IV    string `json:"iv"`
	CT    string `json:"ct"`
}

// Wrap encrypts dek under a KEK derived from h and label.
func Wrap(h HMACer, label string, dek []byte) ([]byte, error) {
	if len(dek) == 0 || len(dek) > maxDEK {
		return nil, fmt.Errorf("dek length %d outside 1..%d", len(dek), maxDEK)
	}
	if err := checkLabel(label); err != nil {
		return nil, err
	}
	nonce, err := randBytes(32)
	if err != nil {
		return nil, err
	}
	kek, err := deriveKEK(h, label, nonce)
	if err != nil {
		return nil, err
	}
	defer zero(kek)
	gcm, err := newGCM(kek)
	if err != nil {
		return nil, err
	}
	iv, err := randBytes(12)
	if err != nil {
		return nil, err
	}
	ct := gcm.Seal(nil, iv, dek, aad(label))
	return json.Marshal(envelopeJSON{
		V:     1,
		Alg:   algName,
		Label: label,
		Nonce: base64.StdEncoding.EncodeToString(nonce),
		IV:    base64.StdEncoding.EncodeToString(iv),
		CT:    base64.StdEncoding.EncodeToString(ct),
	})
}

// Unwrap decrypts env and returns the DEK and its label.
func Unwrap(h HMACer, env []byte) (dek []byte, label string, err error) {
	var e envelopeJSON
	dec := json.NewDecoder(bytes.NewReader(env))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&e); err != nil {
		return nil, "", fmt.Errorf("%w: %v", ErrUnwrap, err)
	}
	var extra json.RawMessage
	if err := dec.Decode(&extra); err != io.EOF {
		return nil, "", fmt.Errorf("%w: trailing data after envelope", ErrUnwrap)
	}
	if e.V != 1 || e.Alg != algName {
		return nil, "", fmt.Errorf("%w: unsupported envelope version or alg", ErrUnwrap)
	}
	nonce, err := base64.StdEncoding.DecodeString(e.Nonce)
	if err != nil {
		return nil, "", fmt.Errorf("%w: %v", ErrUnwrap, err)
	}
	iv, err := base64.StdEncoding.DecodeString(e.IV)
	if err != nil {
		return nil, "", fmt.Errorf("%w: %v", ErrUnwrap, err)
	}
	ct, err := base64.StdEncoding.DecodeString(e.CT)
	if err != nil {
		return nil, "", fmt.Errorf("%w: %v", ErrUnwrap, err)
	}
	// GCM tag is 16 bytes; a non-empty DEK adds at least 1 byte.
	if len(nonce) != 32 || len(iv) != 12 || len(ct) < 17 || len(ct) > maxDEK+16 {
		return nil, "", fmt.Errorf("%w: malformed envelope", ErrUnwrap)
	}
	if err := checkLabel(e.Label); err != nil {
		return nil, "", fmt.Errorf("%w: %v", ErrUnwrap, err)
	}
	kek, err := deriveKEK(h, e.Label, nonce)
	if err != nil {
		return nil, "", err
	}
	defer zero(kek)
	gcm, err := newGCM(kek)
	if err != nil {
		return nil, "", err
	}
	pt, err := gcm.Open(nil, iv, ct, aad(e.Label))
	if err != nil {
		return nil, "", ErrUnwrap
	}
	return pt, e.Label, nil
}

func deriveKEK(h HMACer, label string, nonce []byte) ([]byte, error) {
	msg := make([]byte, 0, len(kdfPrefix)+len(label)+len(nonce)+2)
	msg = append(msg, kdfPrefix...)
	msg = append(msg, 0)
	msg = append(msg, label...)
	msg = append(msg, 0)
	msg = append(msg, nonce...)
	kek, err := h.HMAC(msg)
	if err != nil {
		return nil, err
	}
	if len(kek) != 32 {
		zero(kek)
		return nil, errors.New("kek must be 32 bytes")
	}
	return kek, nil
}

func newGCM(kek []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(kek)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

func aad(label string) []byte {
	return append([]byte(aadPrefix), label...)
}

func checkLabel(label string) error {
	if label == "" || len(label) > maxLabel || strings.IndexByte(label, 0) >= 0 {
		return errors.New("invalid label")
	}
	return nil
}

func randBytes(n int) ([]byte, error) {
	b := make([]byte, n)
	_, err := rand.Read(b)
	return b, err
}

func zero(b []byte) {
	for i := range b {
		b[i] = 0
	}
}
