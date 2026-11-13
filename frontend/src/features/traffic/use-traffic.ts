import { useEffect, useState } from 'react'
import {
  HISTORY_MAX,
  mergeHistory,
  parseHistory,
  parseTraffic,
  pushHistory,
  type HistoryPoint,
  type TrafficResponse,
} from './graph'

export type TrafficState = {
  data: TrafficResponse | null
  history: HistoryPoint[]
  error: boolean
  forbidden: boolean
  loading: boolean
  historyAvailable: boolean | null
}

// Polls /api/traffic. Pauses while the tab is hidden. Keeps last good data on error.
export function useTraffic(intervalMs = 2000): TrafficState {
  const [data, setData] = useState<TrafficResponse | null>(null)
  const [history, setHistory] = useState<HistoryPoint[]>([])
  const [error, setError] = useState(false)
  const [forbidden, setForbidden] = useState(false)
  const [historyAvailable, setHistoryAvailable] = useState<boolean | null>(null)

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const to = Math.floor(Date.now() / 1000)
    const from = to - 3600
    const url = `/api/traffic/history?from=${encodeURIComponent(new Date(from * 1000).toISOString())}&to=${encodeURIComponent(new Date(to * 1000).toISOString())}&bucket=60`

    fetch(url, { credentials: 'include', signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((json) => {
        if (!active) return
        const parsed = parseHistory(json)
        if (parsed && parsed.points.length > 0) {
          setHistory((prev) => mergeHistory(prev, parsed.points, HISTORY_MAX))
          setHistoryAvailable(true)
        } else {
          setHistoryAvailable(false)
        }
      })
      .catch((err) => {
        if (!active || (err instanceof DOMException && err.name === 'AbortError')) return
        setHistoryAvailable(false)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [])

  useEffect(() => {
    let active = true
    let inFlight = false
    let denied = false
    let controller: AbortController | null = null
    const tick = async () => {
      if (denied || inFlight || document.visibilityState === 'hidden') return
      inFlight = true
      controller = new AbortController()
      try {
        const res = await fetch('/api/traffic', { credentials: 'include', signal: controller.signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const parsed = parseTraffic(await res.json())
        if (!parsed) throw new Error('bad payload')
        if (!active) return
        setData(parsed)
        setHistory((h) =>
          pushHistory(h, { ts: parsed.ts, edges: parsed.edges }, HISTORY_MAX)
        )
        setError(false)
      } catch (err) {
        if (!active || (err instanceof DOMException && err.name === 'AbortError')) return
        if (err instanceof Error && err.message === 'HTTP 403') {
          denied = true
          if (active) setForbidden(true)
        }
        if (active) setError(true)
      } finally {
        inFlight = false
        controller = null
      }
    }
    void tick()
    const id = setInterval(() => void tick(), intervalMs)
    const onVis = () => {
      if (document.visibilityState === 'visible') void tick()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      active = false
      controller?.abort()
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [intervalMs])

  return { data, history, error, forbidden, loading: data === null && !error, historyAvailable }
}
