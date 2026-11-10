// Self-check: upload name sanitizing, mime allowlist, magic bytes, base64 decode limits.
import assert from 'node:assert/strict';
import { sanitizeName, ALLOWED_MIME, checkMagic, decodeFile, contentDispositionInline, MAX_FILE } from './uploads.mjs';

assert.equal(sanitizeName('../../etc/a.pdf'), 'a.pdf');
assert.equal(sanitizeName('C:\\x\\b.png'), 'b.png');
assert.equal(sanitizeName('  c.txt  '), 'c.txt');
assert.equal(sanitizeName('dir/'), null);
assert.equal(sanitizeName(''), null);
assert.equal(sanitizeName('   '), null);
assert.equal(sanitizeName('a'.repeat(200)), 'a'.repeat(200));
assert.equal(sanitizeName('a'.repeat(201)), null);
for (const bad of ['a\u0000b', 'a\nb', 'a\u007fb']) assert.equal(sanitizeName(bad), null);

assert.deepEqual(ALLOWED_MIME, ['application/pdf', 'image/png', 'image/jpeg', 'text/plain']);

assert.equal(checkMagic('application/pdf', Buffer.from('%PDF-1.7\n')), true);
assert.equal(checkMagic('application/pdf', Buffer.from('PK\x03\x04')), false);
assert.equal(checkMagic('image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])), true);
assert.equal(checkMagic('image/png', Buffer.from([0xff, 0xd8, 0xff])), false);
assert.equal(checkMagic('image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0])), true);
assert.equal(checkMagic('image/jpeg', Buffer.from('%PDF-')), false);
assert.equal(checkMagic('text/plain', Buffer.from('héllo')), true);
assert.equal(checkMagic('text/plain', Buffer.from([0x68, 0x00, 0x69])), false);
assert.equal(checkMagic('text/plain', Buffer.from([0xff])), false);
assert.equal(checkMagic('application/zip', Buffer.from('PK')), false);

assert.deepEqual(decodeFile(Buffer.from('hello').toString('base64')).buf, Buffer.from('hello'));
assert.equal(decodeFile('aGVs!G8=').status, 400);
assert.equal(decodeFile('QQ=').status, 400);
assert.equal(decodeFile('Q===').status, 400);
assert.equal(decodeFile('').status, 400);
assert.equal(decodeFile(Buffer.alloc(MAX_FILE + 1).toString('base64')).status, 413);
assert.equal(decodeFile(Buffer.alloc(MAX_FILE).toString('base64')).buf.length, MAX_FILE);
assert.equal(decodeFile('QR==').status, 400);
assert.equal(decodeFile('QQ==').buf.toString(), 'A');

assert.equal(contentDispositionInline("a'b(c).pdf"), "inline; filename*=UTF-8''a%27b%28c%29.pdf");
assert.ok(!/['()*]/.test(contentDispositionInline("a'b(c)*.pdf").split("''")[1]));
assert.equal(contentDispositionInline('a b.pdf'), "inline; filename*=UTF-8''a%20b.pdf");

console.log('uploads ok');
