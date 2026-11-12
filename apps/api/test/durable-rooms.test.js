import test from 'node:test';
import assert from 'node:assert/strict';
import { DurableRoomStore, encodeRoom, decodeRoom } from '../lib/durable-rooms.js';
import { applyPlaybackCommand } from '../lib/playback.js';
import { verifyRoomToken } from '../lib/room-token.js';

const config = { roomTtlSeconds: 3600, memberTokenTtlSeconds: 3600, roomTokenSecret: 'r'.repeat(48) };
const host = { identityId: 'host_identity', displayName: 'Host' };
const guest = { identityId: null, displayName: null };
function repository() {
  return {
    data: new Map(), ready: true, beforeSave: async () => {},
    assertReady() { if (!this.ready) throw Object.assign(new Error('Unavailable'), { status: 503, code: 'storage_unavailable' }); },
    async save(room) { this.assertReady(); await this.beforeSave(); this.data.set(room.id, structuredClone(room)); },
    async remove(id) { this.assertReady(); this.data.delete(id); },
    async close() { this.ready = false; }
  };
}

test('durable rooms are published only after the write succeeds', async () => {
  const repo = repository();
  let release;
  repo.beforeSave = () => new Promise(resolve => { release = resolve; });
  const store = new DurableRoomStore(config, repo);
  const creating = store.create({ name: 'Lake Loop' }, host);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.rooms.size, 0);
  release();
  const created = await creating;
  assert.equal(store.resolve(created.room.id).members.size, 1);
  assert.equal(repo.data.size, 1);
});

test('failed writes never grant room membership or change locks/playback', async () => {
  const repo = repository();
  const store = new DurableRoomStore(config, repo);
  const created = await store.create({ name: 'Lake Loop' }, host);
  repo.beforeSave = async () => { throw new Error('Disk unavailable'); };
  await assert.rejects(store.join(created.room.id, {}, guest), { code: 'storage_unavailable' });
  assert.equal(store.rooms.get(created.room.id).members.size, 1);
  assert.equal(store.rooms.get(created.room.id).locked, false);
  await assert.rejects(store.setLocked(created.room.id, created.member.id, true));
  assert.equal(store.rooms.get(created.room.id).locked, false);
});

test('concurrent joins serialize without losing members and preserve realtime room references', async () => {
  const repo = repository();
  const store = new DurableRoomStore(config, repo);
  const created = await store.create({ name: 'Lake Loop' }, host);
  const reference = store.resolve(created.room.id);
  await Promise.all(Array.from({ length: 12 }, (_, i) => store.join(created.room.id, { displayName: `Rider ${i}` }, guest)));
  assert.equal(reference, store.resolve(created.room.id));
  assert.equal(reference.members.size, 13);
  assert.equal(repo.data.get(created.room.id).members.length, 13);
});

test('restart restores token-bound membership, lock and playback; excludes ephemeral signals', async () => {
  const repo = repository();
  const store = new DurableRoomStore(config, repo);
  const created = await store.create({ name: 'Lake Loop' }, host);
  const joined = await store.join(created.room.id, { displayName: 'Rider' }, guest);
  await store.setLocked(created.room.id, created.member.id, true);
  await store.updatePlayback(created.room.id, state => applyPlaybackCommand(state, { type: 'playback.select', trackId: 'track-123', autoplay: true }, created.member.id));
  const room = store.resolve(created.room.id);
  room.locations = [{ latitude: 47, longitude: -116 }];
  room.voiceFloorMemberId = created.member.id;
  const raw = encodeRoom(room);
  assert.equal('locations' in raw, false);
  assert.equal('voiceFloorMemberId' in raw, false);
  assert.equal(JSON.stringify(raw).includes(joined.token), false);
  const restored = new DurableRoomStore(config, repository(), [raw]);
  const recovered = restored.resolve(created.room.joinCode);
  assert.equal(recovered.locked, true);
  assert.equal(recovered.playback.trackId, 'track-123');
  assert.equal(recovered.playback.status, 'playing');
  const claims = verifyRoomToken(joined.token, config.roomTokenSecret);
  assert.equal(recovered.members.get(claims.member_id).identityId, claims.identity_id);
});

test('stale simultaneous playback commands preserve optimistic epoch checks', async () => {
  const store = new DurableRoomStore(config, repository());
  const created = await store.create({ name: 'Lake Loop' }, host);
  const update = () => store.updatePlayback(created.room.id, state => applyPlaybackCommand(state, { type: 'playback.select', expectedEpoch: 0, trackId: 'track-1' }, created.member.id));
  const results = await Promise.allSettled([update(), update()]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'epoch_conflict');
});

test('end is durable, expiry cannot resurrect rooms, invalid stored data fails closed', async () => {
  let now = Date.now();
  const repo = repository();
  const store = new DurableRoomStore(config, repo, [], () => now);
  const created = await store.create({ name: 'Lake Loop' }, host);
  const snapshot = repo.data.get(created.room.id);
  await assert.rejects(store.end(created.room.id, 'wrong-host'), { code: 'host_required' });
  await store.end(created.room.id, created.member.id);
  assert.equal(repo.data.size, 0);
  now += 3601000;
  const restored = new DurableRoomStore(config, repo, [snapshot], () => now);
  assert.throws(() => restored.resolve(created.room.id), { code: 'room_not_found' });
  assert.throws(() => decodeRoom({ ...snapshot, members: [] }), /Invalid persisted room/);
});

test('storage outage blocks room reads and new grants instead of falling back to memory', async () => {
  const repo = repository();
  const store = new DurableRoomStore(config, repo);
  const created = await store.create({ name: 'Lake Loop' }, host);
  repo.ready = false;
  assert.throws(() => store.resolve(created.room.id), { code: 'storage_unavailable' });
  await assert.rejects(store.create({ name: 'Other Ride' }, host), { code: 'storage_unavailable' });
});

test('bounded room capacity is rejected before writing without poisoning the store', async () => {
  const store = new DurableRoomStore(config, repository());
  const created = await store.create({ name: 'Bounded Room' }, host);
  for (let i = 0; i < 127; i++) await store.join(created.room.id, { displayName: `Rider ${i}` }, guest);
  await assert.rejects(store.join(created.room.id, { displayName: 'Overflow' }, guest), { code: 'room_full' });
  assert.equal(store.resolve(created.room.id).members.size, 128);
  assert.equal(store.failed, false);
});
