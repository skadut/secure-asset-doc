# Service Traffic Visualization Guide

A general guide for building a live, animated service-to-service traffic map without adding any new infrastructure. Existing services record their own traffic in memory, one service exposes the aggregated data, and the frontend fetches and renders it as an interactive node graph.

---

## 1. Overview

### Goal

Display each service as a node and each communication path as an animated edge. Each edge shows live metrics such as request rate, error rate, and latency.

### Principles

- **No new services.** No Prometheus, no collector, no separate aggregator. Only libraries and endpoints inside existing services.
- **The sender counts.** Each edge is recorded by the service that initiates the request.
- **One public entry point.** The frontend only talks to one service (usually the backend API). Internal services stay unexposed.
- **Metadata only.** Record counts, durations, and status codes. Never record payloads, tokens, or key material.

### Architecture

```
Frontend ──(normal requests)──► Backend API ──► Service A
    ▲                               │
    │                               └──► Service B ──► Service C
    │                                        │
    └── GET /api/traffic ◄── Backend merges ◄┘ (Service B's own stats)
```

---

## 2. Define the Graph Model

Before writing code, list every edge you expect and decide which service records it.

| Source | Target | Protocol | Recorded by |
|---|---|---|---|
| frontend | backend | HTTPS | backend (inbound middleware) |
| backend | service-a | HTTP / SQL / gRPC | backend (outbound wrapper) |
| backend | service-b | HTTP / gRPC | backend (outbound wrapper) |
| service-b | service-c | HTTP | service-b (outbound wrapper) |

Use stable, lowercase service IDs. The same IDs must be used in the backend recorder and in the frontend node list.

### Metrics per edge

| Metric | Description | Visual mapping |
|---|---|---|
| `rps` | Requests per second over a sliding window | Number or speed of moving particles |
| `errorRate` | Failed requests / total requests | Edge color |
| `avgMs` (or p95) | Average or percentile latency | Label or stroke width |

---

## 3. Record Traffic In Memory

Create a small shared library (not a service) that every participating service imports. It keeps per-second buckets for each edge and computes stats over a sliding window.

### Example (Go)

```go
package traffic

import (
	"sync"
	"time"
)

type EdgeStats struct {
	Source    string  `json:"source"`
	Target    string  `json:"target"`
	RPS       float64 `json:"rps"`
	ErrorRate float64 `json:"errorRate"`
	AvgMs     float64 `json:"avgMs"`
}

type bucket struct {
	count, errors int64
	totalMs       float64
}

type Recorder struct {
	mu      sync.Mutex
	window  time.Duration
	buckets map[[2]string]map[int64]*bucket
}

func NewRecorder(window time.Duration) *Recorder {
	return &Recorder{window: window, buckets: map[[2]string]map[int64]*bucket{}}
}

func (r *Recorder) Record(src, dst string, d time.Duration, failed bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	key := [2]string{src, dst}
	sec := time.Now().Unix()
	if r.buckets[key] == nil {
		r.buckets[key] = map[int64]*bucket{}
	}
	b := r.buckets[key][sec]
	if b == nil {
		b = &bucket{}
		r.buckets[key][sec] = b
	}
	b.count++
	b.totalMs += float64(d.Milliseconds())
	if failed {
		b.errors++
	}
}

func (r *Recorder) Snapshot() []EdgeStats {
	r.mu.Lock()
	defer r.mu.Unlock()
	cutoff := time.Now().Add(-r.window).Unix()
	var out []EdgeStats
	for key, secs := range r.buckets {
		var c, e int64
		var ms float64
		for s, b := range secs {
			if s < cutoff {
				delete(secs, s)
				continue
			}
			c += b.count
			e += b.errors
			ms += b.totalMs
		}
		st := EdgeStats{Source: key[0], Target: key[1]}
		if c > 0 {
			st.RPS = float64(c) / r.window.Seconds()
			st.ErrorRate = float64(e) / float64(c)
			st.AvgMs = ms / float64(c)
		}
		out = append(out, st)
	}
	return out
}
```

A 10-second window (`NewRecorder(10 * time.Second)`) gives a responsive, live-feeling graph. Use a longer window for smoother numbers.

### Other languages

The same design works anywhere: a mutex-protected map of `edge -> second -> {count, errors, totalMs}`, a `record()` function, and a `snapshot()` function that prunes old buckets.

---

## 4. Hook Into Existing Calls

### Inbound (the public service counts frontend traffic)

```go
func TrafficMiddleware(rec *traffic.Recorder, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/traffic" {
			next.ServeHTTP(w, r) // do not count the dashboard's own polling
			return
		}
		sw := &statusWriter{ResponseWriter: w, code: 200}
		start := time.Now()
		next.ServeHTTP(sw, r)
		rec.Record("frontend", "backend", time.Since(start), sw.code >= 500)
	})
}

type statusWriter struct {
	http.ResponseWriter
	code int
}

func (s *statusWriter) WriteHeader(c int) { s.code = c; s.ResponseWriter.WriteHeader(c) }
```

### Outbound HTTP (any service calling another)

```go
type MeteredTransport struct {
	Rec      *traffic.Recorder
	Src, Dst string
	Next     http.RoundTripper
}

func (t *MeteredTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	start := time.Now()
	resp, err := t.Next.RoundTrip(r)
	failed := err != nil || (resp != nil && resp.StatusCode >= 500)
	t.Rec.Record(t.Src, t.Dst, time.Since(start), failed)
	return resp, err
}

// Usage: wrap the existing transport (including any mTLS config)
client := &http.Client{Transport: &MeteredTransport{
	Rec: rec, Src: "service-b", Dst: "service-c", Next: existingTransport,
}}
```

### Outbound non-HTTP (SQL drivers, gRPC, message queues)

Wrap the call site directly:

```go
start := time.Now()
err := repo.Query(ctx, ...)
rec.Record("backend", "service-a", time.Since(start), err != nil)
```

For gRPC, use a unary client interceptor with the same logic.

---

## 5. Expose and Merge the Stats

### Internal services

Each internal service that records edges exposes its snapshot on an internal-only endpoint.

```go
mux.HandleFunc("/internal/traffic", func(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(rec.Snapshot())
})
```

Restrict this endpoint to the internal network or require mTLS from the backend.

### Public service (aggregation point)

The backend merges its own snapshot with each internal service's snapshot and returns a single response.

```go
mux.HandleFunc("/api/traffic", func(w http.ResponseWriter, r *http.Request) {
	edges := rec.Snapshot()
	for _, url := range internalTrafficURLs {
		resp, err := internalClient.Get(url)
		if err != nil {
			continue // a down service simply contributes no edges
		}
		var ext []traffic.EdgeStats
		json.NewDecoder(resp.Body).Decode(&ext)
		resp.Body.Close()
		edges = append(edges, ext...)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"edges": edges, "ts": time.Now().Unix()})
})
```

### Response shape

```json
{
  "ts": 1793030000,
  "edges": [
    { "source": "frontend", "target": "backend", "rps": 12.4, "errorRate": 0.0, "avgMs": 35 },
    { "source": "backend", "target": "service-b", "rps": 8.1, "errorRate": 0.012, "avgMs": 18 }
  ]
}
```

### Node health (optional)

If an internal `/internal/traffic` call fails, include that service in a `down` list in the response so the frontend can mark the node red.

---

## 6. Render in the Frontend

This example uses React Flow (`npm i @xyflow/react`). The same concept applies to D3, Cytoscape.js, or plain SVG.

### Fetch the data

```tsx
type EdgeStats = { source: string; target: string; rps: number; errorRate: number; avgMs: number };

function useTraffic(intervalMs = 2000) {
  const [edges, setEdges] = useState<EdgeStats[]>([]);
  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/traffic", { credentials: "include" });
        if (res.ok && active) setEdges((await res.json()).edges);
      } catch { /* keep last known state */ }
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => { active = false; clearInterval(id); };
  }, [intervalMs]);
  return edges;
}
```

### Animated edge

```tsx
import { BaseEdge, getBezierPath, EdgeProps } from "@xyflow/react";

export function TrafficEdge(props: EdgeProps) {
  const [path] = getBezierPath(props);
  const { rps = 0, errorRate = 0 } = (props.data ?? {}) as Partial<EdgeStats>;

  const color =
    errorRate > 0.05 ? "#ef4444" :  // red: high errors
    errorRate > 0.01 ? "#f59e0b" :  // amber: some errors
    "#5eead4";                      // teal: healthy

  const dots = rps === 0 ? 0 : Math.min(6, Math.ceil(rps / 10));
  const dur = Math.max(0.8, 3 - Math.log10(rps + 1)); // more traffic = faster

  return (
    <>
      <BaseEdge
        path={path}
        style={{ stroke: color, strokeOpacity: rps ? 0.8 : 0.15, strokeDasharray: "4 4" }}
      />
      {Array.from({ length: dots }).map((_, i) => (
        <circle key={i} r={3} fill={color}>
          <animateMotion
            dur={`${dur}s`}
            begin={`${(i * dur) / dots}s`}
            repeatCount="indefinite"
            path={path}
          />
        </circle>
      ))}
    </>
  );
}
```

### Graph component

```tsx
import { ReactFlow, Background, Controls } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

const nodes = [
  { id: "frontend",  position: { x: 0,   y: 150 }, data: { label: "Frontend" } },
  { id: "backend",   position: { x: 250, y: 150 }, data: { label: "Backend API" } },
  { id: "service-a", position: { x: 500, y: 40 },  data: { label: "Service A" } },
  { id: "service-b", position: { x: 500, y: 260 }, data: { label: "Service B" } },
  { id: "service-c", position: { x: 750, y: 260 }, data: { label: "Service C" } },
];

export function TrafficMap() {
  const stats = useTraffic();
  const edges = stats.map((s) => ({
    id: `${s.source}-${s.target}`,
    source: s.source,
    target: s.target,
    type: "traffic",
    data: s,
    label: s.rps ? `${s.rps.toFixed(1)} rps | ${s.avgMs.toFixed(0)} ms` : "",
  }));

  return (
    <div style={{ height: 600 }}>
      <ReactFlow nodes={nodes} edges={edges} edgeTypes={{ traffic: TrafficEdge }} fitView>
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
```

### Visual enhancements

- **Custom nodes:** icon, name, status dot, and a badge with the total inbound rps.
- **Idle state:** dim nodes and edges with no traffic in the current window.
- **Detail panel:** on node or edge click, show a small history chart. Keep the last N snapshots in frontend state to build it without any backend storage.
- **Highlighting:** on node hover, emphasize its connected edges and fade the rest.

---

## 7. Security Checklist

- Protect `/api/traffic` with the same authentication and authorization as the rest of the admin UI. A topology map is useful reconnaissance for an attacker.
- Keep `/internal/traffic` endpoints off the public network. Require mTLS or network policy restrictions.
- Record metadata only. Do not put payloads, user IDs, tokens, secrets, or key identifiers into edge labels or stats.
- Keep the label set small and fixed (service IDs only) to avoid unbounded memory growth.
- Exclude the dashboard's own polling from the counts.
- Rate-limit `/api/traffic` so the dashboard cannot be used to load the backend or fan out to internal services.

---

## 8. Limitations and Upgrade Paths

| Limitation | Impact | Upgrade path |
|---|---|---|
| In-memory stats | Reset on restart | Acceptable for a live view; add persistence only if history is required |
| Multiple replicas | Each replica only knows its own traffic | Have the backend query every replica, or move to a shared metrics store later |
| Polling | Slight delay and extra requests | Switch `/api/traffic` to Server-Sent Events (SSE) |
| Third-party services you cannot modify | No self-reporting | Count them from the caller side, or read their built-in metrics endpoint if one exists |

---

## 9. Implementation Order

1. Write the edge table (Section 2) and agree on service IDs.
2. Add the shared recorder library.
3. Add the inbound middleware to the public service.
4. Wrap every outbound client in every service.
5. Add `/internal/traffic` to internal services and `/api/traffic` to the backend.
6. Verify with `curl /api/traffic` while generating some load.
7. Build the frontend graph with static node positions.
8. Add the animated edge and color mapping.
9. Add custom nodes, the detail panel, and the security hardening.
