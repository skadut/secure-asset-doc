package main

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestBackupTempKeyPathBesideLiveKeyAndUnique(t *testing.T) {
	live := filepath.Join(t.TempDir(), "msk.key")
	a, err := backupTempKeyPath(live)
	if err != nil {
		t.Fatal(err)
	}
	b, err := backupTempKeyPath(live)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(a) != filepath.Dir(live) || !strings.HasPrefix(filepath.Base(a), "msk.key.import-") {
		t.Fatalf("temp path not beside live key: %s", a)
	}
	if a == b {
		t.Fatal("temp paths collide")
	}
}
