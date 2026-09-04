import test from 'node:test';
import assert from 'node:assert/strict';
import { SharedAudioEngine } from '../audio-engine.js';
import { driftCorrection, playbackTargetMs } from '../sync-core.js';

test('shared audio target advances only while room playback is playing', () => {
  const state = { trackId: 't1', status: 'playing', positionMs: 1000, anchorServerTs: '2026-08-28T00:00:00.000Z' };
  assert.equal(playbackTargetMs(state, Date.parse('2026-08-28T00:00:02.500Z')), 3500);
  assert.equal(playbackTargetMs({ ...state, status: 'paused' }, Date.parse('2026-08-28T00:00:02.500Z')), 1000);
});

test('drift policy corrects medium drift faster and hard-seeks large drift', () => {
  assert.equal(driftCorrection({ currentPositionMs: 1000, targetPositionMs: 1100 }).action, 'none');
  assert.deepEqual(driftCorrection({ currentPositionMs: 1000, targetPositionMs: 1400 }), {
    action: 'rate', playbackRate: 1.05, driftMs: 400
  });
  assert.equal(driftCorrection({ currentPositionMs: 1000, targetPositionMs: 1800 }).action, 'seek');
});

class FakeAudio {
  constructor() {
    this.src = '';
    this.readyState = 1;
    this.currentTime = 0;
    this.playbackRate = 1;
    this.ended = false;
    this.error = null;
    this.playCalls = 0;
    this.pauseCalls = 0;
    this.rejectNextPlay = true;
    this.listeners = new Map();
    this.onLoad = null;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  load() {
    this.onLoad?.();
  }

  pause() {
    this.pauseCalls += 1;
  }

  removeAttribute(name) {
    if (name === 'src') this.src = '';
  }

  async play() {
    this.playCalls += 1;
    if (this.rejectNextPlay) {
      this.rejectNextPlay = false;
      const error = new Error('browser blocked autoplay');
      error.name = 'NotAllowedError';
      throw error;
    }
  }
}

test('protected stream startup advances target across metadata load delay', async () => {
  let nowMs = 10_000;
  const audio = new FakeAudio();
  audio.rejectNextPlay = false;
  audio.onLoad = () => { nowMs += 600; };
  const engine = new SharedAudioEngine(audio, { now: () => nowMs });
  const playback = {
    trackId: 'track-load-delay',
    status: 'playing',
    positionMs: 0,
    anchorServerTs: '2026-08-28T00:00:00.000Z'
  };
  const serverNow = Date.parse('2026-08-28T00:00:01.000Z');

  engine.setArmed(true);
  await engine.apply(playback, serverNow, { force: true });

  assert.equal(audio.currentTime, 1.6);
  assert.equal(audio.playCalls, 1);
});

test('autoplay rejection returns engine to Listen state while preserving prepared media for retry', async () => {
  const audio = new FakeAudio();
  const states = [];
  const engine = new SharedAudioEngine(audio, { onState: (state) => states.push(state) });
  const playback = {
    trackId: 'track-1',
    status: 'playing',
    positionMs: 1000,
    anchorServerTs: '2026-08-28T00:00:00.000Z'
  };
  const serverNow = Date.parse('2026-08-28T00:00:01.000Z');

  engine.setArmed(true);
  await engine.apply(playback, serverNow, { force: true });

  assert.equal(engine.armed, false);
  assert.equal(engine.currentTrackId, 'track-1');
  assert.ok(audio.src.endsWith('/v1/echoverse/audio/track-1'));
  assert.equal(states.at(-1).state, 'gesture_required');
  assert.equal(states.at(-1).armed, false);

  engine.setArmed(true);
  await engine.apply(playback, serverNow, { force: true });

  assert.equal(engine.armed, true);
  assert.equal(audio.playCalls, 2);
  assert.equal(states.at(-1).state, 'playing');
});
