export { nextId } from './doc-create.mjs';

// Source: db/init/001_schema.sql, assets CHECK constraints
const ASSET_TYPES = ['PLC', 'RTU', 'HMI', 'SCADA server', 'Historian', 'Engineering workstation', 'Firewall', 'Switch', 'Data diode'];
const SECTORS = ['Energy', 'Water', 'Telecom'];
const PURDUE = ['L0', 'L1', 'L2', 'L3', 'L3.5', 'L4'];
const CRIT = ['high', 'medium', 'low'];
const STATUS = ['active', 'maintenance', 'retired'];
const IPV4 = /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const PATCH_KEYS = ['name', 'type', 'site', 'purdueLevel', 'criticality', 'status', 'lastReviewed', 'owner', 'reason'];

const len = (min, max) => (v) => typeof v === 'string' && v.length >= min && v.length <= max;
const oneOf = (list) => (v) => list.includes(v);
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;

const RULES = {
  name: len(1, 120), site: len(1, 120), owner: len(1, 120), vendor: len(1, 120),
  model: len(1, 80), firmware: len(1, 80),
  type: oneOf(ASSET_TYPES), sector: oneOf(SECTORS), purdueLevel: oneOf(PURDUE),
  criticality: oneOf(CRIT), status: oneOf(STATUS),
  ipAddress: (v) => typeof v === 'string' && IPV4.test(v),
  lastReviewed: isDate,
};
const FIELDS = ['name', 'type', 'site', 'sector', 'purdueLevel', 'vendor', 'model', 'firmware', 'ipAddress', 'criticality', 'status', 'owner', 'lastReviewed'];

function check(src, keys) {
  const value = {};
  for (const k of keys) {
    const v = typeof src[k] === 'string' ? src[k].trim() : src[k];
    if (!RULES[k](v)) return { ok: false, error: `invalid ${k}` };
    value[k] = v;
  }
  return { ok: true, value };
}

const isObj = (b) => b && typeof b === 'object' && !Array.isArray(b);

export function validateAssetBody(body) {
  if (!isObj(body)) return { ok: false, error: 'body must be object' };
  return check(body, FIELDS);
}

export function validateAssetPatch(body) {
  if (!isObj(body)) return { ok: false, error: 'body must be object' };
  const extra = Object.keys(body).find((k) => !PATCH_KEYS.includes(k));
  if (extra) return { ok: false, error: `unknown field ${extra}` };
  const r = check(body, Object.keys(body).filter((k) => k !== 'reason'));
  if (!r.ok) return r;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 1 || reason.length > 500) return { ok: false, error: 'invalid reason' };
  return { ok: true, value: { ...r.value, reason } };
}

export function zoneFor(purdueLevel, type) {
  switch (purdueLevel) {
    case 'L0':
    case 'L1':
      return 'Z1 Control';
    case 'L2':
      return 'Z2 Supervisory';
    case 'L3':
      return type === 'Engineering workstation' ? 'Z3 Engineering' : 'Z2 Supervisory';
    case 'L3.5':
      return 'DMZ';
    case 'L4':
      return 'Z4 Enterprise';
    default:
      return null;
  }
}
