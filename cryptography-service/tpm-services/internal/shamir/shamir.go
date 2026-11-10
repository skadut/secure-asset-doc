// Package shamir splits and combines secrets using Shamir's scheme over GF(256).
package shamir

import (
	"crypto/rand"
	"errors"
	"io"
)

// Split divides secret into n shares recoverable with any threshold shares.
func Split(secret []byte, threshold, n int) ([][]byte, error) {
	if threshold < 2 || threshold > n || n > 255 || len(secret) == 0 {
		return nil, errors.New("invalid Shamir parameters")
	}
	shares := make([][]byte, n)
	for i := range shares {
		shares[i] = make([]byte, len(secret)+1)
		shares[i][0] = byte(i + 1)
	}
	coeff := make([]byte, threshold)
	for j, s := range secret {
		coeff[0] = s
		if _, err := io.ReadFull(rand.Reader, coeff[1:]); err != nil {
			return nil, err
		}
		for i := range shares {
			y, x := coeff[threshold-1], shares[i][0]
			for k := threshold - 2; k >= 0; k-- {
				y = mul(y, x) ^ coeff[k]
			}
			shares[i][j+1] = y
		}
	}
	zero(coeff)
	return shares, nil
}

// Combine reconstructs a secret from threshold or more distinct shares.
func Combine(shares [][]byte, threshold int) ([]byte, error) {
	if threshold < 2 || len(shares) < threshold {
		return nil, errors.New("insufficient Shamir shares")
	}
	size := len(shares[0])
	if size < 2 {
		return nil, errors.New("invalid Shamir share")
	}
	seen := map[byte]bool{}
	for _, s := range shares[:threshold] {
		if len(s) != size || s[0] == 0 || seen[s[0]] {
			return nil, errors.New("invalid Shamir shares")
		}
		seen[s[0]] = true
	}
	out := make([]byte, size-1)
	for b := range out {
		var v byte
		for i, si := range shares[:threshold] {
			li := byte(1)
			for j, sj := range shares[:threshold] {
				if i != j {
					li = mul(li, div(sj[0], sj[0]^si[0]))
				}
			}
			v ^= mul(shares[i][b+1], li)
		}
		out[b] = v
	}
	return out, nil
}

func mul(a, b byte) byte {
	var p byte
	for b != 0 {
		if b&1 != 0 {
			p ^= a
		}
		hi := a & 0x80
		a <<= 1
		if hi != 0 {
			a ^= 0x1b
		}
		b >>= 1
	}
	return p
}
func div(a, b byte) byte {
	if a == 0 {
		return 0
	}
	return mul(a, pow(b, 254))
}
func pow(a byte, n int) byte {
	r := byte(1)
	for n > 0 {
		if n&1 != 0 {
			r = mul(r, a)
		}
		a = mul(a, a)
		n >>= 1
	}
	return r
}
func zero(b []byte) {
	for i := range b {
		b[i] = 0
	}
}
