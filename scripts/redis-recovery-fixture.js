// Isolated synthetic recovery evidence only. Never point this at production.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { loadConfig } from '../apps/api/lib/config.js';
import { createConfiguredRoomStore } from '../apps/api/lib/redis-room-repository.js';
import { applyPlaybackCommand } from '../apps/api/lib/playback.js';
import { verifyRoomToken } from '../apps/api/lib/room-token.js';

if (process.env.REDIS_RECOVERY_TEST_MODE !== '1') throw new Error('Explicit isolated recovery-test mode required');
const fixturePath = process.env.REDIS_RECOVERY_FIXTURE;
if (!fixturePath) throw new Error('REDIS_RECOVERY_FIXTURE is required');
const url = new URL(process.env.REDIS_URL);
if (process.env.REDIS_RECOVERY_HOST) url.hostname = process.env.REDIS_RECOVERY_HOST;
if (!['rydesync-redis-pilot', 'rydesync-redis-restore'].includes(url.hostname)) throw new Error('Recovery fixture refuses non-pilot storage');
process.env.ROOM_TOKEN_SECRET = 'synthetic-recovery-only-signing-key-20261112-not-a-production-secret';
const base = loadConfig();
const config = { ...base, storage: { ...base.storage, driver: 'redis', prefix: 'rydesync:recovery:', url: url.href } };
const store = await createConfiguredRoomStore(config);
try {
  if (process.argv[2] === 'seed') {
    const created = await store.create({ name: 'Synthetic recovery acceptance' }, { identityId: 'recovery_host', displayName: 'Synthetic Host' });
    const joined = await store.join(created.room.id, { displayName: 'Synthetic Guest' }, { identityId: null });
    await store.setLocked(created.room.id, created.member.id, true);
    await store.updatePlayback(created.room.id, state => applyPlaybackCommand(state, { type: 'playback.select', trackId: 'recovery-track', autoplay: true }, created.member.id));
    await fs.writeFile(fixturePath, JSON.stringify({ roomId: created.room.id, hostToken: created.token, guestToken: joined.token }), { mode: 0o600 });
    console.log(JSON.stringify({ status: 'synthetic_fixture_seeded', roomId: created.room.id, members: 2, locked: true, playbackEpoch: 1, credentialsExposed: false }));
  } else if (process.argv[2] === 'verify') {
    const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
    const room = store.resolve(fixture.roomId);
    for (const token of [fixture.hostToken, fixture.guestToken]) {
      const claims = verifyRoomToken(token, config.roomTokenSecret);
      const member = room.members.get(claims.member_id);
      assert.equal(member.role, claims.role); assert.equal(member.identityId, claims.identity_id);
    }
    assert.equal(room.members.size, 2); assert.equal(room.locked, true);
    assert.equal(room.playback.trackId, 'recovery-track'); assert.equal(room.playback.epoch, 1);
    assert.equal(room.locations, undefined); assert.equal(room.voiceFloorMemberId, undefined);
    console.log(JSON.stringify({ status: 'recovery_verified', roomId: room.id, members: 2, locked: true, playbackEpoch: 1, tokenBindings: 'pass', ephemeralSignals: 'absent', credentialsExposed: false }));
  } else throw new Error('Expected seed or verify');
} finally { await store.close(); }
