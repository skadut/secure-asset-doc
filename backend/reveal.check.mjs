// Self-check: reveal/conceal with fake crypto. Pure, no HTTP.
import assert from 'node:assert/strict';
import { reveal, conceal, isSealed, SEALED_MASK } from './reveal.mjs';

const calls = [];
const ok = {
  detokenize: async (t) => (calls.push(['d', t.length]), t.map((x) => `plain(${x.slice(0, 3)})`)),
  unseal: async (t) => (calls.push(['u', t.length]), t.map((x) => `open(${x.length})`)),
};
const row = () => ({ ip: '10.**:t1:d0:x', fw: 'skadut-t1:d0:abc', model: 'plain', none: null });

assert.equal(isSealed('skadut-t1:x'), true);
assert.equal(isSealed('Ab*:t1:x'), false);
assert.equal(isSealed(null), false);

{
  const a = row(), b = row();
  await reveal([[a, 'ip'], [a, 'fw'], [a, 'model'], [a, 'none'], [b, 'ip'], [b, 'fw']], ok);
  assert.deepEqual(calls, [['d', 2], ['u', 2]], 'one batched call per kind');
  assert.equal(a.ip, 'plain(10.)');
  assert.equal(a.fw, 'open(16)');
  assert.equal(a.model, 'plain');
  assert.equal(a.none, null);
}
{
  calls.length = 0;
  await reveal([[row(), 'model']], ok);
  assert.equal(calls.length, 0, 'no call when nothing protected');
}
for (const bad of [async () => null, async (t) => t.slice(1)]) {
  const a = row();
  await reveal([[a, 'ip'], [a, 'fw']], { detokenize: bad, unseal: bad });
  assert.equal(a.ip, '10.**', 'token fails closed to masked part');
  assert.equal(a.fw, SEALED_MASK, 'sealed fails closed to mask');
}
{
  const a = row();
  conceal([[a, 'ip'], [a, 'fw'], [a, 'model']]);
  assert.deepEqual([a.ip, a.fw, a.model], ['10.**', SEALED_MASK, 'plain']);
}

console.log('reveal ok');
