# RydeSync — Global Foundation

RydeSync is a public ride-room product for small crews: frictionless guest joining, authenticated hosting, room-scoped presence/location, WebRTC push-to-talk, and near-synchronized EchoVerse playback. The public app does not require Tailscale. AeroVista Identity/AVCC is the authority for account identity and capabilities; EchoVerse remains behind RydeSync's private server boundary.

## Current milestone — 3.0.0-alpha.7

Alpha.7 is the member-entry + PTT parity build.

### Entry and permissions

- **Guest:** `Join Ryde` + `Sign In`; no `Start Ryde`.
- **Signed-in member:** `Start Ryde` + `Join Ryde`.
- **Guest room member:** presence, opt-in location, crew map, permitted PTT, and current shared track only.
- **Signed-in host/co-host:** shared soundtrack mutation by room role.
- **EchoVerse library:** requires the member's own live `echoverse.library.listen` AVCC capability.

Authentication, capability authorization, room membership, and room role are separate boundaries. Staff/member labels do not automatically grant EchoVerse.

## Current production identity contract

The older `AV_HANDOFF_EXCHANGE_URL=<guess>` configuration is obsolete. Alpha.7 uses the AeroCore app adapter and canonical Identity Gateway broker routes.

```env
AV_IDENTITY_MODE=optional
AV_IDENTITY_APP_ID=rydesync
AV_ACCOUNT_LOGIN_URL=https://account.aerocoreos.com/login
AV_IDENTITY_GATEWAY_ORIGIN=https://identity-api.aerovista.us
AV_IDENTITY_SERVICE_SECRET=<server-only secret>
AV_BROWSER_SESSION_TTL_SECONDS=900
```

Current server-side broker calls:

```text
POST /v1/handoff/exchange
POST /v1/session/resolve
POST /v1/session/revoke
POST /v1/authorization/check
```

Browser handoff is one-time code + state only. RydeSync exchanges the code server-side using HMAC service authentication and creates an encrypted HttpOnly `__session`. No Firebase/AVCC/service token belongs in the redirect URL.

Canonical production Identity Gateway source is **not** the standalone `identity-gateway` repo. It is:

```text
aerovista-us/ACOS
branch: main
path: services/identity-gateway
live: /srv/ACOS/services/identity-gateway
public: https://identity-api.aerovista.us
```

See `docs/IDENTITY_STACK_SCHEMATIC.md` and `docs/SOURCE_AND_PRODUCTION_MAP.md`.

## AeroCore app adapter

Current RydeSync bridge:

```text
apps/api/lib/aerocore-app-adapter.js
```

Shared TypeScript package incubation:

```text
aerovista-us/ACOS
branch: feat/aerocore-app-adapter-v0
path: packages/aerocore-app-adapter
```

The adapter owns Account login URL construction, handoff exchange, session resolve/revoke, live capability checks, signed service calls, timeout/error normalization, and the HMAC contract. See `docs/AEROCORE_APP_ADAPTER_SCHEMATIC.md`.

## Push-to-talk

PTT signaling travels over `/v1/realtime`; microphone audio travels peer-to-peer/relay over WebRTC. Cloudflare Tunnel is not TURN.

Current observed production state:

```text
PUSH TO TALK
Ready
TURN not configured · same-network voice may work
```

Current expected voice configuration shape:

```env
VOICE_ENABLED=true
VOICE_MAX_PEERS=12
STUN_URLS=stun:stun.l.google.com:19302
TURN_URLS=
TURN_USERNAME=
TURN_CREDENTIAL=
```

Do not call independent-cellular PTT production-ready until TURN is configured and the two-phone field test in `docs/VOICE_DEPLOYMENT.md` passes.

## EchoVerse

Canonical private upstream:

```text
http://echoverse-library-api:5304
```

Public consumers use only RydeSync:

- `GET /v1/echoverse/catalog` — signed-in + live `echoverse.library.listen`.
- `GET /v1/echoverse/audio/{track_id}` — authorized member or room-current-track guest grant.
- `GET /v1/echoverse/file/{path}` — full authorized member only.

RydeSync synchronizes playback state, not audio bytes. Each client independently streams the selected track.

Current observed Library UI:

```text
Your account does not currently have EchoVerse Library access.
```

That is an authorization result when an authenticated identity lacks the explicit capability; it is not, by itself, evidence of login failure.

## Realtime/privacy invariants

- Room tokens are sent after WebSocket open, never in invite/WS URLs.
- Location is explicit opt-in and memory-only; it clears on stop/disconnect/staleness/expiry.
- Microphone is explicit opt-in; audio is never carried/stored as WebSocket room payload.
- Guests never inherit a host's broader EchoVerse entitlement.
- Hosting and playback mutation are enforced server-side.
- Active room state remains process-memory in Alpha.7; restart ends active Rydes.

## Tests

```bash
npm test
```

Current Alpha.7 repository suite: **69/69 passing**, plus production Docker Compose validation in the PR workflow. The named synthetic identity matrix covers staff/member allow/deny, guests, revocation, stale authorization, expired/unknown credentials, room boundaries, and TURN/STUN readiness.

## Run

Node 22+:

```bash
cp .env.example .env
npm test
npm start
```

Development default: `http://localhost:9000`.

## Deployment/source truth

Production and repository synchronization are not the same operation. The deployed Alpha.7 artifact is pinned to release SHA `1be4b5e33c77c32014b1f9963315a3219f45d778`; later Alpha.7 commits before this documentation pass are tests/docs and do not change runtime application code. Do not claim a redeploy solely because `main`/docs advance.

Operational deployment ownership is `aerovista-us/nxcore` **master**. NXCore `main` and `master` have unrelated histories; do not merge/rebase them as a routine sync step.

## Canonical documentation

- `docs/RYDESYNC_SCHEMATIC.md` — full application/runtime schematic.
- `docs/IDENTITY_STACK_SCHEMATIC.md` — Account, SSO, Identity Gateway, AVCC and capability convergence.
- `docs/AEROCORE_APP_ADAPTER_SCHEMATIC.md` — adapter methods/HMAC/server-browser boundary.
- `docs/SOURCE_AND_PRODUCTION_MAP.md` — repos, branches, source paths, live paths, pins and reference mirrors.
- `docs/ARCHITECTURE.md` — product architecture/invariants.
- `docs/IDENTITY_INTEGRATION.md` — relying-party identity contract.
- `docs/VOICE_DEPLOYMENT.md` — TURN/PTT deployment gate.
- `docs/ALPHA7_DEPLOYMENT.md` — controlled NXCore release process.
- `docs/SYNTHETIC_IDENTITY_ACCEPTANCE_MATRIX.md` — cross-layer synthetic test semantics.
