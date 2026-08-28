import test from 'node:test';
import assert from 'node:assert/strict';
import { issueRoomToken, verifyRoomToken } from '../lib/room-token.js';

const secret = 's'.repeat(48);

test('room token round-trips valid claims', () => {
  const now = Date.UTC(2026, 7, 27, 12, 0, 0);
  const token = issueRoomToken({ roomId: 'ryde_123', memberId: 'm1', role: 'host', ttlSeconds: 60 }, secret, now);
  const payload = verifyRoomToken(token, secret, now + 1000);
  assert.equal(payload.room_id, 'ryde_123');
  assert.equal(payload.role, 'host');
});

test('room token rejects tampering', () => {
  const now = Date.now();
  const token = issueRoomToken({ roomId: 'ryde_123', memberId: 'm1', role: 'host', ttlSeconds: 60 }, secret, now);
  assert.throws(() => verifyRoomToken(`${token}x`, secret, now), /signature|invalid/i);
});

test('room token rejects expiration', () => {
  const now = Date.now();
  const token = issueRoomToken({ roomId: 'ryde_123', memberId: 'm1', role: 'host', ttlSeconds: 1 }, secret, now);
  assert.throws(() => verifyRoomToken(token, secret, now + 2000), /expired/i);
});
