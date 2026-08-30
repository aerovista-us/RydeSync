export function playbackTargetMs(playback, serverNowMs) {
  if (!playback?.trackId) return 0;
  const base = Math.max(0, Number(playback.positionMs || 0));
  if (playback.status !== 'playing') return base;
  const anchor = Date.parse(playback.anchorServerTs);
  if (!Number.isFinite(anchor) || !Number.isFinite(serverNowMs)) return base;
  return Math.max(0, base + Math.max(0, serverNowMs - anchor));
}

export function driftCorrection({ currentPositionMs, targetPositionMs, softDriftMs = 150, hardDriftMs = 750, status = 'playing' }) {
  const current = Number(currentPositionMs);
  const target = Number(targetPositionMs);
  if (!Number.isFinite(current) || !Number.isFinite(target)) return { action: 'seek', seekToMs: Math.max(0, target || 0), playbackRate: 1 };
  const driftMs = target - current;
  const abs = Math.abs(driftMs);

  if (status !== 'playing') {
    return abs >= softDriftMs
      ? { action: 'seek', seekToMs: Math.max(0, target), playbackRate: 1, driftMs }
      : { action: 'none', playbackRate: 1, driftMs };
  }
  if (abs >= hardDriftMs) return { action: 'seek', seekToMs: Math.max(0, target), playbackRate: 1, driftMs };
  if (abs >= softDriftMs) return { action: 'rate', playbackRate: driftMs > 0 ? 1.05 : 0.95, driftMs };
  return { action: 'none', playbackRate: 1, driftMs };
}
