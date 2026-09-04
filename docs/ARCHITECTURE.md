# RydeSync Global-First Architecture — 3.0.0-alpha.7

Last reconciled against accepted production: **2026-09-01**.

## Product boundary

RydeSync is a public real-time ride/group coordination product. A person can open a share link and join an ephemeral Ryde without Tailscale or an AeroVista account. AeroVista Account/Identity adds authenticated hosting and explicit capabilities; it is not a hidden transport prerequisite. EchoVerse remains a private upstream behind RydeSync.

For the full component graph see `RYDESYNC_SCHEMATIC.md`. For exact source/live ownership see `SOURCE_AND_PRODUCTION_MAP.md`. For the accepted field checkpoint and restore refs see `PRODUCTION_ACCEPTANCE_2026-09-01.md`.

## Foundation rules

1. **Public guest path stays available.** Guest-capable room operations do not depend on AV Identity health.
2. **Privileges never fail open.** Identity outage, invalid credentials, stale capability freshness or malformed authority responses cannot grant protected access.
3. **Identity stays behind the AeroCore app adapter.** Room/product code consumes normalized principals and capability decisions, not Firebase/AVCC/HMAC internals.
4. **EchoVerse stays private upstream.** Browser/Android call RydeSync only; canonical private upstream is `echoverse-library-api:5304`.
5. **Account identity, capability, room membership and room role are distinct.** Authentication alone never implies library entitlement or room control.
6. **Location is ride-scoped and ephemeral.** It is not profile/ride-history data.
7. **One public contract for web and Android.** Android is a client of the same REST/realtime/media boundary.
8. **Realtime credentials do not travel in URLs.** The room token is sent after WebSocket open in the auth message.
9. **Reconnect resynchronizes from authority.** Until a durable journal exists, reconnect receives an authoritative snapshot rather than invented replay.
10. **Media entitlement is least-privilege.** Guest current-track listening never unlocks catalog browse/arbitrary EchoVerse files.
11. **TURN is fallback, not a forced default.** Direct ICE/STUN is preferred; room-scoped temporary TURN credentials are used when NAT/network conditions require relay.
12. **Operational routing is part of the production contract.** Required Traefik static/dynamic definitions must not depend on untracked files that routine Git cleanup can remove.

## Implemented Alpha.7 surface

- dependency-light Node 22 HTTP service and responsive web shell;
- `/health`, `/v1/bootstrap`, local browser session/bootstrap surfaces;
- ephemeral room create/read/join and HMAC-signed room-member tokens;
- authenticated server-side room creation + guest-capable join;
- Account relying-party handoff → Access/AVCC staff convergence when applicable → Identity Gateway broker → encrypted HttpOnly `__session`;
- live capability enforcement for `echoverse.library.listen`;
- authenticated `/v1/realtime` WebSocket room plane;
- presence, reconnect/snapshot, heartbeat and sequence tracking;
- explicit opt-in location with validation/throttling/staleness cleanup;
- provider-neutral crew map;
- canonical EchoVerse catalog/audio/file proxy with byte-range support;
- server-authoritative playback selection/play/pause/seek/clear and epoch conflict handling;
- browser shared-audio engine + Android Media3 foundation;
- guest current-room-track media grants;
- room Lock/End controls for authenticated host;
- first-party QR `/join/<code>` guest/member invitation flow;
- WebRTC PTT signaling/talk floor over existing authenticated room realtime plane;
- STUN + room-scoped temporary TURN REST credentials;
- TURN credential lifetime bounded by the Ryde lifetime;
- baseline browser security/permission headers;
- named synthetic identity acceptance matrix;
- production verifier for origin, Account handoff assets, public root and admin Access protection;
- TURN verifier for secret alignment, transport advertisement, coturn hardening/listeners and public DNS.

## Identity/control plane

```text
Browser
  -> RydeSync /auth/login
  -> account.aerocoreos.com/login
       client_id=rydesync
       return_to=https://rydesync.aerovista.us/auth/callback
       state=<random state>
  -> public Account auth OR staff SSO handoff
  -> staff path: Cloudflare Access -> AVCC /api/auth/handoff/start
  -> short-lived one-time handoff code + original state
  -> RydeSync /auth/callback
  -> server HMAC POST identity-api.aerovista.us/v1/handoff/exchange
  -> encrypted HttpOnly __session

Protected capability
  -> adapter identity.can(capability)
  -> POST /v1/authorization/check
  -> canonical Identity Gateway (ACOS)
  -> AVCC
```

The AVCC relying-party route validates registered `client_id` and exact allowed redirect origin before issuing a code. `rydesync` is registered only for origin `https://rydesync.aerovista.us`.

Canonical Identity Gateway source is `aerovista-us/ACOS/main/services/identity-gateway`. The similarly named standalone repository is reference/test-only and must not be treated as deploy source.

## AeroCore App Adapter boundary

Current RydeSync runtime bridge:

```text
apps/api/lib/aerocore-app-adapter.js
```

Shared TypeScript package incubation:

```text
aerovista-us/ACOS
branch: feat/aerocore-app-adapter-v0
path: packages/aerocore-app-adapter
```

The adapter owns Account login construction, handoff exchange, session resolve/revoke, live authorization checks and signed registered-service calls. Service secrets remain server-only.

Implemented v0.1 service-HMAC canonical string:

```text
METHOD\nPATHNAME\nTIMESTAMP\nRAW_BODY
```

Both the RydeSync bridge and ACOS package currently canonicalize to the URL pathname only. Older documentation that said `PATH_WITH_QUERY` is stale; changing that wire behavior requires an explicit contract version/migration rather than a documentation-only edit.

See `AEROCORE_APP_ADAPTER_SCHEMATIC.md` for the complete contract.

## Room/realtime request flow

```text
Browser / Android
      |
      +-- POST /v1/rooms (authenticated) or /join (guest-capable)
      |          |
      |          +---- signed short-lived room member token
      |
      +-- WS /v1/realtime?room=<public room ref>
                 |
                 +---- { type: "auth", token, lastSeenSeq }
                 +---- auth.ok
                 +---- room.snapshot
                 +---- member.online / member.offline
                 +---- location.member / location.cleared
                 +---- playback.* / playback.sync
                 +---- voice.* signaling / floor state
```

The token is bearer authorization for one room membership. Invite links contain only a public join code.

## Location privacy

The alpha stores only the latest room coordinate in realtime process memory. Samples are validated for coordinate ranges/timestamps and rate limited. Coordinates clear on explicit stop, disconnect, staleness or room expiry. The browser does not automatically persist sharing across reload.

## Crew map

The map is a presentation of existing ephemeral location state, not a second location store. It consumes `room.snapshot.locations` and room location events. Tile provider configuration is exposed through public bootstrap; the default OpenStreetMap endpoint is for development/light use rather than a scaling commitment.

## Shared soundtrack control plane

Authoritative state contains opaque track ID, status, position, server anchor timestamp, epoch and updater. Host/co-host mutation uses `expectedEpoch` to reject stale writes. `presence.ping/pong` estimates server clock; periodic `playback.sync` hints correct drift without mutating epoch.

Identity establishes who the member is. Room role establishes who can control playback. EchoVerse capability establishes who can browse/listen as a full account entitlement. Guest room members may receive only a room/member/current-track grant.

## EchoVerse boundary

```text
Browser / Android
      |
      | RydeSync auth + room/capability policy
      v
RydeSync /v1/echoverse/*
      |
      | private server-to-server
      v
http://echoverse-library-api:5304
```

RydeSync does not forward a user's AeroVista bearer token upstream. Full member catalog browse is capability-gated. Guest current-track media is separately room-gated.

## Push-to-talk and TURN

PTT uses the authenticated room WebSocket for `voice.join`, floor requests/releases and room-scoped SDP/ICE forwarding. Microphone audio travels only over WebRTC. One server-owned talk floor prevents accidental simultaneous transmit.

Production TURN topology:

```text
Browser WebRTC
  -> direct ICE / STUN when possible
  -> fallback TURN: turn.aerovista.us:3478 udp/tcp
  -> public 135.134.145.137
  -> explicit eero forwarding
  -> NXCore 192.168.7.253
  -> rydesync-turn / coturn
```

Relay UDP range is `49160-49415`. TURN credentials are requested only after a valid room token via `POST /v1/voice/ice`; the permanent shared secret remains server-side. Temporary credentials use the coturn TURN REST HMAC model and expire no later than the Ryde itself.

**2026-09-01 field state:** bidirectional audible PTT with a rider on cellular is accepted. coturn listener reachability from the cellular carrier was observed. Because the test did not force `iceTransportPolicy: 'relay'`, selected media relay through coturn is classified as optional/unproven diagnostic evidence rather than a blocker. Cloudflare Tunnel is not a TURN relay.

## Browser voice audio behavior

Remote WebRTC tracks are attached to browser audio elements. Browser autoplay policy may require a user gesture before remote playback starts. This is a UX state, not the same as peer/signaling failure. A future pass should make received-audio retry/unlock explicit while preserving the active peer connection.

## Android

`apps/android` is a sibling client, not a second backend. It owns Android/Media3/Android Auto/device-token platform concerns while consuming RydeSync's public API, realtime and protected media routes.

## Current durability boundary

Rooms, membership, playback, location, sequence and voice-floor state remain process-memory in Alpha.7. A process restart ends active Rydes. Durable event journal/replay, Redis/Postgres state, horizontal coordination, persistent crews/history, push notifications and larger-room voice/SFU remain later hardening/features.

## Operational routing boundary

Traefik file-provider routing is part of the production dependency graph. The 2026-09-01 field session exposed that local/untracked Traefik files under `/srv/core` could be removed by `git stash -u`, invalidating routers that referenced `secure-headers@file` and causing Account to fall through to its deny responder.

Required production routing definitions must be tracked or moved to an explicit runtime-owned path outside routine Git cleanup. Before Traefik restart/recreate, validate static config, Compose config, required middleware definitions and public/origin health. See `PRODUCTION_ACCEPTANCE_2026-09-01.md` for incident/restore detail.

## Source/deployment boundary

Accepted/deployed Alpha.7 runtime SHA:

```text
21012670ad4452bd86d1a7e7aaa2e777d60fb061
```

Accepted Account/staff handoff ACOS SHA:

```text
9f2b68842b42154349d0fc247b2e1ff9c9addad9
```

Accepted NXCore TURN tooling SHA:

```text
eb8471114da51fe6c20957c9b484c043c355768d
```

Deployment orchestration is owned by `aerovista-us/nxcore` operational `master`, not NXCore `main`. Repository synchronization and production deployment remain distinct operations.

Named restore refs are recorded in `PRODUCTION_ACCEPTANCE_2026-09-01.md`.
