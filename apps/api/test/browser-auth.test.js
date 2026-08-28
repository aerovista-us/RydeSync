import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { issueBrowserSession, browserSessionCookie, browserSessionFromRequest, authStateCookie } from '../lib/browser-session.js';
import { beginBrowserLogin, completeBrowserLogin } from '../lib/browser-auth.js';
import { serviceHmac } from '../lib/aerocore-app-adapter.js';

function config(overrides = {}) {
  return {
    nodeEnv: 'test', publicBaseUrl: 'http://127.0.0.1:9000', roomTokenSecret: 'b'.repeat(48),
    identity: {
      mode: 'optional', appId: 'rydesync', timeoutMs: 1000, browserSessionTtlSeconds: 900,
      loginUrl: 'https://account.aerocoreos.com/login',
      identityGatewayOrigin: 'http://127.0.0.1:1',
      serviceSecret: 'adapter-test-secret'.repeat(3),
      capabilitySnapshot: ['echoverse.library.listen'],
      baseUrl: '', verifyPath: '',
      ...overrides
    }
  };
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body;
}

function assertAdapterHmac(req, rawBody, secret) {
  const timestamp = req.headers['x-av-timestamp'];
  assert.equal(req.headers['x-av-service'], 'RYDESYNC');
  assert.ok(timestamp);
  assert.equal(
    req.headers['x-av-signature'],
    serviceHmac({ secret, method: req.method, path: req.url, timestamp, body: rawBody })
  );
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

test('one-time handoff uses the adapter HMAC contract, resolves identity, and creates a local HttpOnly session', async () => {
  const secret = 'adapter-test-secret'.repeat(3);
  const calls = [];
  const gateway = http.createServer(async (req, res) => {
    const raw = await readBody(req);
    assertAdapterHmac(req, raw, secret);
    const parsed = JSON.parse(raw);
    calls.push({ path: req.url, body: parsed });

    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url === '/v1/handoff/exchange') {
      assert.deepEqual(parsed, { code: 'one-time-code' });
      return res.end(JSON.stringify({
        ok: true,
        sessionToken: 'avcc-session-token-123456',
        csrfToken: 'csrf',
        cookieName: 'acos_session',
        expiresAt: '2026-08-28T18:00:00Z'
      }));
    }
    if (req.url === '/v1/session/resolve') {
      assert.deepEqual(parsed, { sessionToken: 'avcc-session-token-123456' });
      return res.end(JSON.stringify({ ok: true, authenticated: true, identityId: 'identity_handoff' }));
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  const { port } = gateway.address();
  const cfg = config({ identityGatewayOrigin: `http://127.0.0.1:${port}`, serviceSecret: secret });
  const req = { headers: { cookie: authStateCookie('state-123', cfg).split(';')[0] } };
  const captured = {};
  const res = { writeHead(status, headers) { captured.status = status; captured.headers = headers; }, end() { captured.ended = true; } };
  try {
    await completeBrowserLogin(req, res, new URL('http://127.0.0.1:9000/auth/callback?code=one-time-code&state=state-123'), cfg);
    assert.equal(captured.status, 302);
    assert.equal(captured.headers.location, '/?signed_in=1');
    assert.deepEqual(calls.map((call) => call.path), ['/v1/handoff/exchange', '/v1/session/resolve']);
    const cookies = captured.headers['set-cookie'];
    assert.ok(Array.isArray(cookies));
    assert.match(cookies[0], /^__session=/);
    assert.match(cookies[0], /HttpOnly/);
  } finally {
    await new Promise((resolve) => gateway.close(resolve));
  }
});

test('handoff network failure is a clean fail-closed 503 instead of an internal error', async () => {
  const cfg = config({ identityGatewayOrigin: 'http://127.0.0.1:1' });
  const req = { headers: { cookie: authStateCookie('state-503', cfg).split(';')[0] } };
  const res = { writeHead() {}, end() {} };
  await assert.rejects(
    completeBrowserLogin(req, res, new URL('http://127.0.0.1:9000/auth/callback?code=one-time-code&state=state-503'), cfg),
    (error) => error?.status === 503 && error?.code === 'handoff_unavailable'
  );
});

test('sign-in uses the fixed Access Convergence parameters and preserves a same-origin Ryde invite', () => {
  const cfg = config();
  const captured = {};
  const res = { writeHead(status, headers) { captured.status = status; captured.headers = headers; }, end() {} };
  beginBrowserLogin(res, cfg, new URL('http://127.0.0.1:9000/auth/login?next=%2F%3Froom%3DABCD2345'));
  assert.equal(captured.status, 302);
  const login = new URL(captured.headers.location);
  assert.equal(login.origin, 'https://account.aerocoreos.com');
  assert.equal(login.pathname, '/login');
  assert.equal(login.searchParams.get('client_id'), 'rydesync');
  assert.equal(login.searchParams.has('audience'), false);
  const callback = new URL(login.searchParams.get('return_to'));
  assert.equal(callback.pathname, '/auth/callback');
  assert.equal(callback.searchParams.get('next'), '/?room=ABCD2345');
  assert.ok(login.searchParams.get('state'));
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
