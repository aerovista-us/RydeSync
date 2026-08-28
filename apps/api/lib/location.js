import { HttpError } from './http.js';

function finiteNumber(value, field, { min = -Infinity, max = Infinity, nullable = false } = {}) {
  if (value == null && nullable) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new HttpError(400, 'invalid_location', `${field} is invalid`);
  }
  return value;
}

export function normalizeLocation(message, config, now = Date.now()) {
  const coords = message?.coords;
  if (!coords || typeof coords !== 'object' || Array.isArray(coords)) {
    throw new HttpError(400, 'invalid_location', 'coords are required');
  }

  let clientTs = null;
  if (message.clientTs != null) {
    const value = typeof message.clientTs === 'number' ? message.clientTs : Date.parse(message.clientTs);
    if (!Number.isFinite(value)) throw new HttpError(400, 'invalid_location_timestamp', 'clientTs is invalid');
    if (value < now - config.maxClientAgeMs) throw new HttpError(400, 'stale_location', 'Location sample is too old');
    if (value > now + config.maxFutureSkewMs) throw new HttpError(400, 'future_location', 'Location sample timestamp is too far in the future');
    clientTs = new Date(value).toISOString();
  }

  return {
    latitude: finiteNumber(coords.latitude, 'latitude', { min: -90, max: 90 }),
    longitude: finiteNumber(coords.longitude, 'longitude', { min: -180, max: 180 }),
    accuracy: finiteNumber(coords.accuracy, 'accuracy', { min: 0, max: config.maxAccuracyMeters }),
    altitude: finiteNumber(coords.altitude, 'altitude', { min: -1000, max: 100000, nullable: true }),
    speed: finiteNumber(coords.speed, 'speed', { min: 0, max: 200, nullable: true }),
    heading: finiteNumber(coords.heading, 'heading', { min: 0, max: 360, nullable: true }),
    clientTs,
    receivedAt: new Date(now).toISOString()
  };
}
