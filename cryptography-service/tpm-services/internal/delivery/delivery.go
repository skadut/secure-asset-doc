// Package delivery wraps a KEK for delivery to an RSA-OAEP recipient.
// Wire format: RSA-OAEP(temp AES-256 key) || AES-KWP(temp key, KEK).
package delivery

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"regexp"

	"tpm-msk/internal/kwp"
)

const (
	label      = "tpm-msk/delivery/v1"
	minRSABits = 3072
	kekLen     = 32
	nonceLen   = 32
	tempKeyLen = 32
)

var idPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)

var (
	errInput  = errors.New("delivery: invalid input")
	errWrap   = errors.New("delivery: wrap failed")
	errUnwrap = errors.New("delivery: unwrap failed")
)

// Wrap encrypts kek for the holder of pub's private key. Caller owns and wipes kek.
func Wrap(pub *rsa.PublicKey, kek []byte, kekID string, version int, nonce []byte) ([]byte, error) {
	if pub == nil || pub.N == nil || pub.N.BitLen() != minRSABits || len(kek) != kekLen || len(nonce) != nonceLen || !validMeta(kekID, version) {
		return nil, errInput
	}

	temp := make([]byte, tempKeyLen)
	defer clear(temp)
	if _, err := rand.Read(temp); err != nil {
		return nil, errWrap
	}

	rsaPart, err := rsa.EncryptOAEP(sha256.New(), rand.Reader, pub, temp, oaepLabel(nonce, kekID, version))
	if err != nil {
		return nil, errWrap
	}
	kwpPart, err := kwp.Wrap(temp, kek)
	if err != nil {
		return nil, errWrap
	}
	return append(rsaPart, kwpPart...), nil
}

// Unwrap reverses Wrap. Caller owns and wipes the returned KEK.
func Unwrap(priv *rsa.PrivateKey, wrapped []byte, kekID string, version int, nonce []byte) ([]byte, error) {
	if priv == nil || priv.N == nil {
		return nil, errInput
	}
	if len(nonce) != nonceLen || !validMeta(kekID, version) {
		return nil, errInput
	}
	k := priv.Size()
	if len(wrapped) <= k {
		return nil, errUnwrap
	}

	temp, err := rsa.DecryptOAEP(sha256.New(), nil, priv, wrapped[:k], oaepLabel(nonce, kekID, version))
	if err != nil {
		return nil, errUnwrap
	}
	defer clear(temp)
	if len(temp) != tempKeyLen {
		return nil, errUnwrap
	}
	kek, err := kwp.Unwrap(temp, wrapped[k:])
	if err != nil || len(kek) != kekLen {
		return nil, errUnwrap
	}
	return kek, nil
}

func validMeta(kekID string, version int) bool {
	return version > 0 && int64(version) <= 1<<32-1 && idPattern.MatchString(kekID)
}

func oaepLabel(nonce []byte, kekID string, version int) []byte {
	l := make([]byte, 0, len(label)+1+len(nonce)+len(kekID)+1+4)
	l = append(l, label...)
	l = append(l, 0)
	l = append(l, nonce...)
	l = append(l, kekID...)
	l = append(l, 0)
	var v [4]byte
	binary.BigEndian.PutUint32(v[:], uint32(version))
	return append(l, v[:]...)
}
