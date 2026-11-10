// Self-check: derive validation + TLP ordering. Pure: no DB, no HTTP.
import assert from 'node:assert/strict';
import { TLP_ORDER } from './auth.mjs';
import { isLowerTlp, validateDerive, visibleDerivedFrom } from './derive.mjs';

assert.deepEqual([...TLP_ORDER], ['CLEAR', 'GREEN', 'AMBER', 'AMBER+STRICT', 'RED', 'RED+STRICT']);
assert.equal(TLP_ORDER.length, 6);
const [CLEAR, GREEN, AMBER, AMBER_STRICT, RED, RED_STRICT] = TLP_ORDER;

// isLowerTlp
assert.equal(isLowerTlp(CLEAR, RED), true);
assert.equal(isLowerTlp(AMBER_STRICT, RED), true);
assert.equal(isLowerTlp(RED, RED), false);
assert.equal(isLowerTlp(GREEN, CLEAR), false);
assert.equal(isLowerTlp('NOPE', RED), false);
assert.equal(isLowerTlp(CLEAR, 'NOPE'), false);

const ok = (tlp, parent, title = 'Turunan', summary = 'Ringkasan') => validateDerive({ title, tlp, summary }, parent).ok;

// Parent RED: accepts every lower TLP, rejects RED and unknown.
for (const tlp of [CLEAR, GREEN, AMBER, AMBER_STRICT]) assert.equal(ok(tlp, RED), true, tlp);
assert.equal(ok(RED, RED), false);
assert.equal(ok('NOPE', RED), false);

// Parent RED+STRICT: accepts every lower TLP (incl. RED); rejects RED+STRICT itself.
for (const tlp of [CLEAR, GREEN, AMBER, AMBER_STRICT, RED]) assert.equal(ok(tlp, RED_STRICT), true, tlp);
assert.equal(ok(RED_STRICT, RED), false);
assert.equal(ok(RED_STRICT, RED_STRICT), false);

// Parent CLEAR: rejects every tlp.
for (const tlp of TLP_ORDER) assert.equal(ok(tlp, CLEAR), false, tlp);

// Title length after trim: 1..120.
assert.equal(ok(CLEAR, RED, ''), false);
assert.equal(ok(CLEAR, RED, '   '), false);
assert.equal(ok(CLEAR, RED, 'x'.repeat(121)), false);
assert.equal(ok(CLEAR, RED, 'x'.repeat(120)), true);

// Summary: non-empty after trim.
assert.equal(ok(CLEAR, RED, 'Judul', ''), false);
assert.equal(ok(CLEAR, RED, 'Judul', ' \t\n '), false);

// Non-string fields.
assert.equal(ok(CLEAR, RED, 42), false);
assert.equal(ok(CLEAR, RED, 'Judul', null), false);
assert.equal(validateDerive(null, RED).ok, false);

// Value is trimmed.
assert.deepEqual(validateDerive({ title: '  Judul  ', tlp: GREEN, summary: ' Ringkas ' }, RED).value, { title: 'Judul', tlp: GREEN, summary: 'Ringkas' });

// visibleDerivedFrom: parent id leaks only if readable by level or granted.
const PARENT = { id: 'DOC-0001', tlp: RED };
assert.equal(visibleDerivedFrom(5, PARENT, new Set()), 'DOC-0001'); // readable parent
assert.equal(visibleDerivedFrom(1, { id: 'DOC-0001', tlp: 'CLEAR' }, new Set()), 'DOC-0001');
assert.equal(visibleDerivedFrom(1, PARENT, new Set()), null); // hidden parent (level 1, RED)
assert.equal(visibleDerivedFrom(1, PARENT, new Set(['DOC-0002'])), null); // grant on other doc
assert.equal(visibleDerivedFrom(1, PARENT, new Set(['DOC-0001'])), 'DOC-0001'); // granted parent
assert.equal(visibleDerivedFrom(1, null, new Set(['DOC-0001'])), null); // no parent

console.log('derive ok');
