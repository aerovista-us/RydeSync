# RydeSync Alpha.7 — Production Acceptance & Restore Point

Date: **2026-09-01**  
Status: **CELLULAR PTT ACCEPTED; TURN fallback ready/reachable; forced-relay selection proof optional/pending**

This document is the checkpoint for the production state accepted during the 2026-09-01 RydeSync field session. It records the exact source/runtime pins, contracts, field evidence, restore refs, and the remaining non-blocking follow-ups before the next product/UI pass.

## 1. Accepted state

### Production application

| Layer | Accepted value |
|---|---|
| Product | RydeSync 3.0.0-alpha.7 |
| Repo | `aerovista-us/RydeSync` |
| Canonical Alpha.7 branch | `upgrade/alpha7-global-foundation` |
| Accepted/deployed RydeSync SHA | `21012670ad4452bd86d1a7e7aaa2e777d60fb061` |
| Production source checkout | `/srv/NXDrive/EchoVerse/rydesync-global-foundation` |
| Public origin | `https://rydesync.aerovista.us` |
| Local production bind | `127.0.0.1:8080` → container `:9000` |
| Runtime env | `/etc/acos-secrets/rydesync.env` |

Production verification passed for the canonical container, localhost bootstrap, Traefik origin, public Cloudflare edge, guest-facing root, Account handoff assets, and `/admin` Cloudflare Access protection.

### Account / staff SSO handoff

| Layer | Accepted value |
|---|---|
| Repo | `aerovista-us/ACOS` |
| Deployed handoff/UI SHA | `9f2b68842b42154349d0fc247b2e1ff9c9addad9` |
| Public Account | `https://account.aerocoreos.com` |
| Protected staff handoff origin | `https://avcc.aerocoreos.com` |
| Identity Gateway | `https://identity-api.aerovista.us` |

The guarded Account handoff deploy passed after routing was repaired. The deployed contract proves:

- `/api/auth/handoff/start` is registered and protected by authentication;
- Account `staff-sso.js` is served byte-for-byte from the pinned ACOS source and referenced by `/login`;
- Account tracked public assets and nginx contract pass post-deploy verification;
- RydeSync `/auth/login` redirects to Account with the registered relying-party parameters;
- RydeSync `/auth/callback` is live and rejects invalid synthetic input rather than 404ing.

### TURN / field network

| Layer | Accepted value |
|---|---|
| TURN host | `turn.aerovista.us` |
| Public IPv4 | `135.134.145.137` |
| NXCore LAN | `192.168.7.253` |
| Listener | `3478/udp` + `3478/tcp` |
| Relay range | `49160-49415/udp` |
| coturn image | `coturn/coturn:4.17.2-r0` |
| NXCore ops restore SHA | `eb8471114da51fe6c20957c9b484c043c355768d` |

The edge/router forwards 3478 TCP+UDP and 49160-49415 UDP to NXCore. `turn.aerovista.us` is DNS-only and resolves to the eero WAN address. No CGNAT/double-NAT mismatch was observed. UPnP is unavailable; explicit forwarding is the production contract.

Server-side TURN verification passed:

- RydeSync and coturn share the same hidden auth secret;
- RydeSync advertises UDP and TCP TURN transports;
- coturn auth/relay hardening is present;
- coturn is stable with restart count 0;
- UDP/TCP 3478 listeners are active;
- public DNS resolves to the expected WAN address.

Field acceptance then proved two riders in one Ryde with WebRTC voice, talk-floor state, and bidirectional audible PTT with the phone on cellular. coturn also observed cellular-origin connection attempts, proving public TURN listener reachability from the carrier path.

**Acceptance distinction:** cellular PTT is accepted. The field session did not force `iceTransportPolicy: 'relay'`, so the selected media candidate was not conclusively proven to be a TURN `relay` candidate. TURN is therefore classified as **fallback ready/reachable** rather than **forced-relay proven**. A temporary relay-only diagnostic remains optional if absolute relay-path evidence is desired.

## 2. Identity / relying-party handoff contract

RydeSync does not directly own AeroVista authentication internals. Login crosses a registered relying-party handoff boundary:

```text
Browser
  -> GET RydeSync /auth/login
  -> account.aerocoreos.com/login
       client_id=rydesync
       return_to=https://rydesync.aerovista.us/auth/callback
       state=<random CSRF state>
  -> staff SSO chooses protected AVCC handoff when applicable
  -> Cloudflare Access authenticates the staff identity
  -> GET avcc.aerocoreos.com/api/auth/handoff/start
  -> AVCC issues short-lived, one-time, audience-bound handoff code
  -> 303 RydeSync /auth/callback?code=<opaque>&state=<original>
  -> RydeSync server exchanges code through Identity Gateway
  -> encrypted HttpOnly application session
```

The AVCC handoff contract is fail-closed:

- `client_id` must be registered;
- `return_to` must parse as a URL;
- redirect origin must exactly match the registered client origin;
- staff SSO identity must resolve to a valid provider link;
- code is short-lived, one-time, and client-bound;
- state is preserved back to the relying party;
- no free-form open redirect is allowed.

Registered RydeSync client:

```text
client_id: rydesync
allowed origin: https://rydesync.aerovista.us
callback: https://rydesync.aerovista.us/auth/callback
```

## 3. AeroCore App Adapter contract

RydeSync product/domain code must not spread Account, Identity Gateway, AVCC, HMAC, cookies, or service-secret mechanics through feature code. Those details remain behind the AeroCore App Adapter boundary.

### Current bridge

```text
RydeSync:
  apps/api/lib/aerocore-app-adapter.js
```

### Canonical shared-package incubation

```text
Repo:   aerovista-us/ACOS
Branch: feat/aerocore-app-adapter-v0
Path:   packages/aerocore-app-adapter
Target: consumable @aerovista/app-adapter-style package
```

The local RydeSync JavaScript bridge remains required until the shared TypeScript package is merged/published/consumable and the same adapter contract suite passes against it.

### Adapter methods

Server-facing application contract:

```text
auth.exchangeHandoff(code)
  -> POST /v1/handoff/exchange

auth.resolveSession(sessionToken)
  -> POST /v1/session/resolve

auth.revokeSession(sessionToken)
  -> POST /v1/session/revoke

identity.can({ identityId, capability, resourceType, resourceId })
  -> POST /v1/authorization/check

services.call(path, { method, body })
  -> signed server-to-server service call
```

Browser-safe login construction carries only navigation parameters; service secrets never enter browser assets or Android APKs.

### Service HMAC wire contract

The implemented v0.1 contract in both the RydeSync bridge and ACOS shared-package incubation signs the **URL pathname only** (not query parameters):

```text
METHOD\nPATHNAME\nTIMESTAMP\nRAW_BODY
```

Signature:

```text
HMAC-SHA256(service_secret, canonical_string)
```

Headers:

```text
X-AV-Service: <APP/SERVICE ID>
X-AV-Timestamp: <ISO-8601 UTC>
X-AV-Signature: <lowercase hex SHA-256 HMAC>
Content-Type: application/json   # when a body is present
```

The exact serialized body on the wire is the body used in the signature. Adapter calls use a bounded timeout and convert rejected HTTP responses into typed adapter errors. Capability-sensitive operations fail closed; the adapter is not a stale authorization cache.

> Historical documentation that described `PATH_WITH_QUERY` is stale and must not be used as the v0.1 implementation contract.

## 4. TURN credential/security contract

TURN is fallback infrastructure, not the default voice path. Direct ICE/STUN remains preferred when it succeeds.

RydeSync obtains relay credentials only after a valid live room token is presented to:

```text
POST /v1/voice/ice
```

Credential model:

- coturn TURN REST `use-auth-secret`;
- permanent shared secret stays server-side;
- temporary username includes expiry + room/member subject;
- HMAC-SHA1/base64 TURN credential;
- default credential ceiling: 21,600 seconds / six hours;
- credential expiry is capped by the server-side Ryde expiration;
- browser never receives the permanent shared secret.

coturn hardening contract includes:

```text
fingerprint
use-auth-secret
realm/server-name turn.aerovista.us
no-cli
no-multicast-peers
no-loopback-peers
no-tcp-relay
stale-nonce=600
unauthorized-ratelimit
unauthorized-ratelimit-rps=10
user-quota=16
total-quota=512
max-bps=262144
bps-capacity=8388608
no-tls
no-dtls
relay range 49160-49415
```

Secret locations:

```text
/etc/acos-secrets/rydesync-turn
/etc/acos-secrets/rydesync-turn/turnserver.conf
/etc/acos-secrets/rydesync-turn.env
```

## 5. Realtime / PTT contract

The authenticated room WebSocket carries signaling and room state only:

```text
voice.join / voice.leave
voice.signal         # room-scoped SDP / ICE
voice.talk.start
voice.talk.stop
voice.floor
voice.floor.denied
```

Microphone audio travels over WebRTC, never through the application WebSocket. One server-owned talk floor prevents simultaneous transmit. Local microphone tracks start disabled and are enabled only while the member owns the talk floor and is actively pressing PTT.

Current Alpha.7 voice is a small-room peer mesh bounded by `VOICE_MAX_PEERS` (default 12). Larger rooms should move to an SFU rather than indefinitely increasing the mesh cap.

## 6. Traefik routing incident and preservation contract

During the field session, Account returned nginx 404 even though `account-public-ui` itself was healthy. The immediate cause was missing Traefik file-provider middleware/runtime files.

A prior:

```text
git stash push -u
```

inside `/srv/core` captured/removing untracked production Traefik files, including the live `secure-headers@file` middleware definition. Routers depending on that middleware became invalid while the low-priority `account-deny` catch-all remained valid, so Account requests fell through to the deny nginx 404 responder. RydeSync origin verification was affected by the same dependency loss.

Selective restoration from the preserved stash repaired routing without restarting Traefik. The restored startup/runtime set includes:

```text
ops/traefik/traefik.yml
ops/traefik/docker-compose.yml
ops/traefik/dynamic/middlewares.yml
ops/traefik/dynamic/acme-certs.yml
ops/traefik/dynamic/http-redirect.yml
ops/traefik/dynamic/infra-admin.yml
ops/traefik/dynamic/openwebui-n8n.yml
ops/traefik/dynamic/ssl-config.yml
ops/traefik/dynamic/stats-umami.yml
ops/traefik/dynamic/tailnet-routes.yml
ops/traefik/dynamic/tailscale-certs.yml
ops/traefik/dynamic/tls.yml
ops/traefik/dynamic/traefik-dashboard.yml
ops/traefik/dynamic/traefik-dynamic.yml
```

The active static file-provider contract is:

```yaml
providers:
  docker:
    exposedByDefault: false
    network: gateway
  file:
    directory: /etc/traefik/dynamic
    watch: true
```

Post-repair validation:

```text
Account /login: 200
RydeSync public root: 200
Traefik fresh errors: none
Docker Compose config: valid
```

### Preservation rule

**Production routing may not depend on untracked files inside a Git working tree that routine `git stash -u`, clean, reset, or checkout operations can remove.**

Before the next infrastructure maintenance window, either:

1. track the canonical immutable Traefik startup/dynamic definitions in the NXCore operational branch while keeping secrets/state ignored; or
2. move mutable/local runtime state outside `/srv/core` and mount it explicitly.

A guard should also verify required file-provider definitions and public/origin health before a stash, cleanup, Docker restart, or Traefik recreate.

## 7. Git restore point

The accepted cross-repository state is pinned by immutable commit SHA and a named restore branch in each owning repository:

```text
RydeSync
  SHA:    21012670ad4452bd86d1a7e7aaa2e777d60fb061
  branch: restore/2026-09-01-cellular-ptt-accepted

ACOS / Account + staff SSO handoff
  SHA:    9f2b68842b42154349d0fc247b2e1ff9c9addad9
  branch: restore/2026-09-01-rydesync-account-handoff

NXCore operational TURN tooling
  SHA:    eb8471114da51fe6c20957c9b484c043c355768d
  branch: restore/2026-09-01-rydesync-turn-infra
```

Runtime-only Traefik files restored on NXCore are **not fully represented by the NXCore Git SHA above** because some were local/untracked at acceptance time. Therefore the Git restore point is sufficient for RydeSync/ACOS/TURN deployment tooling, but Traefik runtime preservation remains an explicit hardening action before the checkpoint can be called a fully self-contained infrastructure restore.

## 8. Product/UI checkpoint

Current product views:

```text
01 Access
02 Ryde
03 Room + Map
04 Music
```

With cellular PTT accepted, the next UI pass may add:

```text
05 Dashboard
```

Dashboard should initially be observational and answer: **What is happening in my Ryde right now?**

Recommended cards:

- Ryde status / room lifetime;
- riders and presence;
- voice/WebRTC connection state;
- selected ICE path: Direct vs TURN Relay;
- TURN readiness / credential expiry;
- current music/playback state;
- sync health/drift;
- network/reconnect state;
- concise quick actions already supported by current contracts.

Voice path examples:

```text
VOICE
Connected
Path: Direct
TURN: Ready
```

```text
VOICE
Connected
Path: TURN Relay
turn.aerovista.us
```

The Dashboard must observe existing working contracts first; it should not invent a second authority or new public feature path.

## 9. Remaining follow-ups

Non-blocking after this checkpoint:

- harden Traefik runtime ownership against `git stash -u` / clean/reset;
- optional forced-relay (`iceTransportPolicy: 'relay'`) PTT diagnostic;
- expose selected ICE candidate/path in the proposed Dashboard;
- improve received-voice audio unlock/retry UX for autoplay-restricted browsers;
- revert the temporary NXCore resolver override after eero/router DNS caching is confirmed healthy;
- playlists remain device-local;
- no server-authoritative playlist queue yet;
- current browser session TTL remains 900 seconds;
- review `.toSorted()` compatibility for older WebViews;
- reconcile Access/Login navigation terminology;
- QR v5-L payload capacity remains bounded;
- address invite participant-lock edge behavior;
- periodically reconcile documentation/test totals with the live release line.

## 10. Acceptance statement

**Accepted on 2026-09-01:** RydeSync can create/join a real Ryde, complete AeroVista Account/staff SSO handoff, establish room realtime presence, enable WebRTC PTT, and pass bidirectional audible PTT with a rider on cellular. TURN is publicly reachable, server-verified, room-token gated, temporary-credential based, and configured as the fallback path. Forced relay candidate selection was not required for the cellular PTT acceptance and remains optional diagnostic evidence.
