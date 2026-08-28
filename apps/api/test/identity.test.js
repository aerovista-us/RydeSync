import test from 'node:test';
import assert from 'node:assert/strict';
import { mapAvIdentityPayload, requireCapability, requireIdentity } from '../lib/identity.js';

const guest = { kind: 'guest', authenticated: false, capabilities: [] };

test('maps a canonical AV identity payload', () => {
  const principal = mapAvIdentityPayload({
    identity_id: 'id_12345',
    display_name: 'Rider One',
    capabilities: ['echoverse.library.listen', 'rydesync.use']
  });
  assert.equal(principal.identityId, 'id_12345');
  assert.equal(principal.authenticated, true);
});

test('guest cannot cross a protected identity boundary', () => {
  assert.throws(() => requireIdentity(guest), /Sign in/);
});

test('capability checks fail closed', () => {
  const principal = mapAvIdentityPayload({ identity_id: 'id_12345', capabilities: [] });
  assert.throws(() => requireCapability(principal, 'echoverse.library.listen'), /Missing required capability/);
});
