package audit

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type fakeHMAC struct{}

func (fakeHMAC) HMAC(msg []byte) ([]byte, error) {
	m := hmac.New(sha256.New, []byte("fixed test key"))
	_, _ = m.Write(msg)
	return m.Sum(nil), nil
}

func testRecord(i int) Record {
	return Record{RequestID: fmt.Sprint(i), Service: "tpm-service", Identity: "test", KeyID: "key", KeyVersion: 1, Action: "kek.request", Result: "ok"}
}

func TestEchoPreservesVerifiedAudit(t *testing.T) {
	path := filepath.Join(t.TempDir(), "audit.jsonl")
	var echo bytes.Buffer
	l, err := Open(path, fakeHMAC{})
	if err != nil {
		t.Fatal(err)
	}
	l.Echo = &echo
	if err := l.Append(testRecord(1)); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(echo.String(), "kek.request") {
		t.Fatalf("echo = %q, want kek.request", echo.String())
	}
	if err := l.Append(Record{RequestID: "-", Service: "tpm-service", Identity: "-", KeyID: "-", Action: "audit.sign", Result: "hmac:test"}); err != nil {
		t.Fatal(err)
	}
	if strings.Count(echo.String(), "[audit]") != 1 {
		t.Fatalf("echoed sign record: %q", echo.String())
	}
	if err := l.Close(); err != nil {
		t.Fatal(err)
	}
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	count, badLine, err := Verify(f)
	if err != nil || count != 2 || badLine != 0 {
		t.Fatalf("Verify = (%d, %d, %v)", count, badLine, err)
	}
}

func TestVerifyThreeRecords(t *testing.T) {
	path := filepath.Join(t.TempDir(), "audit.jsonl")
	l, err := Open(path, nil)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		if err := l.Append(testRecord(i)); err != nil {
			t.Fatal(err)
		}
	}
	if err := l.Close(); err != nil {
		t.Fatal(err)
	}
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	count, badLine, err := Verify(f)
	if err != nil || count != 3 || badLine != 0 {
		t.Fatalf("Verify = (%d, %d, %v)", count, badLine, err)
	}
}

func TestVerifyTamperAndDeletedLine(t *testing.T) {
	for _, deleteMiddle := range []bool{false, true} {
		t.Run(fmt.Sprintf("delete=%t", deleteMiddle), func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "audit.jsonl")
			l, err := Open(path, nil)
			if err != nil {
				t.Fatal(err)
			}
			for i := 0; i < 3; i++ {
				if err := l.Append(testRecord(i)); err != nil {
					t.Fatal(err)
				}
			}
			if err := l.Close(); err != nil {
				t.Fatal(err)
			}
			data, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			lines := strings.Split(strings.TrimSuffix(string(data), "\n"), "\n")
			if deleteMiddle {
				lines = append(lines[:1], lines[2:]...)
			} else {
				var d map[string]any
				if err := json.Unmarshal([]byte(lines[1]), &d); err != nil {
					t.Fatal(err)
				}
				d["result"] = "tampered"
				b, err := json.Marshal(d)
				if err != nil {
					t.Fatal(err)
				}
				lines[1] = string(b)
			}
			count, badLine, err := Verify(strings.NewReader(strings.Join(lines, "\n") + "\n"))
			if err == nil || badLine != 2 || count != 1 {
				t.Fatalf("Verify = (%d, %d, %v)", count, badLine, err)
			}
		})
	}
}

func TestOpenResumesChain(t *testing.T) {
	path := filepath.Join(t.TempDir(), "audit.jsonl")
	l, err := Open(path, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := l.Append(testRecord(1)); err != nil {
		t.Fatal(err)
	}
	if err := l.Close(); err != nil {
		t.Fatal(err)
	}
	l, err = Open(path, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := l.Append(testRecord(2)); err != nil {
		t.Fatal(err)
	}
	if err := l.Close(); err != nil {
		t.Fatal(err)
	}
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	count, badLine, err := Verify(f)
	if err != nil || count != 2 || badLine != 0 {
		t.Fatalf("Verify = (%d, %d, %v)", count, badLine, err)
	}
}

func TestSanitizeFields(t *testing.T) {
	path := filepath.Join(t.TempDir(), "audit.jsonl")
	l, err := Open(path, nil)
	if err != nil {
		t.Fatal(err)
	}
	r := testRecord(1)
	r.RequestID = "a|b\nc\rd"
	if err := l.Append(r); err != nil {
		t.Fatal(err)
	}
	if err := l.Close(); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), `"request_id":"a_b_c_d"`) {
		t.Fatalf("field not sanitized: %s", data)
	}
	count, badLine, err := Verify(strings.NewReader(string(data)))
	if err != nil || count != 1 || badLine != 0 {
		t.Fatalf("Verify = (%d, %d, %v)", count, badLine, err)
	}
}

func TestSignEvery100Records(t *testing.T) {
	path := filepath.Join(t.TempDir(), "audit.jsonl")
	l, err := Open(path, fakeHMAC{})
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 100; i++ {
		if err := l.Append(testRecord(i)); err != nil {
			t.Fatal(err)
		}
	}
	if err := l.Close(); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, line := range strings.Split(strings.TrimSpace(string(data)), "\n") {
		var d diskRecord
		if err := json.Unmarshal([]byte(line), &d); err != nil {
			t.Fatal(err)
		}
		if d.Action == "audit.sign" {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("audit.sign count = %d, want 1", count)
	}
	valid, badLine, err := Verify(strings.NewReader(string(data)))
	if err != nil || valid != 101 || badLine != 0 {
		t.Fatalf("Verify = (%d, %d, %v)", valid, badLine, err)
	}
}
