package kek

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"time"

	"tpm-msk/internal/envelope"
	"tpm-msk/internal/tpm"
)

type Entry struct {
	KEKID    string          `json:"kek_id"`
	Version  int             `json:"version"`
	Created  string          `json:"created"`
	Envelope json.RawMessage `json:"envelope"`
}

type File struct {
	V    int     `json:"v"`
	Keks []Entry `json:"keks"`
}

type Summary struct {
	KEKID   string `json:"kek_id"`
	Version int    `json:"version"`
	Created string `json:"created"`
}

var kekIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)

func DefaultPath() (string, error) {
	base := os.Getenv("APPDATA")
	if base == "" {
		var err error
		if base, err = os.UserConfigDir(); err != nil {
			return "", err
		}
	}
	return filepath.Join(base, "tpm-msk", "keks.json"), nil
}

func Load(path string) (File, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return File{V: 1}, nil
	}
	if err != nil {
		return File{}, err
	}
	return Decode(data)
}

func Decode(data []byte) (File, error) {
	var f File
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&f); err != nil {
		return File{}, err
	}
	var extra json.RawMessage
	if err := dec.Decode(&extra); err != io.EOF {
		if err == nil {
			return File{}, errors.New("trailing data after KEK file")
		}
		return File{}, err
	}
	if f.V != 1 {
		return File{}, fmt.Errorf("unsupported KEK file version %d", f.V)
	}
	if err := validateEntries(f.Keks); err != nil {
		return File{}, err
	}
	return f, nil
}

func Save(path string, f File) error {
	if f.V != 1 {
		return fmt.Errorf("unsupported KEK file version %d", f.V)
	}
	if err := validateEntries(f.Keks); err != nil {
		return err
	}
	data, err := json.Marshal(f)
	if err != nil {
		return err
	}
	dir := filepath.Dir(path)
	_, statErr := os.Stat(dir)
	if statErr != nil && !errors.Is(statErr, os.ErrNotExist) {
		return statErr
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	if errors.Is(statErr, os.ErrNotExist) {
		if err := tpm.RestrictToCurrentUser(dir, true); err != nil {
			return err
		}
	}
	return tpm.WriteAtomic(path, data, true)
}

func Create(path string, h envelope.HMACer, kekID string) (int, error) {
	if !kekIDPattern.MatchString(kekID) {
		return 0, fmt.Errorf("invalid KEK id %q", kekID)
	}
	f, err := Load(path)
	if err != nil {
		return 0, err
	}
	version := 1
	for _, e := range f.Keks {
		if e.KEKID == kekID && e.Version >= version {
			version = e.Version + 1
		}
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		zero(key)
		return 0, err
	}
	defer zero(key)
	label := "kek/" + kekID + "/" + strconv.Itoa(version)
	env, err := envelope.Wrap(h, label, key)
	if err != nil {
		return 0, err
	}
	f.Keks = append(f.Keks, Entry{
		KEKID: kekID, Version: version,
		Created: time.Now().UTC().Format(time.RFC3339), Envelope: env,
	})
	if err := Save(path, f); err != nil {
		return 0, err
	}
	return version, nil
}

func List(path string) ([]Summary, error) {
	f, err := Load(path)
	if err != nil {
		return nil, err
	}
	out := make([]Summary, 0, len(f.Keks))
	for _, e := range f.Keks {
		out = append(out, Summary{KEKID: e.KEKID, Version: e.Version, Created: e.Created})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].KEKID != out[j].KEKID {
			return out[i].KEKID < out[j].KEKID
		}
		return out[i].Version < out[j].Version
	})
	return out, nil
}

func Lookup(f File, kekID string, version int) ([]byte, bool) {
	for _, e := range f.Keks {
		if e.KEKID == kekID && e.Version == version {
			return e.Envelope, true
		}
	}
	return nil, false
}

func validateEntries(entries []Entry) error {
	for _, e := range entries {
		if !kekIDPattern.MatchString(e.KEKID) {
			return fmt.Errorf("invalid KEK id %q", e.KEKID)
		}
		if e.Version < 1 {
			return fmt.Errorf("invalid KEK version %d", e.Version)
		}
		if len(bytes.TrimSpace(e.Envelope)) == 0 {
			return fmt.Errorf("empty envelope for KEK %q version %d", e.KEKID, e.Version)
		}
	}
	return nil
}

func zero(b []byte) {
	for i := range b {
		b[i] = 0
	}
}
