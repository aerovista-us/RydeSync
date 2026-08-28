import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLocation } from '../lib/location.js';

const config = {
  maxClientAgeMs: 30_000,
  maxFutureSkewMs: 10_000,
  maxAccuracyMeters: 5_000
};

const now = Date.parse('2026-08-27T23:00:00.000Z');

test('normalizes a valid browser/Android location sample', () => {
  const value = normalizeLocation({
    coords: { latitude: 47.6777, longitude: -116.7805, accuracy: 8.2, altitude: 650, speed: 12.5, heading: 182 },
    clientTs: now - 1000
  }, config, now);
  assert.equal(value.latitude, 47.6777);
  assert.equal(value.longitude, -116.7805);
  assert.equal(value.clientTs, '2026-08-27T22:59:59.000Z');
  assert.equal(value.receivedAt, '2026-08-27T23:00:00.000Z');
});

test('rejects invalid coordinates and stale samples', () => {
  assert.throws(() => normalizeLocation({
    coords: { latitude: 91, longitude: 0, accuracy: 5 }
  }, config, now), (error) => error.code === 'invalid_location');

  assert.throws(() => normalizeLocation({
    coords: { latitude: 47, longitude: -116, accuracy: 5 }, clientTs: now - 31_000
  }, config, now), (error) => error.code === 'stale_location');
});
