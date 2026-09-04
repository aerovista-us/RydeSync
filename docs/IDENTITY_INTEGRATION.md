# AeroVista Identity Integration Contract

## Current Alpha.7 contract

RydeSync is a relying party of the AeroVista Account + Identity/AVCC control plane.

> **Account proves identity. Identity/AVCC grants capability. RydeSync enforces capability. Room role grants room authority.**

The exact production broker routes are now known and must not be replaced with guessed configuration.

## Current flow

```text
RydeSync /auth/login
  -> account.aerocoreos.com/login
  -> identity proof (public Account or staff SSO resume)
  -> short-lived one-time client/audience-bound handoff code + state
  -> RydeSync /auth/callback
  -> validate state
  -> SERVER-SIDE HMAC POST identity-api.aerovista.us/v1/handoff/exchange
  -> encrypted HttpOnly __session
```

Current adapter broker calls:

```text
POST /v1/handoff/exchange
POST /v1/session/resolve
POST /v1/session/revoke
POST /v1/authorization/check
```

Canonical service source:

```text
aerovista-us/ACOS
branch: main
path: services/identity-gateway
live path: /srv/ACOS/services/identity-gateway
origin: https://identity-api.aerovista.us
```

The standalone `aerovista-us/identity-gateway` repository is an extracted/reference/regression harness and is **not** production source of truth.

## Configuration

```env
AV_IDENTITY_MODE=optional
AV_IDENTITY_APP_ID=rydesync
AV_ACCOUNT_LOGIN_URL=https://account.aerocoreos.com/login
AV_IDENTITY_GATEWAY_ORIGIN=https://identity-api.aerovista.us
AV_IDENTITY_SERVICE_SECRET=<server-only HMAC secret>
AV_BROWSER_SESSION_TTL_SECONDS=900
```

Older `AV_HANDOFF_EXCHANGE_URL=<exact endpoint>` instructions are retired. The app adapter owns the broker paths.

## Server HMAC

```text
METHOD\nPATH_WITH_QUERY\nTIMESTAMP\nRAW_BODY
```

Headers:

```text
X-AV-Service
X-AV-Timestamp
X-AV-Signature
```

The browser never receives the service secret.

## Public and staff identity lanes

Public/customer Account uses Firebase/Google/password identity proof through `account.aerocoreos.com`.

Staff/member SSO uses:

```text
login.aerocoreos.com
  -> Cloudflare Access
  -> Authentik
  -> AVCC
  -> resume Account/app handoff preserving client_id, return_to and state
```

This does not convert staff into a second public-account identity. It resumes the same app relying-party handoff after staff identity converges.

## Capability behavior

`echoverse.library.listen` is a live explicit AVCC capability. It is not inferred from `staff`, `member`, plan, room ownership, or a prior capability snapshot.

```text
allow       -> protected operation proceeds
deny        -> 403
unavailable -> 503 fail closed
```

A locally encrypted app session may establish authenticated identity, but capability-sensitive actions must use a fresh authority decision. Live revocation is expected to be visible without restarting RydeSync.

## Runtime modes

- `off`: guest-capable surfaces only; protected member functions unavailable.
- `optional`: public guest flow remains usable during Identity outages while protected actions fail closed. Current rollout mode.
- `required`: Identity failure prevents identity-dependent use and returns unavailable rather than silently continuing.

## Normalized principal

```json
{
  "kind": "member",
  "authenticated": true,
  "identityId": "canonical-avcc-identity-id",
  "displayName": "Rider",
  "email": "optional@example.com",
  "capabilities": ["echoverse.library.listen"],
  "capabilitiesFresh": true,
  "authState": "verified"
}
```

The room domain consumes this normalized concept; it does not depend directly on Firebase/AVCC response internals.

## Security invariants

1. No Firebase token, AVCC token, service secret or reusable identity credential in redirect/media URLs.
2. Callback state must match the browser's HttpOnly state value.
3. Handoff exchange is server-side and service-authenticated.
4. Rejected/expired/unknown supplied credentials never silently downgrade to a guest credential.
5. `Start Ryde` is authenticated server-side, not merely hidden in UI.
6. EchoVerse library browse requires a fresh explicit capability.
7. Shared playback mutation additionally requires host/co-host room role.
8. Guest listening is a room/current-track media grant, never an inherited library entitlement.
9. Service credentials remain server-only and out of Android/browser bundles.

## Current acceptance evidence

RydeSync synthetic suite: **69/69 passing**.

The semantic identity matrix proves:

- `staff01` allow / `staff02` deny;
- `member01` allow / `member02` deny;
- guest create/join boundaries;
- live `revoked01` capability convergence;
- stale authorization fail closed;
- expired/unknown supplied credentials rejected.

The canonical ACOS Identity Gateway has dedicated broker/session/handoff tests. The standalone extracted Identity Gateway harness additionally passes 10/10 on Node 20 and 10/10 on Node 22. `member-access` carries the same semantic matrix through signed Cloudflare Access JWT/JWKS and AVCC HMAC resolution.

See:

- `IDENTITY_STACK_SCHEMATIC.md`
- `AEROCORE_APP_ADAPTER_SCHEMATIC.md`
- `SOURCE_AND_PRODUCTION_MAP.md`
- `SYNTHETIC_IDENTITY_ACCEPTANCE_MATRIX.md`
