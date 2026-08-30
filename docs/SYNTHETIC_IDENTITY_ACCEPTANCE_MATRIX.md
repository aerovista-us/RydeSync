# RydeSync Synthetic Identity Acceptance Matrix

Status: test-only acceptance fixtures for Alpha 7. These identities are not Firebase users, AVCC production identities, or deployable credentials.

The goal is to keep identity and authorization regressions reproducible without polluting production data or weakening fail-closed behavior.

| Identity | Class | Authenticated | EchoVerse `echoverse.library.listen` | Start Ryde | Join public Ryde | Purpose |
|---|---|---:|---:|---:|---:|---|
| `staff01` | staff | yes | allow | allow | allow | staff with library entitlement |
| `staff02` | staff | yes | deny | allow | allow | staff without library entitlement |
| `member01` | member | yes | allow | allow | allow | member with library entitlement |
| `member02` | member | yes | deny | allow | allow | member without library entitlement |
| `guest01` | guest | no | deny / auth required | deny | allow | anonymous guest boundary |
| `guest02` | guest | no | deny / auth required | deny | allow | second anonymous guest / multi-join boundary |
| `revoked01` | member | yes | allow, then live revoke -> deny | allow | allow | convergence/revocation without service restart |
| `stale01` | member | yes | fail closed with `identity_unavailable` | allow | allow | authenticated identity whose live capability state cannot be verified |
| `expired01` | member-shaped credential | no | reject | reject | guest only if no credential is supplied | expired-session fail-closed behavior |
| `synthetic-unknown01` | unknown credential | no | reject | reject | guest only if no credential is supplied | unknown-token fail-closed behavior |

## Required invariants

1. Account class alone never grants EchoVerse. Staff and member principals must both pass the same explicit capability boundary.
2. Missing `echoverse.library.listen` returns `403 capability_required`; it does not silently downgrade to library access.
3. A stale/unverifiable authorization snapshot returns `503 identity_unavailable` for capability-gated operations even when the identity itself remains authenticated.
4. Expired or unknown credentials return `401 identity_rejected`; supplied bad credentials are never treated as an anonymous guest session.
5. Authenticated principals may create a Ryde independent of EchoVerse entitlement.
6. Anonymous guests may join a public Ryde but may not create/host one.
7. Revoking only the EchoVerse capability is observed on the next authorization check without restarting RydeSync and does not revoke unrelated authenticated Ryde use.
8. PTT remains enabled with STUN-only ICE configuration while correctly reporting TURN as unavailable.
9. TURN is reported ready only when TURN URL, username, and credential are all configured.

## Test implementation

Fixtures: `apps/api/test/fixtures/synthetic-identities.js`

Acceptance tests: `apps/api/test/identity-acceptance-matrix.test.js`

Run with the normal repository suite:

```bash
npm test
```

The existing Alpha 7 PR workflow also validates the production Docker Compose configuration after the full Node 22 test suite.

## Production boundary

These names and tokens are intentionally synthetic and must never be added to production AVCC, Firebase, Account, or Identity Gateway stores merely to satisfy tests. A future dedicated test tenant or authority-side provisioning API can reuse the same semantic matrix, but it should preserve the same isolation and fail-closed expectations.
