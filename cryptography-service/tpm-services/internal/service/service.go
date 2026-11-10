// Package service exposes the KEK wrap endpoint over mTLS.
package service

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"sync"
	"time"

	"tpm-msk/internal/audit"
	"tpm-msk/internal/delivery"
	"tpm-msk/internal/envelope"
	"tpm-msk/internal/kek"
	"tpm-msk/internal/tpm"
)

const (
	routePath   = "/v1/kek/wrapped"
	serviceName = "tpm-service"
	peerCN      = "crypto-service"
	nonceLen    = 32
	maxBody     = 4096
)

var requestIDPattern = regexp.MustCompile(`^[A-Za-z0-9-]{8,64}$`)

const (
	bodyNotFound         = `{"error":"not_found"}`
	bodyMethodNotAllowed = `{"error":"method_not_allowed"}`
	bodyUnauthorized     = `{"error":"unauthorized"}`
	bodyBadRequest       = `{"error":"bad_request"}`
	bodyRateLimited      = `{"error":"rate_limited"}`
	bodyUnavailable      = `{"error":"unavailable"}`
)

// Config is the handler configuration. ActivePub must be safe for concurrent use.
type Config struct {
	KEKPath   string
	AllowKEK  map[string]bool
	Rate      float64 // tokens/sec
	Burst     int
	Audit     interface{ Append(audit.Record) error }
	HMAC      envelope.HMACer // TPM handle serializes HMAC calls internally.
	ActivePub func() *rsa.PublicKey
	Out       io.Writer // stdout lines for KEK delivery; nil discards.
}

type handler struct {
	cfg      Config
	bucketMu sync.Mutex
	tokens   float64
	last     time.Time
}

// NewHandler serves POST /v1/kek/wrapped.
func NewHandler(cfg Config) http.Handler {
	if cfg.Out == nil {
		cfg.Out = io.Discard
	}
	return &handler{cfg: cfg, tokens: float64(cfg.Burst), last: time.Now()}
}

// logKEK writes one KEK delivery line. Callers must pass only kid, version, identity, request ID and reason.
func (h *handler) logKEK(format string, args ...any) {
	_, _ = fmt.Fprintf(h.cfg.Out, format, args...)
}

// TLSConfig requires TLS 1.3 and a client certificate signed by caPool.
func TLSConfig(serverCert tls.Certificate, caPool *x509.CertPool) *tls.Config {
	return &tls.Config{
		MinVersion:   tls.VersionTLS13,
		ClientAuth:   tls.RequireAndVerifyClientCert,
		ClientCAs:    caPool,
		Certificates: []tls.Certificate{serverCert},
	}
}

func (h *handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	rid := requestID(r.Header.Get("X-Request-ID"))
	w.Header().Set("X-Request-ID", rid)
	switch {
	case r.URL.Path != routePath:
		writeJSON(w, http.StatusNotFound, bodyNotFound)
	case r.Method != http.MethodPost:
		w.Header().Set("Allow", http.MethodPost)
		writeJSON(w, http.StatusMethodNotAllowed, bodyMethodNotAllowed)
	default:
		h.wrap(w, r, rid)
	}
}

func (h *handler) wrap(w http.ResponseWriter, r *http.Request, rid string) {
	identity := "-"
	if r.TLS != nil && len(r.TLS.PeerCertificates) > 0 {
		if cn := r.TLS.PeerCertificates[0].Subject.CommonName; cn != "" {
			identity = cn
		}
	}
	var kid string
	var ver int
	// Audit errors on denial paths are ignored: the request is already denied.
	rec := func(action, result string) error {
		return h.cfg.Audit.Append(audit.Record{
			Time: time.Now().UTC().Format(time.RFC3339Nano), RequestID: rid, Service: serviceName,
			Identity: identity, KeyID: kid, KeyVersion: ver, Action: action, Result: result,
		})
	}

	if identity != peerCN {
		h.logKEK("[kek] failed denied:identity id=%s req=%s\n", identity, rid)
		rec("authz.fail", "denied:identity")
		writeJSON(w, http.StatusForbidden, bodyUnauthorized)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxBody)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	var req struct {
		KEKID   string `json:"kek_id"`
		Version int    `json:"version"`
		Nonce   []byte `json:"nonce"`
	}
	if err := dec.Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, bodyBadRequest)
		return
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		writeJSON(w, http.StatusBadRequest, bodyBadRequest)
		return
	}
	if req.KEKID == "" || req.Version < 1 || len(req.Nonce) != nonceLen {
		writeJSON(w, http.StatusBadRequest, bodyBadRequest)
		return
	}
	kid, ver = req.KEKID, req.Version

	if !h.cfg.AllowKEK[kid] {
		h.logKEK("[kek] failed denied:kek_not_allowed id=%s req=%s\n", identity, rid)
		rec("authz.fail", "denied:kek_not_allowed")
		writeJSON(w, http.StatusForbidden, bodyUnauthorized)
		return
	}

	if !h.take(time.Now()) {
		h.logKEK("[kek] failed denied:rate_limit id=%s req=%s\n", identity, rid)
		rec("kek.request", "denied:rate_limit")
		writeJSON(w, http.StatusTooManyRequests, bodyRateLimited)
		return
	}

	pub := h.cfg.ActivePub()
	if pub == nil {
		h.logKEK("[kek] failed denied:no_active_key id=%s req=%s\n", identity, rid)
		rec("authz.fail", "denied:no_active_key")
		writeJSON(w, http.StatusForbidden, bodyUnauthorized)
		return
	}

	f, err := kek.Load(h.cfg.KEKPath)
	var env []byte
	found := false
	if err == nil {
		env, found = kek.Lookup(f, kid, ver)
	}
	if !found {
		h.logKEK("[kek] failed denied:kek_not_found id=%s req=%s\n", identity, rid)
		rec("authz.fail", "denied:kek_not_found")
		writeJSON(w, http.StatusForbidden, bodyUnauthorized)
		return
	}

	// Handle.HMAC serializes TPM calls internally; no handler-level lock needed.
	kekPlain, label, err := envelope.Unwrap(h.cfg.HMAC, env)
	locked := false
	// Zero before unlock: LIFO order with a single defer guarantees clear runs first.
	defer func() {
		clear(kekPlain)
		if locked {
			tpm.UnlockMemory(kekPlain)
		}
	}()
	if err != nil {
		h.logKEK("[kek] failed error:tpm_unwrap id=%s req=%s\n", identity, rid)
		rec("kek.request", "error:tpm_unwrap")
		writeJSON(w, http.StatusServiceUnavailable, bodyUnavailable)
		return
	}
	// Fail closed: a KEK that cannot be pinned is not used.
	if err := tpm.LockMemory(kekPlain); err != nil {
		h.logKEK("[kek] failed error:memlock id=%s req=%s\n", identity, rid)
		rec("kek.request", "error:memlock")
		writeJSON(w, http.StatusServiceUnavailable, bodyUnavailable)
		return
	}
	locked = true
	if label != "kek/"+kid+"/"+strconv.Itoa(ver) {
		h.logKEK("[kek] failed denied:label_mismatch id=%s req=%s\n", identity, rid)
		rec("authz.fail", "denied:label_mismatch")
		writeJSON(w, http.StatusForbidden, bodyUnauthorized)
		return
	}

	wrapped, err := delivery.Wrap(pub, kekPlain, kid, ver, req.Nonce)
	if err != nil {
		h.logKEK("[kek] failed error:delivery id=%s req=%s\n", identity, rid)
		rec("kek.request", "error:delivery")
		writeJSON(w, http.StatusServiceUnavailable, bodyUnavailable)
		return
	}
	// Fail closed: if the success record cannot be written, do not deliver the KEK.
	// The request was authorized but could not be audited; 503 signals retryable
	// server-side unavailability, and no KEK material is sent.
	if err := rec("kek.request", "ok"); err != nil {
		h.logKEK("[kek] failed error:audit id=%s req=%s\n", identity, rid)
		writeJSON(w, http.StatusServiceUnavailable, bodyUnavailable)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(struct {
		KEKID      string `json:"kek_id"`
		Version    int    `json:"version"`
		WrappedKEK string `json:"wrapped_kek"`
	}{kid, ver, base64.StdEncoding.EncodeToString(wrapped)}); err != nil {
		h.logKEK("[kek] failed error:write id=%s req=%s\n", identity, rid)
		return
	}
	h.logKEK("[kek] delivered %s v%d id=%s req=%s\n", kid, ver, identity, rid)
}

// take is a token bucket: refill at cfg.Rate per second up to cfg.Burst.
func (h *handler) take(now time.Time) bool {
	h.bucketMu.Lock()
	defer h.bucketMu.Unlock()
	h.tokens = min(float64(h.cfg.Burst), h.tokens+now.Sub(h.last).Seconds()*h.cfg.Rate)
	h.last = now
	if h.tokens < 1 {
		return false
	}
	h.tokens--
	return true
}

// requestID keeps a well-formed client ID, otherwise generates 16 random bytes as hex.
// crypto/rand.Read does not return errors on supported platforms (Go 1.24+).
func requestID(in string) string {
	if requestIDPattern.MatchString(in) {
		return in
	}
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func writeJSON(w http.ResponseWriter, code int, body string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_, _ = io.WriteString(w, body)
}
