import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';

function config() {
  return {
    nodeEnv: 'test', port: 0, publicBaseUrl: 'http://127.0.0.1',
    roomTokenSecret: 't'.repeat(48), generatedDevSecret: false,
    roomTtlSeconds: 3600, memberTokenTtlSeconds: 3600,
    identity: { mode: 'optional', baseUrl: '', verifyPath: '', timeoutMs: 250, appId: 'rydesync', loginUrl: '' },
    realtime: { authTimeoutMs: 5000, heartbeatMs: 60000, maxMessageBytes: 32768 },
    location: { minIntervalMs: 1000, staleAfterMs: 120000, maxClientAgeMs: 30000, maxFutureSkewMs: 10000, maxAccuracyMeters: 5000 },
    echoverse: { libraryApiUrl: 'http://echoverse-library-api:5304' }
  };
}

async function withServer(fn) {
  const server = createApp(config());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try { await fn(`http://127.0.0.1:${port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('health and guest room flow work without AV Identity configured', async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    const createdRes = await fetch(`${base}/v1/rooms`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Global Test' })
    });
    assert.equal(createdRes.status, 201);
    const created = await createdRes.json();
    const joinedRes = await fetch(`${base}/v1/rooms/${created.room.joinCode}/join`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'Rider 2' })
    });
    assert.equal(joinedRes.status, 200);
  });
});

test('EchoVerse entitlement route fails closed for guests', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/v1/echoverse/access`);
    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.error.code, 'auth_required');
  });
});

test('optional identity outage degrades public session to guest but never grants EchoVerse', async () => {
  await withServer(async (base) => {
    const headers = { authorization: 'Bearer deliberately-unverifiable-token' };
    const sessionRes = await fetch(`${base}/v1/session`, { headers });
    assert.equal(sessionRes.status, 200);
    const session = await sessionRes.json();
    assert.equal(session.principal.authenticated, false);
    assert.equal(session.principal.authState, 'unavailable');

    const accessRes = await fetch(`${base}/v1/echoverse/access`, { headers });
    assert.equal(accessRes.status, 401);
  });
});

test('required identity mode surfaces unavailable identity instead of pretending auth succeeded', async () => {
  const cfg = config();
  cfg.identity = { ...cfg.identity, mode: 'required' };
  const server = createApp(cfg);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/session`, {
      headers: { authorization: 'Bearer deliberately-unverifiable-token' }
    });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, 'identity_unavailable');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
