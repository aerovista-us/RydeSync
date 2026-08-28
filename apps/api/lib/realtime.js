import crypto from 'node:crypto';
import { verifyRoomToken } from './room-token.js';
import { acceptWebSocket } from './websocket.js';
import { normalizeLocation } from './location.js';

const CLOSE = Object.freeze({
  BAD_REQUEST: 4000,
  AUTH_TIMEOUT: 4001,
  AUTH_FAILED: 4003,
  ROOM_MISMATCH: 4004,
  MEMBER_MISSING: 4005,
  REPLACED: 4009,
  ROOM_EXPIRED: 4010
});

function parseMessage(text) {
  let value;
  try { value = JSON.parse(text); }
  catch { return null; }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function publicMember(member, online = false) {
  return {
    id: member.id,
    role: member.role,
    identityId: member.identityId,
    displayName: member.displayName,
    joinedAt: new Date(member.joinedAt).toISOString(),
    online
  };
}

function publicLocation(memberId, location) {
  return { memberId, ...location };
}

export class RealtimeHub {
  constructor({ server, rooms, config, now = () => Date.now() }) {
    this.server = server;
    this.rooms = rooms;
    this.config = config;
    this.now = now;
    this.roomStates = new Map();

    server.on('upgrade', (req, socket, head) => this.#upgrade(req, socket, head));
    this.heartbeat = setInterval(() => this.#heartbeat(), config.realtime.heartbeatMs);
    this.heartbeat.unref?.();
    server.on('close', () => clearInterval(this.heartbeat));
  }

  #state(roomId) {
    let state = this.roomStates.get(roomId);
    if (!state) {
      state = {
        seq: 0,
        connections: new Map(),
        seenMembers: new Set(),
        locations: new Map(),
        lastLocationAt: new Map()
      };
      this.roomStates.set(roomId, state);
    }
    return state;
  }

  #next(roomId) {
    const state = this.#state(roomId);
    state.seq += 1;
    return state.seq;
  }

  #event(roomId, type, data = {}) {
    return { type, seq: this.#next(roomId), serverTs: new Date(this.now()).toISOString(), ...data };
  }

  #send(connection, value) {
    try { return connection.ws.sendJson(value); }
    catch { connection.ws.terminate(); return false; }
  }

  #broadcast(roomId, event, { exceptMemberId = null } = {}) {
    const state = this.roomStates.get(roomId);
    if (!state) return;
    for (const connection of state.connections.values()) {
      if (connection.memberId === exceptMemberId) continue;
      this.#send(connection, event);
    }
  }

  #snapshot(room, state) {
    return {
      room: this.rooms.publicRoom(room),
      members: [...room.members.values()].map((member) => publicMember(member, state.connections.has(member.id))),
      locations: [...state.locations.entries()].map(([memberId, location]) => publicLocation(memberId, location))
    };
  }

  #upgrade(req, socket, head) {
    let url;
    try { url = new URL(req.url, this.config.publicBaseUrl); }
    catch { socket.destroy(); return; }
    if (url.pathname !== '/v1/realtime') {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      socket.end();
      return;
    }

    const roomRef = String(url.searchParams.get('room') || '').trim();
    if (!roomRef) {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      socket.end();
      return;
    }

    let room;
    try { room = this.rooms.resolve(roomRef); }
    catch {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      socket.end();
      return;
    }

    const ws = acceptWebSocket(req, socket, head, { maxMessageBytes: this.config.realtime.maxMessageBytes });
    if (!ws) return;

    const pending = {
      id: crypto.randomUUID(), ws, roomId: room.id, memberId: null,
      role: null, authenticated: false, alive: true, replacing: false
    };

    const authTimer = setTimeout(() => {
      if (!pending.authenticated) ws.close(CLOSE.AUTH_TIMEOUT, 'Room authentication timed out');
    }, this.config.realtime.authTimeoutMs);
    authTimer.unref?.();

    ws.on('pong', () => { pending.alive = true; });
    ws.on('message', (text) => this.#message(pending, room, text, authTimer));
    ws.on('close', () => {
      clearTimeout(authTimer);
      this.#disconnect(pending);
    });
  }

  #message(connection, room, text, authTimer) {
    const message = parseMessage(text);
    if (!message || typeof message.type !== 'string') {
      connection.ws.close(CLOSE.BAD_REQUEST, 'Invalid realtime message');
      return;
    }

    if (!connection.authenticated) {
      if (message.type !== 'auth') {
        connection.ws.close(CLOSE.AUTH_FAILED, 'Authenticate before sending room events');
        return;
      }
      this.#authenticate(connection, room, message, authTimer);
      return;
    }

    if (message.type === 'presence.ping') {
      connection.alive = true;
      this.#send(connection, {
        type: 'presence.pong',
        seq: this.#state(room.id).seq,
        serverTs: new Date(this.now()).toISOString(),
        clientTs: message.clientTs ?? null
      });
      return;
    }

    if (message.type === 'room.state.get') {
      const state = this.#state(room.id);
      this.#send(connection, {
        type: 'room.snapshot',
        seq: state.seq,
        serverTs: new Date(this.now()).toISOString(),
        ...this.#snapshot(room, state)
      });
      return;
    }

    if (message.type === 'location.update') {
      this.#locationUpdate(connection, room, message);
      return;
    }

    if (message.type === 'location.stop') {
      this.#clearLocation(room.id, connection.memberId, 'stopped', { acknowledge: connection });
      return;
    }

    connection.ws.close(CLOSE.BAD_REQUEST, 'Unsupported realtime message');
  }

  #locationUpdate(connection, room, message) {
    const state = this.#state(room.id);
    const now = this.now();
    const lastAt = state.lastLocationAt.get(connection.memberId) || 0;
    const elapsed = now - lastAt;
    if (elapsed < this.config.location.minIntervalMs) {
      this.#send(connection, {
        type: 'location.rate_limited',
        seq: state.seq,
        serverTs: new Date(now).toISOString(),
        retryAfterMs: this.config.location.minIntervalMs - elapsed
      });
      return;
    }

    let location;
    try { location = normalizeLocation(message, this.config.location, now); }
    catch (error) {
      this.#send(connection, {
        type: 'location.error',
        seq: state.seq,
        serverTs: new Date(now).toISOString(),
        error: { code: error.code || 'invalid_location', message: error.message || 'Location update rejected' }
      });
      return;
    }

    state.lastLocationAt.set(connection.memberId, now);
    state.locations.set(connection.memberId, location);
    const event = this.#event(room.id, 'location.member', {
      location: publicLocation(connection.memberId, location)
    });
    this.#broadcast(room.id, event);
  }

  #clearLocation(roomId, memberId, reason, { acknowledge = null } = {}) {
    const state = this.roomStates.get(roomId);
    if (!state) return false;
    const hadLocation = state.locations.delete(memberId);
    state.lastLocationAt.delete(memberId);

    if (hadLocation) {
      const event = this.#event(roomId, 'location.cleared', { memberId, reason });
      this.#broadcast(roomId, event);
      return true;
    }

    if (acknowledge) {
      this.#send(acknowledge, {
        type: 'location.stopped',
        seq: state.seq,
        serverTs: new Date(this.now()).toISOString(),
        memberId
      });
    }
    return false;
  }

  #authenticate(connection, room, message, authTimer) {
    let claims;
    try { claims = verifyRoomToken(message.token, this.config.roomTokenSecret, this.now()); }
    catch {
      connection.ws.close(CLOSE.AUTH_FAILED, 'Room session token is invalid or expired');
      return;
    }

    if (claims.room_id !== room.id) {
      connection.ws.close(CLOSE.ROOM_MISMATCH, 'Room session token belongs to another room');
      return;
    }
    const member = room.members.get(claims.member_id);
    if (!member || member.role !== claims.role || member.identityId !== claims.identity_id) {
      connection.ws.close(CLOSE.MEMBER_MISSING, 'Room membership is no longer valid');
      return;
    }

    clearTimeout(authTimer);
    const state = this.#state(room.id);
    const previous = state.connections.get(member.id);
    const resumed = state.seenMembers.has(member.id) || Number.isInteger(message.lastSeenSeq) && message.lastSeenSeq > 0;

    connection.authenticated = true;
    connection.memberId = member.id;
    connection.role = member.role;
    connection.alive = true;

    if (previous && previous !== connection) {
      previous.replacing = true;
      previous.ws.close(CLOSE.REPLACED, 'Reconnected from another client');
    }

    state.connections.set(member.id, connection);
    state.seenMembers.add(member.id);

    const onlineEvent = this.#event(room.id, 'member.online', { member: publicMember(member, true) });
    this.#send(connection, {
      type: 'auth.ok',
      seq: onlineEvent.seq,
      serverTs: onlineEvent.serverTs,
      connectionId: connection.id,
      member: publicMember(member, true),
      resumed
    });
    this.#send(connection, {
      type: 'room.snapshot',
      seq: onlineEvent.seq,
      serverTs: onlineEvent.serverTs,
      ...this.#snapshot(room, state)
    });
    this.#broadcast(room.id, onlineEvent, { exceptMemberId: member.id });
  }

  #disconnect(connection) {
    if (!connection.authenticated || !connection.memberId) return;
    const state = this.roomStates.get(connection.roomId);
    if (!state) return;
    if (state.connections.get(connection.memberId) !== connection) return;
    state.connections.delete(connection.memberId);

    if (!connection.replacing) {
      this.#clearLocation(connection.roomId, connection.memberId, 'offline');
      let member = null;
      try { member = this.rooms.resolve(connection.roomId).members.get(connection.memberId) || null; }
      catch { /* room expired */ }
      if (member) {
        const event = this.#event(connection.roomId, 'member.offline', { member: publicMember(member, false) });
        this.#broadcast(connection.roomId, event);
      }
    }
  }

  #heartbeat() {
    this.rooms.prune();
    const now = this.now();
    for (const [roomId, state] of this.roomStates) {
      let roomExists = true;
      try { this.rooms.resolve(roomId); }
      catch { roomExists = false; }

      if (!roomExists) {
        state.locations.clear();
        state.lastLocationAt.clear();
        for (const connection of state.connections.values()) connection.ws.close(CLOSE.ROOM_EXPIRED, 'Room expired');
        this.roomStates.delete(roomId);
        continue;
      }

      for (const [memberId, location] of state.locations) {
        const receivedAt = Date.parse(location.receivedAt);
        if (!Number.isFinite(receivedAt) || now - receivedAt > this.config.location.staleAfterMs) {
          this.#clearLocation(roomId, memberId, 'stale');
        }
      }

      for (const connection of state.connections.values()) {
        if (!connection.alive) {
          connection.ws.terminate();
          continue;
        }
        connection.alive = false;
        connection.ws.ping(Buffer.from('rs'));
      }
    }
  }
}
