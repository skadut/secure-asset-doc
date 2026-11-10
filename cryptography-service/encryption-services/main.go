// Demo tiruan Sandidata v2.3 REST API (tanpa mTLS) untuk bimtek SIMPELDATIN.
// Bentuk request/response mengikuti sandidata_v2.3.html.
package main

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"crypto/x509"
	"encoding/base32"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	outLabel     = "skadut-"
	maxBody      = 20 << 20
	maxFile      = 10 << 20
	maxRand      = 1024
	addrDflt     = ":2796"
	internalDflt = ":2797"
)

// totpIssuer is the Sandidata issuer label shown in authenticator apps.
const totpIssuer = "Skadut"

// ponytail: in-memory replay cache, lost on restart and not shared across replicas; move to keyd/DB if scaled.
var (
	totpMu   sync.Mutex
	totpSeen = map[totpReplayKey]time.Time{}
)

type totpReplayKey struct {
	hash [32]byte
	step int64
}

type config struct {
	KeydSocket, TLSCert, TLSKey, TLSClientCA, AuditFile string
	AppIDs                                              []string
}

func wipe(b []byte) {
	if len(b) > 0 {
		clear(b)
		unlockMem(b)
	}
}

var (
	errZone      = errors.New("key zone unavailable")
	errBadCipher = errors.New("ciphertext tidak valid")
)

// keyUnavailableMsg: pesan 503 saat key zone (keyd/TPM) tidak bisa menyediakan kunci.
const keyUnavailableMsg = "KEY_UNAVAILABLE: kunci enkripsi tidak dapat digunakan (DEK/KEK tidak tersedia dari key zone). Operasi enkripsi/dekripsi gagal. Cek koneksi ke keyd dan layanan TPM di DMZ."

func b64(b []byte) string            { return base64.StdEncoding.EncodeToString(b) }
func unb64(s string) ([]byte, error) { return base64.StdEncoding.DecodeString(s) }

type encItem struct {
	Versionkey string `json:"versionkey"`
	Text       string `json:"text"`
	Mac        string `json:"mac"`
	IV         string `json:"iv"`
}
type textItem struct {
	Text string `json:"text"`
}
type fault struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
func badReq(w http.ResponseWriter, msg string) {
	writeJSON(w, 400, map[string]fault{"fault": {1066, "INVALID_JSON_REQUEST: " + msg}})
}

// cryptoFail: error key zone (keyd) atau keyd menolak/gagal internal -> 503 KEY_UNAVAILABLE; error lain (input salah, kriptografi) -> 501.
func cryptoFail(w http.ResponseWriter, err error) {
	if errors.Is(err, errZone) || errors.Is(err, errKeydDeny) {
		writeJSON(w, 503, map[string]fault{"fault": {503, keyUnavailableMsg}})
		return
	}
	writeJSON(w, 501, map[string]fault{"fault": {501, err.Error()}})
}
func post[T any](fn func(http.ResponseWriter, *http.Request, T)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			writeJSON(w, 405, map[string]fault{"fault": {405, "hanya POST"}})
			return
		}
		var req T
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody)).Decode(&req); err != nil {
			badReq(w, err.Error())
			return
		}
		fn(w, r, req)
	}
}

var accessLogger = log.New(os.Stdout, "", 0)

func accessLog(c *gin.Context) {
	start := time.Now()
	ip, method, path := c.ClientIP(), c.Request.Method, c.Request.URL.Path
	defer func() {
		accessLogger.Printf("time=%s ip=%s method=%s path=%q status=%d dur=%s", start.UTC().Format(time.RFC3339Nano), ip, method, path, c.Writer.Status(), time.Since(start))
	}()
	c.Next()
}
func recovery(c *gin.Context) {
	defer func() {
		if recover() != nil {
			log.Printf("zeroize reason=panic count=0")
			c.AbortWithStatus(500)
		}
	}()
	c.Next()
}
func mask(text, format string, length int, position string) (string, error) {
	r := []rune(text)
	hide := make([]bool, len(r))
	switch strings.ToUpper(format) {
	case "LEFT", "RIGHT":
		if length < 0 || length > len(r) {
			return "", errors.New("Length di luar panjang teks")
		}
		for i := 0; i < length; i++ {
			if strings.EqualFold(format, "LEFT") {
				hide[i] = true
			} else {
				hide[len(r)-1-i] = true
			}
		}
	case "MID":
		a, b, ok := strings.Cut(position, ":")
		from, e1 := strconv.Atoi(a)
		to, e2 := strconv.Atoi(b)
		if !ok || e1 != nil || e2 != nil || from < 1 || to < from || to > len(r) {
			return "", errors.New("Position harus \"awal:akhir\" dalam panjang teks")
		}
		for i := from - 1; i < to; i++ {
			hide[i] = true
		}
	default:
		p := []rune(format)
		if len(p) != len(r) {
			return "", errors.New("panjang pola Format harus sama dengan panjang teks")
		}
		for i, c := range p {
			switch c {
			case '$':
				hide[i] = true
			case '%':
			default:
				return "", errors.New("pola Format hanya boleh berisi '$' dan '%'")
			}
		}
	}
	for i := range r {
		if hide[i] {
			r[i] = '*'
		}
	}
	return string(r), nil
}

func encrypt(ctx context.Context, pt string) (encItem, error) {
	plain := []byte(pt)
	defer wipe(plain)
	id, iv, ct, err := keydEncrypt(ctx, plain)
	if err != nil {
		return encItem{}, err
	}
	n := len(ct) - 16
	return encItem{"t1:" + id, b64(ct[:n]), b64(ct[n:]), b64(iv)}, nil
}
func decrypt(ctx context.Context, c encItem) (string, error) {
	c.Versionkey = strings.TrimPrefix(c.Versionkey, outLabel)
	if !strings.HasPrefix(c.Versionkey, "t1:") {
		return "", errBadCipher
	}
	id := strings.TrimPrefix(c.Versionkey, "t1:")
	if !keydDekRe.MatchString(id) {
		return "", errBadCipher
	}
	body, e1 := unb64(c.Text)
	tag, e2 := unb64(c.Mac)
	iv, e3 := unb64(c.IV)
	if errors.Join(e1, e2, e3) != nil || len(iv) != 12 || len(tag) != 16 {
		return "", errBadCipher
	}
	ct := append(append(make([]byte, 0, len(body)+16), body...), tag...)
	defer wipe(ct)
	pt, err := keydDecrypt(ctx, id, iv, ct)
	if err != nil {
		return "", err
	}
	s := string(pt)
	wipe(pt)
	return s, nil
}
func seal(ctx context.Context, pt string) (string, error) {
	plain := []byte(pt)
	defer wipe(plain)
	id, iv, ct, err := keydEncrypt(ctx, plain)
	if err != nil {
		return "", err
	}
	raw := append(append(make([]byte, 0, len(iv)+len(ct)), iv...), ct...)
	defer wipe(raw)
	return "t1:" + id + ":" + b64(raw), nil
}
func totpAt(secret []byte, step int64) string {
	var counter [8]byte
	binary.BigEndian.PutUint64(counter[:], uint64(step))
	mac := hmac.New(sha1.New, secret)
	_, _ = mac.Write(counter[:])
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 0x0f
	value := (uint32(sum[offset])&0x7f)<<24 | uint32(sum[offset+1])<<16 | uint32(sum[offset+2])<<8 | uint32(sum[offset+3])
	return fmt.Sprintf("%06d", value%1_000_000)
}

func validTOTPCode(code string) bool {
	if len(code) != 6 {
		return false
	}
	for i := range code {
		if code[i] < '0' || code[i] > '9' {
			return false
		}
	}
	return true
}

func totpMatch(secret []byte, code string, nowStep int64) (int64, bool) {
	if len(secret) != 20 || !validTOTPCode(code) {
		return 0, false
	}
	matched, found := int64(0), 0
	for _, step := range []int64{nowStep - 1, nowStep, nowStep + 1} {
		eq := subtle.ConstantTimeCompare([]byte(totpAt(secret, step)), []byte(code))
		if eq == 1 && found == 0 {
			matched = step
		}
		found |= eq
	}
	return matched, found == 1
}

// totpConsume: true jika (secret, step) belum dipakai dalam 90 detik terakhir. Entri kedaluwarsa dibuang.
func totpConsume(secret []byte, step int64, now time.Time) bool {
	totpMu.Lock()
	defer totpMu.Unlock()
	for k, exp := range totpSeen {
		if !now.Before(exp) {
			delete(totpSeen, k)
		}
	}
	key := totpReplayKey{sha256.Sum256(secret), step}
	if _, seen := totpSeen[key]; seen {
		return false
	}
	totpSeen[key] = now.Add(90 * time.Second)
	return true
}

func unseal(ctx context.Context, s string) (string, error) {
	p := strings.SplitN(s, ":", 3)
	if len(p) != 3 || p[0] != "t1" || !keydDekRe.MatchString(p[1]) {
		return "", errBadCipher
	}
	raw, e := unb64(p[2])
	if e != nil {
		return "", errBadCipher
	}
	defer wipe(raw)
	if len(raw) < 28 {
		return "", fmt.Errorf("%w: ciphertext terlalu pendek", errBadCipher)
	}
	pt, err := keydDecrypt(ctx, p[1], raw[:12], raw[12:])
	if err != nil {
		return "", err
	}
	out := string(pt)
	wipe(pt)
	return out, nil
}

func routes() (*gin.Engine, error) {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.RedirectTrailingSlash = false
	if err := r.SetTrustedProxies(nil); err != nil {
		return nil, err
	}
	r.Use(accessLog, trafficIn(recorder), recovery)
	r.Any("/genrand", gin.WrapF(post(func(w http.ResponseWriter, _ *http.Request, req struct{ CountByte int }) {
		if req.CountByte < 1 || req.CountByte > maxRand {
			badReq(w, fmt.Sprintf("CountByte harus 1..%d", maxRand))
			return
		}
		b := make([]byte, req.CountByte)
		if _, e := rand.Read(b); e != nil {
			cryptoFail(w, e)
			return
		}
		writeJSON(w, 200, map[string]string{"Random": hex.EncodeToString(b)})
	})))
	r.Any("/encrypt", gin.WrapF(post(func(w http.ResponseWriter, r *http.Request, req struct{ Plaintext []textItem }) {
		if len(req.Plaintext) == 0 {
			badReq(w, "Plaintext wajib berisi minimal satu item")
			return
		}
		out := make([]encItem, len(req.Plaintext))
		for i, p := range req.Plaintext {
			c, e := encrypt(r.Context(), p.Text)
			if e != nil {
				cryptoFail(w, e)
				return
			}
			c.Versionkey = outLabel + c.Versionkey
			out[i] = c
		}
		writeJSON(w, 200, map[string]any{"Ciphertext": out})
	})))
	r.Any("/decrypt", gin.WrapF(post(func(w http.ResponseWriter, r *http.Request, req struct{ Ciphertext []encItem }) {
		if len(req.Ciphertext) == 0 {
			badReq(w, "Ciphertext wajib berisi minimal satu item")
			return
		}
		out := make([]textItem, len(req.Ciphertext))
		for i, c := range req.Ciphertext {
			pt, e := decrypt(r.Context(), c)
			if e != nil {
				cryptoFail(w, fmt.Errorf("item %d: %w", i, e))
				return
			}
			out[i] = textItem{pt}
		}
		writeJSON(w, 200, map[string]any{"Plaintext": out})
	})))
	r.Any("/seal", gin.WrapF(post(func(w http.ResponseWriter, r *http.Request, req struct{ Plaintext []textItem }) {
		if len(req.Plaintext) == 0 {
			badReq(w, "Plaintext wajib berisi minimal satu item")
			return
		}
		out := make([]textItem, len(req.Plaintext))
		for i, p := range req.Plaintext {
			s, e := seal(r.Context(), p.Text)
			if e != nil {
				cryptoFail(w, e)
				return
			}
			out[i] = textItem{outLabel + s}
		}
		writeJSON(w, 200, map[string]any{"Ciphertext": out})
	})))
	r.Any("/unseal", gin.WrapF(post(func(w http.ResponseWriter, r *http.Request, req struct{ Ciphertext []textItem }) {
		if len(req.Ciphertext) == 0 {
			badReq(w, "Ciphertext wajib berisi minimal satu item")
			return
		}
		out := make([]textItem, len(req.Ciphertext))
		for i, c := range req.Ciphertext {
			pt, e := unseal(r.Context(), strings.TrimPrefix(c.Text, outLabel))
			if e != nil {
				cryptoFail(w, e)
				return
			}
			out[i] = textItem{pt}
		}
		writeJSON(w, 200, map[string]any{"Plaintext": out})
	})))
	r.Any("/sealfile", gin.WrapF(post(func(w http.ResponseWriter, r *http.Request, req struct{ Data string }) {
		raw, e := unb64(req.Data)
		defer wipe(raw)
		if e != nil || len(raw) == 0 || len(raw) > maxFile {
			badReq(w, "Data wajib base64 standar, 1 byte sampai 10 MiB")
			return
		}
		// ponytail: salinan string plaintext dari string(raw) tidak bisa di-wipe, sama seperti /seal.
		s, e := seal(r.Context(), string(raw))
		if e != nil {
			cryptoFail(w, e)
			return
		}
		writeJSON(w, 200, map[string]string{"Ciphertext": outLabel + s})
	})))
	r.Any("/unsealfile", gin.WrapF(post(func(w http.ResponseWriter, r *http.Request, req struct{ Ciphertext string }) {
		if req.Ciphertext == "" {
			badReq(w, "Ciphertext wajib diisi")
			return
		}
		pt, e := unseal(r.Context(), strings.TrimPrefix(req.Ciphertext, outLabel))
		if e != nil {
			cryptoFail(w, e)
			return
		}
		b := []byte(pt)
		defer wipe(b)
		// ponytail: string pt dari unseal tidak bisa di-wipe, sama seperti /unseal.
		writeJSON(w, 200, map[string]string{"Data": b64(b)})
	})))
	r.Any("/hmac", gin.WrapF(post(func(w http.ResponseWriter, r *http.Request, req struct{ Message *string }) {
		if req.Message == nil {
			badReq(w, "Message wajib diisi")
			return
		}
		id, tag, e := keydHMAC(r.Context(), []byte(*req.Message), "")
		if e != nil {
			cryptoFail(w, e)
			return
		}
		defer wipe(tag)
		writeJSON(w, 200, map[string]string{"Value": outLabel + "t1:" + id + ":" + b64(tag)})
	})))
	r.Any("/verifyhmac", gin.WrapF(post(func(w http.ResponseWriter, r *http.Request, req struct {
		Message    *string
		HMACstring string
	}) {
		if req.Message == nil || req.HMACstring == "" {
			badReq(w, "Message dan HMACstring wajib diisi")
			return
		}
		hs := strings.TrimPrefix(req.HMACstring, outLabel)
		p := strings.SplitN(hs, ":", 3)
		if len(p) != 3 || p[0] != "t1" || !keydDekRe.MatchString(p[1]) {
			writeJSON(w, 200, map[string]bool{"Value": false})
			return
		}
		expected, err := unb64(p[2])
		if err != nil {
			writeJSON(w, 200, map[string]bool{"Value": false})
			return
		}
		id, got, err := keydHMAC(r.Context(), []byte(*req.Message), p[1])
		if errors.Is(err, errZone) {
			cryptoFail(w, err)
			return
		}
		if err != nil {
			writeJSON(w, 200, map[string]bool{"Value": false})
			return
		}
		defer wipe(got)
		writeJSON(w, 200, map[string]bool{"Value": id == p[1] && hmac.Equal(got, expected)})
	})))
	type maskReq struct {
		Format   string
		Length   int
		Position string
		Text     string
	}
	r.Any("/tokenize", gin.WrapF(post(func(w http.ResponseWriter, r *http.Request, req struct{ Masking []maskReq }) {
		if len(req.Masking) == 0 {
			badReq(w, "Masking wajib berisi minimal satu item")
			return
		}
		out := make([]textItem, len(req.Masking))
		for i, m := range req.Masking {
			masked, e := mask(m.Text, m.Format, m.Length, m.Position)
			if e != nil {
				badReq(w, fmt.Sprintf("item %d: %v", i, e))
				return
			}
			s, e := seal(r.Context(), m.Text)
			if e != nil {
				cryptoFail(w, e)
				return
			}
			out[i] = textItem{masked + ":" + s}
		}
		writeJSON(w, 200, map[string]any{"Ciphertext": out})
	})))
	r.Any("/detokenize", gin.WrapF(post(func(w http.ResponseWriter, r *http.Request, req struct{ Masking []textItem }) {
		if len(req.Masking) == 0 {
			badReq(w, "Masking wajib berisi minimal satu item")
			return
		}
		out := make([]textItem, len(req.Masking))
		for i, m := range req.Masking {
			idx := strings.LastIndex(m.Text, ":t1:")
			if idx < 0 {
				badReq(w, fmt.Sprintf("item %d: format token tidak valid", i))
				return
			}
			pt, e := unseal(r.Context(), m.Text[idx+1:])
			if e != nil {
				cryptoFail(w, e)
				return
			}
			out[i] = textItem{pt}
		}
		writeJSON(w, 200, map[string]any{"Ciphertext": out})
	})))
	r.Any("/totpgenerate", gin.WrapF(post(func(w http.ResponseWriter, r *http.Request, req struct{ AccountName string }) {
		if req.AccountName == "" || len(req.AccountName) > 128 {
			badReq(w, "AccountName wajib diisi, maks 128 byte")
			return
		}
		secret := make([]byte, 20)
		defer wipe(secret)
		if _, e := rand.Read(secret); e != nil {
			cryptoFail(w, e)
			return
		}
		// ponytail: salinan string secret dari string(secret) tidak bisa di-wipe, sama seperti /seal.
		s, e := seal(r.Context(), string(secret))
		if e != nil {
			cryptoFail(w, e)
			return
		}
		label := url.PathEscape(totpIssuer) + ":" + url.PathEscape(req.AccountName)
		uri := "otpauth://totp/" + label + "?algorithm=SHA1&digits=6&issuer=" + url.QueryEscape(totpIssuer) + "&period=30&secret=" + base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(secret)
		writeJSON(w, 200, map[string]string{"SecretEncrypted": outLabel + s, "TOTP Key": uri})
	})))
	r.Any("/totpvalidate", gin.WrapF(post(func(w http.ResponseWriter, r *http.Request, req struct {
		SecretEncrypted string
		CodeOTP         string
	}) {
		if req.SecretEncrypted == "" || req.CodeOTP == "" {
			badReq(w, "SecretEncrypted dan CodeOTP wajib diisi")
			return
		}
		// Format kode dicek sebelum dekripsi: kode salah format tidak perlu menyentuh keyd.
		if !validTOTPCode(req.CodeOTP) {
			writeJSON(w, 200, map[string]bool{"valid": false})
			return
		}
		// ponytail: string s dari unseal tidak bisa di-wipe, sama seperti /unsealfile.
		s, e := unseal(r.Context(), strings.TrimPrefix(req.SecretEncrypted, outLabel))
		if e != nil {
			cryptoFail(w, e)
			return
		}
		secret := []byte(s)
		defer wipe(secret)
		now := time.Now()
		step, ok := totpMatch(secret, req.CodeOTP, now.Unix()/30)
		valid := ok && totpConsume(secret, step, now)
		writeJSON(w, 200, map[string]bool{"valid": valid})
	})))
	r.NoRoute(gin.WrapF(http.NotFound))
	return r, nil
}
func loadDotEnv(path string) {
	b, err := os.ReadFile(path)
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		k, v, ok := strings.Cut(line, "=")
		if !ok || strings.HasPrefix(line, "#") {
			continue
		}
		k, v = strings.TrimSpace(k), strings.Trim(strings.TrimSpace(v), `"'`)
		if _, set := os.LookupEnv(k); !set {
			_ = os.Setenv(k, v)
		}
	}
}
func loadConfig() (config, error) {
	var c config
	if os.Getenv("CRYPTO_MODE") != "tpm" {
		return c, errors.New("CRYPTO_MODE harus tpm")
	}
	c.KeydSocket = envOr("KEYD_SOCKET", "/run/keyd/keyd.sock")
	c.TLSCert = envOr("TLS_CERT_FILE", "/pki/crypto-api.pem")
	c.TLSKey = envOr("TLS_KEY_FILE", "/pki/crypto-api-key.pem")
	c.TLSClientCA = envOr("TLS_CLIENT_CA_FILE", "/pki/ca.pem")
	c.AuditFile = os.Getenv("AUDIT_FILE")
	for _, a := range strings.Split(os.Getenv("APP_IDENTITIES"), ",") {
		if a = strings.TrimSpace(a); a != "" {
			c.AppIDs = append(c.AppIDs, a)
		}
	}
	if len(c.AppIDs) == 0 {
		c.AppIDs = []string{"app"}
	}
	return c, nil
}

var reqIDRe = regexp.MustCompile(`^[A-Za-z0-9-]{8,64}$`)

// requestIDMW: pakai X-Request-ID dari klien jika valid, selain itu generate 16 byte acak.
func requestIDMW(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-ID")
		if !reqIDRe.MatchString(id) {
			b := make([]byte, 16)
			if _, err := rand.Read(b); err != nil {
				writeJSON(w, 503, map[string]fault{"fault": {503, "key zone unavailable"}})
				return
			}
			id = hex.EncodeToString(b)
		}
		w.Header().Set("X-Request-ID", id)
		next.ServeHTTP(w, r.WithContext(withReqID(r.Context(), id)))
	})
}

// identityFrom: CN client cert yang lolos authz; "" jika tidak ada.
func identityFrom(r *http.Request) string {
	if st, ok := r.Context().Value(reqStateKey{}).(*reqState); ok {
		return st.identity
	}
	return ""
}

// authzHandler: tolak CN di luar ids dengan 403 dan catat authz/denied. Lolos -> identitas disimpan untuk audit.
func authzHandler(ids []string, a *auditLog, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cn := ""
		if r.TLS != nil && len(r.TLS.PeerCertificates) > 0 {
			cn = r.TLS.PeerCertificates[0].Subject.CommonName
		}
		st, _ := r.Context().Value(reqStateKey{}).(*reqState)
		if st == nil {
			st = &reqState{}
		}
		st.identity = cn
		allowed := false
		if cn != "" {
			for _, id := range ids {
				if id == cn {
					allowed = true
					break
				}
			}
		}
		if !allowed {
			st.denied = true
			if err := a.write(auditRecord{Time: time.Now().UTC().Format(time.RFC3339Nano), RequestID: reqIDFrom(r.Context()), Service: "crypto-api", Identity: cn, Action: "authz", Result: "denied"}); err != nil {
				writeJSON(w, http.StatusServiceUnavailable, map[string]fault{"fault": {503, "audit unavailable"}})
				return
			}
			writeJSON(w, 403, map[string]fault{"fault": {403, "forbidden"}})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
func main() {
	loadDotEnv(".env")
	cfg, err := loadConfig()
	if err != nil {
		log.Fatal(err)
	}
	keyd = newKeydClient(cfg.KeydSocket)
	go dekCountdown(nil)
	_ = disableCoreDumps()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	addr := os.Getenv("CRYPT_ADDR")
	if addr == "" {
		addr = addrDflt
	}
	r, err := routes()
	if err != nil {
		log.Fatal(err)
	}
	cert, e := tls.LoadX509KeyPair(cfg.TLSCert, cfg.TLSKey)
	if e != nil {
		log.Fatal("gagal membaca sertifikat TLS")
	}
	caPEM, e := os.ReadFile(cfg.TLSClientCA)
	if e != nil {
		log.Fatal("gagal membaca CA klien TLS")
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(caPEM) {
		log.Fatal("sertifikat CA klien TLS tidak valid")
	}
	tlsCfg := &tls.Config{MinVersion: tls.VersionTLS13, ClientAuth: tls.RequireAndVerifyClientCert, ClientCAs: pool, Certificates: []tls.Certificate{cert}}
	audit, e := newAuditLog(cfg.AuditFile)
	if e != nil {
		log.Fatal(e)
	}
	handler := requestIDMW(auditHandler(audit, authzHandler(cfg.AppIDs, audit, r)))
	srv := &http.Server{Addr: addr, Handler: handler, TLSConfig: tlsCfg, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second}
	internalAddr := os.Getenv("CRYPTO_INTERNAL_ADDR")
	if internalAddr == "" {
		internalAddr = internalDflt
	}
	internal := &http.Server{Addr: internalAddr, Handler: internalRoutes(recorder), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second, IdleTimeout: 30 * time.Second}
	done := make(chan struct{})
	go func() {
		defer close(done)
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = internal.Shutdown(shutdown)
		_ = srv.Shutdown(shutdown)
	}()
	go func() {
		if err := internal.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()
	log.Printf("crypt-module di %s", addr)
	err = srv.ListenAndServeTLS("", "")
	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
	<-done
}
