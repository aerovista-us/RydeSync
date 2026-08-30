import { driftCorrection, playbackTargetMs } from './sync-core.js';

export class SharedAudioEngine {
  constructor(audio, { softDriftMs = 150, hardDriftMs = 750, now = () => Date.now(), onState = () => {} } = {}) {
    this.audio = audio;
    this.softDriftMs = softDriftMs;
    this.hardDriftMs = hardDriftMs;
    this.now = now;
    this.onState = onState;
    this.armed = false;
    this.currentTrackId = null;
    this.pendingPlayback = null;
    this.rateResetTimer = null;
    this.lastError = null;

    audio.addEventListener('waiting', () => this.emit('buffering'));
    audio.addEventListener('playing', () => this.emit('playing'));
    audio.addEventListener('pause', () => this.emit(audio.ended ? 'ended' : 'paused'));
    audio.addEventListener('error', () => {
      this.lastError = audio.error?.message || 'media_error';
      this.emit('error', { error: this.lastError });
    });
  }

  emit(state, extra = {}) {
    this.onState({ state, armed: this.armed, trackId: this.currentTrackId, ...extra });
  }

  setArmed(value) {
    this.armed = Boolean(value);
    if (!this.armed) {
      this.audio.pause();
      this.audio.playbackRate = 1;
      this.emit('muted');
    } else {
      this.emit('ready');
      if (this.pendingPlayback) this.apply(this.pendingPlayback.playback, this.pendingPlayback.serverNowMs, { force: true });
    }
  }

  sourceFor(trackId) {
    return `/v1/echoverse/audio/${encodeURIComponent(trackId)}`;
  }

  async ensureTrack(trackId, targetMs) {
    if (this.currentTrackId === trackId && this.audio.src) return;
    this.currentTrackId = trackId;
    this.audio.src = this.sourceFor(trackId);
    this.audio.load();
    await new Promise((resolve, reject) => {
      if (this.audio.readyState >= 1) return resolve();
      const loaded = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); reject(new Error('media_load_failed')); };
      const cleanup = () => {
        this.audio.removeEventListener('loadedmetadata', loaded);
        this.audio.removeEventListener('error', failed);
      };
      this.audio.addEventListener('loadedmetadata', loaded, { once: true });
      this.audio.addEventListener('error', failed, { once: true });
    });
    this.audio.currentTime = Math.max(0, Number(targetMs || 0)) / 1000;
  }

  async apply(playback, serverNowMs, { force = false } = {}) {
    this.pendingPlayback = { playback, serverNowMs };
    if (!playback?.trackId) {
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
      this.currentTrackId = null;
      this.emit('idle');
      return;
    }
    if (!this.armed) {
      this.emit('locked');
      return;
    }

    const applyStartedAt = this.now();
    const initialTargetMs = playbackTargetMs(playback, serverNowMs);
    try {
      await this.ensureTrack(playback.trackId, initialTargetMs);
    } catch (error) {
      this.lastError = error.message;
      this.emit('error', { error: error.message });
      return;
    }

    // Loading a protected stream can take hundreds of milliseconds on a phone.
    // Advance the server-time estimate by that local elapsed time so new riders
    // do not begin playback at the position that was correct before metadata and
    // buffering completed.
    const loadElapsedMs = Math.max(0, this.now() - applyStartedAt);
    const targetMs = playbackTargetMs(playback, Number(serverNowMs) + loadElapsedMs);
    const currentMs = this.audio.currentTime * 1000;
    const correction = driftCorrection({
      currentPositionMs: currentMs,
      targetPositionMs: targetMs,
      softDriftMs: this.softDriftMs,
      hardDriftMs: this.hardDriftMs,
      status: playback.status
    });

    if (force || correction.action === 'seek') {
      if (Math.abs(currentMs - targetMs) > 40) this.audio.currentTime = targetMs / 1000;
      this.audio.playbackRate = 1;
    } else if (correction.action === 'rate') {
      this.audio.playbackRate = correction.playbackRate;
      clearTimeout(this.rateResetTimer);
      this.rateResetTimer = setTimeout(() => { this.audio.playbackRate = 1; }, 3000);
    } else {
      this.audio.playbackRate = 1;
    }

    if (playback.status === 'playing') {
      try {
        await this.audio.play();
        this.emit('playing', { driftMs: correction.driftMs ?? 0, correction: correction.action });
      } catch (error) {
        // Media authorization/loading can outlive the transient browser user
        // activation that began "Listen with crew". Keep the prepared source
        // and pending room state, but return to an unarmed state so the next
        // Listen click is a fresh browser-approved gesture instead of being
        // interpreted as "Stop listening".
        this.armed = false;
        this.emit('gesture_required', { error: error?.name || 'play_blocked' });
      }
    } else {
      this.audio.pause();
      this.emit('paused', { driftMs: correction.driftMs ?? 0, correction: correction.action });
    }
  }
}
