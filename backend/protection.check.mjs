// Self-check: TLP to protection mapping, unknown TLP rejected, PROTECTIONS contents.
import assert from 'node:assert/strict';
import { protectionFor, PROTECTIONS } from './protection.mjs';

assert.equal(protectionFor('CLEAR'), 'integrity');
for (const t of ['GREEN', 'AMBER', 'AMBER+STRICT', 'RED', 'RED+STRICT']) assert.equal(protectionFor(t), 'encrypted');
assert.equal(protectionFor('RED+STRICT'), protectionFor('RED'));
for (const bad of ['clear', 'WHITE', '', 'constructor', undefined, null]) {
  assert.throws(() => protectionFor(bad), /unknown tlp/);
}

assert.deepEqual(PROTECTIONS, ['none', 'integrity', 'encrypted']);
assert.ok(Object.isFrozen(PROTECTIONS));

console.log('protection ok');
