import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { HttpError } from './http.js';
import { DurableRoomStore } from './durable-rooms.js';

const RENEW = "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE',KEYS[1],ARGV[2]) else return 0 end";
const RELEASE = "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end";
const SAVE = "if redis.call('GET',KEYS[1]) ~= ARGV[1] then return 0 end; redis.call('SET',KEYS[2],ARGV[2],'PXAT',ARGV[3]); return 1";
const REMOVE = "if redis.call('GET',KEYS[1]) ~= ARGV[1] then return 0 end; redis.call('DEL',KEYS[2]); return 1";

export class RedisRoomRepository {
  constructor(client, { prefix = 'rydesync:v1:', leaseMs = 15000, timeoutMs = 2500 } = {}) {
    this.client = client;
    this.prefix = prefix;
    this.leaseMs = leaseMs;
    this.timeoutMs = timeoutMs;
    this.owner = crypto.randomUUID();
    this.leaseKey = `${prefix}writer`;
    this.active = false;
    this.lastRenewedAt = -Infinity;
    // Client errors can include connection details; never log their raw text.
    client.on('error', () => { this.active = false; });
    client.on('end', () => { this.active = false; });
  }

  unavailable() { return new HttpError(503, 'storage_unavailable', 'Room storage is unavailable; retry after recovery'); }

  async command(args) {
    let timer;
    try {
      return await Promise.race([
        this.client.sendCommand(args),
        new Promise((_, reject) => { timer = setTimeout(() => reject(this.unavailable()), this.timeoutMs); })
      ]);
    } catch {
      this.active = false;
      // Disable reconnect/offline replay: an unknown write result requires a
      // fresh startup, lease acquisition and hydration, not a memory fallback.
      if (this.client.isOpen) this.client.destroy();
      throw this.unavailable();
    } finally { clearTimeout(timer); }
  }

  assertReady() {
    if (!this.active || !this.client.isReady || performance.now() - this.lastRenewedAt >= this.leaseMs - this.timeoutMs) {
      this.active = false;
      throw this.unavailable();
    }
  }

  async open() {
    await this.client.connect();
    const acquiredAt = performance.now();
    const acquired = await this.command(['SET', this.leaseKey, this.owner, 'NX', 'PX', String(this.leaseMs)]);
    if (acquired !== 'OK') {
      this.client.destroy();
      throw new Error('RydeSync room writer already active; refusing a second writer');
    }
    this.active = true;
    this.lastRenewedAt = acquiredAt;
    this.timer = setInterval(async () => {
      if (this.renewing || !this.active) return;
      this.renewing = true;
      const startedAt = performance.now();
      try {
        const renewed = await this.command(['EVAL', RENEW, '1', this.leaseKey, this.owner, String(this.leaseMs)]);
        if (renewed !== 1) this.active = false;
        else this.lastRenewedAt = startedAt;
      } catch { this.active = false; }
      finally { this.renewing = false; }
    }, Math.floor(this.leaseMs / 3));
    this.timer.unref?.();
    return this;
  }

  async load() {
    this.assertReady();
    const records = [];
    let cursor = '0';
    const seen = new Set();
    do {
      const response = await this.command(['SCAN', cursor, 'MATCH', `${this.prefix}room:*`, 'COUNT', '100']);
      cursor = response[0];
      for (const key of response[1]) {
        if (seen.has(key)) continue;
        seen.add(key);
        const raw = await this.command(['GET', key]);
        if (raw === null) continue; // A room can expire during hydration.
        if (Buffer.byteLength(raw) > 262144 || records.length >= 1000) throw new Error('Room storage exceeds safety limits');
        const record = JSON.parse(raw);
        if (key !== `${this.prefix}room:${record.id}`) throw new Error('Invalid persisted room key');
        records.push(record);
      }
    } while (cursor !== '0');
    this.assertReady();
    return records;
  }

  async save(room) {
    this.assertReady();
    const raw = JSON.stringify(room);
    if (Buffer.byteLength(raw) > 262144) throw new Error('Room exceeds storage safety limit');
    const saved = await this.command(['EVAL', SAVE, '2', this.leaseKey, `${this.prefix}room:${room.id}`, this.owner, raw, String(room.expiresAt)]);
    if (saved !== 1) { this.active = false; throw this.unavailable(); }
  }

  async remove(id) {
    this.assertReady();
    const removed = await this.command(['EVAL', REMOVE, '2', this.leaseKey, `${this.prefix}room:${id}`, this.owner]);
    if (removed !== 1) { this.active = false; throw this.unavailable(); }
  }

  async close() {
    clearInterval(this.timer);
    const release = this.active;
    this.active = false;
    if (release && this.client.isReady) {
      try { await this.command(['EVAL', RELEASE, '1', this.leaseKey, this.owner]); } catch { /* lease expires */ }
    }
    if (this.client.isOpen) this.client.destroy();
  }
}

export async function createConfiguredRoomStore(config) {
  if (config.storage?.driver !== 'redis') {
    const { RoomStore } = await import('./rooms.js');
    return new RoomStore(config);
  }
  const { createClient } = await import('redis');
  const options = config.storage;
  const client = createClient({
    url: options.url,
    socket: { connectTimeout: options.timeoutMs, reconnectStrategy: false },
    disableOfflineQueue: true, commandsQueueMaxLength: 100
  });
  const repository = new RedisRoomRepository(client, options);
  try {
    await repository.open();
    return new DurableRoomStore(config, repository, await repository.load());
  } catch (error) {
    await repository.close();
    // Do not leak a credentialed Redis URL from a startup error.
    throw new Error('RydeSync Redis startup failed: verify private storage, writer lease and persisted schema');
  }
}
