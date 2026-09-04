import { buildDashboardSnapshot } from './dashboard-core.js';

const $ = (selector) => document.querySelector(selector);
const voiceObserved = {
  state: 'off',
  peerCount: 0,
  selectedPath: null,
  turnExpiresAt: null
};

function text(id, fallback = '') {
  const value = $(`#${id}`)?.textContent?.replace(/\s+/g, ' ').trim();
  return value || fallback;
}

function visibleRoom() {
  const panel = $('#realtimePanel');
  return Boolean(panel && !panel.classList.contains('hidden'));
}

function countRows(id) {
  return [...document.querySelectorAll(`#${id} > li`)].filter((item) => !item.classList.contains('muted')).length;
}

function toneFor(value) {
  const textValue = String(value || '').toLowerCase();
  if (/error|failed|expired|unavailable|offline|closed/.test(textValue)) return 'error';
  if (/reconnect|connecting|pending|request|buffer|unknown|not configured|no active/.test(textValue)) return 'warn';
  if (/live|ready|connected|playing|sharing|direct|turn relay|talking|listening/.test(textValue)) return 'online';
  return '';
}

function setValue(id, value) {
  const element = $(`#${id}`);
  if (element) element.textContent = value;
}

function setStatus(id, value) {
  const element = $(`#${id}`);
  if (!element) return;
  element.textContent = value;
  element.classList.remove('online', 'warn', 'error');
  const tone = toneFor(value);
  if (tone) element.classList.add(tone);
}

function renderDashboard() {
  const roomActive = visibleRoom();
  const locationStatus = text('locationStatus', 'Off');
  const snapshot = buildDashboardSnapshot({
    roomActive,
    roomName: text('rtRoom', 'Ride room'),
    realtimeStatus: text('rtStatus', roomActive ? 'CONNECTING' : 'NO ACTIVE RYDE'),
    seq: text('rtSeq', '—'),
    riderCount: countRows('rtMembers'),
    locationCount: countRows('rtLocations'),
    locationStatus,
    locationSharing: /^sharing/i.test(locationStatus),
    voiceStatus: text('voiceStatus', 'Off'),
    voiceSpeaker: text('voiceSpeaker', 'Channel clear'),
    voicePeerCount: voiceObserved.peerCount,
    voicePath: voiceObserved.selectedPath,
    turnStatus: text('turnStatus', 'TURN status unknown'),
    turnExpiresAt: voiceObserved.turnExpiresAt,
    playbackState: text('sharedPlaybackState', 'IDLE'),
    playbackTitle: text('sharedTrackTitle', 'No shared track'),
    playbackMeta: text('sharedTrackMeta', 'Room soundtrack is idle'),
    audioStatus: text('audioClientStatus', 'OFF · audio never starts automatically')
  });

  setStatus('dashOverallStatus', snapshot.room.status);
  setValue('dashRoomName', snapshot.room.name);
  setValue('dashRiderCount', String(snapshot.room.riders));
  setValue('dashRoomSeq', snapshot.room.seq);

  setStatus('dashVoiceStatus', snapshot.voice.status);
  setValue('dashVoicePeers', String(snapshot.voice.peers));
  setValue('dashVoiceSpeaker', snapshot.voice.speaker);
  setStatus('dashVoicePath', snapshot.voice.path);
  setStatus('dashTurnStatus', snapshot.voice.turn);
  setValue('dashTurnExpiry', snapshot.voice.turnExpiry);

  setStatus('dashNetworkStatus', snapshot.network.status);
  setValue('dashNetworkSeq', snapshot.network.seq);

  setStatus('dashLocationStatus', snapshot.location.status);
  setValue('dashLocationCount', String(snapshot.location.visibleRiders));
  setValue('dashLocationSharing', snapshot.location.sharing ? 'ON' : 'OFF');

  setStatus('dashMusicState', snapshot.music.state);
  setValue('dashMusicTitle', snapshot.music.title);
  setValue('dashMusicDetail', snapshot.music.detail);
  setStatus('dashAudioStatus', snapshot.music.audio);

  setValue('dashSyncDrift', Number.isFinite(snapshot.sync.driftMs) ? `${snapshot.sync.driftMs}ms` : '—');
  setValue('dashSyncCorrection', snapshot.sync.correction);
  setStatus('dashSyncStatus', Number.isFinite(snapshot.sync.driftMs) ? snapshot.sync.label : snapshot.music.audio);

  const stamp = $('#dashUpdatedAt');
  if (stamp) stamp.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

const observedIds = [
  'realtimePanel', 'rtRoom', 'rtStatus', 'rtSeq', 'rtMembers', 'rtLocations', 'locationStatus',
  'voiceStatus', 'voiceSpeaker', 'turnStatus', 'sharedPlaybackState', 'sharedTrackTitle',
  'sharedTrackMeta', 'audioClientStatus'
];
const observer = new MutationObserver(renderDashboard);
for (const id of observedIds) {
  const element = $(`#${id}`);
  if (element) observer.observe(element, { attributes: true, childList: true, characterData: true, subtree: true });
}

window.addEventListener('rydesync:voice-observability', (event) => {
  Object.assign(voiceObserved, event.detail || {});
  renderDashboard();
});
window.addEventListener('hashchange', renderDashboard);
document.addEventListener('visibilitychange', () => { if (!document.hidden) renderDashboard(); });
setInterval(renderDashboard, 1000);
renderDashboard();
