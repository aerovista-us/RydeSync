const $ = (selector) => document.querySelector(selector);
const result = $('#result');
const realtimePanel = $('#realtimePanel');
let bootstrap = null;
let realtime = null;
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
  const session = await api('/v1/session');
  const pill = $('#identityPill');
  pill.classList.remove('connected', 'warn');
  if (session.principal.authenticated) {
    pill.textContent = session.principal.displayName || 'AeroVista Member';
    pill.classList.add('connected');
  } else if (session.principal.authState === 'unavailable') {
    pill.textContent = 'Identity unavailable · guest mode';
    pill.classList.add('warn');
  } else {
    pill.textContent = 'Guest';
  }
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

function stopRealtime() {
  if (!realtime) return;
  stopLocationSharing({ notifyServer: true });
  realtime.manualClose = true;
  clearTimeout(realtime.reconnectTimer);
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
        if (locationShare.enabled && locationShare.latest) sendLatestLocation({ force: true });
      } else if (message.type === 'room.snapshot') {
        realtime.members = Array.isArray(message.members) ? message.members : [];
        realtime.locations = new Map((Array.isArray(message.locations) ? message.locations : []).map((entry) => [entry.memberId, entry]));
        renderRealtime({ label: 'LIVE', tone: 'online', seq: message.seq, room: message.room, members: realtime.members });
      } else if (message.type === 'member.online' || message.type === 'member.offline') {
        const member = message.member;
        const index = realtime.members.findIndex((candidate) => candidate.id === member.id);
        if (index >= 0) realtime.members[index] = member;
        else realtime.members.push(member);
        renderRealtime({ label: 'LIVE', tone: 'online', seq: message.seq, members: realtime.members });
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
      if ([4003, 4004, 4005, 4010].includes(event.code)) {
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
    show('Could not create ride', error.body || { message: error.message }, true);
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

$('#rtRefresh').addEventListener('click', () => {
  if (realtime?.ws?.readyState === WebSocket.OPEN) realtime.ws.send(JSON.stringify({ type: 'room.state.get' }));
});

$('#locationToggle').addEventListener('click', () => {
  if (locationShare.enabled) stopLocationSharing({ notifyServer: true });
  else startLocationSharing();
});

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

refreshIdentity().catch((error) => {
  $('#identityPill').textContent = 'Identity status unavailable';
  $('#identityPill').classList.add('warn');
  console.error(error);
});
