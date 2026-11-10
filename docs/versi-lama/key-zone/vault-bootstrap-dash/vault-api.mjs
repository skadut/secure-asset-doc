// Vault node API client. Stdlib only. Never logs or throws bodies, shares, or tokens.
import https from 'node:https';
import fs from 'node:fs';

export const NODES = (process.env.VAULT_NODES || 'vault-1,vault-2,vault-3')
  .split(',').map(s => s.trim()).filter(Boolean);

// ponytail: TLS material memoized for process lifetime; cert rotation needs restart. Upgrade: re-read on mtime change.
let tlsOpts;
function tls() {
  if (!tlsOpts) {
    tlsOpts = {
      ca: fs.readFileSync(process.env.VAULT_CACERT),
      cert: fs.readFileSync(process.env.VAULT_CLIENT_CERT),
      key: fs.readFileSync(process.env.VAULT_CLIENT_KEY),
    };
  }
  return tlsOpts;
}

// Resolves {status, json} for any HTTP status. json is null when body is not JSON. Rejects only on network/timeout error.
function call(node, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const h = payload === undefined ? { ...headers } : { 'Content-Type': 'application/json', ...headers };
    const req = https.request(`https://${node}:8200${path}`, { method, ...tls(), headers: h }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('error', reject);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
        resolve({ status: res.statusCode, json });
      });
    });
    req.setTimeout(5000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(payload);
  });
}

// Throws status-only error on non-2xx. Body text never included.
async function req(node, method, path, body, headers) {
  const { status, json } = await call(node, method, path, body, headers);
  if (status < 200 || status > 299) throw new Error(`vault ${node} ${method} ${path} -> ${status}`);
  return json;
}

// Never throws. 200/501/503 all carry parseable seal state.
export async function sealStatus(node) {
  try {
    const { json } = await call(node, 'GET', '/v1/sys/seal-status');
    if (json === null || typeof json !== 'object') return { reachable: false };
    const { initialized, sealed, t, n, progress, version } = json;
    return { reachable: true, initialized, sealed, t, n, progress, version };
  } catch {
    return { reachable: false };
  }
}

export const init = (node, { shares = 5, threshold = 3 } = {}) =>
  req(node, 'PUT', '/v1/sys/init', { secret_shares: shares, secret_threshold: threshold });

export const unseal = (node, key) => req(node, 'PUT', '/v1/sys/unseal', { key });

// Rekey endpoints are unauthenticated; shares are the auth. No token sent.
export const rekeyInit = node =>
  req(node, 'PUT', '/v1/sys/rekey/init', { secret_shares: 5, secret_threshold: 3 });

export const rekeyUpdate = (node, { key, nonce }) =>
  req(node, 'PUT', '/v1/sys/rekey/update', { key, nonce });

export const rekeyCancel = async node => (await req(node, 'DELETE', '/v1/sys/rekey/init')) ?? {};

export const rekeyStatus = node => req(node, 'GET', '/v1/sys/rekey/init');
