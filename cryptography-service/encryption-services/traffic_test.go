package main

import (
	"bytes"
	"encoding/json"
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

func TestPanicRecoveryLogsZeroizeAndKeepsServing(t *testing.T) {
	var out bytes.Buffer
	oldLog := log.Writer()
	log.SetOutput(&out)
	t.Cleanup(func() { log.SetOutput(oldLog) })
	rec := newTestRecorder(&fakeClock{t: time.Unix(1_800_000_000, 0)})
	r := gin.New()
	r.Use(trafficIn(rec), recovery)
	r.GET("/boom", func(*gin.Context) { panic("boom") })
	r.GET("/ok", func(c *gin.Context) { c.String(200, "ok") })
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/boom", nil))
	if w.Code != 500 {
		t.Fatalf("panic status: %d", w.Code)
	}
	if n := strings.Count(out.String(), "zeroize reason=panic count=0"); n != 1 {
		t.Fatalf("zeroize log count=%d: %q", n, out.String())
	}
	if e := findEdge(t, rec.Snapshot(10*time.Second), clientID, selfID); e.ErrorRate != 1 {
		t.Fatalf("panic not counted as error: %v", e.ErrorRate)
	}
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/ok", nil))
	if w.Code != 200 || w.Body.String() != "ok" {
		t.Fatalf("server not serving after panic: %d %q", w.Code, w.Body)
	}
}
