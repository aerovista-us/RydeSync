import crypto from 'node:crypto';
import { HttpError } from './http.js';

const COOKIE = 'rydesync_media';
const VERSION = 1;

function b64(value) {
  return Buffer.from(value).toString('base64url');
}

function decode(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function key(config) {
  return crypto.createHmac('sha256', config.roomTokenSecret)
    .update('rydesync/echoverse-media-session/v1')
    .digest();
}

function sign(encoded, config) {
  return crypto.createHmac('sha256', key(config)).update(encoded).digest('base64url');
}

function parseCookies(header = '') {
  const out = new Map();
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    out.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }
  return out;
}

export function issueMediaSession(principal, config, now = Date.now()) {
  if (!principal?.authenticated || !principal.identityId) {
    throw new HttpError(401, 'auth_required', 'AeroVista authentication is required for protected media');
  }
  const ttlSeconds = config.echoverse?.mediaSessionTtlSeconds ?? 600;
  const payload = {
    v: VERSION,
    aud: 'echoverse-media',
    sub: principal.identityId,
    cap: 'echoverse.library.listen',
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + ttlSeconds
  };
  const encoded = b64(JSON.stringify(payload));
  return {
    token: `${encoded}.${sign(encoded, config)}`,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    ttlSeconds
  };
}

export function issueRoomMediaSession({ roomId, memberId, trackId }, config, now = Date.now()) {
  if (typeof roomId !== 'string' || typeof memberId !== 'string' || typeof trackId !== 'string' || !trackId) {
    throw new HttpError(400, 'invalid_room_media_grant', 'A valid room membership and current track are required');
  }
  const ttlSeconds = Math.min(config.echoverse?.mediaSessionTtlSeconds ?? 600, 600);
  const payload = {
    v: VERSION,
    aud: 'echoverse-room-media',
    room: roomId,
    member: memberId,
    track: trackId,
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + ttlSeconds
  };
  const encoded = b64(JSON.stringify(payload));
  return { token: `${encoded}.${sign(encoded, config)}`, expiresAt: new Date(payload.exp * 1000).toISOString(), ttlSeconds };
}

export function verifyMediaSessionToken(token, config, now = Date.now()) {
  const [encoded, signature, extra] = String(token || '').split('.');
  if (!encoded || !signature || extra) return null;
  const expected = sign(encoded, config);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(decode(encoded)); } catch { return null; }
  if (payload?.v !== VERSION || !Number.isInteger(payload.exp) || payload.exp * 1000 <= now) return null;
  if (payload.aud === 'echoverse-media') {
    if (payload.cap !== 'echoverse.library.listen' || typeof payload.sub !== 'string' || payload.sub.length < 4) return null;
    return payload;
  }
  if (payload.aud === 'echoverse-room-media') {
    if (typeof payload.room !== 'string' || typeof payload.member !== 'string' || typeof payload.track !== 'string' || !payload.track) return null;
    return payload;
  }
  return null;
}

export function mediaSessionFromRequest(req, config, now = Date.now()) {
  const token = parseCookies(req.headers.cookie).get(COOKIE);
  return token ? verifyMediaSessionToken(token, config, now) : null;
}

export function mediaSessionCookie(session, config) {
  const secure = (() => {
    try { return new URL(config.publicBaseUrl).protocol === 'https:'; } catch { return config.nodeEnv === 'production'; }
  })();
  const attrs = [
    `${COOKIE}=${session.token}`,
    'Path=/v1/echoverse/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${session.ttlSeconds}`
  ];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

export function clearMediaSessionCookie(config) {
  const secure = (() => {
    try { return new URL(config.publicBaseUrl).protocol === 'https:'; } catch { return config.nodeEnv === 'production'; }
  })();
  const attrs = [`${COOKIE}=`, 'Path=/v1/echoverse/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}
