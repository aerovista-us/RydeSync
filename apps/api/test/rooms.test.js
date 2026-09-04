import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomStore } from '../lib/rooms.js';
import { verifyRoomToken } from '../lib/room-token.js';

const config = {
  roomTtlSeconds: 3600,
  memberTokenTtlSeconds: 3600,
  roomTokenSecret: 'r'.repeat(48)
};
const guest = { kind: 'guest', authenticated: false, identityId: null, displayName: null };
const member = { kind: 'member', authenticated: true, identityId: 'identity_host', displayName: 'Host' };

test('member can create while guest can join a public ride room', () => {
  const now = Date.UTC(2026, 7, 27, 12, 0, 0);
  const store = new RoomStore(config, () => now);
  const created = store.create({ name: 'Lake Loop', mode: 'group_ride' }, member);
  assert.equal(created.member.role, 'host');
  const joined = store.join(created.room.joinCode, { displayName: 'Guest Two' }, guest);
  assert.equal(joined.member.role, 'rider');
  assert.equal(joined.room.memberCount, 2);
  assert.equal(verifyRoomToken(joined.token, config.roomTokenSecret, now).room_id, created.room.id);
});

test('expired room is pruned and cannot be joined', () => {
  let now = Date.UTC(2026, 7, 27, 12, 0, 0);
  const store = new RoomStore({ ...config, roomTtlSeconds: 300 }, () => now);
  const created = store.create({ name: 'Short Ride' }, member);
  now += 301_000;
  assert.throws(() => store.join(created.room.id, {}, guest), /expired|not found/i);
});


test('room modes preserve their voice-oriented default roles', () => {
  const now = Date.UTC(2026, 7, 27, 12, 0, 0);
  const expected = { group_ride: 'rider', listening_party: 'listener', classroom: 'listener', band_practice: 'speaker', campaign: 'listener' };
  for (const [mode, role] of Object.entries(expected)) {
    const store = new RoomStore(config, () => now);
    const created = store.create({ name: `Mode ${mode}`, mode }, member);
    const joined = store.join(created.room.joinCode, { displayName: 'Guest' }, guest);
    assert.equal(joined.member.role, role, mode);
  }
});
