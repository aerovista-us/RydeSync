import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { issueBrowserSession, browserSessionCookie, browserSessionFromRequest, authStateCookie } from '../lib/browser-session.js';
import { beginBrowserLogin, completeBrowserLogin } from '../lib/browser-auth.js';

function config(overrides = {}) {
  return {
    nodeEnv: 'test', publicBaseUrl: 'http://127.0.0.1:9000', roomTokenSecret: 'b'.repeat(48),
    identity: {
      mode: 'optional', appId: 'rydesync', timeoutMs: 1000, browserSessionTtlSeconds: 900,
      loginUrl: 'https://account.aerocoreos.com/login', handoffExchangeUrl: 'http://127.0.0.1:1/exchange', handoffAudience: 'rydesync',
      handoffReturnParam: 'return_to', handoffStateParam: 'state', handoffAudienceParam: 'audience', handoffCodeParam: 'code',
      ...overrides
    }
  };
}

test('browser identity session is encrypted and does not expose identity or upstream token in the cookie', () => {
  const cfg = config();
  const session = issueBrowserSession({
    principal: { identityId: 'identity_secret_123', displayName: 'Member', email: 'member@example.com', capabilities: ['echoverse.library.listen'] },
    upstreamToken: 'super-secret-upstream-token'
  }, cfg, Date.UTC(2026, 7, 28));
  const cookie = browserSessionCookie(session, cfg);
  assert.match(cookie, /HttpOnly/);
  assert.doesNotMatch(cookie, /identity_secret_123|super-secret-upstream-token|member@example\.com/);
  const token = /^__session=([^;]+)/.exec(cookie)[1];
  const payload = browserSessionFromRequest({ headers: { cookie: `__session=${token}` } }, cfg, Date.UTC(2026, 7, 28));
  assert.equal(payload.principal.identityId, 'identity_secret_123');
  assert.equal(payload.upstreamToken, 'super-secret-upstream-token');
});

test('one-time handoff callback exchanges code server-side and creates a local HttpOnly session', async () => {
  const exchange = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body);
    assert.equal(parsed.code, 'one-time-code');
    assert.equal(parsed.state, 'state-123');
    assert.equal(parsed.audience, 'rydesync');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ identity_id: 'identity_handoff', display_name: 'Handoff Member', session_token: 'reusable-verifier-token-123' }));
  });
  await new Promise((resolve) => exchange.listen(0, '127.0.0.1', resolve));
  const { port } = exchange.address();
  const cfg = config({ handoffExchangeUrl: `http://127.0.0.1:${port}/exchange` });
  const req = { headers: { cookie: authStateCookie('state-123', cfg).split(';')[0] } };
  const captured = {};
  const res = { writeHead(status, headers) { captured.status = status; captured.headers = headers; }, end() { captured.ended = true; } };
  try {
    await completeBrowserLogin(req, res, new URL('http://127.0.0.1:9000/auth/callback?code=one-time-code&state=state-123'), cfg);
    assert.equal(captured.status, 302);
    assert.equal(captured.headers.location, '/?signed_in=1');
    const cookies = captured.headers['set-cookie'];
    assert.ok(Array.isArray(cookies));
    assert.match(cookies[0], /^__session=/);
    assert.match(cookies[0], /HttpOnly/);
  } finally {
    await new Promise((resolve) => exchange.close(resolve));
  }
});

test('handoff network failure is a clean fail-closed 503 instead of an internal error', async () => {
  const cfg = config({ handoffExchangeUrl: 'http://127.0.0.1:1/exchange' });
  const req = { headers: { cookie: authStateCookie('state-503', cfg).split(';')[0] } };
  const res = { writeHead() {}, end() {} };
  await assert.rejects(
    completeBrowserLogin(req, res, new URL('http://127.0.0.1:9000/auth/callback?code=one-time-code&state=state-503'), cfg),
    (error) => error?.status === 503 && error?.code === 'handoff_unavailable'
  );
});


test('sign-in preserves a same-origin Ryde invite return path through the handoff', () => {
  const cfg = config();
  const captured = {};
  const res = { writeHead(status, headers) { captured.status = status; captured.headers = headers; }, end() {} };
  beginBrowserLogin(res, cfg, new URL('http://127.0.0.1:9000/auth/login?next=%2F%3Froom%3DABCD2345'));
  assert.equal(captured.status, 302);
  const login = new URL(captured.headers.location);
  const callback = new URL(login.searchParams.get('return_to'));
  assert.equal(callback.pathname, '/auth/callback');
  assert.equal(callback.searchParams.get('next'), '/?room=ABCD2345');
});

test('sign-in refuses an external next redirect target', () => {
  const cfg = config();
  const captured = {};
  const res = { writeHead(status, headers) { captured.status = status; captured.headers = headers; }, end() {} };
  beginBrowserLogin(res, cfg, new URL('http://127.0.0.1:9000/auth/login?next=https%3A%2F%2Fevil.example%2Fsteal'));
  const login = new URL(captured.headers.location);
  const callback = new URL(login.searchParams.get('return_to'));
  assert.equal(callback.origin, 'http://127.0.0.1:9000');
  assert.equal(callback.pathname, '/auth/callback');
  assert.equal(callback.searchParams.has('next'), false);
});
