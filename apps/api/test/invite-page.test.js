import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';

function config() {
  return {
    nodeEnv: 'test', port: 0, publicBaseUrl: 'http://127.0.0.1',
    roomTokenSecret: 'q'.repeat(48), generatedDevSecret: false,
    roomTtlSeconds: 3600, memberTokenTtlSeconds: 3600,
    identity: {
      mode: 'optional', baseUrl: '', verifyPath: '', timeoutMs: 250, appId: 'rydesync',
      loginUrl: '', identityGatewayOrigin: '', serviceSecret: '', capabilitySnapshot: [],
      verifyToken: async () => ({ identity_id: 'identity_invite_host', display_name: 'Invite Host', capabilities: [] })
    },
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

test('QR invite page is public, room-bound, and never exposes the host room token', async () => {
  await withServer(async (base) => {
    const createdResponse = await fetch(`${base}/v1/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer invite-host' },
      body: JSON.stringify({ name: 'QR Test Ryde', mode: 'group_ride' })
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();

    const invite = await fetch(`${base}/join/${created.room.joinCode}`);
    assert.equal(invite.status, 200);
    assert.match(invite.headers.get('content-type') || '', /^text\/html/);
    const html = await invite.text();
    assert.match(html, /Continue as Guest/);
    assert.match(html, /Sign in with AeroVista/);
    assert.doesNotMatch(html, new RegExp(created.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    for (const [asset, type] of [['/join.js', 'text/javascript'], ['/join.css', 'text/css'], ['/qr-lite.js', 'text/javascript']]) {
      const response = await fetch(`${base}${asset}`);
      assert.equal(response.status, 200, `${asset} should be public`);
      assert.match(response.headers.get('content-type') || '', new RegExp(`^${type.replace('/', '\\/')}`));
    }

    const joinedResponse = await fetch(`${base}/v1/rooms/${created.room.joinCode}/join`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'QR Guest' })
    });
    assert.equal(joinedResponse.status, 200);
    const joined = await joinedResponse.json();
    assert.equal(joined.room.joinCode, created.room.joinCode);
    assert.equal(joined.member.displayName, 'QR Guest');
    assert.equal(joined.member.identityId, null);
  });
});

test('malformed join paths do not fall through to the invite page', async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/join/not-a-room`)).status, 404);
  });
});
