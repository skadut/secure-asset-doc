import fs from 'node:fs/promises';
import path from 'node:path';

let auditRoot = '/audit';
export function setAuditRoot(dir) { auditRoot = dir; }

const MAX_BYTES = 4 * 1024 * 1024;
const UNIT_MS = { s: 1000, m: 60000, h: 3600000 };

function parseTtl(ttl) {
  const m = /^(\d+)(s|m|h)$/.exec(ttl);
  return m ? Number(m[1]) * UNIT_MS[m[2]] : null;
}

function deactivateAt(time, ttlMs) {
  const t = Date.parse(time);
  return ttlMs == null || Number.isNaN(t) ? null : new Date(t + ttlMs).toISOString();
}

// Lines of the last MAX_BYTES of node's audit.log; [] on any error.
async function readNodeLines(node) {
  let fh;
  try {
    fh = await fs.open(path.join(auditRoot, node, 'audit.log'), 'r');
    const { size } = await fh.stat();
    const start = Math.max(0, size - MAX_BYTES);
    const from = start > 0 ? start - 1 : 0;
    const buf = Buffer.alloc(size - from);
    const { bytesRead } = await fh.read(buf, 0, buf.length, from);
    let text = buf.toString('utf8', 0, bytesRead);
    if (start > 0) {
      if (buf[0] === 0x0a) {
        text = buf.toString('utf8', 1, bytesRead);
      } else {
        const nl = text.indexOf('\n');
        if (nl < 0) return [];
        text = text.slice(nl + 1);
      }
    }
    return text.split('\n');
  } catch {
    return [];
  } finally {
    await fh?.close().catch(() => {});
  }
}

function classify(p, operation, ttl, time, ver) {
  let m;
  if ((m = /^transit\/datakey\/(wrapped|plaintext)\/(.+)$/.exec(p)))
    return { type: 'DEK', op: 'generate+wrap', keyId: m[2], nistState: 'Pre-activation→Active', note: `wrapped by KEK v${ver ?? '?'}; deactivates after TTL ${ttl}`, deactivatesAt: deactivateAt(time, parseTtl(ttl)) };
  if ((m = /^transit\/decrypt\/(.+)$/.exec(p)))
    return { type: 'DEK', op: 'unwrap', keyId: m[1], nistState: 'Active', note: 'KEK used to unwrap DEK' };
  if ((m = /^transit\/rewrap\/(.+)$/.exec(p)))
    return { type: 'DEK', op: 'rewrap', keyId: m[1], nistState: 'Active (rewrapped to latest KEK)' };
  if ((m = /^transit\/keys\/(.+)\/rotate$/.exec(p)))
    return { type: 'KEK', op: 'rotate', keyId: m[1], nistState: 'new version Active; previous → Deactivated (decrypt-only)' };
  if ((m = /^transit\/keys\/(.+)\/config$/.exec(p)))
    return { type: 'KEK', op: 'config', keyId: m[1] };
  if ((m = /^transit\/keys\/(.+)\/trim$/.exec(p)))
    return { type: 'KEK', op: 'trim', keyId: m[1], nistState: 'old versions → Destroyed' };
  if ((m = /^transit\/keys\/([^/]+)$/.exec(p))) {
    if (operation === 'update' || operation === 'create') return { type: 'KEK', op: 'generate', keyId: m[1], nistState: 'Pre-activation→Active' };
    if (operation === 'read') return { type: 'KEK', op: 'read-metadata', keyId: m[1] };
    return null;
  }
  if (/^transit\/export\/.+/.test(p)) return { type: 'KEK', op: 'export-attempt', keyId: p.split('/')[3] || null };
  if (/^sys\/rekey\//.test(p) && operation !== 'read') return { type: 'MSK', op: 'rekey' };
  if (p === 'sys/rotate') return { type: 'MSK', op: 'rotate-barrier-keyring', nistState: 'keyring term+1 Active; old term decrypt-only' };
  if (p === 'sys/seal') return { type: 'MSK', op: 'seal', nistState: 'Active→Suspended' };
  if (p === 'sys/init' && operation !== 'read') return { type: 'MSK', op: 'generate' };
  if (/^auth\/(cert|approle)\/login$/.test(p)) return { type: 'KEK', op: 'client-auth', note: 'crypto-module authenticated to Key Zone' };
  return null;
}

function nodeList() {
  return (process.env.VAULT_NODES || 'vault-1,vault-2,vault-3').split(',').map((s) => s.trim()).filter(Boolean);
}

export async function readKeyEvents({ limit = 200, type = 'ALL', ttl = process.env.CRYPTO_KEY_TTL || '5m' } = {}) {
  const events = [];
  for (const node of nodeList()) {
    for (const line of await readNodeLines(node)) {
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      if (obj?.type !== 'response') continue;
      const req = obj.request || {};
      const p = req.path || '';
      const data = (obj.response || {}).data || {};
      const c = classify(p, req.operation, ttl, obj.time, typeof data.key_version === 'number' ? data.key_version : null);
      if (!c || (type !== 'ALL' && c.type !== type)) continue;
      const error = obj.error;
      events.push({
        type: null, op: null, keyId: null, node, at: obj.time ?? null,
        actor: obj.auth?.display_name || '-',
        result: error ? (String(error).includes('permission denied') ? 'denied' : 'fail') : 'ok',
        requestId: req.id || null,
        version: typeof data.key_version === 'number' ? data.key_version : null,
        nistState: null, note: null, deactivatesAt: null,
        ...c,
        ...(error ? { nistState: null, deactivatesAt: null } : {}),
      });
    }
  }
  const t = (e) => { const v = Date.parse(e.at); return Number.isNaN(v) ? 0 : v; };
  events.sort((a, b) => t(b) - t(a));
  return events.slice(0, limit);
}
