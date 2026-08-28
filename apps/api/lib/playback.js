export class PlaybackError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PlaybackError';
    this.code = code;
  }
}

const MAX_POSITION_MS = 24 * 60 * 60 * 1000;

export function createPlaybackState(now = Date.now()) {
  return {
    trackId: null,
    status: 'idle',
    positionMs: 0,
    anchorServerMs: now,
    epoch: 0,
    updatedBy: null,
    updatedAt: now
  };
}

export function publicPlayback(state) {
  return {
    trackId: state.trackId,
    status: state.status,
    positionMs: Math.max(0, Math.round(state.positionMs)),
    anchorServerTs: new Date(state.anchorServerMs).toISOString(),
    epoch: state.epoch,
    updatedBy: state.updatedBy,
    updatedAt: new Date(state.updatedAt).toISOString()
  };
}

export function effectivePositionMs(state, now = Date.now()) {
  if (!state.trackId) return 0;
  if (state.status !== 'playing') return Math.max(0, state.positionMs);
  return Math.max(0, state.positionMs + Math.max(0, now - state.anchorServerMs));
}

function cleanTrackId(value) {
  const trackId = String(value ?? '').trim();
  if (!trackId || trackId.length > 256 || /[\0\r\n]/.test(trackId)) {
    throw new PlaybackError('invalid_track_id', 'Playback track_id is invalid');
  }
  return trackId;
}

function position(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > MAX_POSITION_MS) {
    throw new PlaybackError('invalid_position', 'Playback position must be a finite non-negative millisecond value');
  }
  return Math.round(number);
}

function checkEpoch(state, expectedEpoch) {
  if (expectedEpoch == null) return;
  if (!Number.isInteger(expectedEpoch) || expectedEpoch < 0) {
    throw new PlaybackError('invalid_epoch', 'expectedEpoch must be a non-negative integer');
  }
  if (expectedEpoch !== state.epoch) {
    throw new PlaybackError('epoch_conflict', 'Playback state changed before this command was applied');
  }
}

function requireTrack(state) {
  if (!state.trackId) throw new PlaybackError('no_track_selected', 'Select a track before changing playback');
}

export function applyPlaybackCommand(state, message, memberId, now = Date.now()) {
  checkEpoch(state, message.expectedEpoch);
  const next = { ...state, epoch: state.epoch + 1, updatedBy: memberId, updatedAt: now, anchorServerMs: now };

  switch (message.type) {
    case 'playback.select': {
      next.trackId = cleanTrackId(message.trackId);
      next.positionMs = message.positionMs == null ? 0 : position(message.positionMs);
      next.status = message.autoplay === true ? 'playing' : 'paused';
      return next;
    }
    case 'playback.play': {
      requireTrack(state);
      next.trackId = state.trackId;
      next.positionMs = message.positionMs == null ? effectivePositionMs(state, now) : position(message.positionMs);
      next.status = 'playing';
      return next;
    }
    case 'playback.pause': {
      requireTrack(state);
      next.trackId = state.trackId;
      next.positionMs = message.positionMs == null ? effectivePositionMs(state, now) : position(message.positionMs);
      next.status = 'paused';
      return next;
    }
    case 'playback.seek': {
      requireTrack(state);
      next.trackId = state.trackId;
      next.positionMs = position(message.positionMs);
      next.status = state.status === 'idle' ? 'paused' : state.status;
      return next;
    }
    case 'playback.clear': {
      next.trackId = null;
      next.positionMs = 0;
      next.status = 'idle';
      return next;
    }
    default:
      throw new PlaybackError('unsupported_playback_command', 'Unsupported playback command');
  }
}
