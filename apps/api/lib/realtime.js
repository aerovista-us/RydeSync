import crypto from 'node:crypto';
import { verifyRoomToken } from './room-token.js';
import { acceptWebSocket } from './websocket.js';
import { normalizeLocation } from './location.js';
import { applyPlaybackCommand, createPlaybackState, publicPlayback, PlaybackError } from './playback.js';
import { canControlPlayback, canUseVoice } from './permissions.js';

const CLOSE = Object.freeze({
  BAD_REQUEST: 4000,
  AUTH_TIMEOUT: 4001,
  AUTH_FAILED: 4003,
  ROOM_MISMATCH: 4004,
  MEMBER_MISSING: 4005,
  REPLACED: 4009,
  ROOM_EXPIRED: 4010,
  ROOM_ENDED: 4011
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
    this.playbackTimer = setInterval(() => this.#playbackSync(), config.playback?.syncIntervalMs ?? 10_000);
    this.playbackTimer.unref?.();
    server.on('close', () => {
      clearInterval(this.heartbeat);
      clearInterval(this.playbackTimer);
    });
  }

  playbackForRoom(roomId) {
    const state = this.roomStates.get(roomId);
    return state ? publicPlayback(state.playback) : null;
  }

  #state(roomId) {
    let state = this.roomStates.get(roomId);
    if (!state) {
      state = {
        seq: 0,
        connections: new Map(),
        seenMembers: new Set(),
        locations: new Map(),
        lastLocationAt: new Map(),
        playback: createPlaybackState(this.now()),
        lastPlaybackSyncAt: 0,
        voicePeers: new Set(),
        voiceFloorMemberId: null
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
      locations: [...state.locations.entries()].map(([memberId, location]) => publicLocation(memberId, location)),
      playback: publicPlayback(state.playback),
      voice: {
        enabled: Boolean(this.config.voice?.enabled),
        floorMemberId: state.voiceFloorMemberId,
        peers: [...state.voicePeers].map((memberId) => {
          const member = room.members.get(memberId);
          return member ? publicMember(member, state.connections.has(memberId)) : null;
        }).filter(Boolean)
      }
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

    if (message.type === 'voice.join') {
      this.#voiceJoin(connection, room);
      return;
    }

    if (message.type === 'voice.leave') {
      this.#voiceLeave(room.id, connection.memberId, 'left');
      return;
    }

    if (message.type === 'voice.signal') {
      this.#voiceSignal(connection, room, message);
      return;
    }

    if (message.type === 'voice.talk.start') {
      this.#voiceTalkStart(connection, room);
      return;
    }

    if (message.type === 'voice.talk.stop') {
      this.#voiceTalkStop(connection, room);
      return;
    }

    if (message.type === 'room.lock.set') {
      this.#roomLock(connection, room, message);
      return;
    }

    if (message.type === 'room.end') {
      this.#roomEnd(connection, room);
      return;
    }

    if (message.type === 'playback.state.get') {
      const state = this.#state(room.id);
      this.#send(connection, {
        type: 'playback.state',
        seq: state.seq,
        serverTs: new Date(this.now()).toISOString(),
        playback: publicPlayback(state.playback)
      });
      return;
    }

    if (message.type.startsWith('playback.')) {
      this.#playbackCommand(connection, room, message);
      return;
    }

    connection.ws.close(CLOSE.BAD_REQUEST, 'Unsupported realtime message');
  }

  #voiceError(connection, roomId, code, message, details = null) {
    const state = this.#state(roomId);
    this.#send(connection, {
      type: 'voice.error',
      seq: state.seq,
      serverTs: new Date(this.now()).toISOString(),
      error: { code, message, details }
    });
  }

  #voiceJoin(connection, room) {
    if (!this.config.voice?.enabled) return this.#voiceError(connection, room.id, 'voice_disabled', 'Voice is disabled on this server');
    const member = room.members.get(connection.memberId);
    if (!member || !canUseVoice(room.mode, member.role)) {
      return this.#voiceError(connection, room.id, 'voice_forbidden', 'Your room role is not allowed to speak in this mode');
    }
    const state = this.#state(room.id);
    if (!state.voicePeers.has(member.id) && state.voicePeers.size >= (this.config.voice?.maxPeers ?? 12)) {
      return this.#voiceError(connection, room.id, 'voice_full', 'This voice mesh has reached its configured peer limit');
    }
    if (!state.voicePeers.has(member.id)) {
      state.voicePeers.add(member.id);
      const event = this.#event(room.id, 'voice.peer.joined', { member: publicMember(member, true) });
      this.#broadcast(room.id, event, { exceptMemberId: member.id });
    }
    this.#send(connection, {
      type: 'voice.joined',
      seq: state.seq,
      serverTs: new Date(this.now()).toISOString(),
      memberId: member.id,
      floorMemberId: state.voiceFloorMemberId,
      peers: [...state.voicePeers].filter((id) => id !== member.id).map((id) => room.members.get(id)).filter(Boolean).map((peer) => publicMember(peer, state.connections.has(peer.id)))
    });
  }

  #voiceLeave(roomId, memberId, reason = 'left') {
    const state = this.roomStates.get(roomId);
    if (!state || !state.voicePeers.delete(memberId)) return false;
    if (state.voiceFloorMemberId === memberId) {
      state.voiceFloorMemberId = null;
      this.#broadcast(roomId, this.#event(roomId, 'voice.floor', { memberId: null, reason }));
    }
    this.#broadcast(roomId, this.#event(roomId, 'voice.peer.left', { memberId, reason }));
    return true;
  }

  #voiceSignal(connection, room, message) {
    const state = this.#state(room.id);
    if (!state.voicePeers.has(connection.memberId)) return this.#voiceError(connection, room.id, 'voice_not_joined', 'Enable push-to-talk before signaling peers');
    const toMemberId = typeof message.toMemberId === 'string' ? message.toMemberId : '';
    const target = state.connections.get(toMemberId);
    if (!toMemberId || !target || !state.voicePeers.has(toMemberId) || toMemberId === connection.memberId) {
      return this.#voiceError(connection, room.id, 'voice_peer_unavailable', 'Voice peer is not available');
    }

    let description = null;
    let candidate = null;
    if (message.description && typeof message.description === 'object') {
      const type = message.description.type;
      const sdp = message.description.sdp;
      if (!['offer', 'answer'].includes(type) || typeof sdp !== 'string' || sdp.length > 24_000) {
        return this.#voiceError(connection, room.id, 'invalid_voice_signal', 'Invalid WebRTC session description');
      }
      description = { type, sdp };
    }
    if (message.candidate && typeof message.candidate === 'object') {
      const raw = JSON.stringify(message.candidate);
      if (raw.length > 8_000) return this.#voiceError(connection, room.id, 'invalid_voice_signal', 'ICE candidate is too large');
      candidate = message.candidate;
    }
    if (!description && !candidate) return this.#voiceError(connection, room.id, 'invalid_voice_signal', 'Voice signal did not contain SDP or ICE data');

    this.#send(target, {
      type: 'voice.signal',
      seq: state.seq,
      serverTs: new Date(this.now()).toISOString(),
      fromMemberId: connection.memberId,
      ...(description ? { description } : {}),
      ...(candidate ? { candidate } : {})
    });
  }

  #voiceTalkStart(connection, room) {
    const state = this.#state(room.id);
    const member = room.members.get(connection.memberId);
    if (!state.voicePeers.has(connection.memberId) || !member || !canUseVoice(room.mode, member.role)) {
      return this.#voiceError(connection, room.id, 'voice_forbidden', 'Push-to-talk is not available for this room membership');
    }
    if (state.voiceFloorMemberId && state.voiceFloorMemberId !== connection.memberId) {
      this.#send(connection, {
        type: 'voice.floor.denied',
        seq: state.seq,
        serverTs: new Date(this.now()).toISOString(),
        memberId: state.voiceFloorMemberId
      });
      return;
    }
    if (state.voiceFloorMemberId !== connection.memberId) {
      state.voiceFloorMemberId = connection.memberId;
      this.#broadcast(room.id, this.#event(room.id, 'voice.floor', {
        memberId: connection.memberId,
        member: publicMember(member, true)
      }));
    }
  }

  #voiceTalkStop(connection, room) {
    const state = this.#state(room.id);
    if (state.voiceFloorMemberId !== connection.memberId) return;
    state.voiceFloorMemberId = null;
    this.#broadcast(room.id, this.#event(room.id, 'voice.floor', { memberId: null, reason: 'released' }));
  }

  #roomLock(connection, room, message) {
    try {
      const locked = this.rooms.setLocked(room.id, connection.memberId, Boolean(message.locked));
      this.#broadcast(room.id, this.#event(room.id, 'room.locked', { locked }));
    } catch (error) {
      this.#send(connection, {
        type: 'room.error', seq: this.#state(room.id).seq, serverTs: new Date(this.now()).toISOString(),
        error: { code: error.code || 'room_control_forbidden', message: error.message || 'Room control rejected' }
      });
    }
  }

  #roomEnd(connection, room) {
    if (room.hostMemberId !== connection.memberId) {
      this.#send(connection, {
        type: 'room.error', seq: this.#state(room.id).seq, serverTs: new Date(this.now()).toISOString(),
        error: { code: 'host_required', message: 'Only the Ryde host can end the room' }
      });
      return;
    }
    const state = this.#state(room.id);
    const event = this.#event(room.id, 'room.ended', { roomId: room.id });
    this.#broadcast(room.id, event);
    this.rooms.end(room.id, connection.memberId);
    for (const peer of state.connections.values()) peer.ws.close(CLOSE.ROOM_ENDED, 'Ryde ended by host');
    this.roomStates.delete(room.id);
  }

  #playbackCommand(connection, room, message) {
    const member = room.members.get(connection.memberId);
    if (!canControlPlayback(member)) {
      this.#send(connection, {
        type: 'playback.error',
        seq: this.#state(room.id).seq,
        serverTs: new Date(this.now()).toISOString(),
        error: { code: 'playback_forbidden', message: 'Only the host or co-host can control room playback' }
      });
      return;
    }

    const state = this.#state(room.id);
    try {
      state.playback = applyPlaybackCommand(state.playback, message, connection.memberId, this.now());
    } catch (error) {
      const code = error instanceof PlaybackError ? error.code : 'playback_error';
      this.#send(connection, {
        type: 'playback.error',
        seq: state.seq,
        serverTs: new Date(this.now()).toISOString(),
        error: { code, message: error.message || 'Playback command rejected' },
        playback: publicPlayback(state.playback)
      });
      return;
    }

    const event = this.#event(room.id, 'playback.state', { playback: publicPlayback(state.playback) });
    this.#broadcast(room.id, event);
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
    connection.identityId = member.identityId;
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
      this.#voiceLeave(connection.roomId, connection.memberId, 'offline');
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

  #playbackSync() {
    const now = this.now();
    for (const [roomId, state] of this.roomStates) {
      if (!state.playback.trackId || state.playback.status !== 'playing' || state.connections.size === 0) continue;
      state.lastPlaybackSyncAt = now;
      this.#broadcast(roomId, {
        type: 'playback.sync',
        seq: state.seq,
        serverTs: new Date(now).toISOString(),
        playback: publicPlayback(state.playback)
      });
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
        state.voicePeers.clear();
        state.voiceFloorMemberId = null;
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
