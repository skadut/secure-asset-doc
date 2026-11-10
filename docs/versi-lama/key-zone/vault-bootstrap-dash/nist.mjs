// NIST SP 800-57 Part 1 Rev. 5 (key management) and SP 800-130 (KMS design) metadata for the key-zone dashboard.
// Descriptive only: values are reported here, not enforced.

// SP 800-57 Pt1 Rev5 §7 key states.
export const STATES = ['Pre-activation', 'Active', 'Suspended', 'Deactivated', 'Compromised', 'Destroyed'];

export const POLICY = [
  {
    key: 'MSK',
    nistClass: 'Symmetric key-wrapping key (root/master key, Shamir 3-of-5 split)',
    purpose: 'Root/master key protecting Vault barrier keyring',
    cryptoperiod: 'Recommended originator cryptoperiod <= 2 years',
    configured: 'MSK_CRYPTOPERIOD_DAYS env (default 365), changed via rekey ceremony',
    custody: 'Split knowledge / dual control: 3-of-5 Shamir shares',
    ref: 'SP 800-57 Pt1 Rev5 §5.3 (cryptoperiods), §7 (key states)',
  },
  {
    key: 'KEK',
    nistClass: 'Symmetric key-wrapping key',
    purpose: 'Vault transit KEK crypto-module-kek wrapping DEKs',
    cryptoperiod: 'Recommended <= 2 years',
    configured: 'auto_rotate 8760h (KEK_CRYPTOPERIOD_DAYS env default 365)',
    custody: 'Non-exportable, no plaintext backup',
    ref: 'SP 800-57 Pt1 Rev5 §5.3 (cryptoperiods), §7 (key states)',
  },
  {
    key: 'DEK',
    nistClass: 'Symmetric data-encryption key',
    purpose: 'Data-encryption key, cached up to CRYPTO_KEY_TTL, wrapped by KEK',
    cryptoperiod: 'Recommended <= 2 years originator-usage',
    configured: 'DEK cached up to CRYPTO_KEY_TTL, wrapped by KEK, then zeroized',
    custody: 'Held in crypto-service memory only, wrapped at rest',
    ref: 'SP 800-57 Pt1 Rev5 §5.3, Table 1',
  },
];

// Latest `at` (string) among events matching pred, compared by Date.parse. Null if none.
const latestAt = (events, pred) => {
  let best = null;
  for (const e of events) {
    if (pred(e) && (best === null || Date.parse(e.at) > Date.parse(best))) best = e.at;
  }
  return best;
};

export function mskInfo({ initialized, sealedCount, nodeCount, events = [] }) {
  const createdAt = latestAt(events, (e) => e.type === 'MSK' && e.op === 'generate' && e.result === 'ok');
  const lastRekeyAt = latestAt(events, (e) => e.type === 'MSK' && e.op === 'rekey' && e.result === 'ok');
  const state = !initialized ? 'Pre-activation' : nodeCount > 0 && sealedCount === nodeCount ? 'Suspended (sealed)' : 'Active';
  const cryptoperiodDays = Number(process.env.MSK_CRYPTOPERIOD_DAYS || 365);
  const base = lastRekeyAt || createdAt;
  const ageDays = base ? Math.floor((Date.now() - Date.parse(base)) / 86400000) : null;
  const overdue = ageDays !== null && ageDays > cryptoperiodDays;
  const expiresAt = base ? new Date(Date.parse(base) + cryptoperiodDays * 86400000).toISOString() : null;
  const daysLeft = expiresAt ? Math.floor((Date.parse(expiresAt) - Date.now()) / 86400000) : null;
  return { state, createdAt, lastRekeyAt, ageDays, cryptoperiodDays, overdue, expiresAt, daysLeft };
}

export function kekInfo(events = []) {
  const createdAt = latestAt(events, (e) => e.type === 'KEK' && (e.op === 'generate' || e.op === 'create') && e.result === 'ok');
  const lastRotateAt = latestAt(events, (e) => e.type === 'KEK' && e.op === 'rotate' && e.result === 'ok');
  const base = lastRotateAt || createdAt;
  const cryptoperiodDays = Number(process.env.KEK_CRYPTOPERIOD_DAYS || 365);
  const nextRotateAt = base ? new Date(Date.parse(base) + cryptoperiodDays * 86400000).toISOString() : null;
  const daysLeft = nextRotateAt ? Math.floor((Date.parse(nextRotateAt) - Date.now()) / 86400000) : null;
  const ageDays = base ? Math.floor((Date.now() - Date.parse(base)) / 86400000) : null;
  let latestVersion = null;
  for (const e of events) {
    const v = Number(e.version);
    if ((e.type === 'DEK' || e.type === 'KEK') && e.version != null && Number.isFinite(v) && (latestVersion === null || v > latestVersion)) {
      latestVersion = v;
    }
  }
  return {
    name: 'crypto-module-kek',
    state: 'Active',
    latestVersion,
    lastRotateAt,
    cryptoperiodDays,
    autoRotate: '8760h',
    createdAt,
    nextRotateAt,
    daysLeft,
    ageDays,
  };
}

// ponytail: 24h counts only see events passed in (server passes last 200), so counts are a floor.
export function dekInfo(events = []) {
  const now = Date.now();
  const inDay = (e) => {
    const t = Date.parse(e.at);
    return Number.isFinite(t) && t >= now - 86400000;
  };
  const dek = events.filter((e) => e.type === 'DEK');
  return {
    ttl: process.env.CRYPTO_KEY_TTL || '5m',
    state: 'Active while cached; Destroyed (zeroized) at TTL expiry',
    stats: {
      generated24h: dek.filter((e) => e.op === 'generate+wrap' && e.result === 'ok' && inDay(e)).length,
      unwrapped24h: dek.filter((e) => e.op === 'unwrap' && e.result === 'ok' && inDay(e)).length,
      total: dek.length,
      lastAt: latestAt(events, (e) => e.type === 'DEK'),
    },
  };
}
