import fs from 'node:fs/promises';
import path from 'node:path';

const SECRET_KEYS = new Set(['share', 'shares', 'token', 'key', 'keys', 'root_token', 'keys_base64', 'unseal_keys_b64', 'secret_shares']);
const TAIL_BYTES = 2 * 1024 * 1024;

const dashDir = () => process.env.DASH_DATA_DIR || '/dash-data';

function stripSecrets(v) {
  if (Array.isArray(v)) return v.map(stripSecrets);
  const proto = v && typeof v === 'object' ? Object.getPrototypeOf(v) : undefined;
  if (proto !== Object.prototype && proto !== null) return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (!SECRET_KEYS.has(k)) out[k] = stripSecrets(x);
  }
  return out;
}

export async function appendEvent(ev) {
  const e = { at: new Date().toISOString(), actor: 'dashboard', result: 'ok', ...stripSecrets(ev) };
  const dir = dashDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.appendFile(path.join(dir, 'events.jsonl'), JSON.stringify(e) + '\n', { mode: 0o600 });
}

export async function readDashEvents(limit = 100) {
  try {
    const fh = await fs.open(path.join(dashDir(), 'events.jsonl'), 'r');
    try {
      const { size } = await fh.stat();
      const start = Math.max(0, size - TAIL_BYTES);
      const from = start > 0 ? start - 1 : 0;
      const buf = Buffer.alloc(size - from);
      const { bytesRead } = await fh.read(buf, 0, buf.length, from);
      let text = buf.subarray(0, bytesRead).toString('utf8');
      if (start > 0 && buf[0] !== 0x0a) {
        const nl = text.indexOf('\n');
        text = nl === -1 ? '' : text.slice(nl + 1);
      }
      const events = [];
      for (const line of text.split('\n')) {
        if (!line) continue;
        try { events.push(JSON.parse(line)); } catch {}
      }
      return events.slice(Math.max(0, events.length - limit)).reverse();
    } finally {
      await fh.close();
    }
  } catch {
    return [];
  }
}
