package main

import (
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	selfID        = "crypto-service"
	clientID      = "client"
	internalPath  = "/internal/traffic"
	trafficWindow = 10 * time.Second
	trafficRetain = time.Minute // ponytail: bucket lama dibuang saat Record agar memori terbatas; window baca tetap trafficWindow.
)

// Edge tetap: label hanya service ID, tidak tumbuh tanpa batas.
var knownEdges = [][2]string{
	{clientID, selfID},
}

var recorder = NewRecorder(knownEdges...)

type EdgeStats struct {
	Source    string  `json:"source"`
	Target    string  `json:"target"`
	RPS       float64 `json:"rps"`
	ErrorRate float64 `json:"errorRate"`
	AvgMs     float64 `json:"avgMs"`
}

type bucket struct {
	count, errors, totalNs int64
}

type Recorder struct {
	mu      sync.Mutex
	now     func() time.Time
	known   [][2]string
	buckets map[[2]string]map[int64]*bucket
}

func NewRecorder(known ...[2]string) *Recorder {
	return &Recorder{now: time.Now, known: known, buckets: map[[2]string]map[int64]*bucket{}}
}

func (r *Recorder) Record(src, dst string, d time.Duration, failed bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := r.now()
	key := [2]string{src, dst}
	if r.buckets[key] == nil {
		r.buckets[key] = map[int64]*bucket{}
	}
	secs := r.buckets[key]
	sec := now.Unix()
	b := secs[sec]
	if b == nil {
		b = &bucket{}
		secs[sec] = b
	}
	b.count++
	b.totalNs += int64(d)
	if failed {
		b.errors++
	}
	cutoff := now.Add(-trafficRetain).Unix()
	for s := range secs {
		if s <= cutoff {
			delete(secs, s)
		}
	}
}

// Snapshot menghitung statistik window terakhir dan membuang bucket di luar window.
// Semua edge yang dikenal selalu ada (nol bila tanpa traffic).
func (r *Recorder) Snapshot(window time.Duration) []EdgeStats {
	r.mu.Lock()
	defer r.mu.Unlock()
	cutoff := r.now().Add(-window).Unix()
	edges := map[[2]string]bool{}
	for _, k := range r.known {
		edges[k] = true
	}
	for k := range r.buckets {
		edges[k] = true
	}
	out := make([]EdgeStats, 0, len(edges))
	for key := range edges {
		st := EdgeStats{Source: key[0], Target: key[1]}
		var c, e, ns int64
		for s, b := range r.buckets[key] {
			if s <= cutoff {
				delete(r.buckets[key], s)
				continue
			}
			c += b.count
			e += b.errors
			ns += b.totalNs
		}
		if c > 0 && window > 0 {
			st.RPS = float64(c) / window.Seconds()
			st.ErrorRate = float64(e) / float64(c)
			st.AvgMs = float64(ns) / float64(c) / 1e6
		}
		out = append(out, st)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Source != out[j].Source {
			return out[i].Source < out[j].Source
		}
		return out[i].Target < out[j].Target
	})
	return out
}

// trafficIn mencatat client -> crypto-service. Harus dipasang sebelum recovery
// agar panic yang ditangkap recovery tetap tercatat sebagai error (status 500).
func trafficIn(rec *Recorder) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.URL.Path == internalPath {
			c.Next()
			return
		}
		start := time.Now()
		c.Next()
		rec.Record(clientID, selfID, time.Since(start), c.Writer.Status() >= 500)
	}
}

// internalRoutes: hanya GET /internal/traffic, dilayani listener CRYPTO_INTERNAL_ADDR.
func internalRoutes(rec *Recorder) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc(internalPath, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			writeJSON(w, 405, map[string]fault{"fault": {405, "hanya GET"}})
			return
		}
		writeJSON(w, 200, rec.Snapshot(trafficWindow))
	})
	return mux
}
