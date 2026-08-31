import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { HttpError } from '../lib/http.js';
import { SYNTHETIC_IDENTITIES, principalFor } from './fixtures/synthetic-identities.js';

function baseConfig({ turn = false } = {}) {
  let revokedLibrary = false;
  const byToken = new Map(
    Object.values(SYNTHETIC_IDENTITIES)
      .filter((identity) => identity.token)
      .map((identity) => [identity.token, identity])
  );

  const config = {
    nodeEnv: 'test',
    port: 0,
    publicBaseUrl: 'http://127.0.0.1',
    roomTokenSecret: 's'.repeat(48),
    generatedDevSecret: false,
    roomTtlSeconds: 3600,
    memberTokenTtlSeconds: 3600,
    identity: {
      mode: 'optional',
      baseUrl: '',
      verifyPath: '',
      timeoutMs: 250,
      appId: 'rydesync',
      loginUrl: '',
      capabilitySnapshot: ['echoverse.library.listen'],
      verifyToken: async (token) => {
        const identity = byToken.get(token);
        if (!identity) throw new HttpError(401, 'identity_rejected', 'Unknown synthetic identity');
        if (identity === SYNTHETIC_IDENTITIES.expired01) {
          throw new HttpError(401, 'identity_rejected', 'Synthetic session expired');
        }
        const capabilities = identity === SYNTHETIC_IDENTITIES.revoked01 && revokedLibrary
          ? []
          : identity.capabilities;
        const principal = principalFor(identity, capabilities);
        if (identity === SYNTHETIC_IDENTITIES.stale01) {
          return Object.freeze({
            ...principal,
            capabilitiesFresh: false,
            authState: 'handoff_session',
            reason: 'live_capabilities_not_verified'
          });
        }
        return principal;
      }
    },
    voice: {
      enabled: true,
      maxPeers: 12,
      stunUrls: ['stun:stun.l.google.com:19302'],
      turnUrls: turn ? ['turn:turn.test.invalid:3478?transport=udp'] : [],
      turnUsername: turn ? 'synthetic-turn-user' : '',
      turnCredential: turn ? 'synthetic-turn-credential' : ''
    },
    realtime: { authTimeoutMs: 5000, heartbeatMs: 60000, maxMessageBytes: 32768 },
    playback: { syncIntervalMs: 10000, softDriftMs: 250, hardDriftMs: 1500 },
    location: {
      minIntervalMs: 1000,
      staleAfterMs: 120000,
      maxClientAgeMs: 30000,
      maxFutureSkewMs: 10000,
      maxAccuracyMeters: 5000
    },
    map: {
      tileUrlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: 'test',
      attributionUrl: 'https://example.invalid',
      minZoom: 2,
      maxZoom: 18
    },
    echoverse: {
      libraryApiUrl: 'http://echoverse-library-api:5304',
      timeoutMs: 500,
      serviceToken: '',
      mediaSessionTtlSeconds: 600
    }
  };

  return {
    config,
    revokeLibrary() { revokedLibrary = true; }
  };
}

async function withServer(config, fn) {
  const server = createApp(config);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function authHeaders(identity) {
  return identity.token ? { authorization: `Bearer ${identity.token}` } : {};
}

async function json(response) {
  return { status: response.status, body: await response.json() };
}

test('synthetic staff/member/guest identities enforce EchoVerse and room boundaries', async () => {
  const harness = baseConfig();
  await withServer(harness.config, async (base) => {
    const expected = [
      ['staff01', true, 200],
      ['staff02', true, 403],
      ['member01', true, 200],
      ['member02', true, 403],
      ['guest01', false, 401],
      ['guest02', false, 401]
    ];

    for (const [name, authenticated, accessStatus] of expected) {
      const identity = SYNTHETIC_IDENTITIES[name];
      const session = await json(await fetch(`${base}/v1/session`, { headers: authHeaders(identity) }));
      assert.equal(session.status, 200, `${name} session response`);
      assert.equal(session.body.principal.authenticated, authenticated, `${name} authenticated state`);

      const access = await json(await fetch(`${base}/v1/echoverse/access`, { headers: authHeaders(identity) }));
      assert.equal(access.status, accessStatus, `${name} EchoVerse access`);
      if (accessStatus === 200) {
        assert.equal(access.body.allowed, true);
        assert.equal(access.body.capability, 'echoverse.library.listen');
      } else {
        assert.equal(
          access.body.error.code,
          authenticated ? 'capability_required' : 'auth_required',
          `${name} denial reason`
        );
      }
    }

    for (const name of ['staff01', 'staff02', 'member01', 'member02']) {
      const identity = SYNTHETIC_IDENTITIES[name];
      const response = await fetch(`${base}/v1/rooms`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders(identity) },
        body: JSON.stringify({ name: `${name} synthetic Ryde` })
      });
      assert.equal(response.status, 201, `${name} can start a Ryde when authenticated`);
    }

    for (const name of ['guest01', 'guest02']) {
      const identity = SYNTHETIC_IDENTITIES[name];
      const response = await fetch(`${base}/v1/rooms`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: `${name} cannot host` })
      });
      assert.equal(response.status, 401, `${name} cannot start a Ryde`);
    }

    const host = SYNTHETIC_IDENTITIES.staff01;
    const created = await json(await fetch(`${base}/v1/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(host) },
      body: JSON.stringify({ name: 'Guest Join Acceptance' })
    }));
    assert.equal(created.status, 201);

    for (const name of ['guest01', 'guest02']) {
      const identity = SYNTHETIC_IDENTITIES[name];
      const joined = await json(await fetch(`${base}/v1/rooms/${created.body.room.joinCode}/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: identity.displayName })
      }));
      assert.equal(joined.status, 200, `${name} can join a public Ryde`);
      assert.equal(joined.body.member.identityId, null, `${name} remains guest-scoped`);
    }
  });
});

test('revoked01 loses EchoVerse immediately without server restart but remains authenticated', async () => {
  const harness = baseConfig();
  const identity = SYNTHETIC_IDENTITIES.revoked01;
  await withServer(harness.config, async (base) => {
    const before = await json(await fetch(`${base}/v1/echoverse/access`, { headers: authHeaders(identity) }));
    assert.equal(before.status, 200);

    harness.revokeLibrary();

    const after = await json(await fetch(`${base}/v1/echoverse/access`, { headers: authHeaders(identity) }));
    assert.equal(after.status, 403);
    assert.equal(after.body.error.code, 'capability_required');

    const session = await json(await fetch(`${base}/v1/session`, { headers: authHeaders(identity) }));
    assert.equal(session.status, 200);
    assert.equal(session.body.principal.authenticated, true);
    assert.deepEqual(session.body.principal.capabilities, []);

    const room = await fetch(`${base}/v1/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(identity) },
      body: JSON.stringify({ name: 'Revoked Library Still Can Ryde' })
    });
    assert.equal(room.status, 201, 'library revocation does not revoke general authenticated Ryde use');
  });
});

test('stale01 fails closed for capability-gated access while preserving authenticated identity', async () => {
  const harness = baseConfig();
  const identity = SYNTHETIC_IDENTITIES.stale01;
  await withServer(harness.config, async (base) => {
    const session = await json(await fetch(`${base}/v1/session`, { headers: authHeaders(identity) }));
    assert.equal(session.status, 200);
    assert.equal(session.body.principal.authenticated, true);
    assert.equal(session.body.principal.capabilitiesFresh, false);
    assert.equal(session.body.principal.reason, 'live_capabilities_not_verified');

    const access = await json(await fetch(`${base}/v1/echoverse/access`, { headers: authHeaders(identity) }));
    assert.equal(access.status, 503);
    assert.equal(access.body.error.code, 'identity_unavailable');

    const room = await fetch(`${base}/v1/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(identity) },
      body: JSON.stringify({ name: 'Stale Authorization General Ryde' })
    });
    assert.equal(room.status, 201, 'stale capability snapshot does not erase authenticated identity');
  });
});

test('expired and unknown credentials are rejected instead of downgraded', async () => {
  const harness = baseConfig();
  await withServer(harness.config, async (base) => {
    for (const token of [SYNTHETIC_IDENTITIES.expired01.token, 'synthetic-unknown01']) {
      for (const path of ['/v1/session', '/v1/echoverse/access']) {
        const response = await json(await fetch(`${base}${path}`, {
          headers: { authorization: `Bearer ${token}` }
        }));
        assert.equal(response.status, 401, `${path} rejects ${token}`);
        assert.equal(response.body.error.code, 'identity_rejected');
      }
    }
  });
});

test('PTT bootstrap is ready with STUN alone and accurately reports TURN readiness', async () => {
  const noTurn = baseConfig({ turn: false });
  await withServer(noTurn.config, async (base) => {
    const bootstrap = await json(await fetch(`${base}/v1/bootstrap`));
    assert.equal(bootstrap.status, 200);
    assert.equal(bootstrap.body.features.pushToTalk, true);
    assert.equal(bootstrap.body.features.turnReady, false);
    assert.equal(bootstrap.body.voice.turnConfigured, false);
    assert.equal(bootstrap.body.voice.turnCredentialMode, 'none');
    assert.deepEqual(bootstrap.body.voice.iceServers, [{ urls: ['stun:stun.l.google.com:19302'] }]);
  });

  const withTurn = baseConfig({ turn: true });
  await withServer(withTurn.config, async (base) => {
    const bootstrap = await json(await fetch(`${base}/v1/bootstrap`));
    assert.equal(bootstrap.status, 200);
    assert.equal(bootstrap.body.features.pushToTalk, true);
    assert.equal(bootstrap.body.features.turnReady, true);
    assert.equal(bootstrap.body.voice.turnConfigured, true);
    assert.equal(bootstrap.body.voice.turnCredentialMode, 'room-static-legacy');
    assert.deepEqual(bootstrap.body.voice.iceServers, [{ urls: ['stun:stun.l.google.com:19302'] }]);
    assert.doesNotMatch(JSON.stringify(bootstrap.body), /synthetic-turn-user|synthetic-turn-credential|turn\.test\.invalid/);
  });
});
