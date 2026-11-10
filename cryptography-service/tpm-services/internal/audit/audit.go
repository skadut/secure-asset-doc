package audit

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

type HMACer interface {
	HMAC(msg []byte) ([]byte, error)
}

type Record struct {
	Time       string
	RequestID  string
	Service    string
	Identity   string
	KeyID      string
	KeyVersion int
	Action     string
	Result     string
}

type diskRecord struct {
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

const zeroHash = "0000000000000000000000000000000000000000000000000000000000000000"

const signInterval = 60 * time.Second

const signEvery = 100

var fieldNames = []string{"time", "request_id", "service", "identity", "key_id", "key_version", "action", "result", "prev_hash", "hash"}

type Logger struct {
	// Echo, when set, gets one console line per non-sign record after the file write succeeds. Errors are ignored.
	Echo io.Writer

	mu        sync.Mutex
	file      *os.File
	signer    HMACer
	service   string // last non-sign record's service; sign records reuse it
	prevHash  string
	sinceSign int // non-sign records since last sign record
	closed    bool
	stop      chan struct{}
	done      chan struct{}
}

// Open creates path if missing and resumes the hash chain from the last line.
// A nil signer disables sign records. Errors if the existing chain is broken.
func Open(path string, signer HMACer) (*Logger, error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR|os.O_APPEND, 0600)
	if err != nil {
		return nil, err
	}
	l := &Logger{file: f, signer: signer, prevHash: zeroHash, stop: make(chan struct{}), done: make(chan struct{})}
	// ponytail: reads the whole file on open; fine for a log that is rotated by the caller.
	if err := l.resume(); err != nil {
		f.Close()
		return nil, err
	}
	if signer == nil {
		close(l.done)
	} else {
		go l.tick()
	}
	return l, nil
}

func (l *Logger) resume() error {
	if _, err := l.file.Seek(0, io.SeekStart); err != nil {
		return err
	}
	br := bufio.NewReader(l.file)
	for lineNo := 1; ; lineNo++ {
		line, readErr := br.ReadString('\n')
		if len(line) > 0 {
			d, err := parseLine(line)
			if err != nil {
				return fmt.Errorf("audit line %d: %w", lineNo, err)
			}
			if d.PrevHash != l.prevHash || d.Hash != hashRecord(d) {
				return fmt.Errorf("audit line %d: broken hash chain", lineNo)
			}
			l.prevHash = d.Hash
			if d.Action == "audit.sign" {
				l.sinceSign = 0
			} else {
				l.sinceSign++
				l.service = d.Service
			}
		}
		if readErr == io.EOF {
			return nil
		}
		if readErr != nil {
			return readErr
		}
	}
}

func (l *Logger) Append(r Record) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed {
		return os.ErrClosed
	}
	if err := l.appendLocked(r); err != nil {
		return err
	}
	if l.signer != nil && l.sinceSign >= signEvery {
		return l.signLocked()
	}
	return nil
}

func (l *Logger) appendLocked(r Record) error {
	if r.Time == "" {
		r.Time = time.Now().UTC().Format(time.RFC3339Nano)
	} else if t, err := time.Parse(time.RFC3339Nano, r.Time); err == nil {
		r.Time = t.UTC().Format(time.RFC3339Nano)
	}
	d := diskRecord{
		Time: clean(r.Time), RequestID: clean(r.RequestID), Service: clean(r.Service),
		Identity: clean(r.Identity), KeyID: clean(r.KeyID), KeyVersion: r.KeyVersion,
		Action: clean(r.Action), Result: clean(r.Result), PrevHash: l.prevHash,
	}
	d.Hash = hashRecord(d)
	b, err := json.Marshal(d)
	if err != nil {
		return err
	}
	if _, err := l.file.Write(append(b, '\n')); err != nil {
		return err
	}
	if err := l.file.Sync(); err != nil {
		return err
	}
	l.prevHash = d.Hash
	if d.Action == "audit.sign" {
		l.sinceSign = 0
	} else {
		l.sinceSign++
		l.service = d.Service
		l.echoLocked(d)
	}
	return nil
}

// echoLocked prints one console line per non-sign record. Caller holds l.mu. Write errors are ignored.
func (l *Logger) echoLocked(d diskRecord) {
	if l.Echo == nil {
		return
	}
	line := fmt.Sprintf("[audit] %s %s %s id=%s", d.Time, d.Action, d.Result, d.Identity)
	if d.KeyID != "" && d.KeyID != "-" {
		line += " kek=" + d.KeyID
	}
	if d.KeyVersion != 0 {
		line += " v=" + strconv.Itoa(d.KeyVersion)
	}
	line += " req=" + d.RequestID
	_, _ = io.WriteString(l.Echo, line+"\n")
}

func (l *Logger) signLocked() error {
	if l.signer == nil || l.sinceSign == 0 {
		return nil
	}
	raw, err := hex.DecodeString(l.prevHash)
	if err != nil {
		return err
	}
	// HMAC is serialized by the lock inside tpm.Handle.HMAC, which is shared by all callers (service KEK unwrap included). Do not add a second lock here.
	sig, err := l.signer.HMAC(append([]byte("tpm-msk/audit-sign/v1"), raw...))
	if err != nil {
		return err
	}
	return l.appendLocked(Record{RequestID: "-", Service: l.service, Identity: "-", KeyID: "-", Action: "audit.sign", Result: "hmac:" + hex.EncodeToString(sig)})
}

func (l *Logger) tick() {
	defer close(l.done)
	t := time.NewTicker(signInterval)
	defer t.Stop()
	for {
		select {
		case <-l.stop:
			return
		case <-t.C:
			l.mu.Lock()
			if !l.closed {
				_ = l.signLocked() // ponytail: sign errors dropped on timer path; next Append retries.
			}
			l.mu.Unlock()
		}
	}
}

func (l *Logger) Close() error {
	l.mu.Lock()
	if l.closed {
		l.mu.Unlock()
		return nil
	}
	l.closed = true
	l.mu.Unlock()
	close(l.stop)
	<-l.done
	serr := l.file.Sync()
	cerr := l.file.Close()
	if serr != nil {
		return serr
	}
	return cerr
}

// Verify checks chain and hash only. audit.sign results need the key, so they are not authenticated here.
func Verify(r io.Reader) (count int, badLine int, err error) {
	br := bufio.NewReader(r)
	prev := zeroHash
	for lineNo := 1; ; lineNo++ {
		line, readErr := br.ReadString('\n')
		if len(line) > 0 {
			d, perr := parseLine(line)
			if perr != nil {
				return count, lineNo, fmt.Errorf("line %d: %w", lineNo, perr)
			}
			if d.PrevHash != prev || d.Hash != hashRecord(d) {
				return count, lineNo, fmt.Errorf("line %d: broken hash chain", lineNo)
			}
			prev = d.Hash
			count++
		}
		if readErr == io.EOF {
			return count, 0, nil
		}
		if readErr != nil {
			return count, lineNo, readErr
		}
	}
}

func parseLine(line string) (diskRecord, error) {
	var d diskRecord
	line = strings.TrimSuffix(strings.TrimSuffix(line, "\n"), "\r")
	var fields map[string]json.RawMessage
	if err := json.Unmarshal([]byte(line), &fields); err != nil {
		return d, err
	}
	if len(fields) != len(fieldNames) {
		return d, errors.New("wrong field count")
	}
	for _, name := range fieldNames {
		if _, ok := fields[name]; !ok {
			return d, fmt.Errorf("missing field %q", name)
		}
	}
	dec := json.NewDecoder(strings.NewReader(line))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&d); err != nil {
		return d, err
	}
	if _, err := dec.Token(); err != io.EOF {
		return d, errors.New("trailing data after record")
	}
	return d, nil
}

func hashRecord(d diskRecord) string {
	s := strings.Join([]string{d.PrevHash, d.Time, d.RequestID, d.Service, d.Identity, d.KeyID, strconv.Itoa(d.KeyVersion), d.Action, d.Result}, "|")
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

var cleaner = strings.NewReplacer("|", "_", "\n", "_", "\r", "_")

func clean(s string) string { return cleaner.Replace(s) }
