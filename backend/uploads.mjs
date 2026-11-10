export const MAX_BODY = 14 * 1024 * 1024;
export const MAX_FILE = 10 * 1024 * 1024;
export const ALLOWED_MIME = ['application/pdf', 'image/png', 'image/jpeg', 'text/plain'];

const CONTROL = /[\u0000-\u001f\u007f]/;
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
const PDF = Buffer.from('%PDF-');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);

export function sanitizeName(raw) {
  const base = raw.split(/[/\\]/).pop();
  if (CONTROL.test(base)) return null;
  const name = base.trim();
  return name && name.length <= 200 ? name : null;
}

export function checkMagic(mime, buf) {
  if (mime === 'application/pdf') return buf.subarray(0, PDF.length).equals(PDF);
  if (mime === 'image/png') return buf.subarray(0, PNG.length).equals(PNG);
  if (mime === 'image/jpeg') return buf.subarray(0, JPEG.length).equals(JPEG);
  if (mime === 'text/plain') {
    if (buf.includes(0)) return false;
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(buf);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

// Size checked from base64 length before decoding, so oversize input never allocates MAX_FILE+.
export function decodeFile(str) {
  if (typeof str !== 'string' || !str.length || str.length % 4 !== 0 || !B64.test(str)) return { status: 400 };
  const pad = str.endsWith('==') ? 2 : str.endsWith('=') ? 1 : 0;
  if ((str.length / 4) * 3 - pad > MAX_FILE) return { status: 413 };
  const buf = Buffer.from(str, 'base64');
  if (buf.toString('base64') !== str) return { status: 400 };
  return { buf };
}

// RFC 5987 attr-char: encodeURIComponent leaves ' ( ) * raw, so escape them too.
export function contentDispositionInline(name) {
  const enc = encodeURIComponent(name).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `inline; filename*=UTF-8''${enc}`;
}
