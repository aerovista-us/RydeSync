import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { loadConfig } from '../lib/config.js';
import { resolveIdentity } from '../lib/identity.js';
import { completeBrowserLogin, browserLogout, browserLoginConfigured } from '../lib/browser-auth.js';
import { issueBrowserSession, browserSessionCookie, browserSessionFromRequest, authStateCookie } from '../lib/browser-session.js';
import { createApp } from '../server.js';
import { RoomStore } from '../lib/rooms.js';

const token = 'synthetic-gateway-session-token';
const descriptor = { identityId: 'canonical_qa_member', name: 'Gateway Rider', status: 'active', service: 'rydesync', avccRole: 'founder' };
function config(origin = 'http://127.0.0.1:1') {
  const base = loadConfig();
  return { ...base, nodeEnv: 'test', publicBaseUrl: 'http://127.0.0.1:9000', identity: {
    ...base.identity, mode: 'optional', baseUrl: '', verifyPath: '', timeoutMs: 300,
    identityGatewayOrigin: origin, serviceSecret: 'synthetic-service-secret', appId: 'rydesync',
    capabilitySnapshot: ['echoverse.library.listen'], browserSessionTtlSeconds: 900
  } };
}
function request(cfg, principalId = descriptor.identityId, upstreamToken = token) {
  const local = issueBrowserSession({ principal: { identityId: principalId, capabilities: ['echoverse.library.listen'] }, upstreamToken }, cfg);
  return { headers: { cookie: browserSessionCookie(local, cfg).split(';')[0] } };
}
function responseCapture() {
  return { writeHead(status, headers) { this.status = status; this.headers = headers; }, end() {} };
}
async function gateway(fn, run) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    calls.push({ path: req.url, body: JSON.parse(raw || '{}') });
    const [status, data] = fn(req.url, calls.at(-1).body);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(data));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(config(`http://127.0.0.1:${server.address().port}`), calls); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('gateway descriptor refreshes canonical name but founder labels do not grant library access', async () => {
  await gateway(path => [200, path === '/v1/identity/describe'
    ? { authenticated: true, identity: descriptor } : { allowed: false }], async (cfg, calls) => {
    const principal = await resolveIdentity(request(cfg), cfg);
    assert.equal(principal.displayName, 'Gateway Rider');
    assert.equal(principal.authState, 'gateway_session');
    assert.deepEqual(principal.capabilities, []);
    assert.equal(calls[1].body.identityId, descriptor.identityId);
    assert.equal(JSON.stringify(principal).includes('founder'), false);
  });
});

test('raw native bearer tokens do not create an unregistered alternative to app handoff', async () => {
  await gateway(() => [200, { authenticated: true, identity: descriptor }], async (cfg, calls) => {
    const principal = await resolveIdentity({ headers: { authorization: `Bearer ${token}` } }, cfg);
    assert.equal(principal.authenticated, false);
    assert.deepEqual(principal.capabilities, []);
    assert.equal(calls.length, 0);
  });
});

for (const [name, identity] of [
  ['suspended', { ...descriptor, status: 'suspended' }],
  ['another app', { ...descriptor, service: 'workstation' }],
  ['changed identity', { ...descriptor, identityId: 'canonical_other_member' }],
  ['revoked', null]
]) {
  test(`${name} session is rejected before any capability check`, async () => {
    await gateway(() => [200, { authenticated: !!identity, identity }], async (cfg, calls) => {
      const principal = await resolveIdentity(request(cfg), cfg);
      assert.equal(principal.authenticated, false);
      assert.equal(principal.authState, 'expired');
      assert.equal(calls.length, 1);
    });
  });
}

test('legacy cookie without an upstream session cannot authenticate or host', async () => {
  const cfg = config();
  const principal = await resolveIdentity(request(cfg, descriptor.identityId, null), cfg);
  assert.equal(principal.authenticated, false);
  assert.equal(principal.authState, 'expired');
});

test('gateway outage never trusts a cached name or capability', async () => {
  const cfg = config();
  const principal = await resolveIdentity(request(cfg), cfg);
  assert.equal(principal.authenticated, false);
  assert.equal(principal.displayName, null);
  assert.deepEqual(principal.capabilities, []);
});

test('local cookie cannot outlive gateway expiry', () => {
  const cfg = config();
  const now = Date.now();
  const session = issueBrowserSession({ principal: descriptor, upstreamToken: token, upstreamExpiresAt: new Date(now + 120000).toISOString() }, cfg, now);
  assert.equal(session.ttlSeconds, 120);
  assert.equal(browserSessionFromRequest({ headers: { cookie: browserSessionCookie(session, cfg) } }, cfg, now + 120001), null);
  assert.throws(() => issueBrowserSession({ principal: descriptor, upstreamExpiresAt: 'invalid' }, cfg));
});

test('failed post-exchange validation revokes the newly minted session and issues no browser cookie', async () => {
  await gateway(path => [200, path === '/v1/handoff/exchange'
    ? { sessionToken: token, expiresAt: new Date(Date.now() + 3600000).toISOString() }
    : path === '/v1/identity/describe' ? { authenticated: false, identity: null } : { revoked: true }], async (cfg, calls) => {
    const req = { headers: { cookie: authStateCookie('synthetic-state', cfg).split(';')[0] } };
    const res = responseCapture();
    await assert.rejects(completeBrowserLogin(req, res, new URL('http://127.0.0.1:9000/auth/callback?state=synthetic-state&code=synthetic-code'), cfg), error => error.status === 401);
    assert.equal(res.headers, undefined);
    assert.deepEqual(calls.map(c => c.path), ['/v1/handoff/exchange', '/v1/identity/describe', '/v1/session/revoke']);
  });
});

test('logout clears both browser and protected media cookies even during an outage', async () => {
  const cfg = config();
  const res = responseCapture();
  await browserLogout(request(cfg), res, cfg);
  assert.ok(res.headers['set-cookie'].some(c => c.startsWith('__session=;') && c.includes('Max-Age=0')));
  assert.ok(res.headers['set-cookie'].some(c => c.startsWith('rydesync_media=;') && c.includes('Path=/v1/echoverse/') && c.includes('Max-Age=0')));
});

test('callback failure returns clean app recovery; logout requires same-origin POST; anonymous session stays public', async () => {
  const cfg = config();
  const server = createApp(cfg);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const callback = await fetch(`${origin}/auth/callback?code=secret-code&state=bad`, { redirect: 'manual' });
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get('location'), '/?login_error=invalid_auth_state');
    assert.equal(callback.headers.get('referrer-policy'), 'no-referrer');
    assert.equal((await fetch(`${origin}/auth/logout`)).status, 404);
    assert.equal((await fetch(`${origin}/auth/logout`, { method: 'POST', headers: { origin: 'https://evil.invalid' } })).status, 403);
    assert.equal((await fetch(`${origin}/auth/logout`, { method: 'POST', headers: { origin: cfg.publicBaseUrl }, redirect: 'manual' })).status, 302);
    const bootstrap = await (await fetch(`${origin}/v1/bootstrap`)).json();
    assert.equal(bootstrap.identity.configured, true);
    assert.equal(bootstrap.identity.provider, 'identity-gateway');
    assert.equal((await (await fetch(`${origin}/v1/session`)).json()).principal.authenticated, false);
  } finally { await server.shutdown(); }
});

test('identity mode off disables sign-in even when credentials exist', () => {
  const cfg = config();
  cfg.identity.mode = 'off';
  assert.equal(browserLoginConfigured(cfg), false);
});

test('revoked browser session loses hosting/library access while public Guest Join stays available', async () => {
  await gateway(() => [200, { authenticated: false, identity: null }], async cfg => {
    const rooms = new RoomStore(cfg);
    const created = rooms.create({ name: 'Isolated guest acceptance' }, descriptor);
    const server = createApp(cfg, { rooms });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { ...request(cfg).headers, 'content-type': 'application/json' };
    try {
      assert.equal((await fetch(`${base}/v1/rooms`, { method: 'POST', headers, body: JSON.stringify({ name: 'Blocked host' }) })).status, 401);
      assert.equal((await fetch(`${base}/v1/echoverse/access`, { headers })).status, 401);
      const join = await fetch(`${base}/v1/rooms/${created.room.joinCode}/join`, { method: 'POST', headers, body: JSON.stringify({ displayName: 'Guest after expiry' }) });
      assert.equal(join.status, 200);
      const member = (await join.json()).member;
      assert.equal(member.identityId, null);
      assert.equal(member.role, 'rider');
    } finally { await server.shutdown(); }
  });
});
