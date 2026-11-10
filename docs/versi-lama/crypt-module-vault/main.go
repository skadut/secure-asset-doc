// Demo tiruan Sandidata v2.3 REST API (tanpa mTLS) untuk bimtek SIMPELDATIN.
// Bentuk request/response mengikuti sandidata_v2.3.html.
package main

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
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
	maxBody      = 20 << 20
	maxFile      = 10 << 20
	maxRand      = 1024
	addrDflt     = ":2796"
	internalDflt = ":2797"
)

type config struct {
	Mode                                                string
	TTL                                                 time.Duration
	Vault                                               VaultConfig
	KeydSocket, TLSCert, TLSKey, TLSClientCA, AuditFile string
	AppIDs                                              []string
}

type VaultConfig struct {
	Addresses                     []string
	CAFile, ClientCert, ClientKey string
}
type VaultClient struct {
	addresses   []string
	http        *http.Client
	mu          sync.Mutex
	token       string
	tokenExpiry time.Time
}

// NewVaultClient membuat klien Vault dari VaultConfig. Test: isi Addresses dengan URL httptest TLS,
// CAFile/ClientCert/ClientKey dengan file PEM, lalu set mode, version, keyManager secara manual.
func NewVaultClient(c VaultConfig) (*VaultClient, error) {
	pool := x509.NewCertPool()
	ca, err := os.ReadFile(c.CAFile)
	if err != nil {
		return nil, errors.New("gagal membaca CA Vault")
	}
	if !pool.AppendCertsFromPEM(ca) {
		return nil, errors.New("sertifikat CA Vault tidak valid")
	}
	cert, err := tls.LoadX509KeyPair(c.ClientCert, c.ClientKey)
	if err != nil {
		return nil, errors.New("gagal membaca sertifikat klien Vault")
	}
	return &VaultClient{addresses: c.Addresses, http: &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: pool, Certificates: []tls.Certificate{cert}}}}}, nil
}

var (
	mode       = "unsafe"
	version    = "s0"
	keyTTL     = 5 * time.Minute
	masterKey  []byte
	keyManager *Manager
	vault      *VaultClient
	mlockWarn  sync.Once
)

type keyEntry struct {
	key     []byte
	expires time.Time
}
type Manager struct {
	mu      sync.Mutex
	ttl     time.Duration
	current string
	keys    map[string]keyEntry
	vault   *VaultClient
}

func lockKey(b []byte) {
	if len(b) > 0 {
		if err := lockMem(b); err != nil {
			mlockWarn.Do(func() { log.Printf("mlock unavailable") })
		}
	}
}
func wipe(b []byte) {
	if len(b) > 0 {
		clear(b)
		unlockMem(b)
	}
}
func derive(master []byte, label string) []byte {
	m := hmac.New(sha256.New, master)
	_, _ = m.Write([]byte(label))
	b := m.Sum(nil)
	lockKey(b)
	return b
}

func (v *VaultClient) request(ctx context.Context, path string, payload any, out any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	var last error
	for _, base := range v.addresses {
		for attempt := 0; attempt < 2; attempt++ {
			v.mu.Lock()
			token, expired := v.token, time.Now().After(v.tokenExpiry)
			v.mu.Unlock()
			if token == "" || expired || attempt == 1 {
				if err = v.login(ctx, base); err != nil {
					last = err
					break
				}
				v.mu.Lock()
				token = v.token
				v.mu.Unlock()
			}
			req, e := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(base, "/")+"/v1/"+path, strings.NewReader(string(body)))
			if e != nil {
				return e
			}
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-Vault-Token", token)
			resp, e := v.http.Do(req)
			if e != nil {
				last = e
				break
			}
			data, e := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
			resp.Body.Close()
			if e != nil {
				last = e
				break
			}
			if resp.StatusCode == http.StatusForbidden {
				v.mu.Lock()
				v.token = ""
				v.mu.Unlock()
				if attempt == 0 {
					continue
				}
			}
			// 400 = ciphertext/wrapped rusak dari klien: jangan purge cache, bukan kegagalan zone.
			if resp.StatusCode == http.StatusBadRequest {
				return errBadCipher
			}
			if resp.StatusCode < 200 || resp.StatusCode >= 300 {
				last = errors.New("Vault menolak permintaan")
				break
			}
			// ponytail: respons didecode ke string Go (tidak bisa di-wipe). Upgrade: parse body langsung ke buffer terkunci.
			err = json.Unmarshal(data, out)
			wipe(data)
			if err != nil {
				last = errors.New("respons Vault tidak valid")
				break
			}
			return nil
		}
	}
	if last == nil {
		last = errors.New("Vault tidak tersedia")
	}
	return last
}

// ponytail: mTLS sertifikat mengganti AppRole/secret_id karena sudah diprovisi, tanpa secret_id tersimpan. Upgrade: AppRole secret_id di tmpfs.
func (v *VaultClient) login(ctx context.Context, base string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(base, "/")+"/v1/auth/cert/login", strings.NewReader(`{"name":"crypto-module"}`))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := v.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	var x struct {
		Auth struct {
			Token string `json:"client_token"`
			Lease int    `json:"lease_duration"`
		} `json:"auth"`
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&x) != nil || x.Auth.Token == "" {
		return errors.New("autentikasi Vault gagal")
	}
	v.mu.Lock()
	v.token = x.Auth.Token
	v.tokenExpiry = time.Now().Add(time.Duration(x.Auth.Lease) * time.Second)
	v.mu.Unlock()
	return nil
}
func (v *VaultClient) unwrap(ctx context.Context, wrapped string) ([]byte, error) {
	var x struct {
		Data struct {
			Plaintext string `json:"plaintext"`
		} `json:"data"`
	}
	if err := v.request(ctx, "transit/decrypt/crypto-module-kek", map[string]string{"ciphertext": wrapped}, &x); err != nil {
		return nil, err
	}
	b, err := base64.StdEncoding.DecodeString(x.Data.Plaintext)
	if err != nil {
		return nil, errors.New("plaintext Vault tidak valid")
	}
	lockKey(b)
	return b, nil
}
func (v *VaultClient) generate(ctx context.Context) (string, []byte, error) {
	var x struct {
		Data struct {
			Ciphertext string `json:"ciphertext"`
		} `json:"data"`
	}
	if err := v.request(ctx, "transit/datakey/wrapped/crypto-module-kek", map[string]int{"bits": 256}, &x); err != nil {
		return "", nil, err
	}
	if x.Data.Ciphertext == "" {
		return "", nil, errors.New("respons Vault tidak valid")
	}
	b, err := v.unwrap(ctx, x.Data.Ciphertext)
	return x.Data.Ciphertext, b, err
}
func (m *Manager) purge(reason string) {
	m.mu.Lock()
	n := len(m.keys)
	for _, e := range m.keys {
		wipe(e.key)
	}
	m.keys = map[string]keyEntry{}
	m.current = ""
	m.mu.Unlock()
	log.Printf("zeroize reason=%s count=%d", reason, n)
}
func (m *Manager) get(ctx context.Context, wrapped string) ([]byte, error) {
	m.mu.Lock()
	e, ok := m.keys[wrapped]
	if ok && time.Now().Before(e.expires) {
		b := append([]byte(nil), e.key...)
		lockKey(b)
		m.mu.Unlock()
		return b, nil
	}
	if ok {
		wipe(e.key)
		delete(m.keys, wrapped)
	}
	m.mu.Unlock()
	b, err := m.vault.unwrap(ctx, wrapped)
	if errors.Is(err, errBadCipher) {
		return nil, err
	}
	if err != nil {
		m.purge("vault-error")
		return nil, fmt.Errorf("%w: %v", errZone, err)
	}
	m.mu.Lock()
	m.keys[wrapped] = keyEntry{append([]byte(nil), b...), time.Now().Add(m.ttl)}
	lockKey(m.keys[wrapped].key)
	m.mu.Unlock()
	return b, nil
}
func (m *Manager) currentKey(ctx context.Context) (string, []byte, error) {
	// DEK aktif dipakai sampai TTL habis; setelah itu generate DEK baru dari Vault.
	m.mu.Lock()
	if e, ok := m.keys[m.current]; ok && time.Now().Before(e.expires) {
		w, b := m.current, append([]byte(nil), e.key...)
		lockKey(b)
		m.mu.Unlock()
		return w, b, nil
	} else if ok {
		wipe(e.key)
		delete(m.keys, m.current)
	}
	m.mu.Unlock()
	wrapped, b, err := m.vault.generate(ctx)
	if err != nil {
		m.purge("vault-error")
		return "", nil, fmt.Errorf("%w: %v", errZone, err)
	}
	m.mu.Lock()
	m.current = wrapped
	m.keys[wrapped] = keyEntry{append([]byte(nil), b...), time.Now().Add(m.ttl)}
	lockKey(m.keys[wrapped].key)
	m.mu.Unlock()
	return wrapped, b, nil
}
func (m *Manager) janitor(ctx context.Context) {
	d := m.ttl
	if d > 30*time.Second {
		d = 30 * time.Second
	}
	t := time.NewTicker(d)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-t.C:
			m.mu.Lock()
			n := 0
			for k, e := range m.keys {
				if !now.Before(e.expires) {
					wipe(e.key)
					delete(m.keys, k)
					n++
				}
			}
			if n > 0 {
				log.Printf("zeroize reason=ttl count=%d", n)
			}
			m.mu.Unlock()
		}
	}
}

var (
	errZone      = errors.New("key zone unavailable")
	errBadCipher = errors.New("ciphertext tidak valid")
)

// ponytail: AAD kosong, API tidak punya tenant/record field. Upgrade: AAD = tenant ID + record ID + schema version (doc, SP 800-38D).
func sealKey(key []byte, pt string) ([]byte, []byte, error) {
	ek := derive(key, "enc")
	defer wipe(ek)
	block, err := aes.NewCipher(ek)
	if err != nil {
		return nil, nil, err
	}
	a, err := cipher.NewGCM(block)
	if err != nil {
		return nil, nil, err
	}
	iv := make([]byte, a.NonceSize())
	if _, err = rand.Read(iv); err != nil {
		return nil, nil, err
	}
	return iv, a.Seal(nil, iv, []byte(pt), nil), nil
}
func openKey(key, iv, ct []byte) (string, error) {
	ek := derive(key, "enc")
	defer wipe(ek)
	block, err := aes.NewCipher(ek)
	if err != nil {
		return "", err
	}
	a, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	pt, err := a.Open(nil, iv, ct, nil)
	defer wipe(pt)
	return string(pt), err
}
func cryptoKey(ctx context.Context, wrapped string) ([]byte, error) {
	if mode == "unsafe" {
		b := append([]byte(nil), masterKey...)
		lockKey(b)
		return b, nil
	}
	return keyManager.get(ctx, wrapped)
}
func encrypt(ctx context.Context, pt string) (encItem, error) {
	if mode == "tpm" {
		plain := []byte(pt)
		defer wipe(plain)
		id, iv, ct, err := keydEncrypt(ctx, plain)
		if err != nil {
			return encItem{}, err
		}
		n := len(ct) - 16
		return encItem{"t1:" + id, b64(ct[:n]), b64(ct[n:]), b64(iv)}, nil
	}
	var wrapped string
	var key []byte
	var err error
	if mode == "safe" {
		wrapped, key, err = keyManager.currentKey(ctx)
	} else {
		key, err = cryptoKey(ctx, "")
	}
	if err != nil {
		return encItem{}, err
	}
	defer wipe(key)
	iv, out, err := sealKey(key, pt)
	if err != nil {
		return encItem{}, err
	}
	n := len(out) - 16
	vk := version
	if mode == "safe" {
		vk = version + ":" + wrapped
	}
	return encItem{vk, b64(out[:n]), b64(out[n:]), b64(iv)}, nil
}
func decrypt(ctx context.Context, c encItem) (string, error) {
	if mode == "tpm" {
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
	wrapped := ""
	if mode == "safe" {
		if !strings.HasPrefix(c.Versionkey, version+":") {
			return "", errors.New("ciphertext tidak valid")
		}
		wrapped = strings.TrimPrefix(c.Versionkey, version+":")
	} else if c.Versionkey != version {
		return "", errors.New("ciphertext tidak valid")
	}
	key, err := cryptoKey(ctx, wrapped)
	if err != nil {
		return "", err
	}
	defer wipe(key)
	ct, e1 := unb64(c.Text)
	tag, e2 := unb64(c.Mac)
	iv, e3 := unb64(c.IV)
	if err = errors.Join(e1, e2, e3); err != nil {
		return "", err
	}
	if len(iv) != 12 || len(tag) != 16 {
		return "", errors.New("ciphertext tidak valid")
	}
	pt, err := openKey(key, iv, append(ct, tag...))
	if err != nil {
		return "", errors.New("ciphertext tidak valid")
	}
	return pt, nil
}
func seal(ctx context.Context, pt string) (string, error) {
	if mode == "tpm" {
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
	var wrapped string
	var key []byte
	var err error
	if mode == "safe" {
		wrapped, key, err = keyManager.currentKey(ctx)
	} else {
		key, err = cryptoKey(ctx, "")
	}
	if err != nil {
		return "", err
	}
	defer wipe(key)
	iv, out, err := sealKey(key, pt)
	if err != nil {
		return "", err
	}
	if mode == "safe" {
		return version + ":" + b64([]byte(wrapped)) + ":" + b64(append(iv, out...)), nil
	}
	return version + ":" + b64(append(iv, out...)), nil
}
func unseal(ctx context.Context, s string) (string, error) {
	if mode == "tpm" {
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
		s := string(pt)
		wipe(pt)
		return s, nil
	}
	var key []byte
	var raw string
	if mode == "safe" {
		p := strings.SplitN(s, ":", 3)
		if len(p) != 3 || p[0] != version {
			return "", errors.New("ciphertext tidak valid")
		}
		w, e := unb64(p[1])
		if e != nil {
			return "", e
		}
		raw = p[2]
		var err error
		key, err = cryptoKey(ctx, string(w))
		if err != nil {
			return "", err
		}
	} else {
		var ok bool
		raw, ok = strings.CutPrefix(s, version+":")
		if !ok {
			return "", errors.New("ciphertext tidak valid")
		}
		key, _ = cryptoKey(ctx, "")
	}
	defer wipe(key)
	b, err := unb64(raw)
	if err != nil {
		return "", err
	}
	if len(b) < 28 {
		return "", errors.New("ciphertext terlalu pendek")
	}
	pt, err := openKey(key, b[:12], b[12:])
	if err != nil {
		return "", errors.New("ciphertext tidak valid")
	}
	return pt, nil
}
func mac(ctx context.Context, msg, wrapped string) (string, error) {
	if mode == "tpm" {
		message := []byte(msg)
		defer wipe(message)
		id, tag, err := keydHMAC(ctx, message, wrapped)
		if err != nil {
			return "", err
		}
		defer wipe(tag)
		return "t1:" + id + ":" + b64(tag), nil
	}
	key, err := cryptoKey(ctx, wrapped)
	if err != nil {
		return "", err
	}
	defer wipe(key)
	mk := derive(key, "mac")
	defer wipe(mk)
	m := hmac.New(sha256.New, mk)
	_, _ = m.Write([]byte(msg))
	if mode == "safe" {
		return version + ":" + b64([]byte(wrapped)) + ":" + b64(m.Sum(nil)), nil
	}
	return version + ":" + b64(m.Sum(nil)), nil
}
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

// cryptoFail: error Vault/key zone -> 503 generik; error lain (input salah, kriptografi) -> 501.
func cryptoFail(w http.ResponseWriter, err error) {
	if errors.Is(err, errZone) {
		writeJSON(w, 503, map[string]fault{"fault": {503, "key zone unavailable"}})
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
			if keyManager != nil {
				keyManager.purge("panic")
			} else {
				log.Printf("zeroize reason=panic count=0")
			}
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
			out[i] = textItem{s}
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
			pt, e := unseal(r.Context(), c.Text)
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
		writeJSON(w, 200, map[string]string{"Ciphertext": s})
	})))
	r.Any("/unsealfile", gin.WrapF(post(func(w http.ResponseWriter, r *http.Request, req struct{ Ciphertext string }) {
		if req.Ciphertext == "" {
			badReq(w, "Ciphertext wajib diisi")
			return
		}
		pt, e := unseal(r.Context(), req.Ciphertext)
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
		wrapped := ""
		if mode == "safe" {
			var b []byte
			var e error
			wrapped, b, e = keyManager.currentKey(r.Context())
			if e != nil {
				cryptoFail(w, e)
				return
			}
			defer wipe(b)
		}
		if mode == "tpm" {
			id, tag, e := keydHMAC(r.Context(), []byte(*req.Message), "")
			if e != nil {
				cryptoFail(w, e)
				return
			}
			defer wipe(tag)
			writeJSON(w, 200, map[string]string{"Value": "t1:" + id + ":" + b64(tag)})
			return
		}
		v, e := mac(r.Context(), *req.Message, wrapped)
		if e != nil {
			cryptoFail(w, e)
			return
		}
		writeJSON(w, 200, map[string]string{"Value": v})
	})))
	r.Any("/verifyhmac", gin.WrapF(post(func(w http.ResponseWriter, r *http.Request, req struct {
		Message    *string
		HMACstring string
	}) {
		if req.Message == nil || req.HMACstring == "" {
			badReq(w, "Message dan HMACstring wajib diisi")
			return
		}
		if mode == "tpm" {
			p := strings.SplitN(req.HMACstring, ":", 3)
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
			return
		}
		var wrapped, tag string // Format: safe "k1:"+b64(wrapped)+":"+b64(tag); unsafe "s0:"+b64(tag). Versi salah -> false.
		if mode == "safe" {
			p := strings.SplitN(req.HMACstring, ":", 3)
			if len(p) != 3 || p[0] != version {
				writeJSON(w, 200, map[string]bool{"Value": false})
				return
			}
			b, e := unb64(p[1])
			if e != nil {
				writeJSON(w, 200, map[string]bool{"Value": false})
				return
			}
			wrapped, tag = string(b), p[2]
		} else {
			p := strings.SplitN(req.HMACstring, ":", 2)
			if len(p) != 2 || p[0] != version {
				writeJSON(w, 200, map[string]bool{"Value": false})
				return
			}
			tag = p[1]
		}
		got, e := mac(r.Context(), *req.Message, wrapped)
		if e != nil {
			cryptoFail(w, e)
			return
		}
		want := got[strings.LastIndex(got, ":")+1:]
		a, e1 := unb64(want)
		b, e2 := unb64(tag)
		writeJSON(w, 200, map[string]bool{"Value": e1 == nil && e2 == nil && hmac.Equal(a, b)})
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
			idx := strings.LastIndex(m.Text, ":"+version+":")
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
	c := config{Mode: os.Getenv("CRYPTO_MODE"), TTL: 5 * time.Minute}
	if c.Mode == "" {
		c.Mode = "safe"
	}
	if c.Mode != "safe" && c.Mode != "unsafe" && c.Mode != "tpm" {
		return c, errors.New("CRYPTO_MODE harus safe, unsafe, atau tpm")
	}
	if s := os.Getenv("CRYPTO_KEY_TTL"); s != "" {
		d, e := time.ParseDuration(s)
		if e != nil || d <= 0 || d > 5*time.Minute {
			return c, errors.New("CRYPTO_KEY_TTL harus >0 dan <=5m")
		}
		c.TTL = d
	}
	if c.Mode == "safe" {
		for _, a := range strings.Split(os.Getenv("VAULT_ADDRS"), ",") {
			if a = strings.TrimSpace(a); a != "" {
				u, e := url.Parse(a)
				if e != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
					return c, errors.New("VAULT_ADDRS harus https://host:port")
				}
				c.Vault.Addresses = append(c.Vault.Addresses, a)
			}
		}
		c.Vault.CAFile = os.Getenv("VAULT_CA_FILE")
		c.Vault.ClientCert = os.Getenv("VAULT_CLIENT_CERT")
		c.Vault.ClientKey = os.Getenv("VAULT_CLIENT_KEY")
		if len(c.Vault.Addresses) == 0 {
			return c, errors.New("VAULT_ADDRS wajib diisi")
		}
	}
	if c.Mode == "tpm" {
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
	mode, keyTTL = cfg.Mode, cfg.TTL
	if mode == "tpm" {
		_, had := os.LookupEnv("CRYPT_KEY")
		_ = os.Unsetenv("CRYPT_KEY")
		if had {
			log.Print("tpm mode: CRYPT_KEY ignored")
		}
		version = "t1"
		keyd = newKeydClient(cfg.KeydSocket)
	} else if mode == "safe" {
		_, had := os.LookupEnv("CRYPT_KEY")
		_ = os.Unsetenv("CRYPT_KEY")
		if had {
			log.Print("safe mode: CRYPT_KEY ignored")
		}
		vault, err = NewVaultClient(cfg.Vault)
		if err != nil {
			log.Fatal(err)
		}
		vault.http.Transport = &MeteredTransport{Base: vault.http.Transport, rec: recorder}
		keyManager = &Manager{ttl: keyTTL, keys: map[string]keyEntry{}, vault: vault}
		version = "k1"
	} else {
		masterKey, err = hex.DecodeString(os.Getenv("CRYPT_KEY"))
		if err != nil || len(masterKey) != 32 {
			log.Fatal("CRYPT_KEY wajib diisi 64 karakter hex")
		}
		lockKey(masterKey)
	}
	_ = disableCoreDumps()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if keyManager != nil {
		go keyManager.janitor(ctx)
	}
	addr := os.Getenv("CRYPT_ADDR")
	if addr == "" {
		addr = addrDflt
	}
	r, err := routes()
	if err != nil {
		log.Fatal(err)
	}
	var tlsCfg *tls.Config
	var audit *auditLog
	var handler http.Handler = r
	if mode == "tpm" {
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
		tlsCfg = &tls.Config{MinVersion: tls.VersionTLS13, ClientAuth: tls.RequireAndVerifyClientCert, ClientCAs: pool, Certificates: []tls.Certificate{cert}}
		audit, e = newAuditLog(cfg.AuditFile)
		if e != nil {
			log.Fatal(e)
		}
		handler = auditHandler(audit, authzHandler(cfg.AppIDs, audit, r))
	}
	handler = requestIDMW(handler)
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
		if keyManager != nil {
			keyManager.purge("shutdown")
		}
		if masterKey != nil {
			wipe(masterKey)
		}
	}()
	go func() {
		if err := internal.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()
	log.Printf("crypt-module di %s", addr)
	if mode == "tpm" {
		err = srv.ListenAndServeTLS("", "")
	} else {
		err = srv.ListenAndServe()
	}
	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
	<-done
}
