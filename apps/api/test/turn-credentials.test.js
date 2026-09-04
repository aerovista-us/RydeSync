import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { issueTurnIceServers, turnIsConfigured } from '../lib/turn-credentials.js';

function turnConfig() {
  return {
    voice: {
      enabled: true,
      stunUrls: ['stun:stun.l.google.com:19302'],
      turnUrls: ['turn:turn.rydesync.aerovista.us:3478?transport=udp', 'turn:turn.rydesync.aerovista.us:3478?transport=tcp'],
      turnSharedSecret: 'shared-secret-1234567890',
      turnCredentialTtlSeconds: 1800,
      turnUsername: '',
      turnCredential: ''
    }
  };
}

test('TURN REST credentials are deterministic HMAC-SHA1, scoped and expiring', () => {
  const cfg = turnConfig();
  assert.equal(turnIsConfigured(cfg), true);
  const issued = issueTurnIceServers({ roomId: 'ryde_test', memberId: 'member_test' }, cfg, 1_700_000_000_000);
  assert.equal(issued.turnConfigured, true);
  assert.equal(issued.credentialMode, 'room-ephemeral');
  assert.equal(issued.expiresAt, '2023-11-14T22:43:20.000Z');
  assert.equal(issued.iceServers.length, 2);
  const turn = issued.iceServers[1];
  assert.equal(turn.username, '1700001800:ryde_test:member_test');
  assert.equal(turn.credential, 'mm8OOCQNlrXLlz1Ts9RRIwK3UA0=');
  assert.deepEqual(turn.urls, cfg.voice.turnUrls);
});

test('TURN credential expiration never extends beyond the Ryde lifetime', () => {
  const cfg = turnConfig();
  cfg.voice.turnCredentialTtlSeconds = 21_600;
  const now = 1_700_000_000_000;
  const roomExpiresAt = now + 3_600_000;
  const issued = issueTurnIceServers({
    roomId: 'ryde_lifetime',
    memberId: 'member_lifetime',
    roomExpiresAt
  }, cfg, now);
  assert.equal(issued.expiresAt, new Date(roomExpiresAt).toISOString());
  assert.match(issued.iceServers[1].username, /^1700003600:ryde_lifetime:member_lifetime$/);
});

function appConfig() {
  return {
    nodeEnv: 'test', port: 0, publicBaseUrl: 'http://127.0.0.1',
    roomTokenSecret: 'r'.repeat(48), generatedDevSecret: false,
    roomTtlSeconds: 3600, memberTokenTtlSeconds: 3600,
    identity: {
      mode: 'optional', baseUrl: '', verifyPath: '', timeoutMs: 250, appId: 'rydesync',
      loginUrl: '', identityGatewayOrigin: '', serviceSecret: '', capabilitySnapshot: [], browserSessionTtlSeconds: 900,
      verifyToken: async () => ({ identity_id: 'identity_turn_host', display_name: 'TURN Host', capabilities: [] })
    },
    voice: {
      enabled: true,
      maxPeers: 12,
      stunUrls: ['stun:stun.l.google.com:19302'],
      turnUrls: ['turn:turn.rydesync.aerovista.us:3478?transport=udp', 'turn:turn.rydesync.aerovista.us:3478?transport=tcp'],
      turnSharedSecret: 'shared-secret-1234567890',
      turnRealm: 'turn.rydesync.aerovista.us',
      turnCredentialTtlSeconds: 7200,
      turnUsername: '', turnCredential: ''
    },
    realtime: { authTimeoutMs: 5000, heartbeatMs: 60000, maxMessageBytes: 32768 },
    location: { minIntervalMs: 1000, staleAfterMs: 120000, maxClientAgeMs: 30000, maxFutureSkewMs: 10000, maxAccuracyMeters: 5000 },
    playback: { syncIntervalMs: 3000, softDriftMs: 150, hardDriftMs: 750 },
    map: { tileUrlTemplate: '', attribution: '', attributionUrl: '', minZoom: 2, maxZoom: 18 },
    echoverse: { libraryApiUrl: 'http://echoverse-library-api:5304', mediaSessionTtlSeconds: 600 }
  };
}

async function withServer(fn) {
  const server = createApp(appConfig());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try { await fn(`http://127.0.0.1:${port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('public bootstrap advertises TURN readiness without exposing relay credentials', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/v1/bootstrap`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.features.turnReady, true);
    assert.equal(body.voice.turnConfigured, true);
    assert.equal(body.voice.turnCredentialMode, 'room-ephemeral');
    assert.deepEqual(body.voice.iceServers, [{ urls: ['stun:stun.l.google.com:19302'] }]);
    const serialized = JSON.stringify(body);
    assert.doesNotMatch(serialized, /shared-secret-1234567890/);
    assert.doesNotMatch(serialized, /turn\.rydesync\.aerovista\.us:3478/);
  });
});

test('TURN credentials require a live Ryde room token and are capped by room expiry', async () => {
  await withServer(async (base) => {
    const createdResponse = await fetch(`${base}/v1/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer turn-host' },
      body: JSON.stringify({ name: 'TURN Room', mode: 'group_ride' })
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();

    const denied = await fetch(`${base}/v1/voice/ice`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ roomToken: 'not-valid' })
    });
    assert.equal(denied.status, 401);

    const allowed = await fetch(`${base}/v1/voice/ice`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ roomToken: created.token })
    });
    assert.equal(allowed.status, 200);
    const body = await allowed.json();
    assert.equal(body.turnConfigured, true);
    assert.equal(body.credentialMode, 'room-ephemeral');
    assert.equal(body.roomId, created.room.id);
    assert.equal(body.memberId, created.member.id);
    assert.equal(body.secretExposed, false);
    assert.equal(body.iceServers.length, 2);
    assert.match(body.iceServers[1].username, /^\d+:ryde_[A-Za-z0-9_-]+:[0-9a-f-]+$/);
    assert.ok(body.iceServers[1].credential.length > 20);
    assert.ok(Date.parse(body.expiresAt) <= Date.parse(created.room.expiresAt));
    assert.doesNotMatch(JSON.stringify(body), /shared-secret-1234567890/);
  });
});
