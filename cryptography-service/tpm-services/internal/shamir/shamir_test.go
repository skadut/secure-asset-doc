package shamir

import (
	"bytes"
	"testing"
)

func TestAnyTwoOfThree(t *testing.T) {
	secret := []byte("throwaway demo secret")
	shares, err := Split(secret, 2, 3)
	if err != nil {
		t.Fatal(err)
	}
	for _, pair := range [][]int{{0, 1}, {0, 2}, {1, 2}} {
		got, err := Combine([][]byte{shares[pair[0]], shares[pair[1]]}, 2)
		if err != nil || !bytes.Equal(got, secret) {
			t.Fatalf("pair %v: %x, %v", pair, got, err)
		}
	}
	one, err := Combine(shares[:1], 2)
	if err == nil && bytes.Equal(one, secret) {
		t.Fatal("one share reconstructed secret")
	}
}
