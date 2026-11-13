// Read-only DB view helpers. Pure: no DB calls, no imports.

// ponytail: string cells cut at 300 chars, no per-cell or full-value fetch. Upgrade: per-cell "show full" endpoint or configurable limit.
const MAX_CELL = 300;
export function truncate(v) {
  if (typeof v !== 'string' || v.length <= MAX_CELL) return v;
  return `${v.slice(0, MAX_CELL)}… (${v.length} chars)`;
}

const CREDENTIAL_COL = /password|totp|secret/i;
export const isCredentialColumn = (name) => CREDENTIAL_COL.test(String(name));
export function maskCell(colName, value) {
  if (value === null) return null;
  return isCredentialColumn(colName) ? '[DISEMBUNYIKAN]' : value;
}

export const quoteIdent =(name) => '"' + String(name).replace(/"/g, '""') + '"';

export function clampLimit(v) {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? 50 : Math.min(200, Math.max(1, n));
}

export function clampOffset(v) {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? 0 : Math.max(0, n);
}

export function resolveTable(name, tableNames) {
  return tableNames.includes(name) ? name : null;
}

export function buildSelectSql(table, columns, pkColumn, limit, offset) {
  const cols = columns.map((c) => quoteIdent(c.name)).join(', ');
  const pk = columns.find((c) => c.name === pkColumn);
  const order = pk ? ` ORDER BY ${quoteIdent(pk.name)}` : '';
  return `SELECT ${cols} FROM public.${quoteIdent(table)}${order} LIMIT $1 OFFSET $2`;
}
