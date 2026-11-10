// Auth policy + crypto helpers. Pure: no DB, no HTTP.
import crypto from 'node:crypto';
import { post } from './crypto-client.mjs';

const JSON_CT = /^application\/json(\s*;\s*charset=utf-8)?$/i;
const DEFAULT_ORIGINS = 'http://127.0.0.1:8088,http://localhost:8088,http://localhost:5173';

export const TLP_ORDER = Object.freeze(['CLEAR', 'GREEN', 'AMBER', 'AMBER+STRICT', 'RED', 'RED+STRICT']);

export function tlpRank(tlp) {
  const i = TLP_ORDER.indexOf(tlp);
  if (i === -1) throw new Error('unknown tlp');
  return i;
}

const RAW = [
  ['jenderal-tni', 'Jenderal TNI', 'PATI', 'RED'],
  ['letnan-jenderal-tni', 'Letnan Jenderal TNI', 'PATI', 'RED'],
  ['mayor-jenderal-tni', 'Mayor Jenderal TNI', 'PATI', 'RED'],
  ['brigadir-jenderal-tni', 'Brigadir Jenderal TNI', 'PATI', 'RED'],
  ['kolonel', 'Kolonel', 'PAMEN', 'AMBER+STRICT'],
  ['letnan-kolonel', 'Letnan Kolonel', 'PAMEN', 'AMBER+STRICT'],
  ['mayor', 'Mayor', 'PAMEN', 'AMBER+STRICT'],
  ['kapten', 'Kapten', 'PAMA', 'AMBER'],
  ['letnan-satu', 'Letnan Satu', 'PAMA', 'AMBER'],
  ['letnan-dua', 'Letnan Dua', 'PAMA', 'AMBER'],
  ['pembantu-letnan-satu', 'Pembantu Letnan Satu', 'Bintara Tinggi', 'GREEN'],
  ['pembantu-letnan-dua', 'Pembantu Letnan Dua', 'Bintara Tinggi', 'GREEN'],
  ['sersan-mayor', 'Sersan Mayor', 'Bintara', 'CLEAR'],
  ['sersan-kepala', 'Sersan Kepala', 'Bintara', 'CLEAR'],
  ['sersan-satu', 'Sersan Satu', 'Bintara', 'CLEAR'],
  ['sersan-dua', 'Sersan Dua', 'Bintara', 'CLEAR'],
  ['kopral-kepala', 'Kopral Kepala', 'Tamtama Kepala', 'CLEAR'],
  ['kopral-satu', 'Kopral Satu', 'Tamtama Kepala', 'CLEAR'],
  ['kopral-dua', 'Kopral Dua', 'Tamtama Kepala', 'CLEAR'],
  ['prajurit-kepala', 'Prajurit Kepala', 'Tamtama', 'CLEAR'],
  ['prajurit-satu', 'Prajurit Satu', 'Tamtama', 'CLEAR'],
  ['prajurit-dua', 'Prajurit Dua', 'Tamtama', 'CLEAR'],
];
export const RANKS = Object.freeze(
  RAW.map(([code, name, golongan, tlpMax], sort) => Object.freeze({ code, name, golongan, tlpMax, sort })),
);

export function rankByCode(code) {
  return RANKS.find((r) => r.code === code) ?? null;
}

const TIER = {
  Tamtama: 'TAMTAMA',
  'Tamtama Kepala': 'TAMTAMA',
  Bintara: 'BINTARA',
  'Bintara Tinggi': 'BINTARA_TINGGI',
  PAMA: 'PAMA',
  PAMEN: 'PAMEN',
  PATI: 'PATI',
};
export function tierOf(golongan) {
  return Object.hasOwn(TIER, golongan) ? TIER[golongan] : null;
}

// Grants per tier. Anything not listed is false.
const GRANTS = {
  TAMTAMA: { upload: ['c'], document: ['r'], asset: ['r'] },
  BINTARA: { upload: ['c'], document: ['r'], asset: ['r', 'uOwn'] },
  BINTARA_TINGGI: { upload: ['c'], document: ['r'], asset: ['r', 'uOwn'] },
  PAMA: { upload: ['c', 'r'], document: ['c', 'r', 'u', 'uDraftOnly'], asset: ['c', 'r', 'u'] },
  PAMEN: {
    upload: ['c', 'r', 'u', 'd'],
    document: ['c', 'r', 'u', 'approve'],
    asset: ['c', 'r', 'u', 'd'],
    account: ['r'],
    version: ['c'],
  },
  PATI: {
    upload: ['c', 'r', 'u', 'd'],
    document: ['c', 'r', 'u', 'approve', 'd'],
    asset: ['c', 'r', 'u', 'd'],
    account: ['c', 'r', 'u', 'd'],
    version: ['c'],
    audit: ['purge'],
  },
};

export function can(rankCode, accessLevel, securityOfficer = false, superAdmin = false) {
  const rank = rankByCode(rankCode);
  const L = accessLevel;
  const so = securityOfficer === true;
  const sa = superAdmin === true && L === 5;
  const p = {
    upload: { c: false, r: false, u: false, d: false },
    document: { c: false, r: false, u: false, approve: false, d: false, uDraftOnly: false },
    asset: { c: false, r: false, u: false, uOwn: false, d: false },
    account: { c: false, r: false, u: false, d: false },
    version: { c: false },
    audit: { purge: false },
    access: { grant: L === 5 || sa, request: L === 5 || so || sa, approve: L === 5 || so || sa, revoke: L === 5 || so || sa },
  };
  const grants = rank ? GRANTS[tierOf(rank.golongan)] : undefined;
  for (const [res, ops] of Object.entries(grants ?? {})) for (const op of ops) p[res][op] = true;
  if (sa) p.audit.purge = true;
  return p;
}

// Level L reads TLP index <= min(L, 4), i.e. up to RED. RED+STRICT (index 5) is unreachable by level, even for 5.
// Only a grant (ctx.granted / grantedIds) opens it. Missing/invalid level or unknown TLP -> false.
export function canReadLevel(level, tlp) {
  if (!Number.isInteger(level) || level < 1 || level > 5) return false;
  const i = TLP_ORDER.indexOf(tlp);
  return i !== -1 && i <= Math.min(level, 4);
}

// Who may approve/revoke access requests. Commander (level 5) first, then security officer.
export function approverRole({ accessLevel, securityOfficer, superAdmin } = {}, taken = []) {
  if (superAdmin === true && accessLevel === 5) return taken.includes('commander') && !taken.includes('security_officer') ? 'security_officer' : 'commander';
  if (accessLevel === 5) return 'commander';
  if (securityOfficer === true) return 'security_officer';
  return null;
}

const ACTIONS = new Set([
  'upload.c', 'upload.r', 'upload.u', 'upload.d',
  'document.c', 'document.r', 'document.u', 'document.approve', 'document.d',
  'asset.c', 'asset.r', 'asset.u', 'asset.d',
  'account.c', 'account.r', 'account.u', 'account.d',
  'version.c',
]);

// Write ceiling. Doc TLP: level read OR active grant on that doc (ctx.granted). New TLP: level only.
// Unknown or missing TLP or level fails closed.
function ceilingOk(c, tlp, newTlp = false) {
  if (canReadLevel(c.accessLevel, tlp)) return true;
  return !newTlp && c.granted === true && TLP_ORDER.includes(tlp);
}

export function authorize(rankCode, action, ctx = {}) {
  const rank = rankByCode(rankCode);
  if (!rank || !ACTIONS.has(action)) return false;
  const c = ctx ?? {};
  const tier = tierOf(rank.golongan);
  const [res, op] = action.split('.');
  const p = can(rankCode, c.accessLevel);

  if (action === 'asset.u' && !p.asset.u) {
    return (
      p.asset.uOwn &&
      c.assetOwner !== undefined &&
      !!c.actorOwnerLabel &&
      c.assetOwner === c.actorOwnerLabel &&
      c.changesOwner !== true
    );
  }
  if (action === 'version.c') {
    const allowed = p.version.c || (tier === 'PAMA' && c.docStatus === 'draft');
    return allowed && ceilingOk(c, c.docTlp);
  }
  if (!p[res][op]) return false;
  if (action === 'document.u' && tier === 'PAMA' && c.docStatus !== 'draft') return false;
  if (action === 'document.approve') return ceilingOk(c, c.docTlp);
  if (action === 'document.d') return ceilingOk(c, c.docTlp);
  if (action === 'document.c' || action === 'document.u') {
    if (c.docTlp !== undefined && !ceilingOk(c, c.docTlp)) return false;
    if (action === 'document.c' && (!TLP_ORDER.includes(c.newTlp) || !ceilingOk(c, c.newTlp, true))) return false;
    if (action !== 'document.c' && c.newTlp !== undefined && !ceilingOk(c, c.newTlp, true)) return false;
  }
  return true;
}

// ponytail: HMAC only, no slow KDF; strength rests on the keyd HMAC key. Add scrypt/argon2 before HMAC if the key could leak.
// Format: hmac$<salt b64>$<crypto-api /hmac Value>. Message = salt:plain.
export async function hashPassword(plain) {
  const saltB64 = crypto.randomBytes(16).toString('base64');
  const r = await post('/hmac', { Message: `${saltB64}:${plain}` });
  if (r.status !== 200) throw new Error('crypto /hmac ' + r.status);
  return `hmac$${saltB64}$${r.json.Value}`;
}

export async function verifyPassword(plain, stored) {
  try {
    const parts = String(stored).split('$');
    if (parts.length !== 3 || parts[0] !== 'hmac') return false;
    if (!Buffer.from(parts[1], 'base64').length) return false;
    if (!(parts[2].startsWith('skadut-t1:') || parts[2].startsWith('t1:'))) return false;
    const res = await post('/verifyhmac', { Message: `${parts[1]}:${plain}`, HMACstring: parts[2] });
    return res.status === 200 && res.json.Value === true;
  } catch {
    return false;
  }
}

// Unknown-user path: one crypto round trip, same as a real verify.
export async function dummyVerify(plain) {
  try {
    const saltB64 = crypto.randomBytes(16).toString('base64');
    await post('/verifyhmac', { Message: `${saltB64}:${plain}`, HMACstring: 'skadut-t1:' + 'x'.repeat(16) + ':AA==' });
  } catch {}
  return false;
}

export const SESSION_TTL_MS = 30 * 60 * 1000;
export const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
// ponytail: static demo OTP; real TOTP (RFC 6238, ±1 step, replay reject, HSM-wrapped secret) moves to crypto-service later
export const DEMO_OTP = '123456';

// Exact 6 digits, constant-time compare against DEMO_OTP.
export function isDemoOtp(code) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return false;
  return crypto.timingSafeEqual(Buffer.from(code), Buffer.from(DEMO_OTP));
}

// Step-1 challenge store. Single-use via consume(); expires after ttlMs.
// ponytail: in-memory challenge store; move to DB/Redis when multi-instance
export function createChallengeStore({ now = Date.now, ttlMs = 2 * 60 * 1000 } = {}) {
  const challenges = new Map();
  return {
    create(userId) {
      const challenge = crypto.randomBytes(32).toString('base64url');
      challenges.set(challenge, { userId, expiresAt: now() + ttlMs });
      return challenge;
    },
    get(token) {
      const item = challenges.get(token);
      if (!item) return null;
      if (item.expiresAt <= now()) {
        challenges.delete(token);
        return null;
      }
      return item;
    },
    consume(token) {
      return challenges.delete(token);
    },
  };
}

export function newSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}
export function hashSessionToken(tok) {
  return crypto.createHash('sha256').update(tok).digest('hex');
}

// ponytail: prunes per key on access only; keys never touched again stay in memory. Add a sweep if abuse-prone.
export function createLoginLimiter({ max = 5, windowMs = 5 * 60 * 1000, now = Date.now } = {}) {
  const fails = new Map();
  const recent = (key) => {
    const t = now();
    const list = (fails.get(key) ?? []).filter((at) => t - at < windowMs);
    if (list.length) fails.set(key, list);
    else fails.delete(key);
    return list;
  };
  return {
    isLimited: (key) => recent(key).length >= max,
    recordFailure: (key) => {
      const list = recent(key);
      list.push(now());
      fails.set(key, list);
    },
    reset: (key) => {
      fails.delete(key);
    },
  };
}

export function checkWriteRequest(method, headers, allowedOrigins) {
  if (method === 'GET' || method === 'HEAD') return null;
  const origin = headers.origin;
  const ok = allowedOrigins instanceof Set ? allowedOrigins.has(origin) : allowedOrigins.includes(origin);
  if (!origin || !ok) return { status: 403, error: 'forbidden' };
  const cl = headers['content-length'];
  const hasBody = (cl !== undefined && cl !== '0') || headers['transfer-encoding'] !== undefined;
  if (hasBody && !JSON_CT.test(headers['content-type'] ?? '')) {
    return { status: 415, error: 'unsupported media type' };
  }
  return null;
}

export function parseAllowedOrigins(envString) {
  const list = (envString ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return new Set(list.length ? list : DEFAULT_ORIGINS.split(','));
}
