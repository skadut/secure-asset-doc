package kek

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"tpm-msk/internal/envelope"
)

type fakeHMAC struct{}

var testKey = []byte("test-key-not-secret")

func (fakeHMAC) HMAC(msg []byte) ([]byte, error) {
	m := hmac.New(sha256.New, testKey)
	m.Write(msg)
	return m.Sum(nil), nil
}

func TestCreateListSorted(t *testing.T) {
	path := filepath.Join(t.TempDir(), "keks.json")
	for _, want := range []int{1, 2} {
		v, err := Create(path, fakeHMAC{}, "kek-01")
		if err != nil || v != want {
			t.Fatalf("Create = %d, %v; want %d", v, err, want)
		}
	}
	list, err := List(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 || list[0].Version != 1 || list[1].Version != 2 {
		t.Fatalf("List = %+v", list)
	}
}

func TestRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "keks.json")
	if _, err := Create(path, fakeHMAC{}, "kek-01"); err != nil {
		t.Fatal(err)
	}
	if _, err := Create(path, fakeHMAC{}, "kek-01"); err != nil {
		t.Fatal(err)
	}
	f, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	env, ok := Lookup(f, "kek-01", 2)
	if !ok {
		t.Fatal("Lookup kek-01/2 not found")
	}
	dek, label, err := envelope.Unwrap(fakeHMAC{}, env)
	if err != nil {
		t.Fatal(err)
	}
	if len(dek) != 32 || label != "kek/kek-01/2" {
		t.Fatalf("Unwrap len=%d label=%q", len(dek), label)
	}
}

func TestCreateInvalidID(t *testing.T) {
	for _, id := range []string{"KEK_01", "-x", ""} {
		path := filepath.Join(t.TempDir(), "keks.json")
		if _, err := Create(path, fakeHMAC{}, id); err == nil {
			t.Errorf("Create(%q) succeeded", id)
		}
		if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
			t.Errorf("Create(%q) wrote file: %v", id, err)
		}
	}
}

func TestLoadMissing(t *testing.T) {
	f, err := Load(filepath.Join(t.TempDir(), "absent.json"))
	if err != nil {
		t.Fatal(err)
	}
	if f.V != 1 || len(f.Keks) != 0 {
		t.Fatalf("Load = %+v", f)
	}
}

func TestLoadUnknownField(t *testing.T) {
	path := filepath.Join(t.TempDir(), "keks.json")
	data := []byte(`{"v":1,"keks":[],"extra":true}`)
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(path); err == nil {
		t.Fatal("Load accepted unknown field")
	}
}

func TestSaveLoadIdentical(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sub", "keks.json")
	want := File{V: 1, Keks: []Entry{
		{KEKID: "kek-01", Version: 1, Created: "2026-01-01T00:00:00Z", Envelope: []byte(`{"v":1}`)},
	}}
	if err := Save(path, want); err != nil {
		t.Fatal(err)
	}
	got, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got.Keks[0].KEKID, want.Keks[0].KEKID) ||
		!bytes.Equal(got.Keks[0].Envelope, want.Keks[0].Envelope) ||
		got.Keks[0].Version != 1 || got.Keks[0].Created != want.Keks[0].Created {
		t.Fatalf("Load = %+v, want %+v", got, want)
	}
}
