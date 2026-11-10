// Self-check: token detection, mask pattern, masked part, local mask. Pure.
import assert from 'node:assert/strict';
import { isToken, maskPattern, maskedPart, localMask } from './tokens.mjs';

// isToken
assert.equal(isToken('Ab*:k1:x:y'), false);
assert.equal(isToken('Ab*:s0:x'), false);
assert.equal(isToken('Ab*:t1:x'), true);
assert.equal(isToken('Ab*:k2:x'), false);
assert.equal(isToken('plain title'), false);
assert.equal(isToken(null), false);
assert.equal(isToken(undefined), false);

// maskPattern: first 3 kept, spaces/punct kept, ':' hidden
const T = 'Operation Order: Exercise Glasswing';
const p = maskPattern(T);
assert.equal(p.length, Array.from(T).length);
assert.equal(p.slice(0, 11), '%%%$$$$$$%$');
assert.equal(p[9], '%');
assert.equal(p[15], '$');
assert.equal(p[16], '%');
assert.equal(maskPattern('ab 😀c').length, 5);

// maskedPart
assert.equal(maskedPart('Ab*:k1:x:y'), 'Ab*');
assert.equal(maskedPart('X:s0:z'), 'X');

// localMask: kept positions verbatim, '$' positions -> '*'
assert.equal(
  localMask(T),
  'Ope' + '*'.repeat(6) + ' ' + '*'.repeat(6) + ' ' + '*'.repeat(8) + ' ' + '*'.repeat(9),
);
assert.equal(localMask(''), '');

console.log('tokens ok');
