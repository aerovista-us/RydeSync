import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';

function config() {
  return {
    nodeEnv: 'test', port: 0, publicBaseUrl: 'http://127.0.0.1',
    roomTokenSecret: 't'.repeat(48), generatedDevSecret: false,
    roomTtlSeconds: 3600, memberTokenTtlSeconds: 3600,
    identity: { mode: 'optional', baseUrl: '', verifyPath: '', timeoutMs: 250, appId: 'rydesync', loginUrl: '', verifyToken: async () => ({ identity_id: 'identity_test_host', display_name: 'Test Host', capabilities: [] }) },
    realtime: { authTimeoutMs: 5000, heartbeatMs: 60000, maxMessageBytes: 32768 },
    location: { minIntervalMs: 1000, staleAfterMs: 120000, maxClientAgeMs: 30000, maxFutureSkewMs: 10000, maxAccuracyMeters: 5000 },
    echoverse: { libraryApiUrl: 'http://echoverse-library-api:5304' }
  };
}

async function withServer(fn, cfg = config()) {
  const server = createApp(cfg);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try { await fn(`http://127.0.0.1:${port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('guest can join but must sign in to start a Ryde', async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    const guestCreate = await fetch(`${base}/v1/rooms`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Guest Cannot Host' })
    });
    assert.equal(guestCreate.status, 401);

    const createdRes = await fetch(`${base}/v1/rooms`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer test-host' }, body: JSON.stringify({ name: 'Global Test' })
    });
    assert.equal(createdRes.status, 201);
    const created = await createdRes.json();
    assert.equal(created.member.identityId, 'identity_test_host');

    const joinedRes = await fetch(`${base}/v1/rooms/${created.room.joinCode}/join`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'Rider 2' })
    });
    assert.equal(joinedRes.status, 200);
    const joined = await joinedRes.json();
    assert.equal(joined.member.identityId, null);
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
  const cfg = config();
  cfg.identity = { ...cfg.identity, verifyToken: async () => { throw new Error('gateway offline'); } };
  await withServer(async (base) => {
    const headers = { authorization: 'Bearer deliberately-unverifiable-token' };
    const sessionRes = await fetch(`${base}/v1/session`, { headers });
    assert.equal(sessionRes.status, 200);
    const session = await sessionRes.json();
    assert.equal(session.principal.authenticated, false);
    assert.equal(session.principal.authState, 'unavailable');

    const accessRes = await fetch(`${base}/v1/echoverse/access`, { headers });
    assert.equal(accessRes.status, 401);
  }, cfg);
});

test('required identity mode surfaces unavailable identity instead of pretending auth succeeded', async () => {
  const cfg = config();
  cfg.identity = { ...cfg.identity, mode: 'required', verifyToken: async () => { throw new Error('gateway offline'); } };
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

test('public responses carry baseline browser security and permission headers', async () => {
  const cfg = config();
  const server = createApp(cfg);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('referrer-policy'), 'same-origin');
    assert.equal(response.headers.get('permissions-policy'), 'geolocation=(self), microphone=(self), camera=()');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('every browser asset referenced by the tabbed product UI is publicly served', async () => {
  await withServer(async (base) => {
    const assets = [
      ['/', 'text/html'],
      ['/app.js', 'text/javascript'],
      ['/styles.css', 'text/css'],
      ['/product-ui.css', 'text/css'],
      ['/ui-shell.js', 'text/javascript'],
      ['/catalog-bridge.js', 'text/javascript'],
      ['/library-ui.js', 'text/javascript'],
      ['/library-core.js', 'text/javascript'],
      ['/map.js', 'text/javascript'],
      ['/map-core.js', 'text/javascript'],
      ['/sync-core.js', 'text/javascript'],
      ['/audio-engine.js', 'text/javascript'],
      ['/voice.js', 'text/javascript']
    ];

    for (const [pathname, contentType] of assets) {
      const response = await fetch(`${base}${pathname}`);
      assert.equal(response.status, 200, `${pathname} should be served`);
      assert.match(response.headers.get('content-type') || '', new RegExp(`^${contentType.replace('/', '\\/')}`), `${pathname} should have ${contentType}`);
      assert.ok((await response.text()).length > 0, `${pathname} should not be empty`);
    }
  });
});
