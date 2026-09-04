import { CrewMap } from '/map.js';
import { playbackTargetMs as projectPlaybackTarget } from '/sync-core.js';
import { SharedAudioEngine } from '/audio-engine.js';
import { VoiceClient } from '/voice.js';
const $ = (selector) => document.querySelector(selector);
const result = $('#result');
const realtimePanel = $('#realtimePanel');
let bootstrap = null;
let realtime = null;
let crewMap = null;
let audioEngine = null;
let mediaSessionExpiresAt = null;
let mediaSessionTrackId = null;
let mediaSessionScope = null;
let currentPrincipal = null;
let voiceClient = null;
let currentRoomLocked = false;
const echoverseTrackIndex = new Map();
const locationShare = {
  watchId: null,
  enabled: false,
  latest: null,
  lastSentAt: 0,
  lastSentCoords: null
};

function show(message, data, isError = false) {
  result.classList.remove('hidden');
  result.classList.toggle('error', isError);
  result.innerHTML = `<h3>${escapeHtml(message)}</h3>${data ? `<pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>` : ''}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body?.error?.message || `HTTP ${response.status}`), { body, status: response.status });
  return body;
}

async function refreshIdentity() {
  bootstrap = await api('/v1/bootstrap');
  $('#identityMode').textContent = bootstrap.identity.mode.toUpperCase();
  $('#realtimeMode').textContent = bootstrap.features.realtime ? 'LIVE' : 'OFF';
  $('#locationMode').textContent = bootstrap.features.liveLocation ? 'OPT-IN' : 'OFF';
  ensureCrewMap();
  renderVoiceBootstrap();
  const session = await api('/v1/session');
  currentPrincipal = session.principal;
  const pill = $('#identityPill');
  pill.classList.remove('connected', 'warn');
  const signedIn = Boolean(session.principal.authenticated);
  $('#createCard').classList.toggle('hidden', !signedIn);
  $('#signInCard').classList.toggle('hidden', signedIn);
  $('#memberCard').classList.toggle('hidden', !signedIn);
  const signInButton = $('#signInButton');
  if (signInButton) {
    signInButton.href = bootstrap.identity.loginPath ? `${bootstrap.identity.loginPath}?next=${encodeURIComponent(location.pathname + location.search)}` : '#';
    signInButton.classList.toggle('disabled-link', !bootstrap.identity.loginConfigured);
  }
  const hint = $('#signInHint');
  if (hint && !bootstrap.identity.loginConfigured) hint.textContent = 'AeroVista sign-in needs the Access Convergence exchange URL configured on this deployment. Joining remains available.';
  if (signedIn) {
    pill.textContent = session.principal.displayName || 'AeroVista Member';
    pill.classList.add('connected');
    $('#memberWelcome').textContent = session.principal.displayName || 'AeroVista Member';
  } else if (session.principal.authState === 'unavailable') {
    pill.textContent = 'Identity unavailable · guest mode';
    pill.classList.add('warn');
  } else {
    pill.textContent = 'Guest';
  }
  const ev = $('#echoverseStatus');
  if (ev) ev.textContent = signedIn
    ? 'Signed in · library access depends on your live AVCC capability grant.'
    : "Sign in with AeroVista Identity to browse the private EchoVerse library. Guest riders can still hear the host's current shared track.";
  const libraryButton = $('#echoverseLoad');
  if (libraryButton) {
    libraryButton.disabled = !signedIn;
    libraryButton.textContent = signedIn ? 'Load library' : 'Sign in for library';
  }
  renderPlayback();
}

function sessionKey(roomId) {
  return `rydesync:session:${roomId}`;
}

function saveRoomSession(room, member, token) {
  const value = { room, member, token, savedAt: new Date().toISOString() };
  localStorage.setItem(sessionKey(room.id), JSON.stringify(value));
  localStorage.setItem('rydesync:last-session', JSON.stringify(value));
  return value;
}

function wsUrl(roomId) {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/v1/realtime?room=${encodeURIComponent(roomId)}`;
}

function memberName(memberId) {
  return realtime?.members?.find((member) => member.id === memberId)?.displayName || 'Rider';
}

function ensureCrewMap() {
  if (crewMap || !bootstrap?.features?.crewMap) return;
  const element = $('#crewMap');
  if (!element) return;
  crewMap = new CrewMap(element, {
    ...(bootstrap.map || {}),
    staleAfterMs: bootstrap.location?.staleAfterMs || 120000
  });
  const attribution = $('#mapAttribution');
  if (attribution) {
    attribution.textContent = bootstrap.map?.attribution || '';
    attribution.href = bootstrap.map?.attributionUrl || '#';
    attribution.hidden = !bootstrap.map?.attribution;
  }
}

function renderCrewMap({ autoFit = false } = {}) {
  ensureCrewMap();
  if (!crewMap) return;
  crewMap.setLocations(realtime ? [...realtime.locations.values()] : [], {
    members: realtime?.members || [],
    selfMemberId: realtime?.session?.member?.id || null,
    autoFit
  });
}

function renderLocations() {
  const list = $('#rtLocations');
  if (!list) return;
  const locations = realtime ? [...realtime.locations.values()] : [];
  list.innerHTML = locations.length
    ? locations.map((entry) => `
      <li>
        <span class="location-pin">⌖</span>
        <span><strong>${escapeHtml(memberName(entry.memberId))}</strong><small>${entry.latitude.toFixed(5)}, ${entry.longitude.toFixed(5)} · ±${Math.round(entry.accuracy)}m</small></span>
      </li>`).join('')
    : '<li class="muted">No one is sharing location.</li>';
  renderCrewMap();
}

function renderLocationControl(label = null, tone = '') {
  const button = $('#locationToggle');
  const status = $('#locationStatus');
  if (!button || !status) return;
  button.textContent = locationShare.enabled ? 'Stop sharing' : 'Share my location';
  button.classList.toggle('danger', locationShare.enabled);
  status.textContent = label || (locationShare.enabled ? 'Sharing only with this ride room' : 'Off · never starts automatically');
  status.className = `location-status ${tone}`;
}

function renderRealtime(status = {}) {
  realtimePanel.classList.remove('hidden');
  $('#rtRoom').textContent = status.room?.name || realtime?.session?.room?.name || 'Ride room';
  $('#rtStatus').textContent = status.label || 'CONNECTING';
  $('#rtStatus').className = `rt-status ${status.tone || ''}`;
  $('#rtSeq').textContent = Number.isInteger(status.seq) ? String(status.seq) : (Number.isInteger(realtime?.lastSeq) ? String(realtime.lastSeq) : '—');

  const members = status.members || realtime?.members || [];
  $('#rtMembers').innerHTML = members.length
    ? members.map((member) => `
      <li>
        <span class="presence-dot ${member.online ? 'online' : ''}"></span>
        <span><strong>${escapeHtml(member.displayName || 'Rider')}</strong><small>${escapeHtml(member.role || 'rider')}</small></span>
      </li>`).join('')
    : '<li class="muted">Waiting for presence snapshot…</li>';
  renderLocations();
  renderLocationControl();
}

function distanceMeters(a, b) {
  if (!a || !b) return Infinity;
  const toRad = (value) => value * Math.PI / 180;
  const earth = 6_371_000;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earth * Math.asin(Math.sqrt(h));
}

function sendLatestLocation({ force = false } = {}) {
  if (!locationShare.enabled || !locationShare.latest || !realtime?.authenticated || realtime.ws?.readyState !== WebSocket.OPEN) return;
  const now = Date.now();
  const minInterval = bootstrap?.location?.minIntervalMs || 5000;
  const coords = locationShare.latest.coords;
  const current = { latitude: coords.latitude, longitude: coords.longitude };
  const elapsed = now - locationShare.lastSentAt;
  const moved = distanceMeters(locationShare.lastSentCoords, current);
  if (!force && (elapsed < minInterval || (moved < 8 && elapsed < 15000))) return;

  realtime.ws.send(JSON.stringify({
    type: 'location.update',
    coords: {
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracy: coords.accuracy,
      altitude: Number.isFinite(coords.altitude) ? coords.altitude : null,
      speed: Number.isFinite(coords.speed) && coords.speed >= 0 ? coords.speed : null,
      heading: Number.isFinite(coords.heading) && coords.heading >= 0 ? coords.heading : null
    },
    clientTs: locationShare.latest.timestamp
  }));
  locationShare.lastSentAt = now;
  locationShare.lastSentCoords = current;
}

function stopLocationSharing({ notifyServer = true, label = null } = {}) {
  if (locationShare.watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(locationShare.watchId);
  locationShare.watchId = null;
  const wasEnabled = locationShare.enabled;
  locationShare.enabled = false;
  locationShare.latest = null;
  locationShare.lastSentAt = 0;
  locationShare.lastSentCoords = null;
  if (wasEnabled && notifyServer && realtime?.authenticated && realtime.ws?.readyState === WebSocket.OPEN) {
    realtime.ws.send(JSON.stringify({ type: 'location.stop' }));
  }
  renderLocationControl(label || 'Off · location cleared from this ride');
}

function startLocationSharing() {
  if (!realtime?.authenticated) {
    renderLocationControl('Connect to the ride before sharing', 'warn');
    return;
  }
  if (!navigator.geolocation) {
    renderLocationControl('Location is not supported by this browser', 'error');
    return;
  }
  if (locationShare.enabled) return;

  locationShare.enabled = true;
  renderLocationControl('Requesting device location…', 'warn');
  locationShare.watchId = navigator.geolocation.watchPosition((position) => {
    locationShare.latest = position;
    window.dispatchEvent(new CustomEvent('rydesync:self-location', { detail: {
      speed: Number.isFinite(position.coords.speed) && position.coords.speed >= 0 ? position.coords.speed : null,
      heading: Number.isFinite(position.coords.heading) && position.coords.heading >= 0 ? position.coords.heading : null,
      accuracy: position.coords.accuracy,
      timestamp: position.timestamp
    } }));
    renderLocationControl(`Sharing · ±${Math.round(position.coords.accuracy)}m`, 'online');
    sendLatestLocation();
  }, (error) => {
    const message = error.code === 1 ? 'Location permission denied' : 'Location temporarily unavailable';
    if (error.code === 1) stopLocationSharing({ notifyServer: true, label: message });
    else renderLocationControl(message, 'warn');
  }, {
    enableHighAccuracy: true,
    maximumAge: 5000,
    timeout: 15000
  });
}

async function openMemberMediaSession() {
  const body = await api('/v1/echoverse/media-session', { method: 'POST', body: '{}' });
  mediaSessionExpiresAt = body.expiresAt || null;
  mediaSessionTrackId = null;
  mediaSessionScope = 'library';
  return body;
}

async function openRoomMediaSession(trackId = realtime?.playback?.trackId) {
  if (!trackId || !realtime?.session?.token) return null;
  const body = await api('/v1/echoverse/room-media-session', {
    method: 'POST', body: JSON.stringify({ roomToken: realtime.session.token })
  });
  if (String(body.trackId) !== String(trackId)) throw new Error('Shared track changed while media access was opening');
  mediaSessionExpiresAt = body.expiresAt || null;
  mediaSessionTrackId = String(trackId);
  mediaSessionScope = 'room-track';
  return body;
}

async function ensurePlaybackMediaGrant(playback = realtime?.playback) {
  if (!playback?.trackId) return null;
  const expires = Date.parse(mediaSessionExpiresAt || '');
  const fresh = Number.isFinite(expires) && expires - Date.now() > 90000;
  if (fresh && (mediaSessionScope === 'library' || mediaSessionTrackId === String(playback.trackId))) return true;
  if (currentPrincipal?.authenticated) {
    try { await openMemberMediaSession(); return true; }
    catch (error) {
      if (!['capability_required', 'identity_unavailable', 'auth_required'].includes(error.body?.error?.code)) throw error;
    }
  }
  await openRoomMediaSession(playback.trackId);
  return true;
}

function ensureAudioEngine() {
  if (audioEngine) return audioEngine;
  const audio = $('#sharedAudio');
  if (!audio) return null;
  audioEngine = new SharedAudioEngine(audio, {
    softDriftMs: bootstrap?.playback?.softDriftMs ?? 250,
    hardDriftMs: bootstrap?.playback?.hardDriftMs ?? 1500,
    onState: ({ state, driftMs, correction, error }) => {
      const el = $('#audioClientStatus');
      if (!el) return;
      const labels = {
        idle: 'READY · no shared track', muted: 'OFF · audio never starts automatically', ready: 'READY', locked: 'OFF · tap Listen with crew',
        buffering: 'BUFFERING', playing: `PLAYING${Number.isFinite(driftMs) ? ` · drift ${Math.round(driftMs)}ms${correction && correction !== 'none' ? ` · ${correction}` : ''}` : ''}`,
        paused: 'PAUSED', gesture_required: 'TAP LISTEN · browser blocked autoplay', error: `AUDIO ERROR · ${error || 'stream unavailable'}`
      };
      el.textContent = labels[state] || state.toUpperCase();
      el.className = `playback-client-state ${['playing','ready'].includes(state) ? 'online' : ['locked','gesture_required','buffering'].includes(state) ? 'warn' : state === 'error' ? 'error' : ''}`;
      const button = $('#audioListenToggle');
      if (button) button.textContent = audioEngine?.armed ? 'Stop listening' : 'Listen with crew';
    }
  });
  return audioEngine;
}

async function applyPlaybackToAudio(playback = realtime?.playback, { force = false } = {}) {
  const engine = ensureAudioEngine();
  if (!engine) return;
  if (engine.armed && playback?.trackId) await ensurePlaybackMediaGrant(playback);
  const serverNow = Date.now() + Number(realtime?.clockOffsetMs || 0);
  await engine.apply(playback, serverNow, { force });
}

function isPlaybackController() {
  return Boolean(realtime?.session?.member?.identityId) && ['host', 'co_host'].includes(realtime?.session?.member?.role);
}

function formatTime(ms) {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function playbackTargetMs(playback = realtime?.playback) {
  return projectPlaybackTarget(playback, Date.now() + Number(realtime?.clockOffsetMs || 0));
}

function playbackTrackLabel(trackId) {
  const track = echoverseTrackIndex.get(String(trackId));
  if (!track) return { title: trackId ? 'Protected EchoVerse track' : 'No shared track', detail: trackId || 'Room soundtrack is idle' };
  return {
    title: track.title || 'Untitled track',
    detail: [track.artist, track.album].filter(Boolean).join(' · ') || String(trackId)
  };
}

function renderPlayback(message = null) {
  const playback = message?.playback || realtime?.playback || null;
  const title = $('#sharedTrackTitle');
  if (!title) return;
  const meta = $('#sharedTrackMeta');
  const state = $('#sharedPlaybackState');
  const clock = $('#sharedPlaybackClock');
  const controls = $('#sharedPlaybackControls');
  const selected = playbackTrackLabel(playback?.trackId || null);
  title.textContent = selected.title;
  meta.textContent = selected.detail;
  const target = playbackTargetMs(playback);
  state.textContent = playback?.trackId ? `${String(playback.status || 'idle').toUpperCase()} · E${playback.epoch ?? 0}` : 'IDLE';
  state.className = `playback-state ${playback?.status === 'playing' ? 'online' : ''}`;
  clock.textContent = playback?.trackId ? `Target ${formatTime(target)} · room clock ${Math.round(realtime?.clockOffsetMs || 0)}ms` : 'Waiting for a host to select a track.';
  controls.hidden = !isPlaybackController();
  if (!controls.hidden) {
    $('#playbackPlay').disabled = !playback?.trackId || playback?.status === 'playing';
    $('#playbackPause').disabled = !playback?.trackId || playback?.status !== 'playing';
    $('#playbackBack').disabled = !playback?.trackId;
    $('#playbackForward').disabled = !playback?.trackId;
    $('#playbackClear').disabled = !playback?.trackId;
  }
}

function sendPlayback(type, payload = {}) {
  if (!realtime?.authenticated || realtime.ws?.readyState !== WebSocket.OPEN) return;
  const expectedEpoch = Number.isInteger(realtime.playback?.epoch) ? realtime.playback.epoch : 0;
  realtime.ws.send(JSON.stringify({ type, expectedEpoch, ...payload }));
}

function sendClockPing() {
  if (!realtime?.authenticated || realtime.ws?.readyState !== WebSocket.OPEN) return;
  realtime.ws.send(JSON.stringify({ type: 'presence.ping', clientTs: Date.now() }));
}

function startClockSync() {
  if (!realtime) return;
  clearInterval(realtime.pingTimer);
  sendClockPing();
  realtime.pingTimer = setInterval(sendClockPing, 5000);
}

function sendRealtime(message) {
  if (!realtime?.authenticated || realtime.ws?.readyState !== WebSocket.OPEN) return false;
  realtime.ws.send(JSON.stringify(message));
  return true;
}

function ensureVoiceClient() {
  if (voiceClient) return voiceClient;
  voiceClient = new VoiceClient({
    iceServers: bootstrap?.voice?.iceServers || [],
    send: sendRealtime,
    onState: ({ state, detail, peerCount }) => {
      const status = $('#voiceStatus');
      const enable = $('#voiceEnable');
      const talk = $('#talkButton');
      const labels = {
        off: 'Off · microphone never starts automatically', requesting: 'Requesting microphone permission…',
        connecting: 'Connecting to crew voice…', reconnecting: 'Voice reconnecting…', ready: `Ready · ${peerCount || 0} voice peer${peerCount === 1 ? '' : 's'}`,
        requesting_floor: 'Requesting talk channel…', talking: 'Transmitting to crew', listening: 'Crew member is talking', busy: 'Channel busy',
        gesture_required: 'Tap Enable PTT again to unlock received audio', error: `Voice error · ${detail || 'request rejected'}`
      };
      status.textContent = labels[state] || state;
      status.className = `voice-status ${['ready','talking','listening'].includes(state) ? 'online' : ['requesting','connecting','reconnecting','requesting_floor','busy','gesture_required'].includes(state) ? 'warn' : state === 'error' ? 'error' : ''}`;
      enable.textContent = voiceClient?.enabled ? 'Disable PTT' : 'Enable PTT';
      enable.classList.toggle('danger', Boolean(voiceClient?.enabled));
      talk.disabled = !(voiceClient?.enabled && voiceClient?.joined);
      $('#talkHint').textContent = talk.disabled ? 'Enable microphone first' : state === 'talking' ? 'Release to stop' : 'Press and hold';
    },
    onFloor: ({ memberId, member }) => {
      const self = realtime?.session?.member?.id;
      const speaker = $('#voiceSpeaker');
      if (!memberId) speaker.textContent = 'Channel clear';
      else if (memberId === self) speaker.textContent = 'You are talking';
      else speaker.textContent = `${member?.displayName || memberName(memberId)} is talking`;
      $('#talkButton').classList.toggle('talking', memberId === self);
      $('#talkLabel').textContent = memberId === self ? 'TALKING' : 'HOLD TO TALK';
    }
  });
  return voiceClient;
}

function renderVoiceBootstrap() {
  const turn = $('#turnStatus');
  if (!turn || !bootstrap?.voice) return;
  turn.textContent = bootstrap.voice.turnConfigured ? 'TURN ready · cellular fallback configured' : 'TURN not configured · same-network voice may work';
  turn.className = bootstrap.voice.turnConfigured ? 'turn-status online' : 'turn-status warn';
  $('#voicePanel').classList.toggle('hidden', !bootstrap.voice.enabled);
}

function renderHostControls(room = null) {
  const isHost = realtime?.session?.member?.role === 'host' && Boolean(realtime?.session?.member?.identityId);
  $('#hostPanel').classList.toggle('hidden', !isHost);
  if (room && typeof room.locked === 'boolean') currentRoomLocked = room.locked;
  $('#roomLockToggle').textContent = currentRoomLocked ? 'Unlock Ryde' : 'Lock Ryde';
}

function stopRealtime() {
  if (!realtime) return;
  stopLocationSharing({ notifyServer: true });
  voiceClient?.disable({ notify: true });
  realtime.manualClose = true;
  clearTimeout(realtime.reconnectTimer);
  clearInterval(realtime.pingTimer);
  if (realtime.ws && realtime.ws.readyState < WebSocket.CLOSING) realtime.ws.close(1000, 'Leaving ride');
  realtime = null;
}

function connectRealtime(session) {
  stopRealtime();
  realtime = {
    session,
    ws: null,
    lastSeq: 0,
    members: [],
    locations: new Map(),
    playback: null,
    clockOffsetMs: 0,
    clockSamples: 0,
    pingTimer: null,
    reconnectAttempt: 0,
    reconnectTimer: null,
    manualClose: false,
    authenticated: false
  };

  const open = () => {
    if (!realtime || realtime.manualClose) return;
    realtime.authenticated = false;
    renderRealtime({ label: realtime.reconnectAttempt ? 'RECONNECTING' : 'CONNECTING', tone: 'warn' });
    const ws = new WebSocket(wsUrl(session.room.id));
    realtime.ws = ws;

    ws.addEventListener('open', () => {
      if (realtime?.ws !== ws) return;
      ws.send(JSON.stringify({ type: 'auth', token: session.token, lastSeenSeq: realtime.lastSeq }));
    });

    ws.addEventListener('message', (event) => {
      if (realtime?.ws !== ws) return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (Number.isInteger(message.seq)) realtime.lastSeq = Math.max(realtime.lastSeq, message.seq);

      if (message.type === 'auth.ok') {
        realtime.authenticated = true;
        realtime.reconnectAttempt = 0;
        renderRealtime({ label: message.resumed ? 'RESUMED' : 'LIVE', tone: 'online', seq: message.seq });
        startClockSync();
        if (locationShare.enabled && locationShare.latest) sendLatestLocation({ force: true });
        if (voiceClient?.enabled) voiceClient.rejoin();
      } else if (message.type === 'room.snapshot') {
        realtime.members = Array.isArray(message.members) ? message.members : [];
        realtime.locations = new Map((Array.isArray(message.locations) ? message.locations : []).map((entry) => [entry.memberId, entry]));
        realtime.playback = message.playback || realtime.playback;
        currentRoomLocked = Boolean(message.room?.locked);
        renderRealtime({ label: 'LIVE', tone: 'online', seq: message.seq, room: message.room, members: realtime.members });
        renderHostControls(message.room);
        renderCrewMap({ autoFit: true });
        renderPlayback();
        applyPlaybackToAudio(realtime.playback).catch(console.error);
      } else if (message.type === 'member.online' || message.type === 'member.offline') {
        const member = message.member;
        const index = realtime.members.findIndex((candidate) => candidate.id === member.id);
        if (index >= 0) realtime.members[index] = member;
        else realtime.members.push(member);
        renderRealtime({ label: 'LIVE', tone: 'online', seq: message.seq, members: realtime.members });
      } else if (message.type === 'presence.pong') {
        const sent = Number(message.clientTs);
        const serverTs = Date.parse(message.serverTs);
        const received = Date.now();
        if (Number.isFinite(sent) && Number.isFinite(serverTs) && sent <= received) {
          const sample = serverTs - ((sent + received) / 2);
          if (Math.abs(sample) < 60000) {
            realtime.clockOffsetMs = realtime.clockSamples ? (realtime.clockOffsetMs * 0.75 + sample * 0.25) : sample;
            realtime.clockSamples += 1;
            renderPlayback();
          }
        }
      } else if (message.type === 'playback.state' || message.type === 'playback.sync') {
        realtime.playback = message.playback || realtime.playback;
        renderPlayback(message);
        applyPlaybackToAudio(realtime.playback).catch(console.error);
      } else if (message.type === 'playback.error') {
        const state = $('#sharedPlaybackState');
        if (state) {
          state.textContent = `CONTROL ERROR · ${message.error?.message || 'command rejected'}`;
          state.className = 'playback-state error';
        }
        if (message.playback) {
          realtime.playback = message.playback;
          setTimeout(() => renderPlayback(), 1500);
        }
      } else if (message.type.startsWith('voice.')) {
        ensureVoiceClient().handle(message).catch((error) => {
          $('#voiceStatus').textContent = `Voice error · ${error.message}`;
          $('#voiceStatus').className = 'voice-status error';
        });
      } else if (message.type === 'room.locked') {
        currentRoomLocked = Boolean(message.locked);
        renderHostControls({ locked: currentRoomLocked });
      } else if (message.type === 'room.ended') {
        voiceClient?.disable({ notify: false });
        stopLocationSharing({ notifyServer: false, label: 'Off · Ryde ended' });
        renderRealtime({ label: 'RYDE ENDED', tone: 'error' });
      } else if (message.type === 'room.error') {
        show('Host control rejected', message.error || {}, true);
      } else if (message.type === 'location.member') {
        realtime.locations.set(message.location.memberId, message.location);
        renderLocations();
      } else if (message.type === 'location.cleared') {
        realtime.locations.delete(message.memberId);
        renderLocations();
      } else if (message.type === 'location.rate_limited') {
        renderLocationControl('Sharing · update throttled to protect battery/data', 'warn');
      } else if (message.type === 'location.error') {
        renderLocationControl(`Location rejected: ${message.error?.message || 'invalid sample'}`, 'error');
      }
    });

    ws.addEventListener('close', (event) => {
      if (!realtime || realtime.ws !== ws || realtime.manualClose) return;
      realtime.authenticated = false;
      clearInterval(realtime.pingTimer);
      voiceClient?.realtimeDisconnected();
      if ([4003, 4004, 4005, 4010, 4011].includes(event.code)) {
        stopLocationSharing({ notifyServer: false, label: 'Off · ride session ended' });
        renderRealtime({ label: 'SESSION ENDED', tone: 'error' });
        return;
      }
      if (event.code === 4009) {
        stopLocationSharing({ notifyServer: false, label: 'Off · session moved to another client' });
        renderRealtime({ label: 'MOVED TO ANOTHER CLIENT', tone: 'warn' });
        return;
      }
      realtime.reconnectAttempt += 1;
      const delay = Math.min(10_000, 500 * (2 ** Math.min(realtime.reconnectAttempt - 1, 5)));
      renderRealtime({ label: `RECONNECT ${Math.ceil(delay / 1000)}s`, tone: 'warn' });
      realtime.reconnectTimer = setTimeout(open, delay);
    });

    ws.addEventListener('error', () => {
      if (realtime?.ws === ws) renderRealtime({ label: 'CONNECTION ISSUE', tone: 'warn' });
    });
  };

  open();
}


function normalizeTrackList(body) {
  return Array.isArray(body?.tracks) ? body.tracks : [];
}

function renderEchoVerseTracks(body) {
  const host = $('#echoverseTracks');
  const tracks = normalizeTrackList(body).slice(0, 12);
  echoverseTrackIndex.clear();
  for (const track of normalizeTrackList(body)) echoverseTrackIndex.set(String(track.id), track);
  host.innerHTML = tracks.length ? tracks.map((track) => `
    <article class="track-card">
      <div class="track-art">${track.artworkUrl ? `<img src="${escapeHtml(track.artworkUrl)}" alt="" />` : '<span>EV</span>'}</div>
      <div class="track-copy">
        <strong>${escapeHtml(track.title || 'Untitled track')}</strong>
        <small>${escapeHtml([track.artist, track.album].filter(Boolean).join(' · ') || 'EchoVerse')}</small>
      </div>
      <span class="track-stream-state">Protected stream · per-rider entitlement</span>
      <button type="button" class="mini track-sync" data-track-id="${escapeHtml(track.id)}" ${isPlaybackController() ? '' : 'disabled'}>Sync to room</button>
    </article>`).join('') : '<div class="muted">No tracks returned by the current catalog contract.</div>';
  renderPlayback();
}

async function loadEchoVerseCatalog() {
  const status = $('#echoverseStatus');
  const button = $('#echoverseLoad');
  button.disabled = true;
  status.textContent = 'Checking AeroVista access and loading the canonical catalog…';
  try {
    await openMemberMediaSession();
    const body = await api('/v1/echoverse/catalog');
    renderEchoVerseTracks(body);
    status.textContent = `${body.total ?? body.tracks?.length ?? 0} track${(body.total ?? body.tracks?.length ?? 0) === 1 ? '' : 's'} available through RydeSync.`;
    status.className = 'echoverse-status online';
  } catch (error) {
    const code = error.body?.error?.code;
    status.textContent = code === 'auth_required' ? 'AeroVista sign-in required for EchoVerse.'
      : code === 'capability_required' ? 'Your account does not currently have EchoVerse Library access.'
        : `Library unavailable: ${error.body?.error?.message || error.message}`;
    status.className = 'echoverse-status error';
  } finally {
    button.disabled = false;
  }
}

$('#sharedPlaybackControls').addEventListener('click', (event) => {
  const id = event.target?.id;
  const current = playbackTargetMs();
  if (id === 'playbackPlay') sendPlayback('playback.play');
  if (id === 'playbackPause') sendPlayback('playback.pause');
  if (id === 'playbackBack') sendPlayback('playback.seek', { positionMs: Math.max(0, current - 10_000) });
  if (id === 'playbackForward') sendPlayback('playback.seek', { positionMs: current + 10_000 });
  if (id === 'playbackClear') sendPlayback('playback.clear');
});

$('#echoverseTracks').addEventListener('click', (event) => {
  const button = event.target.closest?.('.track-sync');
  if (!button || button.disabled) return;
  sendPlayback('playback.select', { trackId: button.dataset.trackId, autoplay: true, positionMs: 0 });
});

async function renewMediaSessionIfNeeded() {
  if (!audioEngine?.armed || !mediaSessionExpiresAt) return;
  const expires = Date.parse(mediaSessionExpiresAt);
  if (!Number.isFinite(expires) || expires - Date.now() > 120000) return;
  try { await ensurePlaybackMediaGrant(realtime?.playback); }
  catch (error) {
    const status = $('#audioClientStatus');
    if (status) {
      status.textContent = 'MEDIA AUTH REFRESH FAILED · current stream may continue';
      status.className = 'playback-client-state warn';
    }
  }
}


const localVolume = $('#audioVolume');
const localMute = $('#audioMuteToggle');
function syncLocalAudioControls() {
  const audio = $('#sharedAudio');
  if (!audio) return;
  if (localVolume) localVolume.value = String(audio.volume);
  if (localMute) localMute.textContent = audio.muted ? 'Unmute' : 'Mute';
}
localVolume?.addEventListener('input', () => {
  const audio = $('#sharedAudio');
  if (!audio) return;
  audio.volume = Math.max(0, Math.min(1, Number(localVolume.value)));
  if (audio.volume > 0 && audio.muted) audio.muted = false;
  syncLocalAudioControls();
});
localMute?.addEventListener('click', () => {
  const audio = $('#sharedAudio');
  if (!audio) return;
  audio.muted = !audio.muted;
  syncLocalAudioControls();
});
syncLocalAudioControls();

$('#audioListenToggle').addEventListener('click', async () => {
  const engine = ensureAudioEngine();
  if (!engine) return;
  if (engine.armed) {
    engine.setArmed(false);
    mediaSessionExpiresAt = null;
    mediaSessionTrackId = null;
    mediaSessionScope = null;
    api('/v1/echoverse/media-session', { method: 'DELETE' }).catch(() => {});
    return;
  }
  const status = $('#audioClientStatus');
  try {
    status.textContent = currentPrincipal?.authenticated ? 'OPENING ECHOVERSE MEDIA…' : 'OPENING SHARED TRACK…';
    status.className = 'playback-client-state warn';
    engine.setArmed(true);
    if (realtime?.playback?.trackId) await ensurePlaybackMediaGrant(realtime.playback);
    await applyPlaybackToAudio(realtime?.playback, { force: true });
  } catch (error) {
    const code = error.body?.error?.code;
    status.textContent = code === 'auth_required' ? 'SIGN IN REQUIRED · AeroVista Identity'
      : code === 'capability_required' ? 'ACCESS REQUIRED · EchoVerse Library'
        : `MEDIA SESSION FAILED · ${error.body?.error?.message || error.message}`;
    status.className = 'playback-client-state error';
    engine.setArmed(false);
  }
});

$('#createForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const created = await api('/v1/rooms', {
      method: 'POST',
      body: JSON.stringify({ name: form.get('name'), mode: form.get('mode') })
    });
    const session = saveRoomSession(created.room, created.member, created.token);
    history.replaceState(null, '', `/?room=${encodeURIComponent(created.room.joinCode)}`);
    show('Ride created', {
      room: created.room,
      member: created.member,
      invite: `${location.origin}/?room=${created.room.joinCode}`,
      realtime: 'connecting',
      note: 'Room session token is stored locally and never placed in the invite URL.'
    });
    connectRealtime(session);
  } catch (error) {
    if (error.body?.error?.code === 'auth_required') show('Sign in to start a Ryde', { action: 'Use Sign In, then Start Ryde becomes available.' }, true);
    else show('Could not create ride', error.body || { message: error.message }, true);
  }
});

$('#joinForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const room = String(form.get('room') || '').trim();
  try {
    const joined = await api(`/v1/rooms/${encodeURIComponent(room)}/join`, {
      method: 'POST',
      body: JSON.stringify({ displayName: form.get('displayName') })
    });
    const session = saveRoomSession(joined.room, joined.member, joined.token);
    history.replaceState(null, '', `/?room=${encodeURIComponent(joined.room.joinCode)}`);
    show('Ride joined', { room: joined.room, member: joined.member, realtime: 'connecting' });
    connectRealtime(session);
  } catch (error) {
    show('Could not join ride', error.body || { message: error.message }, true);
  }
});

$('#voiceEnable').addEventListener('click', async () => {
  const voice = ensureVoiceClient();
  if (voice.enabled) return voice.disable({ notify: true });
  if (!realtime?.authenticated) return show('Join a Ryde before enabling PTT', null, true);
  try { await voice.enable(realtime.session.member.id); }
  catch (error) {
    $('#voiceStatus').textContent = `Microphone unavailable · ${error.message}`;
    $('#voiceStatus').className = 'voice-status error';
  }
});

const talkButton = $('#talkButton');
function startTalk(event) {
  event?.preventDefault();
  if (talkButton.disabled) return;
  try { talkButton.setPointerCapture?.(event.pointerId); } catch {}
  ensureVoiceClient().pressStart();
}
function stopTalk(event) {
  event?.preventDefault();
  voiceClient?.pressStop();
}
talkButton.addEventListener('pointerdown', startTalk);
talkButton.addEventListener('pointerup', stopTalk);
talkButton.addEventListener('pointercancel', stopTalk);
talkButton.addEventListener('contextmenu', (event) => event.preventDefault());
window.addEventListener('blur', () => voiceClient?.pressStop());
document.addEventListener('keydown', (event) => {
  if (event.code !== 'Space' || event.repeat || ['INPUT','SELECT','TEXTAREA','BUTTON'].includes(document.activeElement?.tagName)) return;
  if (!talkButton.disabled) { event.preventDefault(); ensureVoiceClient().pressStart(); }
});
document.addEventListener('keyup', (event) => {
  if (event.code === 'Space' && voiceClient?.pressActive) { event.preventDefault(); voiceClient.pressStop(); }
});

$('#roomLockToggle').addEventListener('click', () => sendRealtime({ type: 'room.lock.set', locked: !currentRoomLocked }));
$('#roomEnd').addEventListener('click', () => {
  if (confirm('End this Ryde for everyone?')) sendRealtime({ type: 'room.end' });
});

$('#rtRefresh').addEventListener('click', () => {
  if (realtime?.ws?.readyState === WebSocket.OPEN) realtime.ws.send(JSON.stringify({ type: 'room.state.get' }));
});

$('#locationToggle').addEventListener('click', () => {
  if (locationShare.enabled) stopLocationSharing({ notifyServer: true });
  else startLocationSharing();
});

$('#mapFit').addEventListener('click', () => crewMap?.fitCrew());
$('#mapZoomIn').addEventListener('click', () => { if (crewMap) { crewMap.userInteracted = true; crewMap.zoomBy(1); } });
$('#mapZoomOut').addEventListener('click', () => { if (crewMap) { crewMap.userInteracted = true; crewMap.zoomBy(-1); } });
$('#echoverseLoad').addEventListener('click', loadEchoVerseCatalog);

const incomingRoom = new URLSearchParams(location.search).get('room');
if (incomingRoom) {
  $('#joinForm [name="room"]').value = incomingRoom;
  try {
    const saved = JSON.parse(localStorage.getItem('rydesync:last-session') || 'null');
    if (saved?.token && saved?.room && [saved.room.id, saved.room.joinCode].includes(incomingRoom)) {
      show('Ride session restored', { room: saved.room, member: saved.member, realtime: 'reconnecting', location: 'off until you explicitly share again' });
      connectRealtime(saved);
    }
  } catch {
    localStorage.removeItem('rydesync:last-session');
  }
}

setInterval(() => { if (realtime?.playback?.trackId) renderPlayback(); }, 500);
setInterval(() => { if (audioEngine?.armed && realtime?.playback?.trackId) applyPlaybackToAudio(realtime.playback).catch(console.error); }, 2000);
setInterval(() => { renewMediaSessionIfNeeded().catch(console.error); }, 60000);

refreshIdentity().catch((error) => {
  $('#identityPill').textContent = 'Identity status unavailable';
  $('#identityPill').classList.add('warn');
  console.error(error);
});
