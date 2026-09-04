(() => {
  const nativeFetch = window.fetch.bind(window);
  const NativeWebSocket = window.WebSocket;
  const LAST_SESSION_KEY = 'rydesync:last-session';
  const SESSION_PREFIX = 'rydesync:session:';
  const SAVED_ROOMS_KEY = 'rydesync:saved-rooms';
  const realtimeSockets = new Set();
  const MODE_PROFILES = Object.freeze({
    group_ride: {
      label: 'Group Ride',
      accent: 'Crew ride',
      createHint: 'Map + PTT stay front and center for a moving crew.',
      roomTitle: 'Crew map + comms.',
      roomCopy: 'Presence, push-to-talk, and live crew position are prioritized for a moving group.',
      musicTitle: 'Shared ride soundtrack.'
    },
    listening_party: {
      label: 'Listening Party',
      accent: 'Listening room',
      createHint: 'Music leads the room; presence and chat stay close behind.',
      roomTitle: 'Listening room + crew.',
      roomCopy: 'Keep the crew visible while the shared soundtrack becomes the center of the room.',
      musicTitle: 'The room is the playlist.'
    },
    classroom: {
      label: 'Classroom',
      accent: 'Classroom',
      createHint: 'Listening-first room with the host keeping the floor and reference media nearby.',
      roomTitle: 'Classroom presence + floor.',
      roomCopy: 'The host leads while listeners stay present, connected, and ready for shared reference audio.',
      musicTitle: 'Reference audio + shared playback.'
    },
    band_practice: {
      label: 'Band Practice',
      accent: 'Practice room',
      createHint: 'Speaker-friendly room with PTT and shared reference tracks emphasized.',
      roomTitle: 'Band channel + room.',
      roomCopy: 'Voice and presence stay prominent while the crew can jump to shared reference tracks quickly.',
      musicTitle: 'Reference tracks for the room.'
    },
    campaign: {
      label: 'Campaign',
      accent: 'Campaign room',
      createHint: 'Coordinated listening room for updates, presence, and controlled shared media.',
      roomTitle: 'Campaign room + presence.',
      roomCopy: 'A controlled room for coordinated updates, crew visibility, and shared reference media.',
      musicTitle: 'Shared campaign media.'
    }
  });

  function parseJson(value, fallback = null) {
    try { return JSON.parse(value); } catch { return fallback; }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  }

  function roomMatches(session, roomRef) {
    if (!session?.room || !roomRef) return false;
    return [session.room.id, session.room.joinCode].filter(Boolean).includes(roomRef);
  }

  function currentSession() {
    const session = parseJson(localStorage.getItem(LAST_SESSION_KEY));
    return session?.room?.id && session?.token ? session : null;
  }

  function readSavedRooms() {
    const value = parseJson(localStorage.getItem(SAVED_ROOMS_KEY), []);
    const rooms = Array.isArray(value) ? value : [];
    const now = Date.now();
    const active = rooms.filter((entry) => !entry.expiresAt || Date.parse(entry.expiresAt) > now);
    if (active.length !== rooms.length) localStorage.setItem(SAVED_ROOMS_KEY, JSON.stringify(active));
    return active;
  }

  function writeSavedRooms(rooms) {
    localStorage.setItem(SAVED_ROOMS_KEY, JSON.stringify(rooms));
  }

  function bookmarkFromSession(session) {
    if (!session?.room?.id || !session.room.joinCode) return null;
    return {
      roomId: session.room.id,
      joinCode: session.room.joinCode,
      name: session.room.name || 'Saved Ryde',
      mode: session.room.mode || 'group_ride',
      expiresAt: session.room.expiresAt || null,
      savedAt: new Date().toISOString()
    };
  }

  function saveRoomBookmark(session) {
    const next = bookmarkFromSession(session);
    if (!next) return;
    const rooms = readSavedRooms();
    const index = rooms.findIndex((entry) => entry.roomId === next.roomId || entry.joinCode === next.joinCode);
    if (index >= 0) {
      const previous = rooms[index];
      const materiallySame = previous.name === next.name && previous.mode === next.mode && previous.expiresAt === next.expiresAt;
      if (materiallySame) return;
      rooms[index] = { ...previous, ...next, savedAt: previous.savedAt || next.savedAt };
    } else rooms.unshift(next);
    writeSavedRooms(rooms.slice(0, 24));
  }

  function removeSavedRoom(roomRef) {
    const before = readSavedRooms();
    const after = before.filter((entry) => ![entry.roomId, entry.joinCode].filter(Boolean).includes(roomRef));
    if (after.length !== before.length) writeSavedRooms(after);
  }

  function clearLocalRoomSession(roomRef, { removeSaved = false, reason = 'unavailable' } = {}) {
    const last = parseJson(localStorage.getItem(LAST_SESSION_KEY));
    let resolvedRoomRef = roomRef;
    if (roomMatches(last, roomRef)) {
      resolvedRoomRef = last.room.id || roomRef;
      if (last.room?.id) localStorage.removeItem(`${SESSION_PREFIX}${last.room.id}`);
      localStorage.removeItem(LAST_SESSION_KEY);
    } else if (roomRef) {
      localStorage.removeItem(`${SESSION_PREFIX}${roomRef}`);
    }
    if (removeSaved) {
      removeSavedRoom(roomRef);
      if (resolvedRoomRef !== roomRef) removeSavedRoom(resolvedRoomRef);
    }
    setTimeout(() => window.dispatchEvent(new CustomEvent('rydesync:room-session-cleared', {
      detail: { roomRef, resolvedRoomRef, removeSaved, reason }
    })), 0);
  }

  async function roomAvailability(roomRef) {
    if (!roomRef) return 'unknown';
    try {
      const response = await nativeFetch(`/v1/rooms/${encodeURIComponent(roomRef)}`, {
        headers: { accept: 'application/json' },
        cache: 'no-store'
      });
      if (response.status === 404 || response.status === 410) return 'missing';
      return response.ok ? 'available' : 'unknown';
    } catch {
      return 'unknown';
    }
  }

  function realtimeRoomFromUrl(rawUrl) {
    try {
      const url = new URL(String(rawUrl), location.href);
      if (url.pathname !== '/v1/realtime') return null;
      return String(url.searchParams.get('room') || '').trim() || null;
    } catch {
      return null;
    }
  }

  function cloneCloseEvent(event, override = {}) {
    return new CloseEvent('close', {
      code: override.code ?? event.code,
      reason: override.reason ?? event.reason,
      wasClean: override.wasClean ?? event.wasClean
    });
  }

  function cloneMessageEvent(event) {
    return new MessageEvent('message', {
      data: event.data,
      origin: event.origin,
      lastEventId: event.lastEventId
    });
  }

  class ResilientWebSocket extends EventTarget {
    constructor(url, protocols) {
      super();
      this.url = String(url);
      this.roomRef = realtimeRoomFromUrl(this.url);
      this._native = protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
      this._closedToApp = false;
      realtimeSockets.add(this);

      this._native.addEventListener('open', () => this.dispatchEvent(new Event('open')));
      this._native.addEventListener('message', (event) => this.dispatchEvent(cloneMessageEvent(event)));
      this._native.addEventListener('error', () => this.dispatchEvent(new Event('error')));
      this._native.addEventListener('close', async (event) => {
        realtimeSockets.delete(this);
        if (this._closedToApp) return;

        if (this.roomRef && event.code === 1006) {
          const availability = await roomAvailability(this.roomRef);
          if (availability === 'missing') {
            clearLocalRoomSession(this.roomRef, { removeSaved: true, reason: 'unavailable' });
            this._closedToApp = true;
            this.dispatchEvent(cloneCloseEvent(event, {
              code: 4010,
              reason: 'Ryde is no longer available',
              wasClean: true
            }));
            return;
          }
        }

        if (this.roomRef && [4003, 4004, 4005, 4010, 4011].includes(event.code)) {
          clearLocalRoomSession(this.roomRef, {
            removeSaved: [4010, 4011].includes(event.code),
            reason: event.code === 4011 ? 'ended' : event.code === 4010 ? 'expired' : 'session-ended'
          });
        }

        this._closedToApp = true;
        this.dispatchEvent(cloneCloseEvent(event));
      });
    }

    send(data) { return this._native.send(data); }
    close(code, reason) { return this._native.close(code, reason); }
    get readyState() { return this._native.readyState; }
    get bufferedAmount() { return this._native.bufferedAmount; }
    get extensions() { return this._native.extensions; }
    get protocol() { return this._native.protocol; }
    get binaryType() { return this._native.binaryType; }
    set binaryType(value) { this._native.binaryType = value; }

    get onopen() { return this._onopen || null; }
    set onopen(handler) { this.#setHandler('open', '_onopen', handler); }
    get onmessage() { return this._onmessage || null; }
    set onmessage(handler) { this.#setHandler('message', '_onmessage', handler); }
    get onerror() { return this._onerror || null; }
    set onerror(handler) { this.#setHandler('error', '_onerror', handler); }
    get onclose() { return this._onclose || null; }
    set onclose(handler) { this.#setHandler('close', '_onclose', handler); }

    #setHandler(type, slot, handler) {
      if (this[slot]) this.removeEventListener(type, this[slot]);
      this[slot] = typeof handler === 'function' ? handler : null;
      if (this[slot]) this.addEventListener(type, this[slot]);
    }
  }

  Object.defineProperties(ResilientWebSocket, {
    CONNECTING: { value: NativeWebSocket.CONNECTING },
    OPEN: { value: NativeWebSocket.OPEN },
    CLOSING: { value: NativeWebSocket.CLOSING },
    CLOSED: { value: NativeWebSocket.CLOSED }
  });
  Object.defineProperties(ResilientWebSocket.prototype, {
    CONNECTING: { value: NativeWebSocket.CONNECTING },
    OPEN: { value: NativeWebSocket.OPEN },
    CLOSING: { value: NativeWebSocket.CLOSING },
    CLOSED: { value: NativeWebSocket.CLOSED }
  });

  window.WebSocket = ResilientWebSocket;

  window.__rydesyncRoomBridge = {
    clearLocalRoomSession,
    roomAvailability,
    saveRoomBookmark,
    removeSavedRoom,
    leave(roomRef) {
      let closed = false;
      for (const socket of realtimeSockets) {
        if (!roomRef || socket.roomRef === roomRef) {
          if (socket.readyState < NativeWebSocket.CLOSING) socket.close(4005, 'Left Ryde on this device');
          closed = true;
        }
      }
      if (!closed && roomRef) clearLocalRoomSession(roomRef, { removeSaved: false, reason: 'left' });
    }
  };

  const nativeStorageSetItem = Storage.prototype.setItem;
  const nativeStorageRemoveItem = Storage.prototype.removeItem;
  Storage.prototype.setItem = function setItem(key, value) {
    nativeStorageSetItem.call(this, key, value);
    if (this === localStorage && (key === LAST_SESSION_KEY || key === SAVED_ROOMS_KEY || String(key).startsWith(SESSION_PREFIX))) {
      queueMicrotask(() => window.dispatchEvent(new CustomEvent('rydesync:room-storage-changed', { detail: { key } })));
    }
  };
  Storage.prototype.removeItem = function removeItem(key) {
    nativeStorageRemoveItem.call(this, key);
    if (this === localStorage && (key === LAST_SESSION_KEY || key === SAVED_ROOMS_KEY || String(key).startsWith(SESSION_PREFIX))) {
      queueMicrotask(() => window.dispatchEvent(new CustomEvent('rydesync:room-storage-changed', { detail: { key } })));
    }
  };

  function installRoomStyles() {
    if (document.querySelector('#rydesyncRoomExperienceStyles')) return;
    const style = document.createElement('style');
    style.id = 'rydesyncRoomExperienceStyles';
    style.textContent = `
      .room-mode-preview{margin-top:-2px;padding:10px 12px;border:1px solid #173c45;border-radius:12px;background:rgba(8,25,30,.62);display:flex;gap:10px;align-items:flex-start}.room-mode-preview strong{color:#19d9ff;font-size:10px;letter-spacing:.13em;text-transform:uppercase;white-space:nowrap}.room-mode-preview span{color:#85aeb6;font-size:12px;line-height:1.4}
      .your-rooms-block{margin-bottom:14px;padding:12px;border:1px solid #173c45;border-radius:14px;background:rgba(7,23,28,.7)}.your-rooms-block label{margin:0}.your-rooms-tools{display:flex;gap:8px;align-items:end}.your-rooms-tools label{flex:1}.your-rooms-note{display:block;margin-top:7px;color:#668f98;font-size:11px}
      .active-ryde-card{border-color:#1f6470;background:linear-gradient(145deg,rgba(10,35,41,.98),rgba(6,22,27,.98));position:relative;overflow:hidden}.active-ryde-card::before{content:'';position:absolute;inset:0 auto 0 0;width:3px;background:#18d5f5}.active-ryde-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.active-ryde-head h3{margin:4px 0}.room-mode-chip{display:inline-flex;border:1px solid #245a64;border-radius:999px;padding:6px 9px;color:#91c6cf;font-size:10px;letter-spacing:.08em;text-transform:uppercase}.active-ryde-meta{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 16px}.active-ryde-meta span{border:1px solid #173a42;border-radius:9px;padding:7px 9px;color:#7fa7af;font-size:11px}.active-ryde-actions{display:flex;flex-wrap:wrap;gap:8px}.active-ryde-status{margin:0;color:#88afb7;line-height:1.45}.mode-listening_party .playback-panel,.mode-band_practice .playback-panel{box-shadow:inset 0 2px 0 rgba(24,213,245,.32)}.mode-classroom .voice-panel,.mode-campaign .voice-panel{border-left:3px solid rgba(24,213,245,.45)}
      @media(max-width:620px){.your-rooms-tools{align-items:stretch;flex-direction:column}.active-ryde-head{flex-direction:column}.active-ryde-actions button{flex:1 1 46%}}
    `;
    document.head.append(style);
  }

  function modeProfile(mode) {
    return MODE_PROFILES[mode] || MODE_PROFILES.group_ride;
  }

  function installModePreview() {
    const select = document.querySelector('#createForm select[name="mode"]');
    if (!select || document.querySelector('#roomModePreview')) return;
    const preview = document.createElement('div');
    preview.id = 'roomModePreview';
    preview.className = 'room-mode-preview';
    select.closest('label')?.after(preview);
    const render = () => {
      const profile = modeProfile(select.value);
      preview.innerHTML = `<strong>${escapeHtml(profile.accent)}</strong><span>${escapeHtml(profile.createHint)}</span>`;
      document.querySelector('#createCard')?.setAttribute('data-room-mode', select.value);
    };
    select.addEventListener('change', render);
    render();
  }

  function applyModeProfile(session = currentSession()) {
    const mode = session?.room?.mode || document.querySelector('#createForm select[name="mode"]')?.value || 'group_ride';
    const profile = modeProfile(mode);
    for (const name of Object.keys(MODE_PROFILES)) document.body.classList.remove(`mode-${name}`);
    document.body.classList.add(`mode-${mode}`);
    document.body.dataset.roomMode = mode;
    const roomHeading = document.querySelector('#roomView .page-heading h2');
    const roomCopy = document.querySelector('#roomView .page-heading > p');
    const musicHeading = document.querySelector('#musicView .page-heading h2');
    if (roomHeading) roomHeading.textContent = profile.roomTitle;
    if (roomCopy) roomCopy.textContent = profile.roomCopy;
    if (musicHeading) musicHeading.textContent = profile.musicTitle;
  }

  function installSavedRoomsPicker() {
    const form = document.querySelector('#joinForm');
    if (!form || document.querySelector('#yourRoomsSelect')) return;
    const block = document.createElement('div');
    block.className = 'your-rooms-block';
    block.innerHTML = `
      <div class="your-rooms-tools">
        <label>Your rooms<select id="yourRoomsSelect"><option value="">Saved rooms</option></select></label>
        <button id="forgetSavedRoom" type="button" class="mini secondary">Forget</button>
      </div>
      <small id="yourRoomsNote" class="your-rooms-note">Save a room once and its join code stays handy on this device.</small>`;
    form.prepend(block);

    const select = block.querySelector('#yourRoomsSelect');
    const roomInput = form.querySelector('[name="room"]');
    const forget = block.querySelector('#forgetSavedRoom');
    select.addEventListener('change', async () => {
      if (!select.value) return;
      if (roomInput) roomInput.value = select.value;
      const availability = await roomAvailability(select.value);
      if (availability === 'missing') {
        removeSavedRoom(select.value);
        if (roomInput?.value === select.value) roomInput.value = '';
        block.querySelector('#yourRoomsNote').textContent = 'That saved Ryde is no longer available, so it was removed.';
        renderSavedRoomsPicker();
      }
    });
    forget.addEventListener('click', () => {
      if (!select.value) return;
      removeSavedRoom(select.value);
      if (roomInput?.value === select.value) roomInput.value = '';
      renderSavedRoomsPicker();
    });
  }

  function renderSavedRoomsPicker() {
    const select = document.querySelector('#yourRoomsSelect');
    const forget = document.querySelector('#forgetSavedRoom');
    if (!select) return;
    const rooms = readSavedRooms();
    const current = select.value;
    select.innerHTML = `<option value="">${rooms.length ? 'Choose a saved Ryde' : 'No saved rooms yet'}</option>${rooms.map((room) => `<option value="${escapeHtml(room.joinCode)}">${escapeHtml(room.name)} · ${escapeHtml(modeProfile(room.mode).label)} · ${escapeHtml(room.joinCode)}</option>`).join('')}`;
    if (rooms.some((room) => room.joinCode === current)) select.value = current;
    if (forget) forget.disabled = !select.value;
  }

  function installActiveRoomCard() {
    const grid = document.querySelector('.ride-grid');
    if (!grid || document.querySelector('#activeRydeCard')) return;
    const card = document.createElement('article');
    card.id = 'activeRydeCard';
    card.className = 'card active-ryde-card hidden';
    card.innerHTML = `
      <div class="active-ryde-head">
        <div><div class="card-kicker">CURRENT RYDE</div><h3 id="activeRydeName">Active Ryde</h3></div>
        <span id="activeRydeMode" class="room-mode-chip">Group Ride</span>
      </div>
      <p id="activeRydeStatus" class="active-ryde-status">This device has an active room session.</p>
      <div class="active-ryde-meta"><span id="activeRydeCode">JOIN —</span><span id="activeRydeRole">ROLE —</span></div>
      <div class="active-ryde-actions">
        <button id="activeRydeOpen" type="button">Open Room + Map</button>
        <button id="activeRydeMusic" type="button" class="secondary">Music</button>
        <button id="activeRydeSave" type="button" class="mini secondary">Save room</button>
        <button id="activeRydeLeave" type="button" class="mini danger">Leave room</button>
      </div>`;
    grid.prepend(card);

    card.querySelector('#activeRydeOpen').addEventListener('click', () => { location.hash = 'room'; });
    card.querySelector('#activeRydeMusic').addEventListener('click', () => { location.hash = 'music'; });
    card.querySelector('#activeRydeSave').addEventListener('click', () => {
      const session = currentSession();
      if (!session) return;
      const saved = readSavedRooms().some((room) => room.roomId === session.room.id || room.joinCode === session.room.joinCode);
      if (saved) removeSavedRoom(session.room.id);
      else saveRoomBookmark(session);
      renderRoomExperience();
    });
    card.querySelector('#activeRydeLeave').addEventListener('click', () => {
      const session = currentSession();
      if (!session) return;
      const confirmed = session.member?.role !== 'host' || confirm('Leave this Ryde on this device? The room stays open for the crew until the host ends it or it expires.');
      if (!confirmed) return;
      window.__rydesyncRoomBridge?.leave(session.room.id);
      if (!window.__rydesyncRoomBridge) clearLocalRoomSession(session.room.id, { removeSaved: false, reason: 'left' });
    });
  }

  function renderActiveRoomCard() {
    const card = document.querySelector('#activeRydeCard');
    if (!card) return;
    const session = currentSession();
    const createCard = document.querySelector('#createCard');
    const rideEmpty = document.querySelector('#rideEmpty');
    if (!session) {
      card.classList.add('hidden');
      if (rideEmpty) rideEmpty.hidden = false;
      if (createCard && document.querySelector('#identityPill')?.classList.contains('connected')) createCard.classList.remove('hidden');
      return;
    }

    if (session.member?.role === 'host') saveRoomBookmark(session);
    card.classList.remove('hidden');
    if (createCard) createCard.classList.add('hidden');
    if (rideEmpty) rideEmpty.hidden = true;
    const profile = modeProfile(session.room.mode);
    card.querySelector('#activeRydeName').textContent = session.room.name || 'Active Ryde';
    card.querySelector('#activeRydeMode').textContent = profile.label;
    card.querySelector('#activeRydeCode').textContent = `JOIN ${session.room.joinCode || '—'}`;
    card.querySelector('#activeRydeRole').textContent = `ROLE ${(session.member?.role || 'rider').replace('_', ' ').toUpperCase()}`;
    card.querySelector('#activeRydeStatus').textContent = session.member?.role === 'host'
      ? 'You are hosting this Ryde. Start-a-Ryde stays out of the way until you leave or end this room.'
      : 'You are in this Ryde on this device. Room controls and saved-room access stay one tap away.';
    const saved = readSavedRooms().some((room) => room.roomId === session.room.id || room.joinCode === session.room.joinCode);
    card.querySelector('#activeRydeSave').textContent = saved ? 'Saved ✓' : 'Save room';
    applyModeProfile(session);
  }

  function cleanRoomQueryAndRoute(reason) {
    const url = new URL(location.href);
    url.searchParams.delete('room');
    url.searchParams.delete('signed_in');
    const signedIn = document.querySelector('#identityPill')?.classList.contains('connected');
    url.hash = signedIn ? 'ride' : 'access';
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    const result = document.querySelector('#result');
    if (result && ['ended', 'expired', 'unavailable', 'left', 'session-ended'].includes(reason)) {
      const copy = reason === 'left' ? 'You left the Ryde on this device.'
        : reason === 'ended' ? 'The host ended this Ryde.'
          : reason === 'expired' ? 'This Ryde expired.'
            : reason === 'unavailable' ? 'That Ryde is no longer available. The stale session was cleaned up automatically.'
              : 'That room session ended. You can rejoin from Your Rooms if the Ryde is still available.';
      result.classList.remove('hidden', 'error');
      result.innerHTML = `<h3>Room closed</h3><p>${escapeHtml(copy)}</p>`;
    }
  }

  function renderRoomExperience() {
    renderSavedRoomsPicker();
    renderActiveRoomCard();
    applyModeProfile();
  }

  function installRoomExperience() {
    installRoomStyles();
    installModePreview();
    installSavedRoomsPicker();
    installActiveRoomCard();
    renderRoomExperience();

    const identityPill = document.querySelector('#identityPill');
    if (identityPill) new MutationObserver(renderActiveRoomCard).observe(identityPill, { attributes: true, attributeFilter: ['class'] });

    window.addEventListener('rydesync:room-storage-changed', renderRoomExperience);
    window.addEventListener('storage', (event) => {
      if ([LAST_SESSION_KEY, SAVED_ROOMS_KEY].includes(event.key) || String(event.key || '').startsWith(SESSION_PREFIX)) renderRoomExperience();
    });
    window.addEventListener('rydesync:room-session-cleared', (event) => {
      cleanRoomQueryAndRoute(event.detail?.reason || 'session-ended');
      renderRoomExperience();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installRoomExperience, { once: true });
  else installRoomExperience();

  window.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    const input = args[0];
    const rawUrl = typeof input === 'string' ? input : input?.url || '';

    try {
      const url = new URL(rawUrl, window.location.href);
      if (url.pathname === '/v1/echoverse/catalog' && response.ok) {
        const clone = response.clone();
        setTimeout(async () => {
          try {
            const body = await clone.json();
            window.__rydesyncCatalog = body;
            window.dispatchEvent(new CustomEvent('rydesync:catalog', { detail: body }));
          } catch {
            // The canonical app remains authoritative if catalog decoration fails.
          }
        }, 0);
      }
    } catch {
      // Preserve native fetch behavior for any URL shape we do not recognize.
    }

    return response;
  };

  import('/pwa.js').catch((error) => console.warn('[rydesync] PWA bootstrap failed', error));
})();
