import crypto from 'node:crypto';
import { HttpError, cleanText } from './http.js';
import { issueRoomToken } from './room-token.js';

const ROOM_MODES = new Set(['group_ride', 'listening_party', 'classroom', 'band_practice', 'campaign']);
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function shortCode(length = 8) {
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i += 1) code += ALPHABET[bytes[i] % ALPHABET.length];
  return code;
}

function roomId() {
  return `ryde_${crypto.randomBytes(9).toString('base64url')}`;
}

export class RoomStore {
  constructor(config, now = () => Date.now()) {
    this.config = config;
    this.now = now;
    this.rooms = new Map();
    this.codes = new Map();
  }

  prune() {
    const now = this.now();
    for (const [id, room] of this.rooms) {
      if (room.expiresAt <= now) {
        this.rooms.delete(id);
        this.codes.delete(room.joinCode);
      }
    }
  }

  create({ name, mode = 'group_ride' }, principal) {
    this.prune();
    const cleanName = cleanText(name, { field: 'name', min: 2, max: 80 });
    if (!ROOM_MODES.has(mode)) throw new HttpError(400, 'invalid_room_mode', 'Unsupported room mode');

    let joinCode;
    do joinCode = shortCode(); while (this.codes.has(joinCode));

    const id = roomId();
    const memberId = crypto.randomUUID();
    const createdAt = this.now();
    const room = {
      id,
      joinCode,
      name: cleanName,
      mode,
      createdAt,
      expiresAt: createdAt + this.config.roomTtlSeconds * 1000,
      hostMemberId: memberId,
      members: new Map()
    };
    room.members.set(memberId, {
      id: memberId,
      role: 'host',
      identityId: principal.identityId,
      displayName: principal.displayName || 'Host',
      joinedAt: createdAt
    });
    this.rooms.set(id, room);
    this.codes.set(joinCode, id);

    return {
      room: this.publicRoom(room),
      member: room.members.get(memberId),
      token: issueRoomToken({
        roomId: id,
        memberId,
        role: 'host',
        identityId: principal.identityId,
        ttlSeconds: this.config.memberTokenTtlSeconds
      }, this.config.roomTokenSecret, createdAt)
    };
  }

  resolve(idOrCode) {
    this.prune();
    const normalized = String(idOrCode || '').trim();
    const id = this.rooms.has(normalized) ? normalized : this.codes.get(normalized.toUpperCase());
    const room = id ? this.rooms.get(id) : null;
    if (!room) throw new HttpError(404, 'room_not_found', 'Ride room was not found or has expired');
    return room;
  }

  join(idOrCode, { displayName }, principal) {
    const room = this.resolve(idOrCode);
    const memberId = crypto.randomUUID();
    const joinedAt = this.now();
    const member = {
      id: memberId,
      role: room.mode === 'listening_party' ? 'listener' : 'rider',
      identityId: principal.identityId,
      displayName: principal.displayName || cleanText(displayName || 'Guest Rider', { field: 'displayName', min: 1, max: 60 }),
      joinedAt
    };
    room.members.set(memberId, member);

    return {
      room: this.publicRoom(room),
      member,
      token: issueRoomToken({
        roomId: room.id,
        memberId,
        role: member.role,
        identityId: principal.identityId,
        ttlSeconds: this.config.memberTokenTtlSeconds
      }, this.config.roomTokenSecret, joinedAt)
    };
  }

  publicRoom(room) {
    return {
      id: room.id,
      joinCode: room.joinCode,
      name: room.name,
      mode: room.mode,
      createdAt: new Date(room.createdAt).toISOString(),
      expiresAt: new Date(room.expiresAt).toISOString(),
      memberCount: room.members.size
    };
  }
}
