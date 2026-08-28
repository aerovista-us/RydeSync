import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlaybackCommand, createPlaybackState, effectivePositionMs, publicPlayback, PlaybackError } from '../lib/playback.js';

test('select with autoplay creates authoritative playing anchor', () => {
  const base = createPlaybackState(1000);
  const next = applyPlaybackCommand(base, { type: 'playback.select', trackId: 'trk-1', autoplay: true }, 'host-1', 2000);
  assert.equal(next.trackId, 'trk-1');
  assert.equal(next.status, 'playing');
  assert.equal(next.positionMs, 0);
  assert.equal(next.epoch, 1);
  assert.equal(next.updatedBy, 'host-1');
  assert.equal(publicPlayback(next).anchorServerTs, new Date(2000).toISOString());
});

test('effective position advances only while playing', () => {
  const playing = { ...createPlaybackState(1000), trackId: 'trk', status: 'playing', positionMs: 5000, anchorServerMs: 1000 };
  assert.equal(effectivePositionMs(playing, 3500), 7500);
  assert.equal(effectivePositionMs({ ...playing, status: 'paused' }, 3500), 5000);
});

test('pause derives position from the server clock', () => {
  const playing = { ...createPlaybackState(1000), trackId: 'trk', status: 'playing', positionMs: 2000, anchorServerMs: 1000, epoch: 4 };
  const paused = applyPlaybackCommand(playing, { type: 'playback.pause', expectedEpoch: 4 }, 'host', 6000);
  assert.equal(paused.status, 'paused');
  assert.equal(paused.positionMs, 7000);
  assert.equal(paused.epoch, 5);
});

test('seek preserves playing state and re-anchors position', () => {
  const playing = { ...createPlaybackState(1000), trackId: 'trk', status: 'playing', positionMs: 2000, epoch: 2 };
  const seeked = applyPlaybackCommand(playing, { type: 'playback.seek', positionMs: 42000, expectedEpoch: 2 }, 'host', 9000);
  assert.equal(seeked.status, 'playing');
  assert.equal(seeked.positionMs, 42000);
  assert.equal(seeked.anchorServerMs, 9000);
});

test('stale controller epoch is rejected instead of overwriting newer state', () => {
  const state = { ...createPlaybackState(1000), trackId: 'trk', status: 'paused', epoch: 3 };
  assert.throws(
    () => applyPlaybackCommand(state, { type: 'playback.play', expectedEpoch: 2 }, 'host', 2000),
    (error) => error instanceof PlaybackError && error.code === 'epoch_conflict'
  );
});

test('clear removes the room track without affecting room membership', () => {
  const state = { ...createPlaybackState(1000), trackId: 'trk', status: 'paused', positionMs: 1234, epoch: 8 };
  const cleared = applyPlaybackCommand(state, { type: 'playback.clear', expectedEpoch: 8 }, 'host', 5000);
  assert.equal(cleared.trackId, null);
  assert.equal(cleared.status, 'idle');
  assert.equal(cleared.positionMs, 0);
  assert.equal(cleared.epoch, 9);
});
