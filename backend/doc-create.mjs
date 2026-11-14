import { sanitizeName, checkMagic, decodeFile } from './uploads.mjs';

// Source: db/init/001_schema.sql, documents.type CHECK
const DOC_TYPES = ['Policy', 'Procedure', 'Network diagram', 'Risk assessment', 'Incident response plan', 'Configuration baseline', 'Audit report', 'Personnel roster', 'Installation register', 'Equipment register'];
// Source: db/init/010_red_strict_dual_auth.sql, documents_tlp_check
const TLP = ['CLEAR', 'GREEN', 'AMBER', 'AMBER+STRICT', 'RED', 'RED+STRICT'];
// Mirrors SAFE_MIME in server.mjs
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SAFE_MIME = ['application/pdf', XLSX];
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const VERSION = /^\d+\.\d+$/;

const str = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const fail = (error) => ({ ok: false, error, status: 400 });
// ponytail: xlsx magic checks only the ZIP local-header bytes; any ZIP passes. Upgrade: inspect [Content_Types].xml when a stricter check is needed.
const magicOk = (mime, buf) => (mime === XLSX ? buf.subarray(0, ZIP.length).equals(ZIP) : checkMagic(mime, buf));

export function validateDocBody(body) {
  if (!body || typeof body !== 'object') return fail('body must be object');
  const s = (k) => (typeof body[k] === 'string' ? body[k].trim() : body[k]);
  const value = {
    title: s('title'), type: body.type, owner: s('owner'), approver: s('approver'), tlp: body.tlp,
    status: body.status, nextReview: body.nextReview, version: body.version, summary: s('summary'),
  };
  const checks = [
    ['title', str(value.title, 200)],
    ['type', DOC_TYPES.includes(value.type)],
    ['owner', str(value.owner, 120)],
    ['approver', str(value.approver, 120)],
    ['tlp', TLP.includes(value.tlp)],
    ['status', ['draft', 'in review'].includes(value.status)],
    ['nextReview', isDate(value.nextReview)],
    ['version', typeof value.version === 'string' && VERSION.test(value.version)],
    ['summary', str(value.summary, 500)],
  ];
  const bad = checks.find(([, ok]) => !ok);
  if (bad) return fail(`invalid ${bad[0]}`);

  const f = body.file;
  if (!f || typeof f !== 'object') return fail('invalid file');
  if (!SAFE_MIME.includes(f.mime)) return fail('invalid mime');
  const name = sanitizeName(typeof f.name === 'string' ? f.name : '');
  if (!name) return fail('invalid file name');
  const d = decodeFile(f.data);
  if (d.status === 413) return { ok: false, error: 'too large', status: 413 };
  if (d.status) return fail('invalid file data');
  try {
    if (!magicOk(f.mime, d.buf)) return fail('file content does not match mime');
  } finally {
    d.buf.fill(0);
  }
  return { ok: true, value: { ...value, file: { name, mime: f.mime, data: f.data } } };
}

export function nextId(prefix, ids) {
  const re = new RegExp(`^${prefix}-(\\d{4})$`);
  const max = ids.reduce((m, id) => {
    const x = re.exec(id);
    return x ? Math.max(m, Number(x[1])) : m;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}
