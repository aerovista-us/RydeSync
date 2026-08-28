import test from 'node:test';
import assert from 'node:assert/strict';
import { driftCorrection, playbackTargetMs } from '../sync-core.js';

test('playbackTargetMs projects the server anchor while playing', () => {
  const playback = { trackId: 'trk', status: 'playing', positionMs: 5000, anchorServerTs: new Date(10_000).toISOString() };
  assert.equal(playbackTargetMs(playback, 12_500), 7500);
  assert.equal(playbackTargetMs({ ...playback, status: 'paused' }, 12_500), 5000);
});

test('small drift does not cause correction churn', () => {
  assert.deepEqual(driftCorrection({ currentPositionMs: 10_000, targetPositionMs: 10_100, softDriftMs: 250, hardDriftMs: 1500 }), {
    action: 'none', playbackRate: 1, driftMs: 100
  });
});

test('medium drift uses a bounded temporary rate nudge', () => {
  assert.equal(driftCorrection({ currentPositionMs: 10_000, targetPositionMs: 10_600, softDriftMs: 250, hardDriftMs: 1500 }).playbackRate, 1.03);
  assert.equal(driftCorrection({ currentPositionMs: 10_600, targetPositionMs: 10_000, softDriftMs: 250, hardDriftMs: 1500 }).playbackRate, 0.97);
});

test('large drift hard-seeks to the room target', () => {
  assert.deepEqual(driftCorrection({ currentPositionMs: 10_000, targetPositionMs: 12_000, softDriftMs: 250, hardDriftMs: 1500 }), {
    action: 'seek', seekToMs: 12000, playbackRate: 1, driftMs: 2000
  });
});
