(() => {
  const nativeFetch = window.fetch.bind(window);
  const NativeWebSocket = window.WebSocket;
  const LAST_SESSION_KEY = 'rydesync:last-session';
  const SESSION_PREFIX = 'rydesync:session:';
  const SAVED_ROOMS_KEY = 'rydesync:saved-rooms';
  const realtimeSockets = new Set();

  function parseJson(value, fallback = null) {
    try { return JSON.parse(value); } catch { return fallback; }
  }

  function roomMatches(session, roomRef) {
    if (!session?.room || !roomRef) return false;
    return [session.room.id, session.room.joinCode].filter(Boolean).includes(roomRef);
  }

  function readSavedRooms() {
    const value = parseJson(localStorage.getItem(SAVED_ROOMS_KEY), []);
    return Array.isArray(value) ? value : [];
  }

  function writeSavedRooms(rooms) {
    localStorage.setItem(SAVED_ROOMS_KEY, JSON.stringify(rooms));
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

  class ResilientWebSocket extends EventTarget {
    constructor(url, protocols) {
      super();
      this.url = String(url);
      this.roomRef = realtimeRoomFromUrl(this.url);
      this._native = protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
      this._closedToApp = false;
      realtimeSockets.add(this);

      this._native.addEventListener('open', (event) => this.dispatchEvent(event));
      this._native.addEventListener('message', (event) => this.dispatchEvent(event));
      this._native.addEventListener('error', (event) => this.dispatchEvent(event));
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
