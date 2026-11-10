package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Audit mode tpm: hash chain SHA-256, satu record per request API. Tidak mencatat plaintext, ciphertext, atau kunci.

type auditLog struct {
	mu     sync.Mutex
	prev   string
	out    io.Writer
	file   *os.File
	failed bool
}

type auditRecord struct {
	Time       string `json:"time"`
	RequestID  string `json:"request_id"`
	Service    string `json:"service"`
	Identity   string `json:"identity"`
	KeyID      string `json:"key_id"`
	KeyVersion int    `json:"key_version"`
	Action     string `json:"action"`
	Result     string `json:"result"`
	PrevHash   string `json:"prev_hash"`
	Hash       string `json:"hash"`
}

// reqState: status per request, diisi authz dan dibaca auditHandler.
type reqState struct {
	identity string
	keyID    string // DEK id pertama yang dipakai request ini, untuk audit key_id
	denied   bool
}

type reqStateKey struct{}

// noteKeyID: catat DEK id pertama per request. Di luar request (test langsung ke keyd) tidak ada state, diabaikan.
func noteKeyID(ctx context.Context, id string) {
	if st, ok := ctx.Value(reqStateKey{}).(*reqState); ok && st.keyID == "" {
		st.keyID = id
	}
}

var auditSanitize = strings.NewReplacer("|", "_", "\n", "_", "\r", "_")

var opActions = map[string]string{
	"/encrypt":      "op.encrypt",
	"/decrypt":      "op.decrypt",
	"/seal":         "op.seal",
	"/unseal":       "op.unseal",
	"/hmac":         "op.hmac",
	"/verifyhmac":   "op.verifyhmac",
	"/tokenize":     "op.tokenize",
	"/detokenize":   "op.detokenize",
	"/sealfile":     "op.sealfile",
	"/unsealfile":   "op.unsealfile",
	"/genrand":      "op.genrand",
	"/totpgenerate": "op.totpgenerate",
	"/totpvalidate": "op.totpvalidate",
}

func newAuditLog(path string) (*auditLog, error) {
	a := &auditLog{prev: strings.Repeat("0", 64), out: os.Stdout}
	if path == "" {
		return a, nil
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR|os.O_APPEND, 0600)
	if err != nil {
		return nil, errors.New("gagal membuka AUDIT_FILE")
	}
	last, err := lastAuditLine(f)
	if err != nil {
		f.Close()
		return nil, err
	}
	if last != "" {
		var rec struct {
			Hash string `json:"hash"`
		}
		if json.Unmarshal([]byte(last), &rec) != nil || rec.Hash == "" {
			f.Close()
			return nil, errors.New("AUDIT_FILE berisi baris tidak valid")
		}
		a.prev = rec.Hash
	}
	a.file = f
	return a, nil
}

// ponytail: baca seluruh file untuk baris terakhir (buffer 1 MiB per baris). Upgrade: seek dari akhir file.
func lastAuditLine(f *os.File) (string, error) {
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return "", errors.New("gagal membaca AUDIT_FILE")
	}
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64<<10), 1<<20)
	last := ""
	for sc.Scan() {
		if t := strings.TrimSpace(sc.Text()); t != "" {
			last = t
		}
	}
	if sc.Err() != nil {
		return "", errors.New("gagal membaca AUDIT_FILE")
	}
	return last, nil
}

// auditHash: SHA-256 hex dari prev|time|reqID|service|identity|keyID|keyVersion|action|result, nilai disanitasi.
func auditHash(prev, t, reqID, service, identity, keyID string, keyVersion int, action, result string) string {
	in := strings.Join([]string{
		prev,
		auditSanitize.Replace(t),
		auditSanitize.Replace(reqID),
		auditSanitize.Replace(service),
		auditSanitize.Replace(identity),
		auditSanitize.Replace(keyID),
		strconv.Itoa(keyVersion),
		auditSanitize.Replace(action),
		auditSanitize.Replace(result),
	}, "|")
	sum := sha256.Sum256([]byte(in))
	return hex.EncodeToString(sum[:])
}

// write: error jika record tidak tertulis. Gagal -> failed=true; auditHandler menjawab 503 sampai tulis berikutnya berhasil.
func (a *auditLog) write(rec auditRecord) error {
	if a == nil {
		return nil
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	rec.Time = auditSanitize.Replace(rec.Time)
	rec.RequestID = auditSanitize.Replace(rec.RequestID)
	rec.Service = auditSanitize.Replace(rec.Service)
	rec.Identity = auditSanitize.Replace(rec.Identity)
	rec.KeyID = auditSanitize.Replace(rec.KeyID)
	rec.Action = auditSanitize.Replace(rec.Action)
	rec.Result = auditSanitize.Replace(rec.Result)
	rec.PrevHash = a.prev
	rec.Hash = auditHash(rec.PrevHash, rec.Time, rec.RequestID, rec.Service, rec.Identity, rec.KeyID, rec.KeyVersion, rec.Action, rec.Result)
	line, err := json.Marshal(rec)
	if err == nil {
		err = a.emit(append(line, '\n'))
	}
	if err != nil {
		// Gagal tulis: prev tidak maju, record berikutnya rantai ke record terakhir yang tertulis.
		if !a.failed {
			log.Printf("audit: tulis gagal: %v", err)
		}
		a.failed = true
		return err
	}
	a.failed = false
	a.prev = rec.Hash
	return nil
}

// emit: tulis ke stdout dan file (jika ada). Error pertama dikembalikan.
func (a *auditLog) emit(line []byte) error {
	var err error
	if a.out != nil {
		if n, e := a.out.Write(line); e != nil {
			err = e
		} else if n != len(line) {
			err = io.ErrShortWrite
		}
	}
	if a.file != nil {
		if n, e := a.file.Write(line); e != nil && err == nil {
			err = e
		} else if e == nil && n != len(line) && err == nil {
			err = io.ErrShortWrite
		}
	}
	return err
}

// log: dipakai authzHandler untuk penolakan. Gagal tulis disimpan di failed dan dibaca request berikutnya.
func (a *auditLog) log(requestID, identity, keyID, action, result string) {
	_ = a.write(auditRecord{
		Time:      time.Now().UTC().Format(time.RFC3339Nano),
		RequestID: requestID,
		Service:   "crypto-api",
		Identity:  identity,
		KeyID:     keyID,
		Action:    action,
		Result:    result,
	})
}

// bufRec: tahan respons sampai record audit tertulis.
type bufRec struct {
	h    http.Header
	code int
	body bytes.Buffer
}

func (b *bufRec) Header() http.Header { return b.h }

func (b *bufRec) WriteHeader(c int) {
	if b.code == 0 {
		b.code = c
	}
}

func (b *bufRec) Write(p []byte) (int, error) {
	if b.code == 0 {
		b.code = http.StatusOK
	}
	return b.body.Write(p)
}

func resultFor(code int) string {
	switch {
	case code >= 200 && code < 300:
		return "ok"
	case code == http.StatusBadRequest:
		return "error:bad_request"
	case code == http.StatusNotImplemented:
		return "error:crypto"
	case code == http.StatusServiceUnavailable:
		return "error:unavailable"
	}
	return "error:internal"
}

// auditHandler: di luar authz. Catat op.* per request API; request yang ditolak authz sudah dicatat authz.
// Fail-closed: record ditulis sebelum respons dikirim. Gagal tulis -> 503 audit unavailable, hasil op tidak dikirim.
func auditHandler(a *auditLog, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		st := &reqState{}
		buf := &bufRec{h: http.Header{}}
		ctx := context.WithValue(r.Context(), reqStateKey{}, st)
		next.ServeHTTP(buf, r.WithContext(ctx))
		if buf.code == 0 {
			buf.code = http.StatusOK
		}
		action, ok := opActions[r.URL.Path]
		if st.denied || !ok || buf.code == http.StatusNotFound || buf.code == http.StatusMethodNotAllowed {
			flush(w, buf)
			return
		}
		err := a.write(auditRecord{
			Time:      time.Now().UTC().Format(time.RFC3339Nano),
			RequestID: reqIDFrom(ctx),
			Service:   "crypto-api",
			Identity:  st.identity,
			KeyID:     st.keyID,
			Action:    action,
			Result:    resultFor(buf.code),
		})
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]fault{"fault": {503, "audit unavailable"}})
			return
		}
		flush(w, buf)
	})
}

func flush(w http.ResponseWriter, buf *bufRec) {
	for k, v := range buf.h {
		w.Header()[k] = v
	}
	w.WriteHeader(buf.code)
	_, _ = w.Write(buf.body.Bytes())
}
