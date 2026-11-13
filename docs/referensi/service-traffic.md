# Panduan visualisasi lalu lintas layanan

Panduan umum untuk membangun peta lalu lintas antar layanan yang hidup dan beranimasi tanpa menambah infrastruktur baru. Layanan yang ada mencatat lalu lintasnya sendiri di memori, satu layanan mengekspos data agregat, dan frontend mengambil lalu merendernya sebagai graph node interaktif.

Untuk penerapan di proyek ini, lihat [desain keamanan](../keamanan/desain-keamanan.md#lalu-lintas-layanan) dan [run.md](../operasi/run.md).

---

## 1. Ringkasan

### Tujuan

Tampilkan setiap layanan sebagai node dan setiap jalur komunikasi sebagai edge beranimasi. Setiap edge menunjukkan metrik live seperti request rate, error rate, dan latensi.

### Prinsip

- **Tanpa layanan baru.** Tanpa Prometheus, tanpa collector, tanpa agregator terpisah. Hanya library dan endpoint di dalam layanan yang ada.
- **Pengirim yang menghitung.** Setiap edge dicatat oleh layanan yang memulai request.
- **Satu titik masuk publik.** Frontend hanya berbicara ke satu layanan (biasanya API backend). Layanan internal tetap tidak diekspos.
- **Hanya metadata.** Catat jumlah, durasi, dan status code. Jangan pernah mencatat payload, token, atau material kunci.

### Arsitektur

```
Frontend ──(normal requests)──► Backend API ──► Service A
    ▲                               │
    │                               └──► Service B ──► Service C
    │                                        │
    └── GET /api/traffic ◄── Backend merges ◄┘ (Service B's own stats)
```

---

## 2. Definisikan model graph

Sebelum menulis kode, daftar setiap edge yang diharapkan dan putuskan layanan mana yang mencatatnya.

| Sumber | Target | Protokol | Dicatat oleh |
|---|---|---|---|
| frontend | backend | HTTPS | backend (middleware inbound) |
| backend | service-a | HTTP / SQL / gRPC | backend (wrapper outbound) |
| backend | service-b | HTTP / gRPC | backend (wrapper outbound) |
| service-b | service-c | HTTP | service-b (wrapper outbound) |

Pakai ID layanan huruf kecil yang stabil. ID yang sama harus dipakai di recorder backend dan di daftar node frontend.

### Metrik per edge

| Metrik | Deskripsi | Pemetaan visual |
|---|---|---|
| `rps` | Request per detik pada jendela geser | Jumlah atau kecepatan partikel bergerak |
| `errorRate` | Request gagal / total request | Warna edge |
| `avgMs` (atau p95) | Latensi rata-rata atau persentil | Label atau lebar stroke |

---

## 3. Catat lalu lintas di memori

Buat library bersama kecil (bukan service) yang diimpor setiap layanan peserta. Library menyimpan bucket per detik untuk setiap edge dan menghitung statistik pada jendela geser.

### Contoh (Go)

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

Jendela 10 detik (`NewRecorder(10 * time.Second)`) memberi graph yang responsif dan terasa live. Pakai jendela lebih panjang untuk angka yang lebih halus.

### Bahasa lain

Desain yang sama bekerja di mana saja: map yang dilindungi mutex dengan bentuk `edge -> second -> {count, errors, totalMs}`, fungsi `record()`, dan fungsi `snapshot()` yang memangkas bucket lama.

---

## 4. Hubungkan ke panggilan yang ada

### Inbound (layanan publik menghitung lalu lintas frontend)

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

### HTTP outbound (layanan mana pun yang memanggil layanan lain)

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

### Outbound non-HTTP (driver SQL, gRPC, message queue)

Bungkus langsung di call site:

```go
start := time.Now()
err := repo.Query(ctx, ...)
rec.Record("backend", "service-a", time.Since(start), err != nil)
```

Untuk gRPC, pakai unary client interceptor dengan logika yang sama.

---

## 5. Ekspos dan gabungkan statistik

### Layanan internal

Setiap layanan internal yang mencatat edge mengekspos snapshot-nya di endpoint khusus internal.

```go
mux.HandleFunc("/internal/traffic", func(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(rec.Snapshot())
})
```

Batasi endpoint ini ke jaringan internal atau wajibkan mTLS dari backend.

### Layanan publik (titik agregasi)

Backend menggabungkan snapshot-nya sendiri dengan snapshot setiap layanan internal dan mengembalikan satu respons.

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

### Bentuk respons

```json
{
  "ts": 1793030000,
  "edges": [
    { "source": "frontend", "target": "backend", "rps": 12.4, "errorRate": 0.0, "avgMs": 35 },
    { "source": "backend", "target": "service-b", "rps": 8.1, "errorRate": 0.012, "avgMs": 18 }
  ]
}
```

### Kesehatan node (opsional)

Jika panggilan `/internal/traffic` gagal, sertakan layanan itu dalam daftar `down` pada respons agar frontend dapat menandai node merah.

---

## 6. Render di frontend

Contoh ini memakai React Flow (`npm i @xyflow/react`). Konsep yang sama berlaku untuk D3, Cytoscape.js, atau SVG biasa.

### Ambil data

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

### Edge beranimasi

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

### Komponen graph

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

### Peningkatan visual

- **Node khusus:** ikon, nama, titik status, dan badge berisi total rps masuk.
- **Keadaan idle:** redupkan node dan edge tanpa lalu lintas pada jendela saat ini.
- **Panel detail:** saat node atau edge diklik, tampilkan grafik riwayat kecil. Simpan N snapshot terakhir di state frontend untuk membangunnya tanpa penyimpanan backend.
- **Penyorotan:** saat node di-hover, tegaskan edge yang terhubung dan redupkan sisanya.

---

## 7. Checklist keamanan

- Lindungi `/api/traffic` dengan autentikasi dan otorisasi yang sama dengan sisa UI admin. Peta topologi berguna untuk reconnaissance penyerang.
- Jauhkan endpoint `/internal/traffic` dari jaringan publik. Wajibkan mTLS atau pembatasan network policy.
- Catat metadata saja. Jangan menaruh payload, user ID, token, secret, atau identifier kunci ke label edge atau statistik.
- Jaga set label tetap kecil dan tetap (hanya ID layanan) untuk menghindari pertumbuhan memori tanpa batas.
- Kecualikan polling dashboard sendiri dari hitungan.
- Rate-limit `/api/traffic` agar dashboard tidak dapat dipakai untuk membebani backend atau membanjiri layanan internal.

---

## 8. Batasan dan jalur peningkatan

| Batasan | Dampak | Jalur peningkatan |
|---|---|---|
| Statistik di memori | Reset saat restart | Dapat diterima untuk tampilan live; tambahkan persistensi hanya jika riwayat dibutuhkan |
| Beberapa replika | Setiap replika hanya tahu lalu lintasnya sendiri | Buat backend menanyakan setiap replika, atau pindah ke metrics store bersama nanti |
| Polling | Sedikit jeda dan request tambahan | Ganti `/api/traffic` ke Server-Sent Events (SSE) |
| Layanan pihak ketiga yang tidak dapat diubah | Tidak ada self-reporting | Hitung dari sisi pemanggil, atau baca endpoint metrik bawaan jika ada |

---

## 9. Urutan implementasi

1. Tulis tabel edge (bagian 2) dan sepakati ID layanan.
2. Tambah library recorder bersama.
3. Tambah middleware inbound ke layanan publik.
4. Bungkus setiap client outbound di setiap layanan.
5. Tambah `/internal/traffic` ke layanan internal dan `/api/traffic` ke backend.
6. Verifikasi dengan `curl /api/traffic` sambil menghasilkan beban.
7. Bangun graph frontend dengan posisi node statis.
8. Tambah edge beranimasi dan pemetaan warna.
9. Tambah node khusus, panel detail, dan pengerasan keamanan.
