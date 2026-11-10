package delivery

import (
	"bytes"
	"crypto/rand"
	"crypto/rsa"
	"math/big"
	"testing"
)

// Wrap rejects any modulus that is not exactly 3072 bits. The check runs before any encryption, so a synthetic modulus is enough.
func TestWrapRequiresExactly3072Bits(t *testing.T) {
	kek := bytes.Repeat([]byte{0x5a}, kekLen)
	nonce := bytes.Repeat([]byte{0xa5}, nonceLen)
	for _, bits := range []int{2048, 4096} {
		n := new(big.Int).Lsh(big.NewInt(1), uint(bits-1))
		n.SetBit(n, 0, 1)
		pub := &rsa.PublicKey{N: n, E: 65537}
		if _, err := Wrap(pub, kek, "key-1", 1, nonce); err == nil {
			t.Fatalf("Wrap accepted %d-bit key", bits)
		}
	}
}

func TestWrapUnwrapAndWrongNonce(t *testing.T) {
	priv, err := rsa.GenerateKey(rand.Reader, 3072)
	if err != nil {
		t.Fatal(err)
	}
	kek := bytes.Repeat([]byte{0x5a}, kekLen)
	nonce := bytes.Repeat([]byte{0xa5}, nonceLen)
	wrapped, err := Wrap(&priv.PublicKey, kek, "key-1", 1, nonce)
	if err != nil {
		t.Fatal(err)
	}
	got, err := Unwrap(priv, wrapped, "key-1", 1, nonce)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, kek) {
		t.Fatal("round-trip KEK mismatch")
	}

	wrongNonce := append([]byte(nil), nonce...)
	wrongNonce[0] ^= 1
	if got, err := Unwrap(priv, wrapped, "key-1", 1, wrongNonce); err == nil {
		clear(got)
		t.Fatal("Unwrap succeeded with wrong nonce")
	}
	clear(got)
}
