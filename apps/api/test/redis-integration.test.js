import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../server.js';
import { createConfiguredRoomStore } from '../lib/redis-room-repository.js';

const enabled = Boolean(process.env.REDIS_TEST_URL);
const prefix = () => `rydesync:test:${crypto.randomBytes(8).toString('hex')}:`;
function config(namespace) {
  return {
    nodeEnv: 'test', port: 0, publicBaseUrl: 'http://127.0.0.1',
    roomTokenSecret: 'r'.repeat(48), roomTtlSeconds: 3600, memberTokenTtlSeconds: 3600,
    storage: { driver: 'redis', url: process.env.REDIS_TEST_URL, prefix: namespace, timeoutMs: 500, leaseMs: 12000 },
    identity: { mode: 'optional', baseUrl: '', verifyPath: '', timeoutMs: 250, appId: 'rydesync', loginUrl: '', verifyToken: async () => ({ identity_id: 'synthetic_host', display_name: 'Synthetic Host', capabilities: [] }) },
    voice: { enabled: true, maxPeers: 12, stunUrls: [], turnUrls: [] },
    realtime: { authTimeoutMs: 2000, heartbeatMs: 10000, maxMessageBytes: 32768 },
    playback: { syncIntervalMs: 1000 },
    location: { minIntervalMs: 1000, staleAfterMs: 15000, maxClientAgeMs: 30000, maxFutureSkewMs: 10000, maxAccuracyMeters: 5000 },
    echoverse: { libraryApiUrl: 'http://unreachable.invalid' }
  };
}
const host = { identityId: 'synthetic_host', displayName: 'Synthetic Host' };

async function start(cfg) {
  const rooms = await createConfiguredRoomStore(cfg);
  const server = createApp(cfg, { rooms });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { rooms, server, base: `http://127.0.0.1:${server.address().port}` };
}
function nextJson(ws, type) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.removeEventListener('message', receive); reject(new Error(`Timed out: ${type}`)); }, 5000);
    function receive(event) {
      const value = JSON.parse(event.data);
      if (value.type !== type) return;
      clearTimeout(timer); ws.removeEventListener('message', receive); resolve(value);
    }
    ws.addEventListener('message', receive);
  });
}
async function connect(base, created) {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/v1/realtime?room=${created.room.id}`);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  const snapshot = nextJson(ws, 'room.snapshot');
  ws.send(JSON.stringify({ type: 'auth', token: created.token, lastSeenSeq: 99 }));
  return { ws, snapshot: await snapshot };
}

test('real Redis HTTP/WS restart preserves membership, locks and playback; clears location/voice', { skip: !enabled }, async () => {
  const cfg = config(prefix());
  let app = await start(cfg);
  try {
    const createdResponse = await fetch(`${app.base}/v1/rooms`, { method: 'POST', headers: { authorization: 'Bearer synthetic', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Redis isolated test' }) });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    const joinResponse = await fetch(`${app.base}/v1/rooms/${created.room.joinCode}/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'Synthetic Guest' }) });
    assert.equal(joinResponse.status, 200);
    const guest = await joinResponse.json();
    const { ws } = await connect(app.base, created);
    let result = nextJson(ws, 'playback.state');
    ws.send(JSON.stringify({ type: 'playback.select', trackId: 'synthetic-track', autoplay: true }));
    assert.equal((await result).playback.epoch, 1);
    result = nextJson(ws, 'room.locked');
    ws.send(JSON.stringify({ type: 'room.lock.set', locked: true }));
    assert.equal((await result).locked, true);
    result = nextJson(ws, 'voice.joined'); ws.send(JSON.stringify({ type: 'voice.join' })); await result;
    result = nextJson(ws, 'voice.floor'); ws.send(JSON.stringify({ type: 'voice.talk.start' })); await result;
    result = nextJson(ws, 'location.member');
    ws.send(JSON.stringify({ type: 'location.update', coords: { latitude: 47.69242, longitude: -116.77771, accuracy: 5 }, clientTs: Date.now() }));
    await result;
    const stored = await app.rooms.repository.command(['GET', `${cfg.storage.prefix}room:${created.room.id}`]);
    assert.equal(stored.includes('47.69242'), false);
    assert.equal(stored.includes('116.77771'), false);
    assert.equal(stored.includes(created.token), false);
    assert.equal(stored.includes('voiceFloor'), false);
    await app.server.shutdown();
    app = await start(cfg);
    const resumed = await connect(app.base, { room: created.room, token: guest.token });
    assert.equal(resumed.snapshot.members.length, 2);
    assert.equal(resumed.snapshot.playback.trackId, 'synthetic-track');
    assert.equal(resumed.snapshot.playback.epoch, 1);
    assert.equal(resumed.snapshot.room.locked, true);
    assert.deepEqual(resumed.snapshot.locations, []);
    assert.deepEqual(resumed.snapshot.voice.peers, []);
    assert.equal(resumed.snapshot.voice.floorMemberId, null);
    const denied = await fetch(`${app.base}/v1/rooms/${created.room.id}/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(denied.status, 423);
    const forbidden = nextJson(resumed.ws, 'playback.error');
    resumed.ws.send(JSON.stringify({ type: 'playback.clear' }));
    assert.equal((await forbidden).error.code, 'playback_forbidden');
    await app.rooms.end(created.room.id, created.member.id);
  } finally { await app.server.shutdown(); }
});

test('real Redis refuses duplicate writer and fences a writer after lease theft', { skip: !enabled }, async () => {
  const cfg = config(prefix());
  const store = await createConfiguredRoomStore(cfg);
  try {
    await assert.rejects(createConfiguredRoomStore(cfg), /Redis startup failed/);
    const created = await store.create({ name: 'Lease test' }, host);
    await store.repository.command(['SET', store.repository.leaseKey, 'different-writer', 'PX', '1500']);
    await assert.rejects(store.join(created.room.id, { displayName: 'Denied' }, { identityId: null }), { code: 'storage_unavailable' });
    assert.equal(store.rooms.get(created.room.id).members.size, 1);
    assert.throws(() => store.resolve(created.room.id), { code: 'storage_unavailable' });
  } finally { await store.close(); }
});

test('real Redis outage returns 503 health and rejects reads/create without fallback', { skip: !enabled }, async () => {
  const app = await start(config(prefix()));
  try {
    const created = await app.rooms.create({ name: 'Outage test' }, host);
    app.rooms.repository.client.destroy();
    assert.equal((await fetch(`${app.base}/health`)).status, 503);
    assert.equal((await fetch(`${app.base}/v1/rooms/${created.room.id}`)).status, 503);
    const denied = await fetch(`${app.base}/v1/rooms`, { method: 'POST', headers: { authorization: 'Bearer synthetic', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Denied room' }) });
    assert.equal(denied.status, 503);
    assert.equal(app.rooms.rooms.size, 1);
  } finally { await app.server.shutdown(); }
});

test('real Redis uses room-expiry TTL and ends remove the persisted key', { skip: !enabled }, async () => {
  const cfg = config(prefix());
  cfg.roomTtlSeconds = 1;
  const store = await createConfiguredRoomStore(cfg);
  try {
    const created = await store.create({ name: 'Expiry test' }, host);
    const key = `${cfg.storage.prefix}room:${created.room.id}`;
    assert.ok(await store.repository.command(['GET', key]));
    await new Promise(resolve => setTimeout(resolve, 1100));
    assert.equal(await store.repository.command(['GET', key]), null);
    assert.throws(() => store.resolve(created.room.id), { code: 'room_not_found' });
  } finally { await store.close(); }
});
