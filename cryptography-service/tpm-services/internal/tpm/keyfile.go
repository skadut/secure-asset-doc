package tpm

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/google/go-tpm/tpm2"
)

type keyFile struct {
	V       int    `json:"v"`
	Parent  string `json:"parent"`
	Public  string `json:"public"`
	Private string `json:"private"`
}

func encode(b []byte) string { return base64.StdEncoding.EncodeToString(b) }

func CheckAbsent(path string, force bool) error {
	_, err := os.Stat(path)
	if err == nil && !force {
		return fmt.Errorf("path already exists: %s", path)
	}
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func WriteAtomic(path string, data []byte, force bool) (err error) {
	dir := filepath.Dir(path)
	if !force {
		if err := CheckAbsent(path, false); err != nil {
			return err
		}
	}
	f, err := os.CreateTemp(dir, filepath.Base(path)+".tmp-*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.Remove(tmp)
		}
	}()
	if err = RestrictToCurrentUser(tmp, false); err != nil {
		_ = f.Close()
		return err
	}
	if _, err = f.Write(data); err != nil {
		_ = f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		_ = f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	if !force {
		if err = CheckAbsent(path, false); err != nil {
			return err
		}
	}
	if force {
		err = os.Rename(tmp, path)
	} else {
		err = os.Link(tmp, path)
		if errors.Is(err, os.ErrExist) {
			return fmt.Errorf("path already exists: %s", path)
		}
		if err == nil {
			err = os.Remove(tmp)
		}
	}
	if err != nil {
		return err
	}
	cleanup = false
	return nil
}

func saveKeyFile(path string, data keyFile, force bool) error {
	if path == "" {
		return errors.New("key path is empty")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	b, err := json.Marshal(data)
	if err != nil {
		return err
	}
	return WriteAtomic(path, append(b, '\n'), force)
}
func loadKeyFile(path string) (keyFile, tpm2.TPM2BPublic, tpm2.TPM2BPrivate, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return keyFile{}, tpm2.TPM2BPublic{}, tpm2.TPM2BPrivate{}, err
	}
	var data keyFile
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.DisallowUnknownFields()
	if err = dec.Decode(&data); err != nil {
		return keyFile{}, tpm2.TPM2BPublic{}, tpm2.TPM2BPrivate{}, err
	}
	if data.V != 1 {
		return keyFile{}, tpm2.TPM2BPublic{}, tpm2.TPM2BPrivate{}, fmt.Errorf("unsupported key file version %d", data.V)
	}
	publicBytes, err := base64.StdEncoding.DecodeString(data.Public)
	if err != nil {
		return keyFile{}, tpm2.TPM2BPublic{}, tpm2.TPM2BPrivate{}, fmt.Errorf("invalid public key encoding: %w", err)
	}
	privateBytes, err := base64.StdEncoding.DecodeString(data.Private)
	if err != nil {
		return keyFile{}, tpm2.TPM2BPublic{}, tpm2.TPM2BPrivate{}, fmt.Errorf("invalid private key encoding: %w", err)
	}
	pub, err := tpm2.Unmarshal[tpm2.TPM2BPublic](publicBytes)
	if err != nil {
		return keyFile{}, tpm2.TPM2BPublic{}, tpm2.TPM2BPrivate{}, fmt.Errorf("invalid public key data: %w", err)
	}
	priv, err := tpm2.Unmarshal[tpm2.TPM2BPrivate](privateBytes)
	if err != nil {
		return keyFile{}, tpm2.TPM2BPublic{}, tpm2.TPM2BPrivate{}, fmt.Errorf("invalid private key data: %w", err)
	}
	return data, *pub, *priv, nil
}
