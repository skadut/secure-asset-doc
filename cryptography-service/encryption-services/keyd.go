package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"regexp"
	"sync"
	"time"
)

// Client socket ke key container (Rust). Protokol: JSON per baris, satu respons per request.

const (
	keydMaxLine = 16 << 20
	keydTimeout = 10 * time.Second
	keydPoolMax = 16
)

var (
	keydDekRe    = regexp.MustCompile(`^d[0-9a-f]{16}$`)
	errKeydProto = errors.New("respons keyd tidak valid")
	errKeydDeny  = errors.New("keyd menolak permintaan")
	errKeydLong  = errors.New("baris respons keyd terlalu panjang")
	errKeydIO    = errors.New("I/O keyd gagal")

	keyd *keydClient // diset main pada mode tpm, nil selain itu
)

type keydClient struct {
	dial func(ctx context.Context) (net.Conn, error)
	idle chan *keydConn
}

type keydConn struct {
	c  net.Conn
	br *bufio.Reader
}

type keydResp struct {
	ID        *string `json:"id"`
	OK        bool    `json:"ok"`
	Error     string  `json:"error"`
	DekID     string  `json:"dek_id"`
	IV        string  `json:"iv"`
	CT        string  `json:"ct"`
	Plaintext *string `json:"plaintext"`
	MAC       string  `json:"mac"`
	TTLms     *int64  `json:"ttl_ms"`
}

var dekDeadlines sync.Map // dek_id -> time.Time, from keyd ttl_ms

func noteDekTTL(id string, ttlMs *int64) {
	if id == "" || ttlMs == nil || !keydDekRe.MatchString(id) {
		return
	}
	dekDeadlines.Store(id, time.Now().Add(time.Duration(*ttlMs)*time.Millisecond))
}

// dekCountdown logs the last 30 s of each DEK keyd holds in plaintext, then its zeroize.
// ponytail: deadline learned from the last keyd response; a DEK not used through this crypto-api is not seen.
func dekCountdown(stop <-chan struct{}) {
	t := time.NewTicker(time.Second)
	defer t.Stop()
	for {
		select {
		case <-stop:
			return
		case now := <-t.C:
			dekDeadlines.Range(func(k, v any) bool {
				left := v.(time.Time).Sub(now)
				if left <= 0 {
					log.Printf("dek.zeroize id=%s by=keyd", k)
					dekDeadlines.Delete(k)
				} else if left <= 30*time.Second {
					log.Printf("dek.countdown id=%s remaining=%ds", k, int((left+time.Second-1)/time.Second))
				}
				return true
			})
		}
	}
}

type reqIDKey struct{}

func withReqID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, reqIDKey{}, id)
}

func reqIDFrom(ctx context.Context) string {
	id, _ := ctx.Value(reqIDKey{}).(string)
	return id
}

func newKeydClient(path string) *keydClient {
	var d net.Dialer
	return newKeydClientDial(func(ctx context.Context) (net.Conn, error) {
		return d.DialContext(ctx, "unix", path)
	})
}

func newKeydClientDial(dial func(ctx context.Context) (net.Conn, error)) *keydClient {
	return &keydClient{dial: dial, idle: make(chan *keydConn, keydPoolMax)}
}

func keydEncrypt(ctx context.Context, pt []byte) (dekID string, iv, ct []byte, err error) {
	if keyd == nil {
		return "", nil, nil, errZone
	}
	// ponytail: plaintext base64 jadi string Go (tidak bisa di-wipe). Upgrade: encode ke buffer terkunci.
	r, err := keyd.call(ctx, "encrypt", map[string]string{"plaintext": base64.StdEncoding.EncodeToString(pt)})
	if err != nil {
		return "", nil, nil, err
	}
	if !keydDekRe.MatchString(r.DekID) {
		return "", nil, nil, errKeydProto
	}
	iv, err = keydB64(r.IV)
	if err != nil || len(iv) != 12 {
		return "", nil, nil, errKeydProto
	}
	ct, err = keydB64(r.CT)
	if err != nil || len(ct) < 16 {
		return "", nil, nil, errKeydProto
	}
	noteKeyID(ctx, r.DekID)
	return r.DekID, iv, ct, nil
}

// keydDecrypt: ct = ciphertext||tag. Caller wipe hasil.
func keydDecrypt(ctx context.Context, dekID string, iv, ct []byte) ([]byte, error) {
	if !keydDekRe.MatchString(dekID) {
		return nil, errBadCipher
	}
	noteKeyID(ctx, dekID)
	if keyd == nil {
		return nil, errZone
	}
	r, err := keyd.call(ctx, "decrypt", map[string]string{
		"dek_id": dekID,
		"iv":     base64.StdEncoding.EncodeToString(iv),
		"ct":     base64.StdEncoding.EncodeToString(ct),
	})
	if err != nil {
		return nil, err
	}
	if r.Plaintext == nil {
		return nil, errKeydProto
	}
	return keydB64(*r.Plaintext)
}

// keydHMAC: dekID "" berarti key "dek_id" tidak dikirim.
func keydHMAC(ctx context.Context, msg []byte, dekID string) (string, []byte, error) {
	f := map[string]string{"message": base64.StdEncoding.EncodeToString(msg)}
	if dekID != "" {
		if !keydDekRe.MatchString(dekID) {
			return "", nil, errBadCipher
		}
		f["dek_id"] = dekID
	}
	if keyd == nil {
		return "", nil, errZone
	}
	r, err := keyd.call(ctx, "hmac", f)
	if err != nil {
		return "", nil, err
	}
	if !keydDekRe.MatchString(r.DekID) {
		return "", nil, errKeydProto
	}
	mac, err := keydB64(r.MAC)
	if err != nil || len(mac) != 32 {
		return "", nil, errKeydProto
	}
	noteKeyID(ctx, r.DekID)
	return r.DekID, mac, nil
}

func keydB64(s string) ([]byte, error) {
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return nil, errKeydProto
	}
	return b, nil
}

// call kirim satu request, terima satu respons. Error apa pun: koneksi ditutup, tidak masuk pool.
func (k *keydClient) call(ctx context.Context, op string, f map[string]string) (keydResp, error) {
	id := reqIDFrom(ctx)
	if id == "" {
		b := make([]byte, 16)
		if _, err := rand.Read(b); err != nil {
			return keydResp{}, fmt.Errorf("id permintaan: %w", err)
		}
		id = hex.EncodeToString(b)
	}
	f["id"], f["op"] = id, op
	b, err := json.Marshal(f)
	if err != nil {
		return keydResp{}, errKeydProto
	}
	line := append(append(make([]byte, 0, len(b)+1), b...), '\n')
	wipe(b)
	defer wipe(line)

	c, pooled, err := k.get(ctx)
	if err != nil {
		return keydResp{}, fmt.Errorf("%w: %v", errZone, err)
	}
	r, err := c.roundTrip(line, id)
	if err != nil && pooled && errors.Is(err, errKeydIO) {
		// Koneksi pool sudah putus (keyd restart/idle): ulangi sekali di koneksi baru, bukan dari pool lagi.
		c.c.Close()
		if c, err = k.fresh(ctx); err != nil {
			return keydResp{}, fmt.Errorf("%w: %v", errZone, err)
		}
		r, err = c.roundTrip(line, id)
	}
	if err != nil {
		c.c.Close()
		return keydResp{}, err
	}
	if !r.OK {
		c.c.Close()
		return keydResp{}, keydErr(r.Error)
	}
	dek := r.DekID
	if dek == "" {
		dek = f["dek_id"]
	}
	noteDekTTL(dek, r.TTLms)
	k.put(c)
	return r, nil
}

func keydErr(code string) error {
	switch code {
	case "unavailable":
		return errZone
	case "bad_cipher":
		return errBadCipher
	}
	return errKeydDeny
}

// get: ambil dari pool; bool true jika koneksi dari pool.
func (k *keydClient) get(ctx context.Context) (*keydConn, bool, error) {
	select {
	case c := <-k.idle:
		return c, true, nil
	default:
	}
	c, err := k.fresh(ctx)
	return c, false, err
}

// fresh dial koneksi baru, tidak pernah dari pool.
func (k *keydClient) fresh(ctx context.Context) (*keydConn, error) {
	nc, err := k.dial(ctx)
	if err != nil {
		return nil, err
	}
	return &keydConn{c: nc, br: bufio.NewReaderSize(nc, 64<<10)}, nil
}

// put kembalikan koneksi ke pool. Buffer sisa (respons ganda/tak diminta) = koneksi tidak sinkron, tutup.
func (k *keydClient) put(c *keydConn) {
	if c.br.Buffered() > 0 {
		c.c.Close()
		return
	}
	select {
	case k.idle <- c:
	default:
		c.c.Close()
	}
}

func (c *keydConn) roundTrip(line []byte, id string) (keydResp, error) {
	if err := c.c.SetDeadline(time.Now().Add(keydTimeout)); err != nil {
		return keydResp{}, fmt.Errorf("%w: %w: %v", errZone, errKeydIO, err)
	}
	if _, err := c.c.Write(line); err != nil {
		return keydResp{}, fmt.Errorf("%w: %w: %v", errZone, errKeydIO, err)
	}
	raw, err := readKeydLine(c.br)
	if errors.Is(err, errKeydLong) {
		return keydResp{}, fmt.Errorf("%w: %v", errZone, err)
	}
	if err != nil {
		return keydResp{}, fmt.Errorf("%w: %w: %v", errZone, errKeydIO, err)
	}
	defer wipe(raw)
	var r keydResp
	// ponytail: field string hasil decode tidak bisa di-wipe. Upgrade: streaming decode ke buffer terkunci.
	if json.Unmarshal(raw, &r) != nil || (r.ID != nil && *r.ID != id) {
		return keydResp{}, errKeydProto
	}
	return r, nil
}

// readKeydLine baca satu baris (termasuk '\n'), maks keydMaxLine byte.
func readKeydLine(br *bufio.Reader) ([]byte, error) {
	var line []byte
	for {
		chunk, err := br.ReadSlice('\n')
		if len(line)+len(chunk) > keydMaxLine {
			wipe(line)
			wipe(chunk)
			return nil, errKeydLong
		}
		line = append(line, chunk...)
		wipe(chunk)
		if err == nil {
			return line, nil
		}
		if err != bufio.ErrBufferFull {
			wipe(line)
			return nil, err
		}
	}
}
