export function cleanText(value, fallback = '—') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

export function connectionPathLabel(path) {
  if (path === 'turn-relay') return 'TURN Relay';
  if (path === 'direct') return 'Direct';
  return 'Pending';
}

export function formatTurnExpiry(expiresAt, now = Date.now()) {
  const expires = Date.parse(expiresAt || '');
  if (!Number.isFinite(expires)) return 'Credential expiry unavailable';
  const remaining = expires - now;
  if (remaining <= 0) return 'Credentials expired';
  const minutes = Math.max(1, Math.round(remaining / 60_000));
  if (minutes < 60) return `Credentials refresh in ~${minutes}m`;
  const hours = Math.round(minutes / 60);
  return `Credentials refresh in ~${hours}h`;
}

export function parseAudioSync(value) {
  const text = cleanText(value, 'Audio idle');
  const match = text.match(/drift\s+(-?\d+)ms/i);
  const driftMs = match ? Number(match[1]) : null;
  const correction = /\bseek\b/i.test(text)
    ? 'hard seek'
    : /\brate\b|\bnudge\b/i.test(text)
      ? 'rate correction'
      : 'none';
  return {
    driftMs,
    correction,
    label: Number.isFinite(driftMs) ? `${driftMs}ms · ${correction}` : text
  };
}

export function buildDashboardSnapshot(input = {}) {
  const roomActive = Boolean(input.roomActive);
  const realtimeStatus = roomActive ? cleanText(input.realtimeStatus, 'CONNECTING') : 'NO ACTIVE RYDE';
  const riderCount = Number.isFinite(Number(input.riderCount)) ? Number(input.riderCount) : 0;
  const locationCount = Number.isFinite(Number(input.locationCount)) ? Number(input.locationCount) : 0;
  const sync = parseAudioSync(input.audioStatus);
  const voicePath = connectionPathLabel(input.voicePath);

  return {
    room: {
      status: realtimeStatus,
      name: roomActive ? cleanText(input.roomName, 'Ride room') : 'No active Ryde',
      seq: roomActive ? cleanText(input.seq) : '—',
      riders: riderCount
    },
    voice: {
      status: cleanText(input.voiceStatus, 'Off'),
      peers: Number.isFinite(Number(input.voicePeerCount)) ? Number(input.voicePeerCount) : 0,
      speaker: cleanText(input.voiceSpeaker, 'Channel clear'),
      path: voicePath,
      turn: cleanText(input.turnStatus, 'TURN status unknown'),
      turnExpiry: formatTurnExpiry(input.turnExpiresAt, input.now)
    },
    network: {
      status: realtimeStatus,
      seq: roomActive ? cleanText(input.seq) : '—'
    },
    location: {
      status: cleanText(input.locationStatus, 'Off'),
      sharing: Boolean(input.locationSharing),
      visibleRiders: locationCount
    },
    music: {
      state: cleanText(input.playbackState, 'IDLE'),
      title: cleanText(input.playbackTitle, 'No shared track'),
      detail: cleanText(input.playbackMeta, 'Room soundtrack is idle'),
      audio: cleanText(input.audioStatus, 'OFF')
    },
    sync
  };
}
