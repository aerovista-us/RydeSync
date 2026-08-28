import crypto from 'node:crypto';

function intEnv(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function identityMode(raw = 'optional') {
  if (!['off', 'optional', 'required'].includes(raw)) {
    throw new Error('AV_IDENTITY_MODE must be off, optional, or required');
  }
  return raw;
}

export function loadConfig() {
  const nodeEnv = process.env.NODE_ENV || 'development';
  let roomTokenSecret = process.env.ROOM_TOKEN_SECRET || '';
  let generatedDevSecret = false;

  if (roomTokenSecret.length < 32) {
    if (nodeEnv === 'production') {
      throw new Error('ROOM_TOKEN_SECRET must be at least 32 characters in production');
    }
    roomTokenSecret = crypto.randomBytes(48).toString('base64url');
    generatedDevSecret = true;
  }

  const port = intEnv('PORT', 9000, { min: 1, max: 65535 });

  return Object.freeze({
    nodeEnv,
    port,
    publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://localhost:${port}`,
    roomTokenSecret,
    generatedDevSecret,
    roomTtlSeconds: intEnv('ROOM_TTL_SECONDS', 21_600, { min: 300, max: 604_800 }),
    memberTokenTtlSeconds: intEnv('MEMBER_TOKEN_TTL_SECONDS', 28_800, { min: 60, max: 604_800 }),
    identity: Object.freeze({
      mode: identityMode(process.env.AV_IDENTITY_MODE),
      baseUrl: (process.env.AV_IDENTITY_BASE_URL || '').replace(/\/$/, ''),
      verifyPath: process.env.AV_IDENTITY_VERIFY_PATH || '',
      timeoutMs: intEnv('AV_IDENTITY_TIMEOUT_MS', 2500, { min: 250, max: 15_000 }),
      appId: process.env.AV_IDENTITY_APP_ID || 'rydesync',
      loginUrl: process.env.AV_ACCOUNT_LOGIN_URL || ''
    }),
    realtime: Object.freeze({
      authTimeoutMs: intEnv('REALTIME_AUTH_TIMEOUT_MS', 10_000, { min: 1_000, max: 60_000 }),
      heartbeatMs: intEnv('REALTIME_HEARTBEAT_MS', 25_000, { min: 5_000, max: 120_000 }),
      maxMessageBytes: intEnv('REALTIME_MAX_MESSAGE_BYTES', 32_768, { min: 1_024, max: 262_144 })
    }),
    location: Object.freeze({
      minIntervalMs: intEnv('LOCATION_MIN_INTERVAL_MS', 5000, { min: 1000, max: 60000 }),
      staleAfterMs: intEnv('LOCATION_STALE_AFTER_MS', 120000, { min: 15000, max: 900000 }),
      maxClientAgeMs: intEnv('LOCATION_MAX_CLIENT_AGE_MS', 30000, { min: 5000, max: 300000 }),
      maxFutureSkewMs: intEnv('LOCATION_MAX_FUTURE_SKEW_MS', 10000, { min: 1000, max: 60000 }),
      maxAccuracyMeters: intEnv('LOCATION_MAX_ACCURACY_METERS', 5000, { min: 50, max: 50000 })
    }),
    echoverse: Object.freeze({
      libraryApiUrl: process.env.ECHOVERSE_LIBRARY_API_URL || 'http://echoverse-library-api:5304'
    })
  });
}
