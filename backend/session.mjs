// Session cookie, DB session lookup, /api/me shape. DB access via injected `q(sql, params)` (pool.query-compatible).
import { rankByCode, can, authorize, newSessionToken, hashSessionToken, SESSION_TTL_MS, IDLE_TIMEOUT_MS, TLP_ORDER } from './auth.mjs';

export const SID = 'sid';
const TOKEN = /^[A-Za-z0-9_-]{43}$/; // base64url of 32 random bytes

export function parseSid(cookieHeader) {
  if (typeof cookieHeader !== 'string') return null;
  for (const part of cookieHeader.split(';')) {
    const i = part.indexOf('=');
    if (i === -1 || part.slice(0, i).trim() !== SID) continue;
    const v = part.slice(i + 1).trim();
    return TOKEN.test(v) ? v : null;
  }
  return null;
}

export const sidSetCookie = (token) =>
  `${SID}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`;
export const sidClearCookie = `${SID}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;

export function meFromRow(row) {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    rankCode: row.rank_code,
    ownerLabel: row.owner_label ?? null,
    accessLevel: Number(row.access_level),
    securityOfficer: row.security_officer === true,
    superAdmin: row.super_admin === true && row.access_level === 5,
    unit: row.unit ?? null,
    unitHead: row.unit_head === true,
    preferences: row.preferences ?? {},
  };
}

// Shape of GET /api/me and POST /api/login response `user`.
export function meJson(me) {
  const rank = rankByCode(me.rankCode);
  const { version, ...perms } = can(me.rankCode, me.accessLevel, me.securityOfficer, me.superAdmin); // version.c is internal, not exposed
  const canDocTlp = (tlp) => authorize(me.rankCode, 'document.c', { accessLevel: me.accessLevel, docTlp: tlp, newTlp: tlp });
  const docCreateMaxTlp = [...TLP_ORDER].reverse().find(canDocTlp) ?? null;
  const assetPerms = can(me.rankCode, me.accessLevel).asset;
  const canAsset = (op) => Boolean(assetPerms?.[op]) && me.accessLevel >= 4;
  return {
    id: me.id,
    username: me.username,
    name: me.name,
    rank: rank.code,
    rankName: rank.name,
    golongan: rank.golongan,
    accessLevel: me.accessLevel,
    // Derived from level now. Invalid level -> undefined (fails closed in canReadLevel).
    tlpMax: Number.isInteger(me.accessLevel) ? TLP_ORDER[Math.min(me.accessLevel, 4)] : undefined,
    securityOfficer: me.securityOfficer === true,
    superAdmin: me.superAdmin === true,
    unit: me.unit ?? null,
    unitHead: me.unitHead === true,
    ownerLabel: me.ownerLabel,
    preferences: me.preferences ?? {},
    can: perms,
    permissions: {
      canCreateDocument: docCreateMaxTlp !== null,
      docCreateMaxTlp,
      canWriteAssets: { c: canAsset('c'), u: canAsset('u'), d: canAsset('d') },
    },
  };
}

// Hard limit (expires_at, 30 min from creation) and idle lock (last_seen older than IDLE_TIMEOUT_MS) both enforced here.
const LOOKUP_SQL = `SELECT u.id, u.username, u.name, u.rank_code, u.owner_label, u.access_level, u.security_officer, u.super_admin, u.unit, u.unit_head, u.preferences
  FROM sessions s JOIN users u ON u.id = s.user_id
  WHERE s.token_hash = $1 AND s.expires_at > now() AND s.last_seen > now() - ($2::int * interval '1 second') AND u.active`;

export async function lookupSession(q, cookieHeader) {
  const tok = parseSid(cookieHeader);
  if (!tok) return null;
  const hash = hashSessionToken(tok);
  const { rows } = await q(LOOKUP_SQL, [hash, IDLE_TIMEOUT_MS / 1000]);
  if (!rows[0]) return null;
  // Sliding idle window: every authenticated request refreshes last_seen.
  await q('UPDATE sessions SET last_seen = now() WHERE token_hash = $1', [hash]);
  return meFromRow(rows[0]);
}

export async function createSession(q, userId) {
  const token = newSessionToken();
  await q(
    "INSERT INTO sessions (token_hash, user_id, expires_at, last_seen) VALUES ($1, $2, now() + ($3::int * interval '1 second'), now())",
    [hashSessionToken(token), userId, SESSION_TTL_MS / 1000],
  );
  return token;
}

export async function destroySession(q, cookieHeader) {
  const tok = parseSid(cookieHeader);
  if (tok) await q('DELETE FROM sessions WHERE token_hash = $1', [hashSessionToken(tok)]);
}

export const DEFAULT_PREFERENCES = Object.freeze({
  theme: 'system', font: 'sans', dir: 'ltr',
  layout: Object.freeze({ variant: 'inset', collapsible: true, sidebarOpen: true }),
  notifications: Object.freeze({ type: 'all', mobile: false, communication_emails: false, social_emails: true, marketing_emails: false, security_emails: true }),
  display: Object.freeze({ items: Object.freeze(['recents', 'home']) }),
});
export const PREFERENCE_KEYS = Object.freeze(['theme', 'font', 'dir', 'layout', 'notifications', 'display']);
export const mergePreferences = (saved = {}) => ({ ...DEFAULT_PREFERENCES, ...(saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}) });
export function validatePreferencesPatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'bad request';
  if (Object.keys(value).some((key) => !PREFERENCE_KEYS.includes(key))) return 'bad request';
  if (value.theme !== undefined && !['light', 'dark', 'system'].includes(value.theme)) return 'bad request';
  if (value.font !== undefined && !['sans', 'mono'].includes(value.font)) return 'bad request';
  if (value.dir !== undefined && !['ltr', 'rtl'].includes(value.dir)) return 'bad request';
  return null;
}
export const preferencesBodyTooLarge = (raw) => raw.length > 8 * 1024;

export async function readPreferences(q, userId) {
  const { rows } = await q('SELECT preferences FROM users WHERE id = $1', [userId]);
  return rows[0]?.preferences ?? {};
}
export async function patchPreferences(q, userId, patch) {
  const { rows } = await q('UPDATE users SET preferences = preferences || $1::jsonb WHERE id = $2 RETURNING preferences', [JSON.stringify(patch), userId]);
  return rows[0]?.preferences ?? null;
}
export function missingPreferencesColumn(err) {
  return err?.code === '42703' && /preferences/i.test(err.message ?? '');
}

export async function updatePreferences(q, userId, preferences) {
  const { rows } = await q('UPDATE users SET preferences = $2::jsonb WHERE id = $1 RETURNING preferences', [userId, JSON.stringify(preferences)]);
  return rows[0]?.preferences ?? null;
}

export async function findLoginUser(q, username) {
  const { rows } = await q(
    'SELECT id, username, name, rank_code, owner_label, access_level, security_officer, super_admin, unit, unit_head, password_hash, active, locked_until, last_login_at, failed_since_last FROM users WHERE username = $1',
    [username],
  );
  return rows[0] ?? null;
}
