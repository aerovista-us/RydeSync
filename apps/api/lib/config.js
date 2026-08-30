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

function csvEnv(name, fallback = []) {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return fallback;
  return raw.split(',').map((value) => value.trim()).filter(Boolean);
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
      // Legacy bearer-token verifier remains available for non-browser clients.
      baseUrl: (process.env.AV_IDENTITY_BASE_URL || '').replace(/\/$/, ''),
      verifyPath: process.env.AV_IDENTITY_VERIFY_PATH || '',
      timeoutMs: intEnv('AV_IDENTITY_TIMEOUT_MS', 2500, { min: 250, max: 15_000 }),
      appId: process.env.AV_IDENTITY_APP_ID || 'rydesync',

      // AeroCore App Adapter / Access Convergence v1. Parameter names are
      // intentionally fixed by the platform contract rather than configurable
      // per-app: client_id, return_to, state and code.
      loginUrl: process.env.AV_ACCOUNT_LOGIN_URL || 'https://account.aerocoreos.com/login',
      identityGatewayOrigin: (process.env.AV_IDENTITY_GATEWAY_ORIGIN || 'https://identity-api.aerovista.us').replace(/\/$/, ''),
      serviceSecret: process.env.AV_IDENTITY_SERVICE_SECRET || '',
      capabilitySnapshot: Object.freeze(csvEnv('AV_IDENTITY_CAPABILITIES', ['echoverse.library.listen'])),
      browserSessionTtlSeconds: intEnv('AV_BROWSER_SESSION_TTL_SECONDS', 900, { min: 60, max: 86400 })
    }),
    voice: Object.freeze({
      enabled: (process.env.VOICE_ENABLED || 'true').toLowerCase() !== 'false',
      maxPeers: intEnv('VOICE_MAX_PEERS', 12, { min: 2, max: 24 }),
      stunUrls: csvEnv('STUN_URLS', ['stun:stun.l.google.com:19302']),
      turnUrls: csvEnv('TURN_URLS'),
      turnUsername: process.env.TURN_USERNAME || '',
      turnCredential: process.env.TURN_CREDENTIAL || ''
    }),
    realtime: Object.freeze({
      authTimeoutMs: intEnv('REALTIME_AUTH_TIMEOUT_MS', 10_000, { min: 1_000, max: 60_000 }),
      heartbeatMs: intEnv('REALTIME_HEARTBEAT_MS', 25_000, { min: 5_000, max: 120_000 }),
      maxMessageBytes: intEnv('REALTIME_MAX_MESSAGE_BYTES', 32_768, { min: 1_024, max: 262_144 })
    }),
    map: Object.freeze({
      tileUrlTemplate: process.env.MAP_TILE_URL_TEMPLATE || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: process.env.MAP_ATTRIBUTION || '© OpenStreetMap contributors',
      attributionUrl: process.env.MAP_ATTRIBUTION_URL || 'https://www.openstreetmap.org/copyright',
      minZoom: intEnv('MAP_MIN_ZOOM', 2, { min: 0, max: 20 }),
      maxZoom: intEnv('MAP_MAX_ZOOM', 18, { min: 1, max: 22 })
    }),
    playback: Object.freeze({
      syncIntervalMs: intEnv('PLAYBACK_SYNC_INTERVAL_MS', 3000, { min: 1000, max: 60000 }),
      softDriftMs: intEnv('PLAYBACK_SOFT_DRIFT_MS', 150, { min: 50, max: 2000 }),
      hardDriftMs: intEnv('PLAYBACK_HARD_DRIFT_MS', 750, { min: 250, max: 10000 })
    }),
    location: Object.freeze({
      minIntervalMs: intEnv('LOCATION_MIN_INTERVAL_MS', 5000, { min: 1000, max: 60000 }),
      staleAfterMs: intEnv('LOCATION_STALE_AFTER_MS', 120000, { min: 15000, max: 900000 }),
      maxClientAgeMs: intEnv('LOCATION_MAX_CLIENT_AGE_MS', 30000, { min: 5000, max: 300000 }),
      maxFutureSkewMs: intEnv('LOCATION_MAX_FUTURE_SKEW_MS', 10000, { min: 1000, max: 60000 }),
      maxAccuracyMeters: intEnv('LOCATION_MAX_ACCURACY_METERS', 5000, { min: 50, max: 50000 })
    }),
    echoverse: Object.freeze({
      libraryApiUrl: process.env.ECHOVERSE_LIBRARY_API_URL || 'http://echoverse-library-api:5304',
      timeoutMs: intEnv('ECHOVERSE_TIMEOUT_MS', 5000, { min: 500, max: 30000 }),
      serviceToken: process.env.ECHOVERSE_UPSTREAM_BEARER_TOKEN || '',
      mediaSessionTtlSeconds: intEnv('ECHOVERSE_MEDIA_SESSION_TTL_SECONDS', 600, { min: 60, max: 3600 })
    })
  });
}
