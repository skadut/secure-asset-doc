// Package escrow holds the pure-bytes logic for the MSK escrow bundle: sealing M under K,
// Shamir share text, and manifest and DEK-file validation. No TPM and no file IO.
package escrow

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
)

const (
	Version   = 1
	Alg       = "AES-256-GCM"
	Threshold = 3
	Shares    = 5
)

// ErrAuth is returned by Open when K does not authenticate the escrow ciphertext.
var ErrAuth = errors.New("escrow authentication failed")

// ErrKeySize is returned when K cannot initialize AES-GCM.
var ErrKeySize = errors.New("invalid escrow key size")

// Escrow is the msk.escrow file: M sealed under K.
type Escrow struct {
	V         int    `json:"v"`
	Alg       string `json:"alg"`
	BundleID  string `json:"bundle_id"`
	KeyID     string `json:"key_id"`
	Threshold int    `json:"threshold"`
	Shares    int    `json:"shares"`
	IV        string `json:"iv"`
	CT        string `json:"ct"`
}

// Manifest is manifest.json. SHA256 maps each bundle file name to its hex digest.
type Manifest struct {
	V        int               `json:"v"`
	BundleID string            `json:"bundle_id"`
	KeyID    string            `json:"key_id"`
	Created  string            `json:"created"`
	KEKs     []KEKRef          `json:"keks"`
	DEKCount int               `json:"dek_count"`
	SHA256   map[string]string `json:"sha256"`
}

// KEKRef names one KEK entry in the manifest.
type KEKRef struct {
	KEKID   string `json:"kek_id"`
	Version int    `json:"version"`
}

// DEK is one entry of deks.json. Only the fields the restore flow needs are typed.
type DEK struct {
	DEKID      string `json:"dek_id"`
	Purpose    string `json:"purpose"`
	KEKID      string `json:"kek_id"`
	KEKVersion int    `json:"kek_version"`
}

type deksFile struct {
	V    int               `json:"v"`
	DEKs []json.RawMessage `json:"deks"`
}

// BundleFiles is the exact set of files a bundle holds, all listed in the manifest sha256 map.
var BundleFiles = []string{"msk.escrow", "keks.json", "deks.json"}

var errShare = errors.New("invalid share")

func aad(bundleID, keyID string) []byte {
	return []byte("tpm-msk/escrow/v1\x00" + bundleID + "\x00" + keyID)
}

// Seal encrypts the 32-byte M under the 32-byte K with a fresh 12-byte IV.
func Seal(m, k []byte, bundleID, keyID string) (Escrow, error) {
	if len(m) != 32 || len(k) != 32 {
		return Escrow{}, errors.New("M and K must be 32 bytes")
	}
	block, err := aes.NewCipher(k)
	if err != nil {
		return Escrow{}, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return Escrow{}, err
	}
	iv := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(iv); err != nil {
		return Escrow{}, err
	}
	ct := gcm.Seal(nil, iv, m, aad(bundleID, keyID))
	return Escrow{
		V: Version, Alg: Alg, BundleID: bundleID, KeyID: keyID,
		Threshold: Threshold, Shares: Shares,
		IV: base64.StdEncoding.EncodeToString(iv),
		CT: base64.StdEncoding.EncodeToString(ct),
	}, nil
}

// ValidateEscrow strictly validates the structural fields of an escrow JSON document.
func ValidateEscrow(data []byte) error {
	var e Escrow
	if err := decodeStrict(data, &e); err != nil {
		return err
	}
	if e.V != Version || e.Alg != Alg || e.BundleID == "" || e.KeyID == "" || e.Threshold != Threshold || e.Shares != Shares {
		return errors.New("invalid escrow parameters")
	}
	iv, err := base64.StdEncoding.DecodeString(e.IV)
	if err != nil || len(iv) != 12 {
		return errors.New("invalid escrow iv")
	}
	if _, err := base64.StdEncoding.DecodeString(e.CT); err != nil {
		return errors.New("invalid escrow ciphertext")
	}
	return nil
}

// Open decodes escrow JSON and decrypts M with K. The caller zeroes the returned M.
func Open(k, data []byte) (m []byte, bundleID, keyID string, err error) {
	var e Escrow
	if err := decodeStrict(data, &e); err != nil {
		return nil, "", "", err
	}
	if e.V != Version || e.Alg != Alg || e.Threshold != Threshold || e.Shares != Shares {
		return nil, "", "", errors.New("unsupported escrow parameters")
	}
	if e.BundleID == "" || e.KeyID == "" {
		return nil, "", "", errors.New("escrow missing bundle_id or key_id")
	}
	iv, err := base64.StdEncoding.DecodeString(e.IV)
	if err != nil {
		return nil, "", "", errors.New("invalid escrow iv encoding")
	}
	ct, err := base64.StdEncoding.DecodeString(e.CT)
	if err != nil {
		return nil, "", "", errors.New("invalid escrow ct encoding")
	}
	if len(k) != 32 {
		return nil, "", "", ErrKeySize
	}
	block, err := aes.NewCipher(k)
	if err != nil {
		return nil, "", "", ErrKeySize
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, "", "", err
	}
	if len(iv) != gcm.NonceSize() {
		return nil, "", "", errors.New("invalid escrow iv length")
	}
	m, err = gcm.Open(nil, iv, ct, aad(e.BundleID, e.KeyID))
	if err != nil {
		return nil, "", "", ErrAuth
	}
	if len(m) != 32 {
		zero(m)
		return nil, "", "", errors.New("decrypted M must be 32 bytes")
	}
	return m, e.BundleID, e.KeyID, nil
}

// FormatShare returns the display line "share i/5 <bundleID>:<hex>". i is 1-based.
func FormatShare(i int, bundleID string, share []byte) string {
	return fmt.Sprintf("share %d/%d %s:%s", i, Shares, bundleID, hex.EncodeToString(share))
}

// ParseShare accepts "<bundleID>:<hex>" or "share i/5 <bundleID>:<hex>" and returns the raw share bytes.
// The bundle_id must equal bundleID. Errors never include share bytes.
func ParseShare(line, bundleID string) ([]byte, error) {
	s := strings.TrimSpace(line)
	if rest, ok := strings.CutPrefix(s, "share "); ok {
		idx, after, found := strings.Cut(rest, " ")
		if !found {
			return nil, errShare
		}
		n, total, found := strings.Cut(idx, "/")
		if !found || total != strconv.Itoa(Shares) {
			return nil, errShare
		}
		if i, err := strconv.Atoi(n); err != nil || i < 1 || i > Shares {
			return nil, errShare
		}
		s = after
	}
	id, h, found := strings.Cut(s, ":")
	if !found {
		return nil, errShare
	}
	if id != bundleID {
		return nil, errors.New("share bundle_id does not match manifest")
	}
	b, err := hex.DecodeString(h)
	if err != nil || len(b) < 2 {
		return nil, errShare
	}
	return b, nil
}

// SHA256Hex returns the lowercase hex SHA-256 of data.
func SHA256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// VerifyFile checks data against the manifest digest. Hex digests are not secret, so plain compare is fine.
func VerifyFile(data []byte, wantHex string) error {
	if SHA256Hex(data) != wantHex {
		return errors.New("file sha256 does not match manifest")
	}
	return nil
}

// DecodeManifest parses manifest.json strictly and validates it.
func DecodeManifest(data []byte) (Manifest, error) {
	var m Manifest
	if err := decodeStrict(data, &m); err != nil {
		return Manifest{}, err
	}
	return m, ValidateManifest(m)
}

// ValidateManifest checks version, ids, and that the sha256 keys are exactly BundleFiles.
func ValidateManifest(m Manifest) error {
	if m.V != Version {
		return fmt.Errorf("unsupported manifest version %d", m.V)
	}
	if m.BundleID == "" || m.KeyID == "" {
		return errors.New("manifest missing bundle_id or key_id")
	}
	if len(m.SHA256) != len(BundleFiles) {
		return errors.New("manifest sha256 map must list exactly the bundle files")
	}
	for _, name := range BundleFiles {
		if _, ok := m.SHA256[name]; !ok {
			return fmt.Errorf("manifest sha256 missing %s", name)
		}
	}
	return nil
}

// ValidateDEKs checks deks.json: strict schema, version 1, no trailing data. Returns the DEK count.
func ValidateDEKs(data []byte) (int, error) {
	var f deksFile
	if err := decodeStrict(data, &f); err != nil {
		return 0, err
	}
	if f.V != Version {
		return 0, fmt.Errorf("unsupported deks version %d", f.V)
	}
	for _, raw := range f.DEKs {
		// Pointers so that JSON null and missing fields both show up as nil.
		var d struct {
			DEKID      *string `json:"dek_id"`
			Purpose    *string `json:"purpose"`
			KEKID      *string `json:"kek_id"`
			KEKVersion *int    `json:"kek_version"`
			Created    *string `json:"created"`
			IV         *string `json:"iv"`
			CT         *string `json:"ct"`
		}
		if err := decodeStrict(raw, &d); err != nil {
			return 0, errors.New("invalid deks entry")
		}
		if d.DEKID == nil || d.Purpose == nil || d.KEKID == nil || d.KEKVersion == nil || d.Created == nil || d.IV == nil || d.CT == nil {
			return 0, errors.New("deks entry requires dek_id, purpose, kek_id, kek_version, created, iv and ct")
		}
		if *d.DEKID == "" || *d.KEKID == "" || *d.IV == "" || *d.CT == "" {
			return 0, errors.New("deks entry missing dek_id, kek_id, iv or ct")
		}
		if *d.KEKVersion < 1 {
			return 0, errors.New("deks entry kek_version must be >= 1")
		}
	}
	return len(f.DEKs), nil
}

// CheckDEKRefs verifies every deks.json entry names a (kek_id, kek_version) present in refs.
// Empty refs pass only when deks has zero entries.
func CheckDEKRefs(deks []byte, refs []KEKRef) error {
	var f deksFile
	if err := decodeStrict(deks, &f); err != nil {
		return err
	}
	have := make(map[KEKRef]bool, len(refs))
	for _, r := range refs {
		have[r] = true
	}
	for _, raw := range f.DEKs {
		var d DEK
		if err := json.Unmarshal(raw, &d); err != nil {
			return errors.New("invalid deks entry")
		}
		if !have[KEKRef{KEKID: d.KEKID, Version: d.KEKVersion}] {
			return fmt.Errorf("deks entry %s references missing KEK %s version %d", d.DEKID, d.KEKID, d.KEKVersion)
		}
	}
	return nil
}

// SameKEKRefs reports whether a and b hold the same (kek_id, version) pairs with multiplicity.
func SameKEKRefs(a, b []KEKRef) bool {
	if len(a) != len(b) {
		return false
	}
	counts := make(map[KEKRef]int, len(a))
	for _, r := range a {
		counts[r]++
	}
	for _, r := range b {
		counts[r]--
		if counts[r] < 0 {
			return false
		}
	}
	return true
}

// decodeStrict decodes exactly one JSON value into v, rejecting unknown fields and trailing data.
func decodeStrict(data []byte, v any) error {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return err
	}
	var extra json.RawMessage
	if err := dec.Decode(&extra); err != io.EOF {
		return errors.New("trailing data after JSON value")
	}
	return nil
}

func zero(b []byte) {
	for i := range b {
		b[i] = 0
	}
}
