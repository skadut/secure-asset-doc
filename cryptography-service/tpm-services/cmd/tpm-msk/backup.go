package main

import (
	"bufio"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"tpm-msk/internal/envelope"
	"tpm-msk/internal/escrow"
	"tpm-msk/internal/kek"
	"tpm-msk/internal/shamir"
	"tpm-msk/internal/tpm"
)

func cmdBackup(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprint(stderr, usage)
		return 2
	}
	switch args[0] {
	case "export":
		return cmdBackupExport(args[1:], stdout, stderr)
	case "import":
		return cmdBackupImport(args[1:], stdout, stderr)
	default:
		fmt.Fprint(stderr, usage)
		return 2
	}
}

// escrowFailed restores prior key state and removes only this run's escrow file.
func escrowFailed(keyPath string, existed bool, original []byte, escrowFile string, stderr io.Writer, err error) int {
	if escrowFile != "" {
		_ = os.Remove(escrowFile)
	}
	fmt.Fprintf(stderr, "escrow setup failed: %v\n", err)
	if existed {
		if restoreErr := tpm.WriteAtomic(keyPath, original, true); restoreErr != nil {
			fmt.Fprintf(stderr, "restoring original key at %s failed: %v\n", keyPath, restoreErr)
		} else {
			fmt.Fprintln(stderr, "original key restored; rerun init --escrow")
		}
	} else if rmErr := os.Remove(keyPath); rmErr != nil && !errors.Is(rmErr, os.ErrNotExist) {
		fmt.Fprintf(stderr, "new key %s could not be removed (%v); delete it before rerunning init --escrow\n", keyPath, rmErr)
	} else {
		fmt.Fprintln(stderr, "new key removed; rerun init --escrow")
	}
	return 1
}

// backupTempKeyPath returns a random staging path beside keyPath. tpm.Init with force=false refuses an existing path.
func backupTempKeyPath(keyPath string) (string, error) {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return keyPath + ".import-" + hex.EncodeToString(b), nil
}

func backupKeyRollback(keyPath string, existed bool, original []byte, stderr io.Writer, cause error) int {
	if existed {
		if err := tpm.WriteAtomic(keyPath, original, true); err != nil {
			fmt.Fprintf(stderr, "restoring original key at %s failed: %v\n", keyPath, err)
		}
	} else if err := os.Remove(keyPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		fmt.Fprintf(stderr, "removing new key %s failed: %v\n", keyPath, err)
	}
	fmt.Fprintln(stderr, cause)
	return 1
}

func initEscrow(keyPath, escrowFile string, pin []byte, force bool, stdout, stderr io.Writer) int {
	defer zero(pin)
	pinCopy := append([]byte(nil), pin...)
	defer zero(pinCopy)
	m := make([]byte, 32)
	k := make([]byte, 32)
	defer zero(m)
	defer zero(k)
	if _, err := rand.Read(m); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	imp := []byte(hex.EncodeToString(m))
	defer zero(imp)
	existed := tpm.KeyFileExists(keyPath)
	var original []byte
	if existed && force {
		var err error
		if original, err = readLimited(keyPath, 1<<20); err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
	}
	defer zero(original)
	if err := tpm.Init(keyPath, pin, imp, force); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	wrote := false
	fail := func(err error) int {
		esc := ""
		if wrote {
			esc = escrowFile
		}
		return escrowFailed(keyPath, existed, original, esc, stderr, err)
	}
	h, err := tpm.Open(keyPath, pinCopy)
	if err != nil {
		return fail(fmt.Errorf("opening new key: %w", err))
	}
	keyID, err := h.KeyID()
	_ = h.Close()
	if err != nil {
		return fail(fmt.Errorf("getting key ID: %w", err))
	}
	if _, err := rand.Read(k); err != nil {
		return fail(err)
	}
	bidBytes := make([]byte, 16)
	defer zero(bidBytes)
	if _, err := rand.Read(bidBytes); err != nil {
		return fail(err)
	}
	bundleID := hex.EncodeToString(bidBytes)
	e, err := escrow.Seal(m, k, bundleID, keyID)
	if err != nil {
		return fail(err)
	}
	data, err := json.Marshal(e)
	if err == nil {
		data = append(data, '\n')
		err = tpm.WriteAtomic(escrowFile, data, false)
	}
	if err != nil {
		return fail(err)
	}
	wrote = true
	shares, err := shamir.Split(k, 3, 5)
	if err != nil {
		return fail(err)
	}
	defer func() {
		for _, s := range shares {
			zero(s)
		}
	}()
	fmt.Fprintln(stdout, keyPath)
	fmt.Fprintf(stdout, "key_id: %s\n", keyID)
	for i, share := range shares {
		fmt.Fprintln(stdout, escrow.FormatShare(i+1, bundleID, share))
	}
	fmt.Fprintln(stderr, "Give each share to a different custodian. Shares are shown only once; 3 of 5 are needed to restore.")
	return 0
}

// kekRefs lists the (kek_id, version) pairs of a KEK file.
func kekRefs(kf kek.File) []escrow.KEKRef {
	refs := make([]escrow.KEKRef, 0, len(kf.Keks))
	for _, e := range kf.Keks {
		refs = append(refs, escrow.KEKRef{KEKID: e.KEKID, Version: e.Version})
	}
	return refs
}

func cmdBackupExport(args []string, stdout, stderr io.Writer) int {
	fs := newFlags("backup export", "Export a portable escrow bundle.", stderr)
	escrowDir := fs.String("escrow", "", "escrow directory (required)")
	deksPath := fs.String("deks", "", "deks.json path (required)")
	out := fs.String("out", "", "bundle directory (required)")
	key := fs.String("key", "", "key file path")
	file := fs.String("file", "", "KEK file path")
	if code, ok := parse(fs, args); !ok {
		return code
	}
	if *escrowDir == "" || *deksPath == "" || *out == "" {
		fmt.Fprintln(stderr, "backup export requires --escrow, --deks and --out")
		return 2
	}
	deks, err := readLimited(*deksPath, 16<<20)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	defer zero(deks)
	dekCount, err := escrow.ValidateDEKs(deks)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	keyPath, err := resolveKey(*key)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	keksPath := *file
	if keksPath == "" {
		keksPath, err = kek.DefaultPath()
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
	}
	pin, err := readPIN(stderr, "PIN: ")
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	defer zero(pin)
	h, err := tpm.Open(keyPath, pin)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	defer h.Close()
	keyID, err := h.KeyID()
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	escrowData, err := readLimited(filepath.Join(*escrowDir, "msk.escrow"), 4096)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	defer zero(escrowData)
	if err := escrow.ValidateEscrow(escrowData); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	var e escrow.Escrow
	if err := json.Unmarshal(escrowData, &e); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	if e.KeyID != keyID {
		fmt.Fprintln(stderr, "escrow key_id does not match current TPM key")
		return 1
	}
	keksData, err := readLimited(keksPath, 16<<20)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	defer zero(keksData)
	kf, err := kek.Decode(keksData)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	if err := escrow.CheckDEKRefs(deks, kekRefs(kf)); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	for _, entry := range kf.Keks {
		dek, _, err := envelope.Unwrap(h, []byte(entry.Envelope))
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		zero(dek)
	}
	created, err := createEmptyDir(*out)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	var written []string
	cleanup := func() {
		if created {
			_ = os.RemoveAll(*out)
			return
		}
		for _, name := range written {
			_ = os.Remove(filepath.Join(*out, name))
		}
	}
	files := []struct {
		name string
		data []byte
	}{{"msk.escrow", escrowData}, {"keks.json", keksData}, {"deks.json", deks}}
	manifest := escrow.Manifest{V: 1, BundleID: e.BundleID, KeyID: e.KeyID, Created: time.Now().UTC().Format(time.RFC3339), DEKCount: dekCount, SHA256: map[string]string{}}
	manifest.KEKs = kekRefs(kf)
	for _, f := range files {
		manifest.SHA256[f.name] = escrow.SHA256Hex(f.data)
		written = append(written, f.name)
		if err := write0600(filepath.Join(*out, f.name), f.data); err != nil {
			cleanup()
			fmt.Fprintln(stderr, err)
			return 1
		}
	}
	mb, err := json.Marshal(manifest)
	if err == nil {
		written = append(written, "manifest.json")
		err = write0600(filepath.Join(*out, "manifest.json"), append(mb, '\n'))
	}
	if err != nil {
		cleanup()
		fmt.Fprintln(stderr, err)
		return 1
	}
	fmt.Fprintf(stdout, "wrote %s\n", *out)
	return 0
}

func cmdBackupImport(args []string, stdout, stderr io.Writer) int {
	fs := newFlags("backup import", "Restore a portable escrow bundle.", stderr)
	in := fs.String("in", "", "bundle directory (required)")
	key := fs.String("key", "", "key file path")
	file := fs.String("file", "", "KEK file path")
	force := fs.Bool("force", false, "overwrite existing key and KEK files")
	if code, ok := parse(fs, args); !ok {
		return code
	}
	if *in == "" {
		fmt.Fprintln(stderr, "backup import requires --in")
		return 2
	}
	entries, err := os.ReadDir(*in)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	wantFiles := map[string]bool{"manifest.json": true, "msk.escrow": true, "keks.json": true, "deks.json": true}
	if len(entries) != len(wantFiles) {
		fmt.Fprintln(stderr, "bundle directory must contain exactly manifest.json, msk.escrow, keks.json and deks.json")
		return 1
	}
	for _, entry := range entries {
		if entry.IsDir() || !wantFiles[entry.Name()] {
			fmt.Fprintln(stderr, "bundle directory must contain exactly manifest.json, msk.escrow, keks.json and deks.json")
			return 1
		}
	}
	mb, err := readLimited(filepath.Join(*in, "manifest.json"), 1<<20)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	manifest, err := escrow.DecodeManifest(mb)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	files := make(map[string][]byte)
	for _, name := range escrow.BundleFiles {
		b, err := readLimited(filepath.Join(*in, name), 16<<20)
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		if err := escrow.VerifyFile(b, manifest.SHA256[name]); err != nil {
			zero(b)
			fmt.Fprintln(stderr, err)
			return 1
		}
		files[name] = b
		defer zero(b)
	}
	dekCount, err := escrow.ValidateDEKs(files["deks.json"])
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	kf, err := kek.Decode(files["keks.json"])
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	refs := kekRefs(kf)
	if manifest.DEKCount != dekCount || !escrow.SameKEKRefs(manifest.KEKs, refs) {
		fmt.Fprintln(stderr, "manifest KEKs or DEK count does not match bundle files")
		return 1
	}
	if err := escrow.CheckDEKRefs(files["deks.json"], refs); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	var scanner = bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 1024), 8192)
	var shares [][]byte
	defer func() {
		for _, s := range shares {
			zero(s)
		}
	}()
	// Stop after 3 non-empty lines; never read to EOF (would hang on a terminal).
	for len(shares) < 3 && scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}
		share, err := escrow.ParseShare(line, manifest.BundleID)
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		shares = append(shares, share)
	}
	if err := scanner.Err(); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	if len(shares) != 3 {
		fmt.Fprintln(stderr, "three shares required")
		return 1
	}
	k, err := shamir.Combine(shares, 3)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	defer zero(k)
	m, bundleID, keyID, err := escrow.Open(k, files["msk.escrow"])
	if err != nil {
		if errors.Is(err, escrow.ErrAuth) || errors.Is(err, escrow.ErrKeySize) {
			fmt.Fprintln(stderr, "shares or escrow do not match")
		} else {
			fmt.Fprintln(stderr, err)
		}
		return 1
	}
	defer zero(m)
	if bundleID != manifest.BundleID || keyID != manifest.KeyID {
		fmt.Fprintln(stderr, "shares or escrow do not match")
		return 1
	}
	pin, err := readPIN(stderr, "PIN: ")
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	defer zero(pin)
	confirm, err := readPIN(stderr, "Confirm PIN: ")
	if err != nil {
		zero(confirm)
		fmt.Fprintln(stderr, err)
		return 1
	}
	same := subtle.ConstantTimeCompare(pin, confirm) == 1
	zero(confirm)
	if !same {
		fmt.Fprintln(stderr, "PINs do not match")
		return 1
	}
	pinCopy := append([]byte(nil), pin...)
	defer zero(pinCopy)
	keyPath, err := resolveKey(*key)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	keksPath := *file
	if keksPath == "" {
		keksPath, err = kek.DefaultPath()
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
	}
	if err := tpm.CheckAbsent(keyPath, *force); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	if err := tpm.CheckAbsent(keksPath, *force); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	// Snapshot the existing key in memory so --force can restore it if the keks.json install fails.
	keyExisted := tpm.KeyFileExists(keyPath)
	var origKey []byte
	if keyExisted {
		origKey, err = readLimited(keyPath, 1<<20)
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
	}
	defer zero(origKey)
	if err := ensureParent(keyPath); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	imp := []byte(hex.EncodeToString(m))
	defer zero(imp)
	// Stage the key beside the live path. The live key stays untouched until the staged key verifies.
	tempKey, err := backupTempKeyPath(keyPath)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	defer func() { _ = os.Remove(tempKey) }()
	if err := tpm.Init(tempKey, pin, imp, false); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	h, err := tpm.Open(tempKey, pinCopy)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	newID, err := h.KeyID()
	if err != nil {
		_ = h.Close()
		fmt.Fprintln(stderr, err)
		return 1
	}
	if newID != manifest.KeyID {
		_ = h.Close()
		fmt.Fprintln(stderr, "TPM key ID mismatch: imported key does not match manifest")
		return 1
	}
	for _, entry := range kf.Keks {
		dek, _, err := envelope.Unwrap(h, []byte(entry.Envelope))
		if err != nil {
			_ = h.Close()
			fmt.Fprintf(stderr, "KEK %s version %d does not unwrap under imported key: %v\n", entry.KEKID, entry.Version, err)
			return 1
		}
		zero(dek)
	}
	_ = h.Close()
	newKey, err := os.ReadFile(tempKey)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	defer zero(newKey)
	// Verified. Atomic replace at the live path; on failure the old key is still in place.
	if err := tpm.WriteAtomic(keyPath, newKey, *force); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	// keks.json is installed last; failure rolls the live key back to its original state.
	if err := ensureParent(keksPath); err != nil {
		return backupKeyRollback(keyPath, keyExisted, origKey, stderr, err)
	}
	if err := tpm.WriteAtomic(keksPath, files["keks.json"], *force); err != nil {
		return backupKeyRollback(keyPath, keyExisted, origKey, stderr, err)
	}
	fmt.Fprintln(stdout, "restore deks.json into the keyd-deks docker volume (see docs)")
	return 0
}

func createEmptyDir(path string) (bool, error) {
	if _, err := os.Stat(path); err == nil {
		entries, e := os.ReadDir(path)
		if e != nil {
			return false, e
		}
		if len(entries) != 0 {
			return false, fmt.Errorf("bundle directory must be empty: %s", path)
		}
		return false, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return false, err
	}
	if err := os.MkdirAll(path, 0700); err != nil {
		return false, err
	}
	return true, nil
}
func write0600(path string, data []byte) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	_, werr := f.Write(data)
	cerr := f.Close()
	if werr != nil {
		return werr
	}
	return cerr
}
func ensureParent(path string) error {
	dir := filepath.Dir(path)
	if _, err := os.Stat(dir); errors.Is(err, os.ErrNotExist) {
		if err := os.MkdirAll(dir, 0700); err != nil {
			return err
		}
		return tpm.RestrictToCurrentUser(dir, true)
	} else {
		return err
	}
}
