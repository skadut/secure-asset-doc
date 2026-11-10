package tpm

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"

	"github.com/google/go-tpm/tpm2"
	"github.com/google/go-tpm/tpm2/transport"
)

const persistentSRK tpm2.TPMHandle = 0x81000001

const tbsAccessHint = "TPM access blocked by Windows TBS; try an elevated PowerShell"

func wrapTPMError(operation string, err error) error {
	if err == nil {
		return nil
	}
	for cause := err; cause != nil; cause = errors.Unwrap(cause) {
		v := reflect.ValueOf(cause)
		t := v.Type()
		if t.Kind() == reflect.Uint32 && t.Name() == "Error" && strings.HasSuffix(t.PkgPath(), "/tpmutil/tbs") {
			code := uint32(v.Uint())
			if code == 0x80284012 || code == 0x80280400 {
				return fmt.Errorf("%s: %s: %w", operation, tbsAccessHint, err)
			}
		}
	}
	return fmt.Errorf("%s: %w", operation, err)
}

// ErrWrongPIN is returned on auth failure when lockout counters cannot be read.
var ErrWrongPIN = errors.New("wrong PIN")

// authValue is SHA-256(PIN), 32 bytes. The TPM auth is derived from the PIN, never the PIN itself.
// Caller must zero the result.
func authValue(pin []byte) []byte {
	h := sha256.Sum256(pin)
	out := make([]byte, len(h))
	copy(out, h[:])
	zero(h[:])
	return out
}

func zero(b []byte) {
	for i := range b {
		b[i] = 0
	}
}

func openTPM() (transport.TPMCloser, error) {
	if addr := os.Getenv("TPM_MSK_TCP"); addr != "" {
		conn, err := net.Dial("tcp", addr)
		if err != nil {
			return nil, wrapTPMError("open TPM", err)
		}
		t := transport.FromReadWriteCloser(conn)
		if err := flushLeftovers(t); err != nil {
			_ = t.Close()
			return nil, wrapTPMError("open TPM", err)
		}
		return t, nil
	}
	t, err := transport.OpenTPM()
	if err != nil {
		return nil, wrapTPMError("open TPM", err)
	}
	return t, nil
}

// ponytail: swtpm has no resource manager; leftovers flushed on open. Upgrade: tpm2-abrmd or a TPM with RM.
// flushLeftovers flushes transient objects and loaded sessions left by a crashed process. TCP path only.
func flushLeftovers(t transport.TPM) error {
	for _, base := range []tpm2.TPMHandle{
		tpm2.TPMHandle(uint32(tpm2.TPMHTTransient) << 24),
		tpm2.TPMHandle(uint32(tpm2.TPMHTLoadedSession) << 24),
	} {
		typeBase := uint32(base) >> 24
		property := uint32(base)
		for {
			r, err := (tpm2.GetCapability{Capability: tpm2.TPMCapHandles, Property: property, PropertyCount: 64}).Execute(t)
			if err != nil {
				return err
			}
			handles, err := r.CapabilityData.Data.Handles()
			if err != nil {
				return err
			}
			for _, handle := range handles.Handle {
				if uint32(handle)>>24 != typeBase {
					break
				}
				_, _ = (tpm2.FlushContext{FlushHandle: handle}).Execute(t)
				property = uint32(handle) + 1
			}
			if !r.MoreData || len(handles.Handle) == 0 || uint32(handles.Handle[len(handles.Handle)-1])>>24 != typeBase {
				break
			}
		}
	}
	return nil
}

// parent returns a usable parent handle. Persistent SRK if present, otherwise a transient
// ECC SRK created under the owner hierarchy (caller must flush when transient is true).
func parent(t transport.TPM) (p tpm2.AuthHandle, name string, transient bool, err error) {
	r, err := (tpm2.ReadPublic{ObjectHandle: persistentSRK}).Execute(t)
	if err == nil {
		return tpm2.AuthHandle{Handle: persistentSRK, Name: r.Name, Auth: tpm2.PasswordAuth(nil)}, "0x81000001", false, nil
	}
	return eccPrimary(t)
}

// parentFor honors the parent recorded in the key file. Never writes hierarchy state.
func parentFor(t transport.TPM, wanted string) (p tpm2.AuthHandle, name string, transient bool, err error) {
	switch wanted {
	case "0x81000001":
		r, e := (tpm2.ReadPublic{ObjectHandle: persistentSRK}).Execute(t)
		if e != nil {
			return tpm2.AuthHandle{}, "", false, errors.New("key requires persistent SRK 0x81000001, which is absent")
		}
		return tpm2.AuthHandle{Handle: persistentSRK, Name: r.Name, Auth: tpm2.PasswordAuth(nil)}, "0x81000001", false, nil
	case "srk-primary-ecc-p256":
		return eccPrimary(t)
	}
	return tpm2.AuthHandle{}, "", false, fmt.Errorf("unsupported key parent %q", wanted)
}

func eccPrimary(t transport.TPM) (p tpm2.AuthHandle, name string, transient bool, err error) {
	c, err := (tpm2.CreatePrimary{
		PrimaryHandle: tpm2.AuthHandle{Handle: tpm2.TPMRHOwner, Auth: tpm2.PasswordAuth(nil)},
		InPublic:      tpm2.New2B(tpm2.ECCSRKTemplate),
	}).Execute(t)
	if err != nil {
		return tpm2.AuthHandle{}, "", false, wrapTPMError("TPM2_CreatePrimary failed", err)
	}
	return tpm2.AuthHandle{Handle: c.ObjectHandle, Name: c.Name, Auth: tpm2.PasswordAuth(nil)}, "srk-primary-ecc-p256", true, nil
}

// ponytail: no PCR binding; MSK is not bound to boot state. Add when boot-state policy exists.
// ponytail: no generated-MSK backup/export; add when a recovery ceremony exists.
// ponytail: no key rotation; add when rotation policy exists.
// mskTemplate: keyed-hash HMAC-SHA256. Generated keys set SensitiveDataOrigin; imported keys do not.
func mskTemplate(generated bool) tpm2.TPMTPublic {
	return tpm2.TPMTPublic{
		Type:    tpm2.TPMAlgKeyedHash,
		NameAlg: tpm2.TPMAlgSHA256,
		ObjectAttributes: tpm2.TPMAObject{
			FixedTPM:            true,
			FixedParent:         true,
			UserWithAuth:        true,
			SignEncrypt:         true,
			SensitiveDataOrigin: generated,
		},
		Parameters: tpm2.NewTPMUPublicParms(tpm2.TPMAlgKeyedHash, &tpm2.TPMSKeyedHashParms{
			Scheme: tpm2.TPMTKeyedHashScheme{
				Scheme:  tpm2.TPMAlgHMAC,
				Details: tpm2.NewTPMUSchemeKeyedHash(tpm2.TPMAlgHMAC, &tpm2.TPMSSchemeHMAC{HashAlg: tpm2.TPMAlgSHA256}),
			},
		}),
		Unique: tpm2.NewTPMUPublicID(tpm2.TPMAlgKeyedHash, &tpm2.TPM2BDigest{}),
	}
}

// Init creates the TPM-bound MSK (or imports importHex, 32-64 bytes hex-encoded) and saves the key file.
// pin and importHex are zeroed on return.
func Init(keyPath string, pin []byte, importHex []byte, force bool) (err error) {
	defer zero(pin)
	defer zero(importHex)
	if keyPath == "" {
		if keyPath, err = DefaultKeyPath(); err != nil {
			return err
		}
	}
	var imported []byte
	if len(importHex) != 0 {
		imported = make([]byte, hex.DecodedLen(len(importHex)))
		defer zero(imported)
		n, e := hex.Decode(imported, importHex)
		if e != nil {
			return fmt.Errorf("invalid import hex: %w", e)
		}
		if n < 32 || n > 64 {
			return errors.New("imported key must be 32-64 bytes")
		}
		imported = imported[:n]
	}
	auth := authValue(pin)
	defer zero(auth)

	t, err := openTPM()
	if err != nil {
		return err
	}
	defer t.Close()

	p, parentName, transient, err := parent(t)
	if err != nil {
		return err
	}
	if transient {
		defer func() { _, _ = (tpm2.FlushContext{FlushHandle: p.Handle}).Execute(t) }()
	}

	c, err := (tpm2.Create{
		ParentHandle: p,
		InSensitive: tpm2.TPM2BSensitiveCreate{Sensitive: &tpm2.TPMSSensitiveCreate{
			UserAuth: tpm2.TPM2BAuth{Buffer: auth},
			Data:     tpm2.NewTPMUSensitiveCreate(&tpm2.TPM2BSensitiveData{Buffer: imported}),
		}},
		InPublic: tpm2.New2B(mskTemplate(len(imported) == 0)),
	}).Execute(t)
	if err != nil {
		return fmt.Errorf("TPM2_Create failed: %w", err)
	}
	return saveKeyFile(keyPath, keyFile{
		V:       1,
		Parent:  parentName,
		Public:  encode(tpm2.Marshal(c.OutPublic)),
		Private: encode(tpm2.Marshal(c.OutPrivate)),
	}, force)
}

// Handle is a loaded MSK. Close flushes the key, closes the TPM, and zeroes auth.
type Handle struct {
	tpm       transport.TPMCloser
	key       tpm2.TPMHandle
	name      tpm2.TPM2BName
	srk       tpm2.TPMHandle
	srkPub    tpm2.TPMTPublic
	transient bool
	auth      []byte
	closed    bool
	mu        sync.Mutex // serializes every TPM call on this handle, including Close
}

// Open loads the MSK from keyPath under the given PIN. pin is zeroed on return.
func Open(keyPath string, pin []byte) (*Handle, error) {
	defer func() { UnlockMemory(pin); zero(pin) }()
	if err := LockMemory(pin); err != nil {
		return nil, err
	}
	if keyPath == "" {
		var err error
		if keyPath, err = DefaultKeyPath(); err != nil {
			return nil, err
		}
	}
	kf, pub, priv, err := loadKeyFile(keyPath)
	if err != nil {
		return nil, err
	}
	auth := authValue(pin)
	if err := LockMemory(auth); err != nil {
		zero(auth)
		return nil, err
	}
	cleanupAuth := func() { UnlockMemory(auth); zero(auth) }

	t, err := openTPM()
	if err != nil {
		cleanupAuth()
		return nil, err
	}
	p, _, transient, err := parentFor(t, kf.Parent)
	if err != nil {
		cleanupAuth()
		_ = t.Close()
		return nil, err
	}
	r, err := (tpm2.ReadPublic{ObjectHandle: p.Handle}).Execute(t)
	if err != nil {
		if transient {
			_, _ = (tpm2.FlushContext{FlushHandle: p.Handle}).Execute(t)
		}
		cleanupAuth()
		_ = t.Close()
		return nil, fmt.Errorf("TPM2_ReadPublic failed: %w", err)
	}
	srkPub, err := r.OutPublic.Contents()
	if err != nil {
		if transient {
			_, _ = (tpm2.FlushContext{FlushHandle: p.Handle}).Execute(t)
		}
		cleanupAuth()
		_ = t.Close()
		return nil, err
	}
	l, err := (tpm2.Load{ParentHandle: p, InPrivate: priv, InPublic: pub}).Execute(t)
	if err != nil {
		if transient {
			_, _ = (tpm2.FlushContext{FlushHandle: p.Handle}).Execute(t)
		}
		cleanupAuth()
		_ = t.Close()
		return nil, fmt.Errorf("TPM2_Load failed: %w", err)
	}
	return &Handle{tpm: t, key: l.ObjectHandle, name: l.Name, srk: p.Handle, srkPub: *srkPub, transient: transient, auth: auth}, nil
}

// HMAC returns HMAC-SHA256(msg) using the loaded MSK. Key and auth bytes are never returned or logged.
// h.mu is held for the whole TPM call. Every caller (audit signing, service KEK unwrap) shares this lock.
func (h *Handle) HMAC(msg []byte) ([]byte, error) {
	if h == nil {
		return nil, errors.New("TPM handle is closed")
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return nil, errors.New("TPM handle is closed")
	}
	r, err := (tpm2.Hmac{
		Handle:  tpm2.AuthHandle{Handle: h.key, Name: h.name, Auth: tpm2.HMAC(tpm2.TPMAlgSHA256, 16, tpm2.Auth(h.auth), tpm2.Salted(tpm2.TPMIDHObject(h.srk), h.srkPub), tpm2.AESEncryption(128, tpm2.EncryptInOut))},
		Buffer:  tpm2.TPM2BMaxBuffer{Buffer: msg},
		HashAlg: tpm2.TPMAlgSHA256,
	}).Execute(h.tpm)
	if err != nil {
		return nil, h.mapAuthErr(err)
	}
	out := append([]byte(nil), r.OutHMAC.Buffer...)
	zero(r.OutHMAC.Buffer)
	return out, nil
}

// KeyID returns a stable identifier for the TPM-bound MSK.
func (h *Handle) KeyID() (string, error) {
	sum, err := h.HMAC([]byte("tpm-msk/key-id/v1"))
	if err != nil {
		return "", err
	}
	defer zero(sum)
	return hex.EncodeToString(sum[:16]), nil
}

// mapAuthErr matches go-tpm TPMRC values with errors.Is (TPMRC.Is handles FMT1 session-indexed codes).
func (h *Handle) mapAuthErr(err error) error {
	switch {
	case errors.Is(err, tpm2.TPMRCAuthFail), errors.Is(err, tpm2.TPMRCBadAuth):
		c, m, _, qerr := lockoutProps(h.tpm)
		if qerr != nil {
			return ErrWrongPIN
		}
		return fmt.Errorf("wrong PIN; failures count toward lockout: %d of %d", c, m)
	case errors.Is(err, tpm2.TPMRCLockout):
		_, _, iv, qerr := lockoutProps(h.tpm)
		if qerr != nil {
			return errors.New("TPM is in dictionary-attack lockout")
		}
		return fmt.Errorf("TPM is in dictionary-attack lockout; each failure decays after %d s", iv)
	}
	return fmt.Errorf("TPM2_HMAC failed: %w", err)
}

// Close flushes the loaded key, closes the TPM transport, and zeroes auth. Idempotent.
func (h *Handle) Close() error {
	if h == nil {
		return nil
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return nil
	}
	h.closed = true
	UnlockMemory(h.auth)
	zero(h.auth)
	_, flushErr := (tpm2.FlushContext{FlushHandle: h.key}).Execute(h.tpm)
	if h.transient {
		_, _ = (tpm2.FlushContext{FlushHandle: h.srk}).Execute(h.tpm)
	}
	closeErr := h.tpm.Close()
	if flushErr != nil {
		return fmt.Errorf("TPM2_FlushContext failed: %w", flushErr)
	}
	return closeErr
}

// property reads one TPM_PT value via TPM2_GetCapability(TPM_CAP_TPM_PROPERTIES).
func property(t transport.TPM, p tpm2.TPMPT) (uint32, error) {
	r, err := (tpm2.GetCapability{Capability: tpm2.TPMCapTPMProperties, Property: uint32(p), PropertyCount: 1}).Execute(t)
	if err != nil {
		return 0, err
	}
	props, err := r.CapabilityData.Data.TPMProperties()
	if err != nil || len(props.TPMProperty) == 0 || props.TPMProperty[0].Property != p {
		return 0, errors.New("TPM property unavailable")
	}
	return props.TPMProperty[0].Value, nil
}

func lockoutProps(t transport.TPM) (counter, maxFail, interval uint32, err error) {
	if counter, err = property(t, tpm2.TPMPTLockoutCounter); err != nil {
		return
	}
	if maxFail, err = property(t, tpm2.TPMPTMaxAuthFail); err != nil {
		return
	}
	interval, err = property(t, tpm2.TPMPTLockoutInterval)
	return
}

// fourCC decodes a TPM vendor/family word as big-endian ASCII, trimming NUL padding.
func fourCC(v uint32) string {
	var b [4]byte
	binary.BigEndian.PutUint32(b[:], v)
	return strings.TrimRight(string(b[:]), "\x00")
}

// KeyFileExists reports whether the key file exists. Contents are never read or printed.
func KeyFileExists(path string) bool {
	if path == "" {
		var err error
		if path, err = DefaultKeyPath(); err != nil {
			return false
		}
	}
	_, err := os.Stat(path)
	return err == nil
}

// DefaultKeyPath returns %APPDATA%\tpm-msk\msk.key, falling back to os.UserConfigDir.
func DefaultKeyPath() (string, error) {
	base := os.Getenv("APPDATA")
	if base == "" {
		var err error
		if base, err = os.UserConfigDir(); err != nil {
			return "", err
		}
	}
	return filepath.Join(base, "tpm-msk", "msk.key"), nil
}

var (
	selfTestCmd      = []byte{0x80, 0x01, 0x00, 0x00, 0x00, 0x0B, 0x00, 0x00, 0x01, 0x43, 0x00} // TPM2_SelfTest(fullTest=NO)
	getTestResultCmd = []byte{0x80, 0x01, 0x00, 0x00, 0x00, 0x0A, 0x00, 0x00, 0x01, 0x7C}       // TPM2_GetTestResult
	errTBSBlocked    = errors.New("blocked by Windows TBS for this user; rerun elevated to include it")
)

// rawCmd sends a prebuilt command and returns the response body after the 10-byte header.
// A nonzero response code is an error reported in hex.
func rawCmd(t transport.TPM, cmd []byte) ([]byte, error) {
	resp, err := t.Send(cmd)
	if err != nil {
		return nil, err
	}
	if len(resp) < 10 {
		return nil, fmt.Errorf("short response: %d bytes", len(resp))
	}
	if rc := binary.BigEndian.Uint32(resp[6:10]); rc != 0 {
		if rc == 0x80280400 {
			return nil, errTBSBlocked
		}
		return nil, fmt.Errorf("TPM rc 0x%08x", rc)
	}
	if sz := binary.BigEndian.Uint32(resp[2:6]); int(sz) != len(resp) {
		return nil, fmt.Errorf("response size field %d != %d bytes", sz, len(resp))
	}
	return resp[10:], nil
}

// Selftest prints PASS/FAIL lines. Read-only: no PIN, no CreatePrimary.
func Selftest(w io.Writer) error {
	t, err := openTPM()
	if err != nil {
		return err
	}
	defer t.Close()

	failed := false
	// TBS command-block policy is not a TPM health failure.
	check := func(name string, e error) {
		if errors.Is(e, errTBSBlocked) {
			fmt.Fprintf(w, "SKIP: %s: blocked by Windows TBS for non-admin; rerun in an elevated PowerShell to include it\n", name)
			return
		}
		if e != nil {
			fmt.Fprintf(w, "FAIL: %s: %v\n", name, e)
			failed = true
			return
		}
		fmt.Fprintf(w, "PASS: %s\n", name)
	}

	check("GetRandom(32)", func() error {
		r, e := (tpm2.GetRandom{BytesRequested: 32}).Execute(t)
		if e != nil {
			return e
		}
		if len(r.RandomBytes.Buffer) != 32 {
			zero(r.RandomBytes.Buffer)
			return fmt.Errorf("expected 32 random bytes, got %d", len(r.RandomBytes.Buffer))
		}
		nonzero := false
		for _, b := range r.RandomBytes.Buffer {
			if b != 0 {
				nonzero = true
				break
			}
		}
		zero(r.RandomBytes.Buffer)
		if !nonzero {
			return errors.New("output is all zero")
		}
		return nil
	}())

	check("algorithms HMAC/SHA256/KeyedHash/AES", func() error {
		for _, want := range []tpm2.TPMAlgID{tpm2.TPMAlgHMAC, tpm2.TPMAlgSHA256, tpm2.TPMAlgKeyedHash, tpm2.TPMAlgAES} {
			r, e := (tpm2.GetCapability{Capability: tpm2.TPMCapAlgs, Property: uint32(want), PropertyCount: 1}).Execute(t)
			if e != nil {
				return e
			}
			algs, e := r.CapabilityData.Data.Algorithms()
			if e != nil {
				return e
			}
			if len(algs.AlgProperties) == 0 || algs.AlgProperties[0].Alg != want {
				return fmt.Errorf("required algorithm 0x%04x missing", uint16(want))
			}
		}
		return nil
	}())

	check("PCR banks", func() error {
		r, e := (tpm2.GetCapability{Capability: tpm2.TPMCapPCRs, PropertyCount: 32}).Execute(t)
		if e != nil {
			return e
		}
		pcrs, e := r.CapabilityData.Data.AssignedPCR()
		if e != nil {
			return e
		}
		if len(pcrs.PCRSelections) == 0 {
			return errors.New("no PCR banks reported")
		}
		names := map[tpm2.TPMAlgID]string{tpm2.TPMAlgSHA1: "SHA1", tpm2.TPMAlgSHA256: "SHA256", tpm2.TPMAlgSHA384: "SHA384", tpm2.TPMAlgSHA512: "SHA512", tpm2.TPMAlgSM3256: "SM3_256", 0x0027: "SHA3_256", 0x0028: "SHA3_384", 0x0029: "SHA3_512"}
		var banks []string
		for _, bank := range pcrs.PCRSelections {
			if n, ok := names[bank.Hash]; ok {
				banks = append(banks, n)
			} else {
				banks = append(banks, fmt.Sprintf("0x%04x", uint16(bank.Hash)))
			}
		}
		fmt.Fprintf(w, "INFO: PCR banks: %s\n", strings.Join(banks, ", "))
		return nil
	}())

	check("TPM2_SelfTest", func() error {
		_, e := rawCmd(t, selfTestCmd)
		return e
	}())

	check("TPM2_GetTestResult", func() error {
		body, e := rawCmd(t, getTestResultCmd)
		if e != nil {
			return e
		}
		if len(body) < 2 {
			return errors.New("short GetTestResult body")
		}
		n := int(binary.BigEndian.Uint16(body[:2]))
		if len(body) < 2+n+4 {
			return errors.New("truncated GetTestResult body")
		}
		if res := binary.BigEndian.Uint32(body[2+n : 2+n+4]); res != 0 {
			return fmt.Errorf("testResult 0x%08x", res)
		}
		return nil
	}())

	if _, e := (tpm2.ReadPublic{ObjectHandle: persistentSRK}).Execute(t); e != nil {
		fmt.Fprintln(w, "INFO: SRK 0x81000001 absent; init will use CreatePrimary fallback")
	} else {
		fmt.Fprintln(w, "PASS: persistent SRK 0x81000001 present")
	}

	if failed {
		return errors.New("TPM selftest failed")
	}
	return nil
}

// Info prints read-only TPM properties.
func Info(w io.Writer) error {
	t, err := openTPM()
	if err != nil {
		return err
	}
	defer t.Close()

	props := []struct {
		name string
		id   tpm2.TPMPT
	}{
		{"manufacturer", tpm2.TPMPTManufacturer},
		{"vendor1", tpm2.TPMPTVendorString1},
		{"vendor2", tpm2.TPMPTVendorString2},
		{"vendor3", tpm2.TPMPTVendorString3},
		{"vendor4", tpm2.TPMPTVendorString4},
		{"firmware1", tpm2.TPMPTFirmwareVersion1},
		{"firmware2", tpm2.TPMPTFirmwareVersion2},
		{"family", tpm2.TPMPTFamilyIndicator},
		{"level", tpm2.TPMPTLevel},
		{"revision", tpm2.TPMPTRevision},
		{"lockoutCounter", tpm2.TPMPTLockoutCounter},
		{"maxAuthFail", tpm2.TPMPTMaxAuthFail},
		{"lockoutInterval", tpm2.TPMPTLockoutInterval},
		{"lockoutRecovery", tpm2.TPMPTLockoutRecovery},
		{"permanent", tpm2.TPMPTPermanent},
	}
	for _, p := range props {
		v, e := property(t, p.id)
		if e != nil {
			fmt.Fprintf(w, "%s: unavailable\n", p.name)
			continue
		}
		switch p.name {
		case "manufacturer", "vendor1", "vendor2", "vendor3", "vendor4", "family":
			fmt.Fprintf(w, "%s: %s\n", p.name, fourCC(v))
		case "firmware1", "firmware2":
			fmt.Fprintf(w, "%s: 0x%08x (%d.%d)\n", p.name, v, v>>16, v&0xffff)
		case "revision":
			fmt.Fprintf(w, "%s: %d.%d\n", p.name, v/100, v%100)
		case "permanent":
			fmt.Fprintf(w, "%s: inLockout=%t\n", p.name, v&0x200 != 0)
		default:
			fmt.Fprintf(w, "%s: %d\n", p.name, v)
		}
	}

	return nil
}
