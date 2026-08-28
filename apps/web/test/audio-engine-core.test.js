import test from 'node:test';
import assert from 'node:assert/strict';
import { driftCorrection, playbackTargetMs } from '../sync-core.js';

test('shared audio target advances only while room playback is playing', () => {
  const state = { trackId: 't1', status: 'playing', positionMs: 1000, anchorServerTs: '2026-08-28T00:00:00.000Z' };
  assert.equal(playbackTargetMs(state, Date.parse('2026-08-28T00:00:02.500Z')), 3500);
  assert.equal(playbackTargetMs({ ...state, status: 'paused' }, Date.parse('2026-08-28T00:00:02.500Z')), 1000);
});

test('drift policy prefers gentle rate correction before hard seek', () => {
  assert.equal(driftCorrection({ currentPositionMs: 1000, targetPositionMs: 1100 }).action, 'none');
  assert.equal(driftCorrection({ currentPositionMs: 1000, targetPositionMs: 1600 }).action, 'rate');
  assert.equal(driftCorrection({ currentPositionMs: 1000, targetPositionMs: 3000 }).action, 'seek');
});
