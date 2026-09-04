import { buildDashboardSnapshot } from './dashboard-core.js';
import { CrewMap } from './map.js';

const $ = (selector) => document.querySelector(selector);
const voiceObserved = {
  state: 'off',
  peerCount: 0,
  selectedPath: null,
  turnExpiresAt: null
};

let miniMap = null;
let miniMapPromise = null;
let lastMapSignature = '';
let dashboardTalkActive = false;
let smoothedSpeedMph = null;
let musicDrawerOpen = false;
let lastModePreferenceKey = '';
const MODE_PREFS_KEY = 'rydesync:mode-preferences:v1';

const MODE_DASHBOARDS = Object.freeze({
  group_ride: { label: 'Group Ride', map: 'primary', ptt: 'preferred', music: 'secondary' },
  listening_party: { label: 'Listening Party', map: 'secondary', ptt: 'optional', music: 'primary' },
  classroom: { label: 'Classroom', map: 'optional', ptt: 'host-led', music: 'reference' },
  band_practice: { label: 'Band Practice', map: 'optional', ptt: 'preferred', music: 'reference' },
  campaign: { label: 'Campaign', map: 'mission', ptt: 'preferred', music: 'secondary' }
});

function activeRoomSession() {
  try { return JSON.parse(localStorage.getItem('rydesync:last-session') || 'null'); } catch { return null; }
}

function activeRoomMode() {
  try {
    const session = activeRoomSession();
    return MODE_DASHBOARDS[session?.room?.mode] ? session.room.mode : 'group_ride';
  } catch { return 'group_ride'; }
}

function readModePreferences() {
  try { return JSON.parse(localStorage.getItem(MODE_PREFS_KEY) || '{}') || {}; } catch { return {}; }
}

function modePreferences(mode = activeRoomMode()) {
  return { autoPtt: false, autoLocation: false, ...(readModePreferences()[mode] || {}) };
}

function saveModePreferences(mode, patch) {
  const all = readModePreferences();
  all[mode] = { ...modePreferences(mode), ...patch };
  localStorage.setItem(MODE_PREFS_KEY, JSON.stringify(all));
  return all[mode];
}


function installCockpit() {
  const view = $('#dashboardView');
  if (!view || view.dataset.cockpitInstalled === 'true') return;
  view.dataset.cockpitInstalled = 'true';
  view.innerHTML = `
    <div class="dashboard-cockpit-head">
      <div>
        <div class="eyebrow">RYDE COCKPIT</div>
        <h2 id="dashRoomName">No active Ryde</h2>
      </div>
      <div class="dashboard-live-state">
        <span id="dashOverallStatus" class="dashboard-status warn">NO ACTIVE RYDE</span>
        <small>Updated <strong id="dashUpdatedAt">—</strong></small>
      </div>
    </div>

    <section class="dashboard-cockpit-grid">
      <article class="dashboard-map-card">
        <div class="dashboard-map-topline">
          <div>
            <span class="card-kicker">CREW</span>
            <strong id="dashCrewCount">0 online</strong>
          </div>
          <div class="dashboard-map-actions">
            <span id="dashLocationStatus" class="dashboard-status">Location off</span>
            <button type="button" class="mini" data-dashboard-jump="room">Open map</button>
          </div>
        </div>
        <div id="dashMiniMap" class="crew-map dashboard-mini-map" role="img" aria-label="Condensed live crew map"></div>
        <div class="dashboard-speed" aria-label="Current device speed"><strong id="dashSpeed">--</strong><span>MPH</span></div>
        <button id="dashModeSettings" type="button" class="dashboard-mode-settings" aria-label="Room mode preferences">⚙</button>
        <div id="dashCrewStrip" class="dashboard-crew-strip" aria-live="polite">
          <span class="dashboard-crew-empty">No crew online yet</span>
        </div>
      </article>

      <div class="dashboard-control-stack">
        <article class="dashboard-control-card dashboard-voice-card">
          <div class="dashboard-control-head">
            <div>
              <span class="card-kicker">PUSH TO TALK</span>
              <strong id="dashVoiceSpeaker">Channel clear</strong>
            </div>
            <span id="dashVoiceStatus" class="dashboard-status">Off</span>
          </div>
          <button id="dashPttButton" type="button" class="dashboard-ptt" disabled>
            <span>HOLD TO TALK</span>
            <small id="dashPttHint">Enable microphone first</small>
          </button>
          <div class="dashboard-inline-actions">
            <button id="dashVoiceEnable" type="button" class="mini">Enable PTT</button>
            <span id="dashVoicePath" class="dashboard-route-chip">Path pending</span>
          </div>
        </article>

        <article class="dashboard-control-card dashboard-music-card">
          <div class="dashboard-control-head">
            <div class="dashboard-track-copy">
              <span class="card-kicker">NOW PLAYING</span>
              <strong id="dashMusicTitle">No shared track</strong>
              <small id="dashMusicDetail">Room soundtrack is idle</small>
            </div>
            <div class="dashboard-music-actions">
              <span id="dashMusicState" class="dashboard-status">IDLE</span>
              <button id="dashMiniPlay" type="button" class="dashboard-mini-play" aria-label="Play or pause shared music">▶</button>
              <button id="dashMusicDrawerToggle" type="button" class="dashboard-drawer-toggle" aria-expanded="false" aria-label="Show full player">⌃</button>
            </div>
          </div>
          <div id="dashHostMusicControls" class="dashboard-transport" hidden>
            <button type="button" class="mini" data-dashboard-proxy="playbackBack">−10s</button>
            <button id="dashTransportToggle" type="button" class="dashboard-play-button">Play</button>
            <button type="button" class="mini" data-dashboard-proxy="playbackForward">+10s</button>
          </div>
          <div class="dashboard-listener-controls">
            <button id="dashListenToggle" type="button" class="mini secondary">Listen with crew</button>
            <button id="dashMuteToggle" type="button" class="mini">Mute</button>
            <span id="dashAudioStatus" class="dashboard-audio-state">OFF</span>
          </div>
        </article>
      </div>
    </section>

    <section id="dashModeSheet" class="dashboard-mode-sheet" hidden>
      <div class="dashboard-mode-sheet-head"><div><span class="card-kicker">ROOM MODE</span><strong id="dashModeLabel">Group Ride</strong></div><button id="dashModeSheetClose" type="button" class="mini">Done</button></div>
      <p>Remember how this device should prepare features when you join this room type. Browser permission still stays under your control.</p>
      <label class="dashboard-pref"><input id="dashAutoPtt" type="checkbox" /> <span><strong>PTT ready automatically</strong><small>Uses microphone automatically only after browser permission is already granted.</small></span></label>
      <label class="dashboard-pref"><input id="dashAutoLocation" type="checkbox" /> <span><strong>Share location automatically</strong><small>Starts room location sharing automatically only after browser permission is already granted.</small></span></label>
      <small id="dashPermissionState" class="dashboard-permission-state">Permissions checked on this device.</small>
    </section>

    <details class="dashboard-health">
      <summary>
        <span>Connection health</span>
        <span id="dashHealthSummary">Realtime idle · voice pending · sync idle</span>
      </summary>
      <div class="dashboard-health-grid">
        <div><small>Realtime</small><strong id="dashNetworkStatus">NO ACTIVE RYDE</strong><span>SEQ <b id="dashNetworkSeq">—</b></span></div>
        <div><small>Location</small><strong id="dashLocationSharing">OFF</strong><span><b id="dashLocationCount">0</b> visible riders</span></div>
        <div><small>Voice route</small><strong id="dashTurnStatus">TURN status unknown</strong><span id="dashTurnExpiry">Credential expiry unavailable</span></div>
        <div><small>Music sync</small><strong id="dashSyncStatus">OFF</strong><span><b id="dashSyncDrift">—</b> drift · <b id="dashSyncCorrection">none</b></span></div>
      </div>
    </details>`;
}

function text(id, fallback = '') {
  const value = $(`#${id}`)?.textContent?.replace(/\s+/g, ' ').trim();
  return value || fallback;
}

function visibleRoom() {
  const panel = $('#realtimePanel');
  return Boolean(panel && !panel.classList.contains('hidden'));
}

function crewMembers() {
  return [...document.querySelectorAll('#rtMembers > li')]
    .filter((item) => !item.classList.contains('muted'))
    .map((item, index) => ({
      name: item.querySelector('strong')?.textContent?.trim() || `Rider ${index + 1}`,
      role: item.querySelector('small')?.textContent?.trim() || 'rider',
      online: Boolean(item.querySelector('.presence-dot.online'))
    }));
}

function locationRows() {
  return [...document.querySelectorAll('#rtLocations > li')]
    .filter((item) => !item.classList.contains('muted'))
    .map((item, index) => {
      const name = item.querySelector('strong')?.textContent?.trim() || `Rider ${index + 1}`;
      const raw = item.querySelector('small')?.textContent || '';
      const match = raw.match(/(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\s*·\s*±(\d+)m/i);
      if (!match) return null;
      const memberId = `dashboard-${index}-${name}`;
      return {
        memberId,
        name,
        latitude: Number(match[1]),
        longitude: Number(match[2]),
        accuracy: Number(match[3]),
        receivedAt: new Date().toISOString()
      };
    })
    .filter(Boolean);
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

function renderCrewStrip() {
  const container = $('#dashCrewStrip');
  if (!container) return;
  const members = crewMembers();
  const online = members.filter((member) => member.online);
  setValue('dashCrewCount', `${online.length} online`);
  if (!members.length) {
    container.innerHTML = '<span class="dashboard-crew-empty">No crew online yet</span>';
    return;
  }
  container.replaceChildren(...members.map((member) => {
    const chip = document.createElement('span');
    chip.className = `dashboard-crew-chip${member.online ? ' online' : ''}`;
    const dot = document.createElement('i');
    const name = document.createElement('strong');
    const role = document.createElement('small');
    name.textContent = member.name;
    role.textContent = member.role.replaceAll('_', ' ');
    chip.append(dot, name, role);
    return chip;
  }));
}

async function ensureMiniMap() {
  if (miniMap) return miniMap;
  if (miniMapPromise) return miniMapPromise;
  const element = $('#dashMiniMap');
  if (!element) return null;
  miniMapPromise = fetch('/v1/bootstrap')
    .then((response) => response.ok ? response.json() : null)
    .then((boot) => {
      if (!boot || !$('#dashMiniMap')) return null;
      miniMap = new CrewMap($('#dashMiniMap'), {
        ...(boot.map || {}),
        staleAfterMs: boot.location?.staleAfterMs || 120000
      });
      return miniMap;
    })
    .catch(() => null);
  return miniMapPromise;
}

async function renderMiniMap() {
  const view = $('#dashboardView');
  if (!view || view.hidden) return;
  const map = await ensureMiniMap();
  if (!map) return;
  const locations = locationRows();
  const signature = JSON.stringify(locations.map(({ name, latitude, longitude, accuracy }) => [name, latitude, longitude, accuracy]));
  if (signature === lastMapSignature) return;
  lastMapSignature = signature;
  const members = locations.map((entry) => ({ id: entry.memberId, displayName: entry.name }));
  map.setLocations(locations, { members, autoFit: true });
}

function sourceButton(id) {
  const button = $(`#${id}`);
  return button instanceof HTMLButtonElement ? button : null;
}

function proxyClick(id) {
  const button = sourceButton(id);
  if (button && !button.disabled) button.click();
}

function forwardTalk(type, sourceEvent = null) {
  const source = sourceButton('talkButton');
  if (!source || source.disabled) return false;
  const event = typeof PointerEvent === 'function'
    ? new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: sourceEvent?.pointerId || 1, pointerType: sourceEvent?.pointerType || 'mouse' })
    : new Event(type, { bubbles: true, cancelable: true });
  source.dispatchEvent(event);
  return true;
}

function stopDashboardTalk(event = null) {
  if (!dashboardTalkActive) return;
  dashboardTalkActive = false;
  forwardTalk('pointerup', event);
}

function syncControlMirrors() {
  const sourceTalk = sourceButton('talkButton');
  const dashTalk = sourceButton('dashPttButton');
  const sourceEnable = sourceButton('voiceEnable');
  const dashEnable = sourceButton('dashVoiceEnable');
  if (dashTalk) {
    dashTalk.disabled = !sourceTalk || sourceTalk.disabled;
    dashTalk.classList.toggle('talking', /transmitting|you are talking/i.test(`${text('voiceStatus')} ${text('voiceSpeaker')}`));
  }
  if (dashEnable && sourceEnable) {
    dashEnable.textContent = sourceEnable.textContent;
    dashEnable.disabled = sourceEnable.disabled;
    dashEnable.classList.toggle('danger', sourceEnable.classList.contains('danger'));
  }
  setValue('dashPttHint', sourceTalk?.disabled ? 'Enable microphone first' : 'Press and hold');

  const hostControls = $('#sharedPlaybackControls');
  const dashHostControls = $('#dashHostMusicControls');
  if (dashHostControls) dashHostControls.hidden = !hostControls || hostControls.hidden;

  const playbackState = text('sharedPlaybackState', 'IDLE').toUpperCase();
  const transport = sourceButton('dashTransportToggle');
  if (transport) {
    transport.textContent = playbackState === 'PLAYING' ? 'Pause' : 'Play';
    const target = playbackState === 'PLAYING' ? sourceButton('playbackPause') : sourceButton('playbackPlay');
    transport.disabled = !target || target.disabled;
  }

  const sourceListen = sourceButton('audioListenToggle');
  const dashListen = sourceButton('dashListenToggle');
  if (dashListen && sourceListen) {
    dashListen.textContent = sourceListen.textContent;
    dashListen.disabled = sourceListen.disabled;
  }
  const miniPlay = sourceButton('dashMiniPlay');
  if (miniPlay) {
    miniPlay.textContent = playbackState === 'PLAYING' ? 'Ⅱ' : '▶';
    miniPlay.setAttribute('aria-label', playbackState === 'PLAYING' ? 'Pause shared music' : 'Play shared music');
  }
  const sourceMute = sourceButton('audioMuteToggle');
  const dashMute = sourceButton('dashMuteToggle');
  if (dashMute && sourceMute) {
    dashMute.textContent = sourceMute.textContent;
    dashMute.disabled = sourceMute.disabled;
  }
}

async function permissionState(name) {
  try {
    if (!navigator.permissions?.query) return 'unknown';
    return (await navigator.permissions.query({ name })).state || 'unknown';
  } catch { return 'unknown'; }
}

async function applyModePreferences({ userInitiated = false } = {}) {
  const mode = activeRoomMode();
  const prefs = modePreferences(mode);
  const mic = await permissionState('microphone');
  const geo = await permissionState('geolocation');
  setValue('dashPermissionState', `Microphone ${mic} · Location ${geo}`);
  const voiceEnable = sourceButton('voiceEnable');
  const locationToggle = sourceButton('locationToggle');
  if (prefs.autoPtt && voiceEnable && !/disable|stop/i.test(voiceEnable.textContent || '') && (userInitiated || mic === 'granted')) voiceEnable.click();
  if (prefs.autoLocation && locationToggle && !/stop/i.test(locationToggle.textContent || '') && (userInitiated || geo === 'granted')) locationToggle.click();
}

function renderModeControls() {
  const mode = activeRoomMode();
  const profile = MODE_DASHBOARDS[mode];
  const prefs = modePreferences(mode);
  const view = $('#dashboardView');
  if (view) view.dataset.rydeMode = mode;
  document.body.dataset.rydeMode = mode;
  setValue('dashModeLabel', profile.label);
  const ptt = $('#dashAutoPtt');
  const location = $('#dashAutoLocation');
  if (ptt) ptt.checked = prefs.autoPtt;
  if (location) location.checked = prefs.autoLocation;
}

function setDashboardActiveClass() {
  const view = $('#dashboardView');
  document.body.classList.toggle('dashboard-active', Boolean(view && !view.hidden));
}

function renderDashboard() {
  const roomActive = visibleRoom();
  setDashboardActiveClass();
  renderModeControls();
  const preferenceSession = activeRoomSession();
  const preferenceKey = `${preferenceSession?.room?.id || 'none'}:${activeRoomMode()}`;
  if (roomActive && preferenceKey !== lastModePreferenceKey) {
    lastModePreferenceKey = preferenceKey;
    setTimeout(() => applyModePreferences(), 0);
  }
  const members = crewMembers();
  const locationStatus = text('locationStatus', 'Off');
  const snapshot = buildDashboardSnapshot({
    roomActive,
    roomName: text('rtRoom', 'Ride room'),
    realtimeStatus: text('rtStatus', roomActive ? 'CONNECTING' : 'NO ACTIVE RYDE'),
    seq: text('rtSeq', '—'),
    riderCount: members.length,
    locationCount: locationRows().length,
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
  renderCrewStrip();

  setStatus('dashVoiceStatus', snapshot.voice.status);
  setValue('dashVoiceSpeaker', snapshot.voice.speaker);
  setStatus('dashVoicePath', snapshot.voice.path === 'Pending' ? 'Path pending' : snapshot.voice.path);

  setStatus('dashLocationStatus', snapshot.location.sharing ? 'Sharing location' : snapshot.location.visibleRiders ? `${snapshot.location.visibleRiders} on map` : 'Location off');

  setStatus('dashMusicState', snapshot.music.state);
  setValue('dashMusicTitle', snapshot.music.title);
  setValue('dashMusicDetail', snapshot.music.detail);
  setStatus('dashAudioStatus', snapshot.music.audio);

  setStatus('dashNetworkStatus', snapshot.network.status);
  setValue('dashNetworkSeq', snapshot.network.seq);
  setValue('dashLocationSharing', snapshot.location.sharing ? 'ON' : 'OFF');
  setValue('dashLocationCount', String(snapshot.location.visibleRiders));
  setStatus('dashTurnStatus', snapshot.voice.turn);
  setValue('dashTurnExpiry', snapshot.voice.turnExpiry);
  setValue('dashSyncDrift', Number.isFinite(snapshot.sync.driftMs) ? `${snapshot.sync.driftMs}ms` : '—');
  setValue('dashSyncCorrection', snapshot.sync.correction);
  setStatus('dashSyncStatus', Number.isFinite(snapshot.sync.driftMs) ? snapshot.sync.label : snapshot.music.audio);
  setValue('dashHealthSummary', `${snapshot.network.status} · ${snapshot.voice.path} · ${Number.isFinite(snapshot.sync.driftMs) ? `${snapshot.sync.driftMs}ms drift` : 'sync idle'}`);

  syncControlMirrors();
  renderMiniMap();

  const stamp = $('#dashUpdatedAt');
  if (stamp) stamp.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

installCockpit();

document.querySelectorAll('[data-dashboard-jump]').forEach((button) => {
  button.addEventListener('click', () => { window.location.hash = button.dataset.dashboardJump; });
});
document.querySelectorAll('[data-dashboard-proxy]').forEach((button) => {
  button.addEventListener('click', () => proxyClick(button.dataset.dashboardProxy));
});

$('#dashVoiceEnable')?.addEventListener('click', () => proxyClick('voiceEnable'));
$('#dashListenToggle')?.addEventListener('click', () => proxyClick('audioListenToggle'));
$('#dashMuteToggle')?.addEventListener('click', () => proxyClick('audioMuteToggle'));
$('#dashTransportToggle')?.addEventListener('click', () => {
  const state = text('sharedPlaybackState', 'IDLE').toUpperCase();
  proxyClick(state === 'PLAYING' ? 'playbackPause' : 'playbackPlay');
});

$('#dashMusicDrawerToggle')?.addEventListener('click', () => {
  musicDrawerOpen = !musicDrawerOpen;
  $('#dashboardView')?.classList.toggle('music-drawer-open', musicDrawerOpen);
  $('#dashMusicDrawerToggle')?.setAttribute('aria-expanded', String(musicDrawerOpen));
  if ($('#dashMusicDrawerToggle')) $('#dashMusicDrawerToggle').textContent = musicDrawerOpen ? '⌄' : '⌃';
});
$('#dashMiniPlay')?.addEventListener('click', () => {
  const state = text('sharedPlaybackState', 'IDLE').toUpperCase();
  const target = state === 'PLAYING' ? sourceButton('playbackPause') : sourceButton('playbackPlay');
  if (target && !target.disabled) target.click();
  else proxyClick('audioListenToggle');
});
$('#dashModeSettings')?.addEventListener('click', () => { $('#dashModeSheet').hidden = false; renderModeControls(); applyModePreferences(); });
$('#dashModeSheetClose')?.addEventListener('click', () => { $('#dashModeSheet').hidden = true; });
$('#dashAutoPtt')?.addEventListener('change', (event) => {
  const enabled = event.currentTarget.checked;
  saveModePreferences(activeRoomMode(), { autoPtt: enabled });
  const button = sourceButton('voiceEnable');
  if (enabled && button && !/disable|stop/i.test(button.textContent || '')) button.click();
  applyModePreferences();
});
$('#dashAutoLocation')?.addEventListener('change', (event) => {
  const enabled = event.currentTarget.checked;
  saveModePreferences(activeRoomMode(), { autoLocation: enabled });
  const button = sourceButton('locationToggle');
  if (enabled && button && !/stop/i.test(button.textContent || '')) button.click();
  applyModePreferences();
});

const dashPtt = $('#dashPttButton');
dashPtt?.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  if (forwardTalk('pointerdown', event)) dashboardTalkActive = true;
});
dashPtt?.addEventListener('pointerup', stopDashboardTalk);
dashPtt?.addEventListener('pointercancel', stopDashboardTalk);
dashPtt?.addEventListener('keydown', (event) => {
  if (!['Space', 'Enter'].includes(event.code) || event.repeat) return;
  event.preventDefault();
  if (forwardTalk('pointerdown', event)) dashboardTalkActive = true;
});
dashPtt?.addEventListener('keyup', (event) => {
  if (!['Space', 'Enter'].includes(event.code)) return;
  event.preventDefault();
  stopDashboardTalk(event);
});
window.addEventListener('pointerup', stopDashboardTalk);
window.addEventListener('blur', stopDashboardTalk);

const observedIds = [
  'realtimePanel', 'rtRoom', 'rtStatus', 'rtSeq', 'rtMembers', 'rtLocations', 'locationStatus',
  'voiceStatus', 'voiceSpeaker', 'turnStatus', 'talkButton', 'voiceEnable', 'sharedPlaybackState', 'sharedTrackTitle',
  'sharedTrackMeta', 'sharedPlaybackControls', 'playbackPlay', 'playbackPause', 'audioClientStatus', 'audioListenToggle', 'audioMuteToggle'
];
const observer = new MutationObserver(renderDashboard);
for (const id of observedIds) {
  const element = $(`#${id}`);
  if (element) observer.observe(element, { attributes: true, childList: true, characterData: true, subtree: true });
}

window.addEventListener('rydesync:self-location', (event) => {
  const metersPerSecond = Number(event.detail?.speed);
  if (!Number.isFinite(metersPerSecond) || metersPerSecond < 0) {
    smoothedSpeedMph = null;
    setValue('dashSpeed', '--');
    return;
  }
  const mph = metersPerSecond * 2.2369362921;
  smoothedSpeedMph = smoothedSpeedMph == null ? mph : (smoothedSpeedMph * 0.68 + mph * 0.32);
  setValue('dashSpeed', String(Math.max(0, Math.round(smoothedSpeedMph))));
});

window.addEventListener('rydesync:voice-observability', (event) => {
  Object.assign(voiceObserved, event.detail || {});
  renderDashboard();
});
window.addEventListener('hashchange', renderDashboard);
document.addEventListener('visibilitychange', () => { if (!document.hidden) renderDashboard(); });
setInterval(renderDashboard, 1500);
renderDashboard();
setTimeout(() => applyModePreferences(), 500);
