import crypto from 'node:crypto';
import { HttpError } from './http.js';

function b64json(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function sign(data, secret) {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

export function issueRoomToken({ roomId, memberId, role, identityId = null, ttlSeconds }, secret, nowMs = Date.now()) {
  const now = Math.floor(nowMs / 1000);
  const payload = {
    v: 1,
    aud: 'rydesync-room',
    room_id: roomId,
    member_id: memberId,
    role,
    identity_id: identityId,
    iat: now,
    exp: now + ttlSeconds,
    jti: crypto.randomUUID()
  };
  const encoded = b64json(payload);
  return `rsm1.${encoded}.${sign(encoded, secret)}`;
}

export function verifyRoomToken(token, secret, nowMs = Date.now()) {
  if (typeof token !== 'string') throw new HttpError(401, 'invalid_room_token', 'Room session token is required');
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'rsm1') throw new HttpError(401, 'invalid_room_token', 'Room session token is invalid');
  const [, encoded, suppliedSig] = parts;
  const expectedSig = sign(encoded, secret);
  const a = Buffer.from(suppliedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new HttpError(401, 'invalid_room_token', 'Room session token signature is invalid');
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw new HttpError(401, 'invalid_room_token', 'Room session token payload is invalid');
  }
  const now = Math.floor(nowMs / 1000);
  if (payload.aud !== 'rydesync-room' || payload.v !== 1 || !Number.isInteger(payload.exp) || payload.exp <= now) {
    throw new HttpError(401, 'expired_room_token', 'Room session token has expired or is invalid');
  }
  return payload;
}
