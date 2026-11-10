import { keepPreviousData, useQuery } from '@tanstack/react-query'

export type DbColumn = { name: string; type: string }
export type DbTableInfo = { name: string; rowCount: number; columns: DbColumn[] }
export type DbTablesResponse = { tables: DbTableInfo[] }
export type DbTableResponse = {
  table: string
  columns: DbColumn[]
  rows: unknown[][]
  total: number
  limit: number
  offset: number
}

export class DbError extends Error {
  status: number
  constructor(status: number) {
    super(`HTTP ${status}`)
    this.name = 'DbError'
    this.status = status
  }
}

// Same fetch shape as features/traffic/use-traffic.ts. Throws DbError so callers can read status.
async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) throw new DbError(res.status)
  return (await res.json()) as T
}

export function useDbTables() {
  return useQuery({
    queryKey: ['db', 'tables'],
    queryFn: () => getJson<DbTablesResponse>('/api/db/tables'),
    retry: false,
  })
}

export function useDbTable(name: string, limit: number, offset: number) {
  return useQuery({
    queryKey: ['db', 'table', name, limit, offset],
    queryFn: () =>
      getJson<DbTableResponse>(
        `/api/db/tables/${encodeURIComponent(name)}?limit=${limit}&offset=${offset}`
      ),
    enabled: name !== '',
    retry: false,
    placeholderData: keepPreviousData,
  })
}
