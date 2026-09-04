export const SYNTHETIC_IDENTITIES = Object.freeze({
  staff01: Object.freeze({
    token: 'synthetic-staff01',
    identityId: 'avi_test_staff01',
    displayName: 'Synthetic Staff 01',
    accountClass: 'staff',
    capabilities: Object.freeze(['echoverse.library.listen'])
  }),
  staff02: Object.freeze({
    token: 'synthetic-staff02',
    identityId: 'avi_test_staff02',
    displayName: 'Synthetic Staff 02',
    accountClass: 'staff',
    capabilities: Object.freeze([])
  }),
  member01: Object.freeze({
    token: 'synthetic-member01',
    identityId: 'avi_test_member01',
    displayName: 'Synthetic Member 01',
    accountClass: 'member',
    capabilities: Object.freeze(['echoverse.library.listen'])
  }),
  member02: Object.freeze({
    token: 'synthetic-member02',
    identityId: 'avi_test_member02',
    displayName: 'Synthetic Member 02',
    accountClass: 'member',
    capabilities: Object.freeze([])
  }),
  guest01: Object.freeze({
    token: null,
    identityId: null,
    displayName: 'Synthetic Guest 01',
    accountClass: 'guest',
    capabilities: Object.freeze([])
  }),
  guest02: Object.freeze({
    token: null,
    identityId: null,
    displayName: 'Synthetic Guest 02',
    accountClass: 'guest',
    capabilities: Object.freeze([])
  }),
  revoked01: Object.freeze({
    token: 'synthetic-revoked01',
    identityId: 'avi_test_revoked01',
    displayName: 'Synthetic Revoked 01',
    accountClass: 'member',
    capabilities: Object.freeze(['echoverse.library.listen'])
  }),
  stale01: Object.freeze({
    token: 'synthetic-stale01',
    identityId: 'avi_test_stale01',
    displayName: 'Synthetic Stale Authorization 01',
    accountClass: 'member',
    capabilities: Object.freeze(['echoverse.library.listen'])
  }),
  expired01: Object.freeze({
    token: 'synthetic-expired01',
    identityId: 'avi_test_expired01',
    displayName: 'Synthetic Expired 01',
    accountClass: 'member',
    capabilities: Object.freeze([])
  })
});

export function principalFor(identity, capabilities = identity.capabilities) {
  return Object.freeze({
    kind: 'member',
    authenticated: true,
    identityId: identity.identityId,
    displayName: identity.displayName,
    email: null,
    accountClass: identity.accountClass,
    capabilities: Object.freeze([...capabilities]),
    capabilitiesFresh: true,
    authState: 'verified',
    reason: null
  });
}
