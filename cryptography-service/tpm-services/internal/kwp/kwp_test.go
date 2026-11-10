package kwp

import (
	"encoding/hex"
	"testing"
)

func TestRFC5649Vectors(t *testing.T) {
	vectors := [][3]string{
		{"5840df6e29b02af1ab493b705bf16ea1ae8338f4dcc176a8", "c37b7e6492584340bed12207808941155068f738", "138bdeaa9b8fa7fc61f97742e72248ee5ae6ae5360d1ae6a5f54f373fa543b6a"},
		{"5840df6e29b02af1ab493b705bf16ea1ae8338f4dcc176a8", "466f7250617369", "afbeb0f07dfbf5419200f2ccb50bb24f"},
	}
	for _, v := range vectors {
		key, _ := hex.DecodeString(v[0])
		plain, _ := hex.DecodeString(v[1])
		want, _ := hex.DecodeString(v[2])
		got, err := Wrap(key, plain)
		if err != nil || hex.EncodeToString(got) != hex.EncodeToString(want) {
			t.Fatalf("Wrap: got %x, err %v", got, err)
		}
		back, err := Unwrap(key, want)
		if err != nil || hex.EncodeToString(back) != hex.EncodeToString(plain) {
			t.Fatalf("Unwrap: got %x, err %v", back, err)
		}
	}
}
