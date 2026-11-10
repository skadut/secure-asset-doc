// Package kwp implements AES Key Wrap with Padding (RFC 5649).
package kwp

import (
	"crypto/aes"
	"encoding/binary"
	"errors"
)

// ErrIntegrity is returned when unwrap fails the RFC 5649 integrity check.
var ErrIntegrity = errors.New("AES-KWP integrity check failed")

var iv = [4]byte{0xA6, 0x59, 0x59, 0xA6}

// Wrap returns the RFC 5649 wrapping of plaintext under the AES key.
func Wrap(key, plaintext []byte) ([]byte, error) {
	b, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	if len(plaintext) == 0 {
		return nil, errors.New("empty KWP plaintext")
	}
	mli := uint32(len(plaintext))
	n := (len(plaintext) + 7) / 8
	r := make([]byte, n*8)
	copy(r, plaintext)

	var a [8]byte
	copy(a[:4], iv[:])
	binary.BigEndian.PutUint32(a[4:], mli)

	if n == 1 {
		block := make([]byte, 16)
		copy(block, a[:])
		copy(block[8:], r)
		b.Encrypt(block, block)
		return block, nil
	}

	var blk [16]byte
	for j := 0; j < 6; j++ {
		for i := 1; i <= n; i++ {
			copy(blk[:8], a[:])
			copy(blk[8:], r[(i-1)*8:i*8])
			b.Encrypt(blk[:], blk[:])
			t := uint64(n*j + i)
			copy(a[:], blk[:8])
			binary.BigEndian.PutUint64(a[:], binary.BigEndian.Uint64(a[:])^t)
			copy(r[(i-1)*8:i*8], blk[8:])
		}
	}
	out := make([]byte, 8+len(r))
	copy(out, a[:])
	copy(out[8:], r)
	return out, nil
}

// Unwrap reverses Wrap and checks the RFC 5649 header and zero padding.
func Unwrap(key, ciphertext []byte) ([]byte, error) {
	b, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	if len(ciphertext) < 16 || len(ciphertext)%8 != 0 {
		return nil, ErrIntegrity
	}
	var a [8]byte
	var r []byte
	if len(ciphertext) == 16 {
		block := make([]byte, 16)
		b.Decrypt(block, ciphertext)
		copy(a[:], block[:8])
		r = append([]byte(nil), block[8:]...)
	} else {
		n := len(ciphertext)/8 - 1
		copy(a[:], ciphertext[:8])
		r = append([]byte(nil), ciphertext[8:]...)
		var blk [16]byte
		for j := 5; j >= 0; j-- {
			for i := n; i >= 1; i-- {
				t := uint64(n*j + i)
				binary.BigEndian.PutUint64(blk[:8], binary.BigEndian.Uint64(a[:])^t)
				copy(blk[8:], r[(i-1)*8:i*8])
				b.Decrypt(blk[:], blk[:])
				copy(a[:], blk[:8])
				copy(r[(i-1)*8:i*8], blk[8:])
			}
		}
	}
	if a[0] != iv[0] || a[1] != iv[1] || a[2] != iv[2] || a[3] != iv[3] {
		return nil, ErrIntegrity
	}
	m := int(binary.BigEndian.Uint32(a[4:]))
	if m == 0 || m > len(r) || len(r)-m > 7 {
		return nil, ErrIntegrity
	}
	for _, v := range r[m:] {
		if v != 0 {
			return nil, ErrIntegrity
		}
	}
	return r[:m], nil
}
