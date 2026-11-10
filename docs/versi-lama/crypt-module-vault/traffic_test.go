package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

type fakeClock struct{ t time.Time }

func newTestRecorder(clk *fakeClock) *Recorder {
	rec := NewRecorder(knownEdges...)
	rec.now = func() time.Time { return clk.t }
	return rec
}

func findEdge(t *testing.T, edges []EdgeStats, src, dst string) EdgeStats {
	t.Helper()
	for _, e := range edges {
		if e.Source == src && e.Target == dst {
			return e
		}
	}
	t.Fatalf("edge %s->%s missing", src, dst)
	return EdgeStats{}
}

func TestSnapshotMath(t *testing.T) {
	clk := &fakeClock{t: time.Unix(1_800_000_000, 0)}
	rec := newTestRecorder(clk)
	rec.Record("a", "b", 10*time.Millisecond, false)
	rec.Record("a", "b", 20*time.Millisecond, true)
	rec.Record("a", "b", 30*time.Millisecond, false)
	e := findEdge(t, rec.Snapshot(10*time.Second), "a", "b")
	if e.RPS != 0.3 || e.ErrorRate != 1.0/3.0 || e.AvgMs != 20 {
		t.Fatalf("math: rps=%v errorRate=%v avgMs=%v", e.RPS, e.ErrorRate, e.AvgMs)
	}
}

func TestSnapshotKnownEdgesZeroDefaults(t *testing.T) {
	rec := newTestRecorder(&fakeClock{t: time.Unix(1_800_000_000, 0)})
	edges := rec.Snapshot(10 * time.Second)
	if len(edges) != len(knownEdges) {
		t.Fatalf("edges=%d want %d", len(edges), len(knownEdges))
	}
	for _, e := range edges {
		if e.RPS != 0 || e.ErrorRate != 0 || e.AvgMs != 0 {
			t.Fatalf("non-zero default: %+v", e)
		}
	}
	for _, v := range []string{"vault-1", "vault-2", "vault-3"} {
		findEdge(t, edges, selfID, v)
	}
}

func TestSnapshotPrunesWithInjectedClock(t *testing.T) {
	clk := &fakeClock{t: time.Unix(1_800_000_000, 0)}
	rec := newTestRecorder(clk)
	rec.Record("a", "b", time.Millisecond, false)
	clk.t = clk.t.Add(5 * time.Second)
	rec.Record("a", "b", time.Millisecond, false)
	clk.t = clk.t.Add(6 * time.Second) // bucket pertama sudah di luar window 10s
	e := findEdge(t, rec.Snapshot(10*time.Second), "a", "b")
	if e.RPS != 0.1 {
		t.Fatalf("pruning: rps=%v want 0.1", e.RPS)
	}
	clk.t = clk.t.Add(time.Hour)
	if e = findEdge(t, rec.Snapshot(10*time.Second), "a", "b"); e.RPS != 0 {
		t.Fatalf("expired traffic still counted: rps=%v", e.RPS)
	}
	if len(rec.buckets[[2]string{"a", "b"}]) != 0 {
		t.Fatal("expired buckets not deleted")
	}
}

func TestInboundMiddlewareStatus(t *testing.T) {
	gin.SetMode(gin.TestMode)
	clk := &fakeClock{t: time.Unix(1_800_000_000, 0)}
	rec := newTestRecorder(clk)
	r := gin.New()
	r.Use(trafficIn(rec), recovery)
	r.GET("/ok", func(c *gin.Context) { c.Status(200) })
	r.GET("/fail", func(c *gin.Context) { c.Status(503) })
	r.GET(internalPath, func(c *gin.Context) { c.Status(200) })
	for _, p := range []string{"/ok", "/fail", internalPath} {
		r.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, p, nil))
	}
	e := findEdge(t, rec.Snapshot(10*time.Second), clientID, selfID)
	if e.RPS != 0.2 || e.ErrorRate != 0.5 {
		t.Fatalf("inbound: rps=%v errorRate=%v (internal path must be skipped)", e.RPS, e.ErrorRate)
	}
}

func TestMeteredTransportRecordsVault(t *testing.T) {
	clk := &fakeClock{t: time.Unix(1_800_000_000, 0)}
	rec := newTestRecorder(clk)
	statuses := []int{200, 403, 503}
	var i int
	base := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		s := statuses[i]
		i++
		if s == 0 {
			return nil, errors.New("dial failed")
		}
		return &http.Response{StatusCode: s, Body: http.NoBody, Request: r}, nil
	})
	mt := &MeteredTransport{Base: base, rec: rec}
	for range statuses {
		req := httptest.NewRequest(http.MethodPost, "https://vault-1:8200/v1/x", nil)
		if resp, err := mt.RoundTrip(req); err == nil {
			resp.Body.Close()
		}
	}
	e := findEdge(t, rec.Snapshot(10*time.Second), selfID, "vault-1")
	if e.RPS != 0.3 || e.ErrorRate != 1.0/3.0 {
		t.Fatalf("metered: rps=%v errorRate=%v (403 must not count as failed)", e.RPS, e.ErrorRate)
	}
}

func TestMeteredTransportTransportErrorIsFailed(t *testing.T) {
	clk := &fakeClock{t: time.Unix(1_800_000_000, 0)}
	rec := newTestRecorder(clk)
	mt := &MeteredTransport{Base: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("dial failed")
	}), rec: rec}
	if _, err := mt.RoundTrip(httptest.NewRequest(http.MethodGet, "https://vault-1:8200/", nil)); err == nil {
		t.Fatal("expected transport error")
	}
	if e := findEdge(t, rec.Snapshot(10*time.Second), selfID, "vault-1"); e.ErrorRate != 1 {
		t.Fatalf("transport error not counted: errorRate=%v", e.ErrorRate)
	}
}

func TestInternalTrafficEndpoint(t *testing.T) {
	rec := newTestRecorder(&fakeClock{t: time.Unix(1_800_000_000, 0)})
	rec.Record(clientID, selfID, time.Millisecond, false)
	h := internalRoutes(rec)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, internalPath, nil))
	if w.Code != 200 || w.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("internal: %d %s", w.Code, w.Header().Get("Content-Type"))
	}
	var edges []EdgeStats
	if err := json.Unmarshal(w.Body.Bytes(), &edges); err != nil || len(edges) != len(knownEdges) {
		t.Fatalf("internal body: %v %s", err, w.Body)
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodPost, internalPath, nil))
	if w.Code != 405 {
		t.Fatalf("POST internal: %d", w.Code)
	}
}

func TestPanicPurgesKeysAndLogs(t *testing.T) {
	setup(t, true)
	var out bytes.Buffer
	oldLog := log.Writer()
	log.SetOutput(&out)
	t.Cleanup(func() { log.SetOutput(oldLog) })
	cached := bytes.Repeat([]byte{7}, 32)
	keyManager = &Manager{ttl: time.Minute, keys: map[string]keyEntry{
		"a": {key: cached, expires: time.Now().Add(time.Minute)},
		"b": {key: bytes.Repeat([]byte{8}, 32), expires: time.Now().Add(time.Minute)},
	}, current: "a", vault: nil}
	rec := newTestRecorder(&fakeClock{t: time.Unix(1_800_000_000, 0)})
	r := gin.New()
	r.Use(trafficIn(rec), recovery)
	r.GET("/boom", func(*gin.Context) { panic("boom") })
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/boom", nil))
	if w.Code != 500 {
		t.Fatalf("panic status: %d", w.Code)
	}
	if len(keyManager.keys) != 0 || keyManager.current != "" {
		t.Fatalf("cache not purged: keys=%d current=%q", len(keyManager.keys), keyManager.current)
	}
	if !bytes.Equal(cached, make([]byte, len(cached))) {
		t.Fatal("DEK buffer not zeroed on panic")
	}
	if !strings.Contains(out.String(), "zeroize reason=panic count=2") {
		t.Fatalf("missing zeroize log: %q", out.String())
	}
	if e := findEdge(t, rec.Snapshot(10*time.Second), clientID, selfID); e.ErrorRate != 1 {
		t.Fatalf("panic not counted as error: %v", e.ErrorRate)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
