import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import * as defaultVault from './vault-api.mjs';
import { appendEvent } from './events.mjs';

const CONFIRM = 'I have recorded all 5 shares', SHARE_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const httpErr = (status, msg) => Object.assign(new Error(msg), { status });
const validShare = (s) => typeof s === 'string' && s.length >= 1 && s.length <= 100 && SHARE_RE.test(s);
const readShare = (p) => fs.readFileSync(p, 'utf8').trim(); const clearRo = (p) => { if (fs.existsSync(p)) fs.chmodSync(p, 0o600); }; // Windows: 0400 = read-only
const rmDir = (d) => { if (!fs.existsSync(d)) return; for (const f of fs.readdirSync(d)) clearRo(path.join(d, f)); fs.rmSync(d, { recursive: true, force: true }); };
const writeDurable = (p, data) => { const fd = fs.openSync(p, 'wx', 0o400); try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } };
// Finish or discard an interrupted share rewrite. next/COMMIT present: new shares complete, rename in. Absent: old shares still valid, drop next/.
export function recoverShares(dir = '/custodians') {
  const next = path.join(dir, 'next');
  if (!fs.existsSync(next)) return;
  if (fs.existsSync(path.join(next, 'COMMIT'))) {
    for (let i = 1; i <= 5; i++) {
      const src = path.join(next, `share-${i}`);
      if (!fs.existsSync(src)) continue;
      const dst = path.join(dir, `share-${i}`);
      clearRo(dst); fs.renameSync(src, dst);
    }
  }
  rmDir(next);
}

function runScript({ root }, env) {
  const e = { PATH: env.PATH, VAULT_CACERT: env.VAULT_CACERT, VAULT_CLIENT_CERT: env.VAULT_CLIENT_CERT, VAULT_CLIENT_KEY: env.VAULT_CLIENT_KEY, VAULT_TOKEN: root, VAULT_ADDR: 'https://vault-1:8200' };
  return new Promise((resolve, reject) => {
    const child = spawn('sh', ['/scripts/configure.sh'], { env: e, stdio: ['ignore', 'pipe', 'pipe'] }), t = setTimeout(() => { child.kill(); reject(new Error('configure timeout')); }, 120000);
    let out = ''; child.stdout.on('data', (d) => { out += d; });
    child.stderr.resume(); // discarded, never logged
    child.on('error', (err) => { clearTimeout(t); reject(err); });
    child.on('close', (code) => { clearTimeout(t); if (code !== 0) reject(new Error('configure failed exit ' + code)); else resolve(out.split(/\r?\n/).filter((l) => /^(PASS|FAIL):/.test(l))); });
  });
}

export function createCeremony(deps = {}) {
  const {
    vault = defaultVault,
    dir = '/custodians',
    mode = process.env.KEYZONE_MODE || 'safe',
    env = process.env,
    nodes = (env.VAULT_NODES || 'vault-1,vault-2,vault-3').split(',').map((s) => s.trim()).filter(Boolean),
    events = appendEvent,
    runConfigure = (p) => runScript(p, env),
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    joinTimeoutMs = 90000,
    pollMs = 2000,
  } = deps;

  const emit = async (ev) => { try { await events(ev); } catch { /* step already succeeded */ } };
  const sharePath = (i) => path.join(dir, `share-${i}`);
  const sharePaths = () => [1, 2, 3, 4, 5].map(sharePath).filter((p) => fs.existsSync(p));
  const sharesOnDisk = () => sharePaths().length > 0;
  const writeShares = (shares) => shares.forEach((s, i) => fs.writeFileSync(sharePath(i + 1), s, { mode: 0o400, flag: 'wx' }));
  // ponytail: dir fsync skipped (not portable to Windows). Ceiling: power loss mid-rename relies on COMMIT replay in recoverShares.
  const writeSharesAtomic = (keys) => {
    const next = path.join(dir, 'next');
    rmDir(next); // leftover from earlier crash
    fs.mkdirSync(next, { mode: 0o700 });
    keys.forEach((k, i) => writeDurable(path.join(next, `share-${i + 1}`), k));
    writeDurable(path.join(next, 'COMMIT'), '');
    recoverShares(dir);
  };
  const waitForJoin = async () => {
    const start = Date.now();
    while (!(await Promise.all(nodes.slice(1).map((n) => vault.sealStatus(n)))).every((s) => s.reachable && s.initialized === true)) {
      if (Date.now() - start > joinTimeoutMs) throw httpErr(504, 'nodes did not join raft in time');
      await sleep(pollMs);
    }
  };

  async function initCluster() {
    if (sharesOnDisk()) throw Object.assign(new Error('shares already stored on disk'), { status: 409 });
    if (mode === 'unsafe') { try { fs.accessSync(dir, fs.constants.W_OK); } catch { throw Object.assign(new Error('custodians dir not writable'), { status: 500 }); } }
    const st = await Promise.all(nodes.map((n) => vault.sealStatus(n)));
    if (st.some((s) => s.initialized === true)) throw httpErr(409, 'cluster already initialized');
    if (!st[0].reachable) throw httpErr(503, 'vault-1 unreachable');
    const init = await vault.init(nodes[0], { shares: 5, threshold: 3 });
    const shares = init.keys_base64;
    let root = init.root_token;
    try {
      // ponytail: safe-mode partial failure returns shares with partial:true. Ceiling: no configure retry. Upgrade path: none needed for shares; add retry of configure.
      if (mode === 'unsafe') writeShares(shares);
      try {
        for (let i = 0; i < 3; i++) await vault.unseal(nodes[0], shares[i]);
        await waitForJoin();
        for (const n of nodes.slice(1)) for (let i = 0; i < 3; i++) await vault.unseal(n, shares[i]);
        const configure = await runConfigure({ root });
        if (configure.some((l) => l.startsWith('FAIL:'))) throw new Error('configure reported FAIL');
        await emit({ type: 'MSK', op: 'generate', node: nodes[0], result: 'ok', nistState: 'Pre-activation→Active', note: 'cluster initialized' });
        return mode === 'unsafe' ? { stored: true, configure } : { shares, threshold: 3, configure };
      } catch (err) {
        await emit({ type: 'MSK', op: 'generate', node: nodes[0], result: 'fail' });
        if (mode === 'safe') return { shares, threshold: 3, configure: [], partial: true, error: 'cluster init incomplete; re-run unseal/configure' };
        throw err;
      }
    } finally {
      root = null; // drop root token from memory
    }
  }

  async function unsealAll(share) {
    if (!validShare(share)) throw httpErr(400, 'invalid share');
    const out = [];
    for (const node of nodes) {
      const st = await vault.sealStatus(node);
      if (!st.reachable) { out.push({ id: node, reachable: false }); continue; }
      if (!st.initialized || !st.sealed) { out.push({ id: node, reachable: true, initialized: st.initialized, sealed: st.sealed, progress: st.progress }); continue; }
      let r;
      try { r = await vault.unseal(node, share); } catch {
        await emit({ type: 'MSK', op: 'unseal-share', node, result: 'fail' });
        out.push({ id: node, reachable: true, initialized: true, sealed: true, error: true });
        continue;
      }
      await emit({ type: 'MSK', op: 'unseal-share', node, result: 'ok' });
      if (r.sealed === false) await emit({ type: 'MSK', op: 'activate', node, result: 'ok', nistState: 'Active' });
      out.push({ id: node, reachable: true, initialized: true, sealed: r.sealed, progress: r.progress });
    }
    return { nodes: out };
  }

  function autoUnsealLoop() {
    if (mode !== 'unsafe') return () => {};
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        if (!sharesOnDisk()) return;
        const shares = [1, 2, 3].map((i) => readShare(sharePath(i)));
        for (const node of nodes) {
          const st = await vault.sealStatus(node);
          if (!(st.reachable && st.initialized && st.sealed)) continue;
          let r;
          for (const s of shares) {
            r = await vault.unseal(node, s);
            if (r.sealed === false) break;
          }
          if (r?.sealed === false) await emit({ type: 'MSK', op: 'activate', node, result: 'ok', nistState: 'Active', note: 'auto-unseal' });
        }
      } catch { /* never crash server; retried next tick */ } finally { busy = false; }
    };
    const timer = setInterval(tick, 5000);
    timer.unref();
    return () => clearInterval(timer);
  }

  async function revealShares() {
    if (mode !== 'safe') throw httpErr(409, 'reveal only in safe mode');
    if (!sharesOnDisk()) throw httpErr(409, 'no stored shares');
    const shares = sharePaths().filter((p) => fs.existsSync(p)).map(readShare);
    await emit({ type: 'MSK', op: 'reveal', result: 'ok', note: 'shares revealed' });
    return { shares };
  }

  async function destroyShares(confirm) {
    if (confirm !== CONFIRM) throw httpErr(400, 'confirmation phrase mismatch');
    const leftovers = [1, 2, 3, 4, 5].map((i) => path.join(dir, 'next', `share-${i}`)).filter((p) => fs.existsSync(p));
    for (const p of [...sharePaths(), ...leftovers]) {
      fs.chmodSync(p, 0o600); // clear read-only before write
      const fd = fs.openSync(p, 'r+'), len = fs.fstatSync(fd).size;
      fs.writeSync(fd, Buffer.alloc(len), 0, len, 0); fs.fsyncSync(fd); fs.closeSync(fd); fs.unlinkSync(p);
    }
    rmDir(path.join(dir, 'next'));
    await emit({ type: 'MSK', op: 'destroy-stored-shares', result: 'ok', nistState: 'Active (custody: offline)', note: 'stored shares zeroed and deleted' });
  }

  async function storeShares(shares) {
    if (mode !== 'unsafe') throw httpErr(409, 'store only in unsafe mode');
    if (sharesOnDisk()) throw httpErr(409, 'shares already stored');
    if (!Array.isArray(shares) || shares.length < 3 || shares.length > 5 || !shares.every((s) => validShare(s))) throw httpErr(400, 'invalid shares');
    if (new Set(shares).size !== shares.length) throw httpErr(400, 'duplicate shares');
    writeShares(shares);
    await emit({ type: 'MSK', op: 'store-shares', result: 'ok', nistState: 'Active', note: 'shares stored' });
  }

  async function rekeyStatus() {
    try { const s = await vault.rekeyStatus(nodes[0]); return { started: !!s.started, progress: s.progress ?? 0, required: s.required ?? 3, nonce: s.nonce ?? null }; }
    catch { return { started: false, progress: 0, required: 3, nonce: null }; }
  }

  async function rekeyStart() {
    const r = await vault.rekeyInit(nodes[0]);
    if (!r.nonce) throw new Error('rekey init returned no nonce');
    return { nonce: r.nonce, required: r.required ?? 3 };
  }

  async function rekeyProvide({ nonce, share }) {
    if (typeof nonce !== 'string' || !UUID_RE.test(nonce)) throw httpErr(400, 'invalid nonce');
    const cur = await rekeyStatus();
    if (!cur.started || cur.nonce !== nonce) throw httpErr(409, 'no matching rekey in progress');
    let r;
    if (share !== undefined) {
      if (!validShare(share)) throw httpErr(400, 'invalid share');
      r = await vault.rekeyUpdate(nodes[0], { key: share, nonce });
    } else if (mode === 'unsafe') {
      const stored = sharePaths().filter((p) => fs.existsSync(p));
      if (!stored.length) throw httpErr(409, 'no stored shares');
      for (const p of stored) {
        r = await vault.rekeyUpdate(nodes[0], { key: readShare(p), nonce });
        if (r.complete === true) break;
      }
    } else {
      throw httpErr(400, 'share required');
    }
    if (r.complete !== true) return { progress: r.progress, required: r.required, complete: false };
    const keys = r.keys_base64;
    if (!Array.isArray(keys) || keys.length !== 5) throw new Error('rekey returned unexpected key set');
    if (mode === 'unsafe') writeSharesAtomic(keys);
    await emit({ type: 'MSK', op: 'rekey', result: 'ok', nistState: 'Active(new shares); old shares → Destroyed', note: 'rekey complete' });
    const done = { progress: r.progress, required: r.required, complete: true };
    return mode === 'unsafe' ? done : { ...done, shares: keys };
  }

  const rekeyCancel = () => vault.rekeyCancel(nodes[0]);

  return { sharesOnDisk, initCluster, unsealAll, autoUnsealLoop, revealShares, destroyShares, storeShares, rekeyStatus, rekeyStart, rekeyProvide, rekeyCancel };
}
