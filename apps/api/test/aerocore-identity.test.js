import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { issueBrowserSession, browserSessionCookie } from '../lib/browser-session.js';
import { resolveIdentity } from '../lib/identity.js';

function config(origin) {
  return {
    nodeEnv: 'test',
    publicBaseUrl: 'http://127.0.0.1:9000',
    roomTokenSecret: 'r'.repeat(48),
    identity: {
      mode: 'optional',
      appId: 'rydesync',
      timeoutMs: 1000,
      loginUrl: 'https://account.aerocoreos.com/login',
      identityGatewayOrigin: origin,
      serviceSecret: 'live-capability-secret'.repeat(3),
      capabilitySnapshot: ['echoverse.library.listen'],
      browserSessionTtlSeconds: 900,
      baseUrl: '',
      verifyPath: ''
    }
  };
}

async function body(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return JSON.parse(raw || '{}');
}

test('browser handoff session is resolved live and capabilities are refreshed through Identity Gateway', async () => {
  const calls = [];
  const gateway = http.createServer(async (req, res) => {
    const parsed = await body(req);
    calls.push({ path: req.url, body: parsed });
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url === '/v1/session/resolve') {
      return res.end(JSON.stringify({ ok: true, authenticated: true, identityId: 'avi_member_123' }));
    }
    if (req.url === '/v1/authorization/check') {
      assert.deepEqual(parsed, {
        identityId: 'avi_member_123',
        capability: 'echoverse.library.listen',
        resourceType: null,
        resourceId: null
      });
      return res.end(JSON.stringify({ ok: true, allowed: true }));
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  const cfg = config(`http://127.0.0.1:${gateway.address().port}`);
  const local = issueBrowserSession({
    principal: { identityId: 'avi_member_123', displayName: 'Member', email: null, capabilities: [] },
    upstreamToken: 'avcc-session-token-123456'
  }, cfg);
  const req = { headers: { cookie: browserSessionCookie(local, cfg).split(';')[0] } };

  try {
    const principal = await resolveIdentity(req, cfg);
    assert.equal(principal.authenticated, true);
    assert.equal(principal.identityId, 'avi_member_123');
    assert.equal(principal.capabilitiesFresh, true);
    assert.deepEqual(principal.capabilities, ['echoverse.library.listen']);
    assert.deepEqual(calls.map((call) => call.path), ['/v1/session/resolve', '/v1/authorization/check']);
  } finally {
    await new Promise((resolve) => gateway.close(resolve));
  }
});

test('Identity Gateway outage degrades an optional browser identity to guest and does not grant stale capability', async () => {
  const cfg = config('http://127.0.0.1:1');
  const local = issueBrowserSession({
    principal: { identityId: 'avi_member_123', displayName: 'Member', email: null, capabilities: ['echoverse.library.listen'] },
    upstreamToken: 'avcc-session-token-123456'
  }, cfg);
  const req = { headers: { cookie: browserSessionCookie(local, cfg).split(';')[0] } };
  const principal = await resolveIdentity(req, cfg);
  assert.equal(principal.authenticated, false);
  assert.equal(principal.capabilitiesFresh, false);
  assert.deepEqual(principal.capabilities, []);
  assert.equal(principal.authState, 'unavailable');
});
