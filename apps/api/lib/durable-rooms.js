import { RoomStore } from './rooms.js';
import { HttpError } from './http.js';

// Explicit projection: coordinates, presence, voice, browser/media/room tokens
// and account credentials must never enter Redis or its persistence files.
export function encodeRoom(room) {
  return {
    schema: 1, id: room.id, joinCode: room.joinCode, name: room.name,
    mode: room.mode, createdAt: room.createdAt, expiresAt: room.expiresAt,
    hostMemberId: room.hostMemberId, locked: Boolean(room.locked),
    members: [...room.members.values()].map(({ id, role, identityId, displayName, joinedAt }) => ({ id, role, identityId, displayName, joinedAt })),
    playback: room.playback ? Object.fromEntries(['trackId', 'status', 'positionMs', 'anchorServerMs', 'epoch', 'updatedBy', 'updatedAt'].map(key => [key, room.playback[key]])) : null
  };
}

export function decodeRoom(raw) {
  const invalid = () => { throw new Error('Invalid persisted room'); };
  const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;
  if (!raw || raw.schema !== 1 || !/^ryde_[A-Za-z0-9_-]{12}$/.test(raw.id) || !/^[A-HJ-NP-Z2-9]{8}$/.test(raw.joinCode)
    || !text(raw.name, 80) || !['group_ride', 'listening_party', 'classroom', 'band_practice', 'campaign'].includes(raw.mode)
    || !Number.isSafeInteger(raw.createdAt) || !Number.isSafeInteger(raw.expiresAt) || raw.expiresAt <= raw.createdAt
    || raw.expiresAt - raw.createdAt > 604800000 || typeof raw.locked !== 'boolean'
    || !Array.isArray(raw.members) || !raw.members.length || raw.members.length > 2000) invalid();
  const members = new Map();
  for (const member of raw.members) {
    if (!member || !text(member.id, 64) || members.has(member.id)
      || !['host', 'co_host', 'rider', 'listener', 'speaker'].includes(member.role)
      || !(member.identityId === null || text(member.identityId, 256)) || !text(member.displayName, 256)
      || !Number.isSafeInteger(member.joinedAt)) invalid();
    members.set(member.id, { id: member.id, role: member.role, identityId: member.identityId, displayName: member.displayName, joinedAt: member.joinedAt });
  }
  if (members.get(raw.hostMemberId)?.role !== 'host' || !members.get(raw.hostMemberId).identityId) invalid();
  if (raw.playback) {
    const p = raw.playback;
    if (!(p.trackId === null || text(p.trackId, 256)) || !['idle', 'playing', 'paused'].includes(p.status)
      || !Number.isFinite(p.positionMs) || p.positionMs < 0 || p.positionMs > 86400000
      || !Number.isSafeInteger(p.epoch) || p.epoch < 0 || !Number.isSafeInteger(p.anchorServerMs)
      || !Number.isSafeInteger(p.updatedAt) || !(p.updatedBy === null || members.has(p.updatedBy))) invalid();
  }
  // Re-project rather than hydrate arbitrary JSON properties/prototypes.
  const clean = encodeRoom({ ...raw, members });
  return { ...clean, members, playback: clean.playback || undefined };
}

export class DurableRoomStore extends RoomStore {
  constructor(config, repository, records = [], now = () => Date.now()) {
    super(config, now);
    this.repository = repository;
    this.pending = Promise.resolve();
    this.failed = false;
    for (const record of records) {
      const room = decodeRoom(record);
      if (room.expiresAt <= now()) continue;
      if (this.rooms.has(room.id) || this.codes.has(room.joinCode)) throw new Error('Duplicate persisted room');
      this.rooms.set(room.id, room);
      this.codes.set(room.joinCode, room.id);
    }
  }

  assertReady() {
    if (this.failed) throw new HttpError(503, 'storage_unavailable', 'Room storage is unavailable; retry after recovery');
    this.repository.assertReady();
  }

  resolve(ref) { this.assertReady(); return super.resolve(ref); }

  #write(method, args) {
    const operation = this.pending.then(async () => {
      this.assertReady();
      this.prune();
      const draft = new RoomStore(this.config, this.now);
      // Copy the indexes, then clone only the room this operation mutates.
      // A soundtrack command must not serialize every other active Ryde.
      draft.rooms = new Map(this.rooms);
      draft.codes = new Map(this.codes);
      if (method !== 'create') {
        const room = super.resolve(args[0]);
        draft.rooms.set(room.id, decodeRoom(encodeRoom(room)));
      }
      const result = draft[method](...args);
      const id = method === 'create' || method === 'join' ? result.room.id : args[0];
      const candidate = draft.rooms.get(id);
      if (draft.rooms.size > 1000) throw new HttpError(429, 'room_capacity', 'Room capacity reached; retry after a Ryde expires');
      if (candidate?.members.size > 128) throw new HttpError(429, 'room_full', 'This Ryde has reached its rider limit');
      if (candidate) decodeRoom(encodeRoom(candidate));
      try {
        if (candidate) await this.repository.save(encodeRoom(candidate));
        else await this.repository.remove(id);
      } catch {
        // A timeout may mean Redis committed but its acknowledgement was lost.
        // Never continue writing from this potentially stale process snapshot.
        this.failed = true;
        throw new HttpError(503, 'storage_unavailable', 'Room storage is unavailable; retry after recovery');
      }
      if (candidate) {
        const current = this.rooms.get(id);
        if (current) Object.assign(current, candidate);
        else this.rooms.set(id, candidate);
        this.codes.set(candidate.joinCode, id);
      } else {
        const current = this.rooms.get(id);
        this.rooms.delete(id);
        if (current) this.codes.delete(current.joinCode);
      }
      return result;
    });
    this.pending = operation.catch(() => {});
    return operation;
  }

  create(...args) { return this.#write('create', args); }
  join(...args) { return this.#write('join', args); }
  setLocked(...args) { return this.#write('setLocked', args); }
  end(...args) { return this.#write('end', args); }
  updatePlayback(...args) { return this.#write('updatePlayback', args); }
  async close() { await this.pending; await this.repository.close(); }
}
