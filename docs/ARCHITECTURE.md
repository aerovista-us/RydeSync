# RydeSync Global-First Architecture — 3.0.0-alpha.7

## Product boundary

RydeSync is a public real-time ride/group coordination product. A person can open a share link and join an ephemeral Ryde without Tailscale or an AeroVista account. AeroVista Account/Identity adds authenticated hosting and explicit capabilities; it is not a hidden transport prerequisite. EchoVerse remains a private upstream behind RydeSync.

For the full component graph see `RYDESYNC_SCHEMATIC.md`. For exact source/live ownership see `SOURCE_AND_PRODUCTION_MAP.md`.

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

## Implemented Alpha.7 surface

- dependency-light Node 22 HTTP service and responsive web shell;
- `/health`, `/v1/bootstrap`, local browser session/bootstrap surfaces;
- ephemeral room create/read/join and HMAC-signed room-member tokens;
- authenticated server-side room creation + guest-capable join;
- Account relying-party handoff → Identity Gateway broker → encrypted HttpOnly `__session`;
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
- WebRTC PTT signaling/talk floor over existing authenticated room realtime plane;
- STUN support and explicit TURN readiness reporting;
- baseline browser security/permission headers;
- named synthetic identity acceptance matrix;
- full repository suite currently **69/69 passing** plus production Compose validation.

## Identity/control plane

```text
Browser
  -> RydeSync /auth/login
  -> account.aerocoreos.com/login
  -> one-time handoff code + state
  -> RydeSync /auth/callback
  -> server HMAC POST identity-api.aerovista.us/v1/handoff/exchange
  -> encrypted HttpOnly __session

Protected capability
  -> adapter identity.can(capability)
  -> POST /v1/authorization/check
  -> canonical Identity Gateway (ACOS)
  -> AVCC
```

Canonical Identity Gateway source is `aerovista-us/ACOS/main/services/identity-gateway`. The similarly named standalone repository is reference/test-only and must not be treated as deploy source.

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

## Push-to-talk

PTT uses the authenticated room WebSocket for `voice.join`, floor requests/releases and room-scoped SDP/ICE forwarding. Microphone audio travels only over WebRTC. One server-owned talk floor prevents accidental simultaneous transmit.

Current observed production bootstrap/UI is PTT ready with TURN not configured. STUN-only/easy-NAT operation is useful for development and some same-network cases, but independent-cellular reliability is not accepted until TURN is configured and field-tested. Cloudflare Tunnel is not a TURN relay.

## Android

`apps/android` is a sibling client, not a second backend. It owns Android/Media3/Android Auto/device-token platform concerns while consuming RydeSync's public API, realtime and protected media routes.

## Current durability boundary

Rooms, membership, playback, location, sequence and voice-floor state remain process-memory in Alpha.7. A process restart ends active Rydes. Durable event journal/replay, Redis/Postgres state, horizontal coordination, persistent crews/history, push notifications and larger-room voice/SFU remain later hardening/features.

## Source/deployment boundary

Production Alpha.7 is pinned to runtime release SHA `1be4b5e33c77c32014b1f9963315a3219f45d778`. Later Alpha.7 commits before this documentation reconciliation add tests/docs without changing app runtime logic. Advancing the repository does not itself constitute redeployment.

Deployment orchestration is owned by `aerovista-us/nxcore` operational `master`, not NXCore `main`. See `SOURCE_AND_PRODUCTION_MAP.md`.
