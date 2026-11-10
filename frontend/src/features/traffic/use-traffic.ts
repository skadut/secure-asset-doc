import { useEffect, useState } from 'react'
import { HISTORY_MAX, parseTraffic, pushHistory, type HistoryPoint, type TrafficResponse } from './graph'

export type TrafficState = {
  data: TrafficResponse | null
  history: HistoryPoint[]
  error: boolean
  loading: boolean
}

// Polls /api/traffic. Pauses while the tab is hidden. Keeps last good data on error.
export function useTraffic(intervalMs = 2000): TrafficState {
  const [data, setData] = useState<TrafficResponse | null>(null)
  const [history, setHistory] = useState<HistoryPoint[]>([])
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true
    let inFlight = false
    const tick = async () => {
      if (inFlight || document.visibilityState === 'hidden') return
      inFlight = true
      try {
        const res = await fetch('/api/traffic', { credentials: 'include' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const parsed = parseTraffic(await res.json())
        if (!parsed) throw new Error('bad payload')
        if (!active) return
        setData(parsed)
        setHistory((h) => pushHistory(h, { ts: parsed.ts, edges: parsed.edges }, HISTORY_MAX))
        setError(false)
      } catch {
        if (active) setError(true)
      } finally {
        inFlight = false
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
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [intervalMs])

  return { data, history, error, loading: data === null && !error }
}
