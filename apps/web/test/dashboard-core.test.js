import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboardSnapshot, connectionPathLabel, formatTurnExpiry, parseAudioSync } from '../dashboard-core.js';

test('dashboard projects an inactive room without inventing live state', () => {
  const view = buildDashboardSnapshot({ roomActive: false, realtimeStatus: 'CONNECTED', riderCount: 4 });
  assert.equal(view.room.status, 'NO ACTIVE RYDE');
  assert.equal(view.room.name, 'No active Ryde');
  assert.equal(view.room.riders, 4);
  assert.equal(view.network.seq, '—');
});

test('dashboard preserves live room, voice, location and music observations', () => {
  const view = buildDashboardSnapshot({
    roomActive: true,
    roomName: 'Lake Loop',
    realtimeStatus: 'LIVE',
    seq: '42',
    riderCount: 3,
    locationCount: 2,
    locationStatus: 'Sharing · ±8m',
    locationSharing: true,
    voiceStatus: 'Ready · 2 voice peers',
    voicePeerCount: 2,
    voicePath: 'turn-relay',
    turnStatus: 'TURN ready · cellular fallback configured',
    turnExpiresAt: '2026-09-04T15:00:00Z',
    playbackState: 'PLAYING',
    playbackTitle: 'Night Ride',
    audioStatus: 'PLAYING · drift 87ms'
  });
  assert.equal(view.room.name, 'Lake Loop');
  assert.equal(view.room.riders, 3);
  assert.equal(view.voice.path, 'TURN Relay');
  assert.equal(view.voice.peers, 2);
  assert.equal(view.location.visibleRiders, 2);
  assert.equal(view.location.sharing, true);
  assert.equal(view.music.state, 'PLAYING');
  assert.equal(view.sync.driftMs, 87);
});

test('ICE path labels distinguish direct and relay without exposing addresses', () => {
  assert.equal(connectionPathLabel('direct'), 'Direct');
  assert.equal(connectionPathLabel('turn-relay'), 'TURN Relay');
  assert.equal(connectionPathLabel(null), 'Pending');
});

test('audio sync parser surfaces drift and correction mode', () => {
  assert.deepEqual(parseAudioSync('PLAYING · drift -312ms · rate nudge'), {
    driftMs: -312,
    correction: 'rate correction',
    label: '-312ms · rate correction'
  });
});

test('TURN expiry is rendered as a safe relative health signal', () => {
  assert.equal(formatTurnExpiry('2026-09-04T14:30:00Z', Date.parse('2026-09-04T14:00:00Z')), 'Credentials refresh in ~30m');
  assert.equal(formatTurnExpiry(null, Date.parse('2026-09-04T14:00:00Z')), 'Credential expiry unavailable');
});
