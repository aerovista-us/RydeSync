# RydeSync / Identity Synthetic Acceptance Matrix

Status: **test-only cross-layer semantic fixtures**. These names are not production Firebase users, AVCC identities, Account users or deployable credentials.

The same semantic identities are reused across RydeSync, the extracted Identity Gateway regression harness, and `member-access` so authorization behavior can be compared without polluting production identity stores.

| Identity | Layer-specific purpose | Expected result |
|---|---|---|
| `staff01` | authenticated staff + explicit EchoVerse grant | library allow; authenticated Ryde use allow |
| `staff02` | authenticated staff without grant | library deny; unrelated authenticated Ryde use remains allowed |
| `member01` | authenticated member + explicit grant | library allow |
| `member02` | authenticated member without grant | library deny |
| `guest01` | anonymous boundary | public join allow; host/library deny |
| `guest02` | second anonymous participant | multi-user guest join/realtime boundary |
| `revoked01` | live convergence | allow, then revoke; next capability check denies without service restart |
| `stale01` | identity known but authorization freshness unavailable | capability action fails closed with 503 |
| `suspended01` | AVCC account suspension | valid upstream identity proof cannot override suspended account; 403 |
| `unverified01` | Firebase email verification gate | rejected before canonical bootstrap |
| `expired01` | expired supplied credential | 401/reject; never silently treated as valid member |
| `synthetic-unknown01` / `unknown01` | unknown supplied credential | 401/reject; never silently treated as member |

## Required invariants

1. Staff/member class alone never grants EchoVerse.
2. `echoverse.library.listen` must be explicitly true.
3. A stale/unreachable authorization authority cannot become allow.
4. Supplied bad/expired credentials do not silently downgrade into authenticated or privileged guest behavior.
5. Authenticated room creation is independent of EchoVerse entitlement.
6. Anonymous guests may join public Rydes but may not host.
7. Revoking EchoVerse is visible on the next live check without restarting RydeSync and does not revoke unrelated Ryde identity automatically.
8. AVCC suspension overrides otherwise valid identity proof.
9. Profile update inputs cannot smuggle principal type, badges, permissions or access version.
10. Identity Gateway/adapter HMAC uses the exact raw body/path/timestamp contract.
11. PTT can report enabled with STUN while TURN remains unavailable.
12. TURN-ready is true only when TURN URL + username + credential are configured.

## RydeSync implementation

```text
apps/api/test/fixtures/synthetic-identities.js
apps/api/test/identity-acceptance-matrix.test.js
```

Current full repository suite: **69/69 passing** plus production Docker Compose validation.

## Canonical Identity Gateway coverage

Canonical production source is:

```text
aerovista-us/ACOS/main/services/identity-gateway
```

It contains dedicated tests for Firebase, handoff, broker/RydeSync broker and session behavior under `services/identity-gateway/tests/`.

The standalone `aerovista-us/identity-gateway` repository is a noncanonical extracted/reference regression harness. Its added synthetic HTTP matrix passes **10/10 on Node 20 and 10/10 on Node 22** and verifies guest denial, email verification, expiration/unknown credentials, revocation visibility, suspension propagation, PATCH escalation filtering, HMAC/correlation and logout scoping. Merge: `488aaca1db1cc56536c56b724095cb92fc75b14d`.

## `member-access` coverage

`aerovista-us/member-access` verifies the staff/member access lane using a real local JWKS, real signed RS256 Access JWTs and a real local HTTP AVCC fake rather than mocking signature verification.

Added matrix coverage includes:

- staff/member grant separation;
- Authentik `custom.sub` preference over Cloudflare synthetic `sub`;
- documented fallback to Cloudflare `sub`;
- immediate grant revocation;
- AVCC suspension override;
- exact AVCC HMAC/body/service identity;
- email normalization.

Synthetic extension merge: `dca457fcfe60f6faf8ad179966c10327fea52239`.

## Production boundary

Do not create real `staff01`, `member01`, etc. in production just to satisfy acceptance tests. A future dedicated test tenant/provisioning lane may reuse these semantics, but it must remain isolated and preserve the same fail-closed rules.

See `IDENTITY_STACK_SCHEMATIC.md` and `SOURCE_AND_PRODUCTION_MAP.md`.
