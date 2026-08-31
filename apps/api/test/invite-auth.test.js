import test from 'node:test';
import assert from 'node:assert/strict';
import { beginBrowserLogin } from '../lib/browser-auth.js';

function config() {
  return {
    nodeEnv: 'test',
    publicBaseUrl: 'https://rydesync.aerovista.us',
    roomTokenSecret: 'i'.repeat(48),
    identity: {
      mode: 'optional', appId: 'rydesync', timeoutMs: 1000, browserSessionTtlSeconds: 900,
      loginUrl: 'https://account.aerocoreos.com/login',
      identityGatewayOrigin: 'https://identity-api.aerovista.us',
      serviceSecret: 'invite-auth-secret'.repeat(4),
      capabilitySnapshot: ['echoverse.library.listen'], baseUrl: '', verifyPath: ''
    }
  };
}

test('AeroVista login preserves the first-party QR join path', () => {
  const captured = {};
  const res = {
    writeHead(status, headers) { captured.status = status; captured.headers = headers; },
    end() {}
  };
  beginBrowserLogin(
    res,
    config(),
    new URL('https://rydesync.aerovista.us/auth/login?next=%2Fjoin%2FABCD2345')
  );
  assert.equal(captured.status, 302);
  const account = new URL(captured.headers.location);
  assert.equal(account.origin, 'https://account.aerocoreos.com');
  const callback = new URL(account.searchParams.get('return_to'));
  assert.equal(callback.origin, 'https://rydesync.aerovista.us');
  assert.equal(callback.pathname, '/auth/callback');
  assert.equal(callback.searchParams.get('next'), '/join/ABCD2345');
});
