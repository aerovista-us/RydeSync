import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';

function config() {
  return {
    nodeEnv: 'test', port: 0, publicBaseUrl: 'http://127.0.0.1',
    roomTokenSecret: 'w'.repeat(48), generatedDevSecret: false,
    roomTtlSeconds: 3600, memberTokenTtlSeconds: 3600,
    identity: { mode: 'optional', baseUrl: '', verifyPath: '', timeoutMs: 250, appId: 'rydesync', loginUrl: '' },
    realtime: { authTimeoutMs: 1000, heartbeatMs: 60_000, maxMessageBytes: 32_768 },
    location: { minIntervalMs: 1000, staleAfterMs: 120000, maxClientAgeMs: 30000, maxFutureSkewMs: 10000, maxAccuracyMeters: 5000 },
    echoverse: { libraryApiUrl: 'http://echoverse-library-api:5304' }
  };
}

async function openServer() {
  const server = createApp(config());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    server,
    httpBase: `http://127.0.0.1:${port}`,
    wsBase: `ws://127.0.0.1:${port}`
  };
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function createRoom(httpBase, name = 'Realtime Test') {
  const response = await fetch(`${httpBase}/v1/rooms`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name })
  });
  assert.equal(response.status, 201);
  return response.json();
}

function onceOpen(ws, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('WebSocket open timeout')), timeoutMs);
    ws.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('WebSocket open failed')); }, { once: true });
  });
}

function nextJson(ws, predicate = () => true, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      reject(new Error('WebSocket message timeout'));
    }, timeoutMs);
    function onMessage(event) {
      let value;
      try { value = JSON.parse(event.data); } catch { return; }
      if (!predicate(value)) return;
      clearTimeout(timeout);
      ws.removeEventListener('message', onMessage);
      resolve(value);
    }
    ws.addEventListener('message', onMessage);
  });
}

function onceClose(ws, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve({ code: 1006, reason: '' });
    const timeout = setTimeout(() => reject(new Error('WebSocket close timeout')), timeoutMs);
    ws.addEventListener('close', (event) => {
      clearTimeout(timeout);
      resolve({ code: event.code, reason: event.reason });
    }, { once: true });
  });
}

async function closeWs(ws) {
  if (ws.readyState === WebSocket.CLOSED) return;
  const closed = onceClose(ws).catch(() => null);
  ws.close(1000, 'test complete');
  await closed;
}

test('room token authenticates realtime and yields authoritative snapshot', async () => {
  const { server, httpBase, wsBase } = await openServer();
  let ws;
  try {
    const created = await createRoom(httpBase);
    ws = new WebSocket(`${wsBase}/v1/realtime?room=${encodeURIComponent(created.room.id)}`);
    await onceOpen(ws);
    const authPromise = nextJson(ws, (m) => m.type === 'auth.ok');
    const snapshotPromise = nextJson(ws, (m) => m.type === 'room.snapshot');
    ws.send(JSON.stringify({ type: 'auth', token: created.token, lastSeenSeq: 0 }));
    const auth = await authPromise;
    const snapshot = await snapshotPromise;
    assert.equal(auth.member.id, created.member.id);
    assert.equal(auth.resumed, false);
    assert.equal(snapshot.room.id, created.room.id);
    assert.equal(snapshot.members.find((m) => m.id === created.member.id)?.online, true);
  } finally {
    if (ws) await closeWs(ws);
    await closeServer(server);
  }
});

test('second room member receives online and offline presence events', async () => {
  const { server, httpBase, wsBase } = await openServer();
  let hostWs;
  let riderWs;
  try {
    const created = await createRoom(httpBase, 'Presence Ride');
    const joinedRes = await fetch(`${httpBase}/v1/rooms/${created.room.joinCode}/join`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'Rider 2' })
    });
    const joined = await joinedRes.json();

    hostWs = new WebSocket(`${wsBase}/v1/realtime?room=${created.room.id}`);
    await onceOpen(hostWs);
    const hostAuth = nextJson(hostWs, (m) => m.type === 'auth.ok');
    hostWs.send(JSON.stringify({ type: 'auth', token: created.token }));
    await hostAuth;

    const onlinePromise = nextJson(hostWs, (m) => m.type === 'member.online' && m.member.id === joined.member.id);
    riderWs = new WebSocket(`${wsBase}/v1/realtime?room=${created.room.id}`);
    await onceOpen(riderWs);
    const riderAuth = nextJson(riderWs, (m) => m.type === 'auth.ok');
    riderWs.send(JSON.stringify({ type: 'auth', token: joined.token }));
    await riderAuth;
    const online = await onlinePromise;
    assert.equal(online.member.online, true);

    const offlinePromise = nextJson(hostWs, (m) => m.type === 'member.offline' && m.member.id === joined.member.id);
    await closeWs(riderWs);
    riderWs = null;
    const offline = await offlinePromise;
    assert.equal(offline.member.online, false);
  } finally {
    if (riderWs) await closeWs(riderWs);
    if (hostWs) await closeWs(hostWs);
    await closeServer(server);
  }
});

test('reconnect resumes membership and replaces stale socket', async () => {
  const { server, httpBase, wsBase } = await openServer();
  let first;
  let second;
  try {
    const created = await createRoom(httpBase, 'Reconnect Ride');
    first = new WebSocket(`${wsBase}/v1/realtime?room=${created.room.id}`);
    await onceOpen(first);
    const firstAuth = nextJson(first, (m) => m.type === 'auth.ok');
    first.send(JSON.stringify({ type: 'auth', token: created.token }));
    const initial = await firstAuth;

    const replaced = onceClose(first);
    second = new WebSocket(`${wsBase}/v1/realtime?room=${created.room.id}`);
    await onceOpen(second);
    const secondAuth = nextJson(second, (m) => m.type === 'auth.ok');
    second.send(JSON.stringify({ type: 'auth', token: created.token, lastSeenSeq: initial.seq }));
    const resumed = await secondAuth;
    const closed = await replaced;
    assert.equal(resumed.resumed, true);
    assert.equal(closed.code, 4009);
  } finally {
    if (second) await closeWs(second);
    if (first && first.readyState !== WebSocket.CLOSED) await closeWs(first);
    await closeServer(server);
  }
});

test('invalid room token is rejected after upgrade', async () => {
  const { server, httpBase, wsBase } = await openServer();
  let ws;
  try {
    const created = await createRoom(httpBase, 'Reject Ride');
    ws = new WebSocket(`${wsBase}/v1/realtime?room=${created.room.id}`);
    await onceOpen(ws);
    const closePromise = onceClose(ws);
    ws.send(JSON.stringify({ type: 'auth', token: 'not-a-valid-token' }));
    const closed = await closePromise;
    assert.equal(closed.code, 4003);
  } finally {
    if (ws && ws.readyState !== WebSocket.CLOSED) await closeWs(ws);
    await closeServer(server);
  }
});

test('live location is opt-in, room-scoped, and broadcast only after room authentication', async () => {
  const { server, httpBase, wsBase } = await openServer();
  let hostWs;
  let riderWs;
  try {
    const created = await createRoom(httpBase, 'Location Ride');
    const joinedRes = await fetch(`${httpBase}/v1/rooms/${created.room.joinCode}/join`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'Rider 2' })
    });
    const joined = await joinedRes.json();

    hostWs = new WebSocket(`${wsBase}/v1/realtime?room=${created.room.id}`);
    await onceOpen(hostWs);
    const hostSnapshot = nextJson(hostWs, (m) => m.type === 'room.snapshot');
    hostWs.send(JSON.stringify({ type: 'auth', token: created.token }));
    assert.deepEqual((await hostSnapshot).locations, []);

    riderWs = new WebSocket(`${wsBase}/v1/realtime?room=${created.room.id}`);
    await onceOpen(riderWs);
    const riderAuth = nextJson(riderWs, (m) => m.type === 'auth.ok');
    riderWs.send(JSON.stringify({ type: 'auth', token: joined.token }));
    await riderAuth;

    const locationEvent = nextJson(riderWs, (m) => m.type === 'location.member' && m.location.memberId === created.member.id);
    hostWs.send(JSON.stringify({
      type: 'location.update',
      coords: { latitude: 47.6777, longitude: -116.7805, accuracy: 8.5, speed: 11.2, heading: 90 },
      clientTs: Date.now()
    }));
    const event = await locationEvent;
    assert.equal(event.location.latitude, 47.6777);
    assert.equal(event.location.longitude, -116.7805);
    assert.equal(event.location.identityId, undefined);

    const snapshotPromise = nextJson(riderWs, (m) => m.type === 'room.snapshot' && Array.isArray(m.locations) && m.locations.length === 1);
    riderWs.send(JSON.stringify({ type: 'room.state.get' }));
    const snapshot = await snapshotPromise;
    assert.equal(snapshot.locations[0].memberId, created.member.id);
  } finally {
    if (riderWs) await closeWs(riderWs);
    if (hostWs) await closeWs(hostWs);
    await closeServer(server);
  }
});

test('server throttles location updates without closing the realtime session', async () => {
  const { server, httpBase, wsBase } = await openServer();
  let ws;
  try {
    const created = await createRoom(httpBase, 'Throttle Ride');
    ws = new WebSocket(`${wsBase}/v1/realtime?room=${created.room.id}`);
    await onceOpen(ws);
    const auth = nextJson(ws, (m) => m.type === 'auth.ok');
    ws.send(JSON.stringify({ type: 'auth', token: created.token }));
    await auth;

    const first = nextJson(ws, (m) => m.type === 'location.member');
    ws.send(JSON.stringify({ type: 'location.update', coords: { latitude: 47, longitude: -116, accuracy: 5 }, clientTs: Date.now() }));
    await first;
    const limited = nextJson(ws, (m) => m.type === 'location.rate_limited');
    ws.send(JSON.stringify({ type: 'location.update', coords: { latitude: 47.0001, longitude: -116, accuracy: 5 }, clientTs: Date.now() }));
    const message = await limited;
    assert.ok(message.retryAfterMs > 0);
    assert.equal(ws.readyState, WebSocket.OPEN);
  } finally {
    if (ws) await closeWs(ws);
    await closeServer(server);
  }
});

test('stopping location sharing immediately clears the room-scoped coordinate', async () => {
  const { server, httpBase, wsBase } = await openServer();
  let hostWs;
  let riderWs;
  try {
    const created = await createRoom(httpBase, 'Privacy Ride');
    const joinedRes = await fetch(`${httpBase}/v1/rooms/${created.room.joinCode}/join`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'Rider 2' })
    });
    const joined = await joinedRes.json();

    hostWs = new WebSocket(`${wsBase}/v1/realtime?room=${created.room.id}`);
    riderWs = new WebSocket(`${wsBase}/v1/realtime?room=${created.room.id}`);
    await Promise.all([onceOpen(hostWs), onceOpen(riderWs)]);
    const hostAuth = nextJson(hostWs, (m) => m.type === 'auth.ok');
    const riderAuth = nextJson(riderWs, (m) => m.type === 'auth.ok');
    hostWs.send(JSON.stringify({ type: 'auth', token: created.token }));
    riderWs.send(JSON.stringify({ type: 'auth', token: joined.token }));
    await Promise.all([hostAuth, riderAuth]);

    const location = nextJson(riderWs, (m) => m.type === 'location.member' && m.location.memberId === created.member.id);
    hostWs.send(JSON.stringify({ type: 'location.update', coords: { latitude: 47, longitude: -116, accuracy: 5 }, clientTs: Date.now() }));
    await location;

    const cleared = nextJson(riderWs, (m) => m.type === 'location.cleared' && m.memberId === created.member.id);
    hostWs.send(JSON.stringify({ type: 'location.stop' }));
    const event = await cleared;
    assert.equal(event.reason, 'stopped');

    const snapshotPromise = nextJson(riderWs, (m) => m.type === 'room.snapshot');
    riderWs.send(JSON.stringify({ type: 'room.state.get' }));
    assert.deepEqual((await snapshotPromise).locations, []);
  } finally {
    if (riderWs) await closeWs(riderWs);
    if (hostWs) await closeWs(hostWs);
    await closeServer(server);
  }
});

test('invalid location is rejected as a message error without terminating the ride socket', async () => {
  const { server, httpBase, wsBase } = await openServer();
  let ws;
  try {
    const created = await createRoom(httpBase, 'Validation Ride');
    ws = new WebSocket(`${wsBase}/v1/realtime?room=${created.room.id}`);
    await onceOpen(ws);
    const auth = nextJson(ws, (m) => m.type === 'auth.ok');
    ws.send(JSON.stringify({ type: 'auth', token: created.token }));
    await auth;
    const errorPromise = nextJson(ws, (m) => m.type === 'location.error');
    ws.send(JSON.stringify({ type: 'location.update', coords: { latitude: 999, longitude: -116, accuracy: 5 } }));
    const error = await errorPromise;
    assert.equal(error.error.code, 'invalid_location');
    assert.equal(ws.readyState, WebSocket.OPEN);
  } finally {
    if (ws) await closeWs(ws);
    await closeServer(server);
  }
});

test('disconnect clears a rider location instead of leaving stale coordinates behind', async () => {
  const { server, httpBase, wsBase } = await openServer();
  let hostWs;
  let riderWs;
  try {
    const created = await createRoom(httpBase, 'Disconnect Privacy');
    const joinedRes = await fetch(`${httpBase}/v1/rooms/${created.room.joinCode}/join`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'Rider 2' })
    });
    const joined = await joinedRes.json();

    hostWs = new WebSocket(`${wsBase}/v1/realtime?room=${created.room.id}`);
    riderWs = new WebSocket(`${wsBase}/v1/realtime?room=${created.room.id}`);
    await Promise.all([onceOpen(hostWs), onceOpen(riderWs)]);
    const hostAuth = nextJson(hostWs, (m) => m.type === 'auth.ok');
    const riderAuth = nextJson(riderWs, (m) => m.type === 'auth.ok');
    hostWs.send(JSON.stringify({ type: 'auth', token: created.token }));
    riderWs.send(JSON.stringify({ type: 'auth', token: joined.token }));
    await Promise.all([hostAuth, riderAuth]);

    const seen = nextJson(hostWs, (m) => m.type === 'location.member' && m.location.memberId === joined.member.id);
    riderWs.send(JSON.stringify({ type: 'location.update', coords: { latitude: 47.7, longitude: -116.8, accuracy: 6 }, clientTs: Date.now() }));
    await seen;

    const cleared = nextJson(hostWs, (m) => m.type === 'location.cleared' && m.memberId === joined.member.id);
    await closeWs(riderWs);
    riderWs = null;
    const event = await cleared;
    assert.equal(event.reason, 'offline');
  } finally {
    if (riderWs) await closeWs(riderWs);
    if (hostWs) await closeWs(hostWs);
    await closeServer(server);
  }
});

test('host playback command becomes authoritative room state for every member', async () => {
  const { server, httpBase, wsBase } = await openServer();
  let hostWs;
  let riderWs;
  try {
    const created = await createRoom(httpBase, 'Shared Soundtrack');
    const joinedRes = await fetch(`${httpBase}/v1/rooms/${created.room.joinCode}/join`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'Rider 2' })
    });
    const joined = await joinedRes.json();

    hostWs = new WebSocket(`${wsBase}/v1/realtime?room=${created.room.id}`);
    riderWs = new WebSocket(`${wsBase}/v1/realtime?room=${created.room.id}`);
    await Promise.all([onceOpen(hostWs), onceOpen(riderWs)]);
    const hostAuth = nextJson(hostWs, (m) => m.type === 'auth.ok');
    const riderAuth = nextJson(riderWs, (m) => m.type === 'auth.ok');
    hostWs.send(JSON.stringify({ type: 'auth', token: created.token }));
    riderWs.send(JSON.stringify({ type: 'auth', token: joined.token }));
    await Promise.all([hostAuth, riderAuth]);

    const shared = nextJson(riderWs, (m) => m.type === 'playback.state' && m.playback?.trackId === 'trk-crew');
    hostWs.send(JSON.stringify({ type: 'playback.select', trackId: 'trk-crew', autoplay: true, expectedEpoch: 0 }));
    const event = await shared;
    assert.equal(event.playback.status, 'playing');
    assert.equal(event.playback.epoch, 1);
    assert.equal(event.playback.updatedBy, created.member.id);
  } finally {
    if (riderWs) await closeWs(riderWs);
    if (hostWs) await closeWs(hostWs);
    await closeServer(server);
  }
});

test('rider cannot mutate room playback even though room realtime access is valid', async () => {
  const { server, httpBase, wsBase } = await openServer();
  let riderWs;
  try {
    const created = await createRoom(httpBase, 'Playback Roles');
    const joinedRes = await fetch(`${httpBase}/v1/rooms/${created.room.joinCode}/join`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'Rider 2' })
    });
    const joined = await joinedRes.json();
    riderWs = new WebSocket(`${wsBase}/v1/realtime?room=${created.room.id}`);
    await onceOpen(riderWs);
    const auth = nextJson(riderWs, (m) => m.type === 'auth.ok');
    riderWs.send(JSON.stringify({ type: 'auth', token: joined.token }));
    await auth;
    const denied = nextJson(riderWs, (m) => m.type === 'playback.error');
    riderWs.send(JSON.stringify({ type: 'playback.select', trackId: 'trk-nope', autoplay: true, expectedEpoch: 0 }));
    const event = await denied;
    assert.equal(event.error.code, 'playback_forbidden');
    assert.equal(riderWs.readyState, WebSocket.OPEN);
  } finally {
    if (riderWs) await closeWs(riderWs);
    await closeServer(server);
  }
});

test('reconnect snapshot restores current playback epoch and anchor', async () => {
  const { server, httpBase, wsBase } = await openServer();
  let hostWs;
  let second;
  try {
    const created = await createRoom(httpBase, 'Playback Reconnect');
    hostWs = new WebSocket(`${wsBase}/v1/realtime?room=${created.room.id}`);
    await onceOpen(hostWs);
    const auth = nextJson(hostWs, (m) => m.type === 'auth.ok');
    hostWs.send(JSON.stringify({ type: 'auth', token: created.token }));
    await auth;
    const state = nextJson(hostWs, (m) => m.type === 'playback.state' && m.playback?.trackId === 'trk-resume');
    hostWs.send(JSON.stringify({ type: 'playback.select', trackId: 'trk-resume', autoplay: true, expectedEpoch: 0 }));
    const selected = await state;
    await closeWs(hostWs);
    hostWs = null;

    second = new WebSocket(`${wsBase}/v1/realtime?room=${created.room.id}`);
    await onceOpen(second);
    const snapshot = nextJson(second, (m) => m.type === 'room.snapshot');
    second.send(JSON.stringify({ type: 'auth', token: created.token, lastSeenSeq: selected.seq }));
    const restored = await snapshot;
    assert.equal(restored.playback.trackId, 'trk-resume');
    assert.equal(restored.playback.status, 'playing');
    assert.equal(restored.playback.epoch, 1);
  } finally {
    if (second) await closeWs(second);
    if (hostWs) await closeWs(hostWs);
    await closeServer(server);
  }
});

test('playing rooms emit periodic playback.sync drift hints without changing epoch', async () => {
  const cfg = config();
  cfg.playback = { syncIntervalMs: 30, softDriftMs: 250, hardDriftMs: 1500 };
  const server = createApp(cfg);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const httpBase = `http://127.0.0.1:${port}`;
  const wsBase = `ws://127.0.0.1:${port}`;
  let ws;
  try {
    const created = await createRoom(httpBase, 'Drift Hint Ride');
    ws = new WebSocket(`${wsBase}/v1/realtime?room=${created.room.id}`);
    await onceOpen(ws);
    const auth = nextJson(ws, (m) => m.type === 'auth.ok');
    ws.send(JSON.stringify({ type: 'auth', token: created.token }));
    await auth;
    const selected = nextJson(ws, (m) => m.type === 'playback.state' && m.playback?.trackId === 'trk-sync');
    ws.send(JSON.stringify({ type: 'playback.select', trackId: 'trk-sync', autoplay: true, expectedEpoch: 0 }));
    const state = await selected;
    const sync = await nextJson(ws, (m) => m.type === 'playback.sync' && m.playback?.trackId === 'trk-sync', 1000);
    assert.equal(sync.playback.epoch, state.playback.epoch);
    assert.equal(sync.seq, state.seq);
  } finally {
    if (ws) await closeWs(ws);
    await closeServer(server);
  }
});
