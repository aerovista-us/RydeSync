import test from 'node:test';
import assert from 'node:assert/strict';
import { issueMediaSession, mediaSessionCookie, verifyMediaSessionToken } from '../lib/media-session.js';

const config = { roomTokenSecret: 'm'.repeat(48), publicBaseUrl: 'https://rydesync.aerovista.us', nodeEnv: 'test', echoverse: { mediaSessionTtlSeconds: 600 } };
const principal = { authenticated: true, identityId: 'identity_123' };

test('media sessions are signed, scoped, expiring grants without AV credential material', () => {
  const now = Date.parse('2026-08-28T00:00:00Z');
  const session = issueMediaSession(principal, config, now);
  assert.equal(session.token.includes('identity_123'), false);
  const payload = verifyMediaSessionToken(session.token, config, now + 1000);
  assert.equal(payload.sub, 'identity_123');
  assert.equal(payload.cap, 'echoverse.library.listen');
  assert.equal(verifyMediaSessionToken(session.token, config, now + 601000), null);
});

test('media cookie is HttpOnly, Strict, path-scoped, and Secure on HTTPS', () => {
  const session = issueMediaSession(principal, config, Date.now());
  const cookie = mediaSessionCookie(session, config);
  for (const part of ['HttpOnly', 'SameSite=Strict', 'Path=/v1/echoverse/', 'Secure']) assert.match(cookie, new RegExp(part.replaceAll('/', '\\/')));
});
