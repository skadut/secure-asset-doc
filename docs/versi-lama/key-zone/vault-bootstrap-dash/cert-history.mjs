import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT = process.env.CERT_HISTORY_FILE || '/dash-data/certs-history.jsonl';
const SNAP = ['id', 'role', 'cn', 'subjectDN', 'issuerDN', 'serial', 'fingerprint256', 'notBefore', 'notAfter', 'publicKey', 'privateKeyState'];
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const pick = (o, keys) => clean(Object.fromEntries(keys.map((k) => [k, o[k]])));
const ts = (s) => Date.parse(s) || 0;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));

async function loadHistory(file) {
  let text;
  try { text = await fs.readFile(file, 'utf8'); }
  catch (err) { if (err.code === 'ENOENT') return []; throw err; }
  const out = [];
  for (const line of text.split('\n')) {
    try { const v = JSON.parse(line); if (isObj(v)) out.push(v); } catch {}
  }
  return out;
}

const snapOf = (c) => clean({
  id: c.id, role: c.role, cn: c.cn, subjectDN: c.subjectDN, issuerDN: c.issuerDN, serial: c.serial,
  fingerprint256: c.fingerprint256, notBefore: c.notBefore, notAfter: c.notAfter,
  publicKey: c.publicKey && pick(c.publicKey, ['type', 'bits', 'curve']),
  privateKeyState: c.privateKey?.state,
});

let chain = Promise.resolve();
// Serialize writers: concurrent calls would otherwise read the same history and append duplicate events.
export function recordCerts(certs, opts) {
  const p = chain.then(() => doRecord(certs, opts));
  chain = p.catch(() => {});
  return p;
}

async function doRecord(certs, { file = DEFAULT, now = Date.now() } = {}) {
  const history = await loadHistory(file);
  const nowIso = new Date(now).toISOString();
  const done = new Set(history.map((l) => `${l.event}|${l.fingerprint256}`));
  const snaps = new Map(); // fp -> issued snapshot
  const latest = new Map(); // cert id -> fp of last issued line, pre-run only
  for (const l of history) {
    if (l.event !== 'issued') continue;
    snaps.set(l.fingerprint256, pick(l, SNAP));
    latest.set(l.id, l.fingerprint256);
  }
  const out = [];
  const emit = (event, fp, fields) => {
    const key = `${event}|${fp}`;
    if (done.has(key)) return;
    done.add(key);
    out.push(clean({ ...fields, event, observedAt: nowIso }));
  };

  for (const c of certs) {
    if (!c.fingerprint256) continue;
    const snap = snapOf(c);
    if (!snaps.has(c.fingerprint256)) snaps.set(c.fingerprint256, snap);
    emit('issued', c.fingerprint256, { ...snap, at: c.notBefore ?? nowIso });
  }
  for (const c of certs) {
    if (c.isCA !== true || !c.fingerprint256 || !String(c.privateKey?.state ?? '').startsWith('Destroyed')) continue;
    emit('private-key-destroyed', c.fingerprint256, {
      ...snapOf(c), at: c.notBefore ?? nowIso, inferred: true,
      note: 'vault-certs deletes the CA key immediately after signing; exact time = issuance run',
    });
  }
  for (const c of certs) {
    const prev = latest.get(c.id);
    if (c.status === 'unavailable' || !c.fingerprint256 || !prev || prev === c.fingerprint256 || !snaps.has(prev)) continue;
    emit('replaced', prev, { ...snaps.get(prev), at: nowIso, replacedBy: c.fingerprint256 });
  }
  for (const [fp, s] of snaps) {
    if (Date.parse(s.notAfter) < now) emit('expired', fp, { ...s, at: s.notAfter });
  }

  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  if (out.length) await fs.appendFile(file, out.map((l) => JSON.stringify(l) + '\n').join(''), { mode: 0o600 });
}

export async function readCertHistory({ file = DEFAULT, limit = 200, now = Date.now() } = {}) {
  const history = await loadHistory(file);
  const events = [...history].sort((a, b) => ts(b.at) - ts(a.at)).slice(0, limit);
  const replaced = new Set(history.filter((l) => l.event === 'replaced').map((l) => l.fingerprint256));
  const inv = new Map();
  for (const l of history) {
    const fp = l.fingerprint256;
    if (typeof fp !== 'string') continue;
    const prev = inv.get(fp) ?? {};
    const firstSeen = typeof l.observedAt === 'string' && (!prev.firstSeen || l.observedAt < prev.firstSeen) ? l.observedAt : prev.firstSeen;
    const lastEventAt = ts(l.at) >= ts(prev.lastEventAt) ? l.at : prev.lastEventAt;
    inv.set(fp, clean({
      fingerprint256: fp, id: l.id, role: l.role, cn: l.cn, serial: l.serial, notAfter: l.notAfter,
      publicKey: l.publicKey, privateKeyState: l.privateKeyState, firstSeen, lastEventAt,
    }));
  }
  const inventory = [...inv.values()]
    .map((e) => ({ ...e, state: replaced.has(e.fingerprint256) ? 'Replaced' : Date.parse(e.notAfter) < now ? 'Expired' : 'Current' }))
    .sort((a, b) => (b.firstSeen || '').localeCompare(a.firstSeen || ''));
  return { events, inventory };
}
