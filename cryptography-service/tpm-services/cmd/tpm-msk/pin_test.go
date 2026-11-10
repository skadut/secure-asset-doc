package main

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func writePINTemp(t *testing.T, content []byte) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "pin")
	if err := os.WriteFile(p, content, 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestPINFileStripsOneNewline(t *testing.T) {
	cases := []struct{ in, want string }{
		{"123456\n", "123456"},
		{"123456\r\n", "123456"},
		{"123456\n\n", "123456\n"},
	}
	for i, c := range cases {
		got, err := readPINFile(writePINTemp(t, []byte(c.in)))
		if err != nil {
			t.Fatalf("case %d: unexpected error", i)
		}
		if string(got) != c.want {
			t.Errorf("case %d: wrong result after newline strip", i)
		}
	}
}

func TestPINFileShortRejected(t *testing.T) {
	if _, err := readPINFile(writePINTemp(t, []byte("12345\n"))); err == nil {
		t.Error("short PIN accepted")
	}
}

func TestPINFileTooLarge(t *testing.T) {
	if _, err := readPINFile(writePINTemp(t, bytes.Repeat([]byte("1"), 1025))); err == nil {
		t.Error("oversized PIN file accepted")
	}
}

func TestPINFileEnvUnset(t *testing.T) {
	t.Setenv("TPM_MSK_PIN_FILE", "")
	if p, ok := pinFilePath(); ok || p != "" {
		t.Error("empty env reported as set")
	}
}

func TestPINFileEnvSet(t *testing.T) {
	want := filepath.Join(t.TempDir(), "pin")
	t.Setenv("TPM_MSK_PIN_FILE", want)
	if p, ok := pinFilePath(); !ok || p != want {
		t.Error("env path not returned")
	}
}
