# RydeSync Global-First Architecture — Foundation

## Product boundary

RydeSync is a public real-time ride/group coordination product. A person must be able to open a share link and join an ephemeral ride without Tailscale or an AeroVista account. AeroVista Identity adds durable identity and entitlements; it must not become a hidden network prerequisite.

## Foundation rules

1. **Public guest path stays available.** Guest-capable room operations do not depend on AV Identity health.
2. **Privileges never fail open.** Identity outages, malformed claims, or unconfigured identity endpoints cannot grant EchoVerse or account-only capabilities.
3. **AV Identity stays behind an adapter.** The room domain consumes a normalized principal and does not know Firebase, Identity Gateway, AVCC, cookie names, or handoff internals.
4. **EchoVerse stays private upstream.** Browsers and Android clients call RydeSync/public product APIs. The canonical EchoVerse Library API remains an internal upstream.
5. **Room identity and account identity are separate.** Every room member gets a short-lived room session token. An AeroVista `identity_id` may be attached when verified.
6. **Location is ride-scoped.** Future live location belongs to the active room/session and is not automatically durable profile history.
7. **One public contract for web and Android.** Android consumes the same versioned REST/realtime contract rather than a Tailnet-only backend.
8. **Realtime credentials do not travel in URLs.** The client upgrades first, then sends the room token in an `auth` message.
9. **Reconnect means resynchronize, not fake replay.** Until durable event history exists, a reconnect receives an authoritative snapshot. `lastSeenSeq` is carried so a future event journal can add replay without changing the client contract.

## Current alpha — 3.0.0-alpha.3

Implemented:
- dependency-free Node 22 HTTP service
- `/health`
- `/v1/bootstrap`
- `/v1/session`
- ephemeral room create/read/join
- HMAC-signed short-lived room member sessions
- AV Identity adapter modes: `off`, `optional`, `required`
- protected EchoVerse entitlement gate (`echoverse.library.listen`)
- WebSocket endpoint `/v1/realtime?room=<room-id-or-code>`
- first-message room-token authentication with timeout
- room/member/token binding verification
- one active realtime socket per member; reconnect replaces stale connections
- monotonically increasing in-memory room event sequence
- `auth.ok`, `room.snapshot`, `member.online`, `member.offline`, `presence.ping/pong`, `room.state.get`
- heartbeat cleanup and room-expiration disconnects
- browser exponential reconnect and reload restore from local room session
- opt-in `location.update` / `location.stop` realtime contract
- server-side coordinate validation, timestamp checks, update throttling and staleness cleanup
- `location.member` / `location.cleared` room events and location-bearing authoritative snapshots
- location is cleared on explicit stop, disconnect, staleness, or room expiry
- web client does not persist the location-sharing choice across a full reload
- zero-dependency responsive web shell
- automated coverage for guest flow, token integrity/expiry, identity fail-closed behavior, realtime auth, presence and reconnect

Not implemented yet:
- durable event journal / missed-event replay
- WebRTC/PTT voice
- persistent room/crew database
- EchoVerse catalog proxy implementation
- production AV Identity endpoint mapping
- Android client
- push notifications

## REST + realtime request flow

```text
Browser / Android
      |
      +-- POST /v1/rooms or /join
      |          |
      |          +---- signed short-lived room member token
      |
      +-- WS /v1/realtime?room=<public room ref>
                 |
                 +---- { type: "auth", token, lastSeenSeq }
                 |
                 +---- auth.ok
                 +---- room.snapshot
                 +---- member.online / member.offline
                 +---- location.member / location.cleared
```

The room token is bearer authorization for one room membership. Invite links contain only the public join code. The token is intentionally kept out of URLs.

## Reconnect model

A room member is durable for the life of the ephemeral room; a WebSocket is not. On transient network loss the browser reconnects with the same room token and its last observed server sequence. The server validates that the signed claims still match a live member record, replaces any stale socket for that member, and sends a fresh authoritative snapshot.

This gives the Android client a stable future contract for cellular handoffs and sleep/wake behavior without claiming event replay exists before we have a persistent event store.

## Why identity is optional at the transport boundary

`AV_IDENTITY_MODE=optional` means public routes can degrade to guest behavior if the identity control plane is unavailable. It does **not** mean authenticated privileges degrade to guest-equivalent authorization. Any route calling `requireIdentity` or `requireCapability` still denies access.

This is deliberate because AeroVista Identity is the strategic authority but is still being stabilized. RydeSync can be built against its final role now without making every ride dependent on unfinished auth behavior.


## Live location privacy model

Location is a room-session signal, not profile data. A client must explicitly opt in after it has authenticated to the ride room. Location samples are sent through the existing authenticated WebSocket, never through invite URLs or unauthenticated endpoints.

The alpha stores the latest coordinate only in `RealtimeHub` memory. It is not written to `RoomStore`, files, account records, or ride history. The server validates coordinate ranges and client timestamps, enforces a minimum update interval, and removes coordinates when sharing stops, the member disconnects, the sample becomes stale, or the room expires.

The web client also performs movement/time throttling before sending updates. A native Android client can use the same `location.update` message from a foreground ride service. Android-specific background permissions and battery policy belong in the client, not in a second backend contract.
