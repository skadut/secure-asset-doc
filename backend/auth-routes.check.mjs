// Self-check: device-check crypto probe pass/fail and 5 s cache. Offline, fake cryptoPost.
import assert from 'node:assert/strict';
import { makeAuthRoutes } from './auth-routes.mjs';
import { createChallengeStore } from './auth.mjs';

function harness(cryptoPost) {
  const challengeStore = createChallengeStore();
  const challenge = challengeStore.create('u1');
  const q = async () => ({ rows: [] });
  const send = (res, status, body, headers = {}) => Object.assign(res, { status, body, headers });
  const routes = makeAuthRoutes({
    q, send, challengeStore, limiter: {}, readRaw: async () => null, cryptoPost,
  });
  const req = { headers: { 'x-challenge': challenge }, socket: { remoteAddress: '127.0.0.1' }, url: '/api/auth/device-check' };
  return { routes, req };
}

// a. real post shape for HTTP 200 with {Value:false} -> pass
{
  const h = harness(async () => ({ status: 200, json: { Value: false } }));
  const res = {};
  await h.routes.deviceCheck(h.req, res);
  assert.equal(res.status, 200);
  assert.equal(res.body.checks.crypto.status, 'pass');
  assert.equal(typeof res.body.checks.crypto.latencyMs, 'number');
  assert.equal(Object.hasOwn(res.body.checks, 'hostname'), false);
}

// b. throw -> fail with note
{
  const h = harness(async () => { throw new Error('crypto timeout'); });
  const res = {};
  await h.routes.deviceCheck(h.req, res);
  assert.equal(res.body.checks.crypto.status, 'fail');
  assert.equal(res.body.checks.crypto.note, 'crypto-api tidak merespons');
}

// c. two calls within 5 s -> one probe
{
  let calls = 0;
  const h = harness(async () => { calls++; return { status: 200, json: { Value: false } }; });
  await h.routes.deviceCheck(h.req, {});
  await h.routes.deviceCheck(h.req, {});
  assert.equal(calls, 1);
}
