import fs from 'node:fs';
import fsp from 'node:fs/promises';
import tls from 'node:tls';
import crypto, { X509Certificate } from 'node:crypto';

const DAY = 86400000;
const TIMEOUT_MS = 3000;
// ponytail: cache is per process, 60s ceiling; cert rotation shows up up to 60s late. Upgrade: key cache on file mtime.
const CACHE_MS = 60000;
const DEFAULT_NODES = ['vault-1', 'vault-2', 'vault-3'];
const ROLE = { ca: 'Root CA', vault: 'Vault node (server)', admin: 'Client: admin', cm: 'Client: crypto-module' };
const EKU = { '1.3.6.1.5.5.7.3.1': 'serverAuth', '1.3.6.1.5.5.7.3.2': 'clientAuth' };
const env = (name, fallback) => process.env[name] || fallback;
const timeoutErr = () => Object.assign(new Error('timeout'), { code: 'TIMEOUT' });
let cache = null;

function pubKey(key) {
  const d = key.asymmetricKeyDetails ?? {};
  return { type: key.asymmetricKeyType, ...(d.modulusLength !== undefined && { bits: d.modulusLength }), ...(d.namedCurve && { curve: d.namedCurve }) };
}

function blank(id, role, source, privateKey, error) {
  return { id, role, source, status: 'unavailable', subjectDN: null, issuerDN: null, cn: null, serial: null, notBefore: null, notAfter: null, daysLeft: null, lifetimeDays: null, san: [], extKeyUsage: [], isCA: false, fingerprint256: null, publicKey: null, privateKey, error };
}

function describe(id, role, source, cert, privateKey, now) {
  const notBefore = new Date(cert.validFrom);
  const notAfter = new Date(cert.validTo);
  const daysLeft = Math.floor((notAfter - now) / DAY);
  const status = now > notAfter ? 'expired' : now < notBefore ? 'not-yet-valid' : daysLeft <= 30 ? 'expiring' : 'valid';
  const cn = cert.subject.match(/^CN=(.*)$/m);
  return {
    id, role, source, status,
    subjectDN: cert.subject.replace(/\n/g, ', '),
    issuerDN: cert.issuer.replace(/\n/g, ', '),
    cn: cn ? cn[1] : null,
    serial: cert.serialNumber,
    notBefore: notBefore.toISOString(),
    notAfter: notAfter.toISOString(),
    daysLeft,
    lifetimeDays: Math.floor((notAfter - notBefore) / DAY),
    san: cert.subjectAltName ? cert.subjectAltName.split(', ') : [],
    // cert.keyUsage on X509Certificate is the EKU OID list (verified on Node 24; Node 22 not available here)
    extKeyUsage: (cert.keyUsage ?? []).map(o => EKU[o] ?? o),
    isCA: cert.ca === true,
    fingerprint256: cert.fingerprint256,
    publicKey: pubKey(cert.publicKey),
    privateKey,
    error: null,
  };
}

async function clientKey(keyPath, cert) {
  try {
    const key = crypto.createPrivateKey(await fsp.readFile(keyPath, 'utf8'));
    return { state: 'Active (on disk, read-only)', ...pubKey(key), matchesCert: cert ? cert.checkPrivateKey(key) : false };
  } catch {
    return { state: 'Unreadable', matchesCert: false };
  }
}

async function fileEntry(id, role, certPath, keyPath, now) {
  let der, cert = null, error = null;
  try { der = await fsp.readFile(certPath); } catch (err) { error = err.code === 'ENOENT' ? 'file missing' : 'read failed'; }
  if (der) {
    try { cert = new X509Certificate(der); } catch { error = 'parse failed'; }
  }
  const privateKey = keyPath ? await clientKey(keyPath, cert) : { state: 'Destroyed (after issuance)' };
  if (!cert) return blank(id, role, 'file', privateKey, error);
  try { return describe(id, role, 'file', cert, privateKey, now); } catch { return blank(id, role, 'file', privateKey, 'parse failed'); }
}

function defaultHandshake(node) {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({
      host: node, port: 8200, servername: node,
      ca: fs.readFileSync(process.env.VAULT_CACERT),
      cert: fs.readFileSync(process.env.VAULT_CLIENT_CERT),
      key: fs.readFileSync(process.env.VAULT_CLIENT_KEY),
    });
    sock.setTimeout(TIMEOUT_MS, () => sock.destroy(timeoutErr()));
    sock.once('secureConnect', () => { resolve(sock.getPeerCertificate(true).raw); sock.destroy(); });
    sock.once('error', reject);
  });
}

async function vaultEntry(node, handshake, now) {
  const held = { state: 'Held by node (not visible to dash)' };
  let timer, der;
  try {
    der = await Promise.race([
      handshake(node),
      new Promise((_, reject) => { timer = setTimeout(() => reject(timeoutErr()), TIMEOUT_MS); }),
    ]);
  } catch (err) {
    return blank(node, ROLE.vault, 'tls-handshake', held, err?.code === 'TIMEOUT' ? 'handshake timeout' : 'handshake failed');
  } finally {
    clearTimeout(timer);
  }
  try {
    return describe(node, ROLE.vault, 'tls-handshake', new X509Certificate(der), held, now);
  } catch {
    return blank(node, ROLE.vault, 'tls-handshake', held, 'parse failed');
  }
}

export async function readCerts({ nodes = DEFAULT_NODES, now, handshake } = {}) {
  const cacheable = !handshake && now === undefined;
  const at = now ?? Date.now();
  const key = nodes.join(',');
  if (cacheable && cache?.key === key && at - cache.at < CACHE_MS) return cache.value;
  const [ca, vaults, admin, cm] = await Promise.all([
    fileEntry('ca', ROLE.ca, env('CERTS_ADMIN_CA', '/vault/tls/admin/ca.pem'), undefined, at),
    Promise.all(nodes.map(n => vaultEntry(n, handshake ?? defaultHandshake, at))),
    fileEntry('client-admin', ROLE.admin, env('CERTS_ADMIN_CERT', '/vault/tls/admin/cert.pem'), env('CERTS_ADMIN_KEY', '/vault/tls/admin/key.pem'), at),
    fileEntry('client-crypto-module', ROLE.cm, env('CERTS_CM_CERT', '/vault/tls/crypto-module/cert.pem'), env('CERTS_CM_KEY', '/vault/tls/crypto-module/key.pem'), at),
  ]);
  const value = { checkedAt: new Date(at).toISOString(), certs: [ca, ...vaults, admin, cm] };
  if (cacheable) cache = { key, at, value };
  return value;
}
