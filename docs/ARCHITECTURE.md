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

## Current alpha — 3.0.0-alpha.5

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
- interactive provider-neutral crew map over ephemeral room location
- protected canonical EchoVerse `/api/catalog` proxy normalized as `rydesync-catalog-v1`
- protected EchoVerse audio/file proxy with byte-range support
- server-authoritative shared playback state with `playback.select`, `playback.play`, `playback.pause`, `playback.seek`, `playback.clear`, `playback.state` and `playback.sync`
- host/co-host-only playback mutation while every rider retains independent EchoVerse entitlement enforcement
- playback epochs reject stale controller writes instead of silently overwriting newer state
- client/server clock estimation and portable drift-correction policy for future browser/Android media engines
- automated coverage for guest flow, token integrity/expiry, identity fail-closed behavior, realtime auth, presence, reconnect, map projection/fit, catalog normalization, media proxy and shared playback synchronization

Not implemented yet:
- durable event journal / missed-event replay
- WebRTC/PTT voice
- persistent room/crew database
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

## Alpha.4 crew map

The crew map is a browser presentation of the existing ephemeral `location.member` room signal. It does not introduce another location store. The map consumes the same `room.snapshot.locations` and realtime location events that Android will consume later.

The map renderer is provider-neutral and dependency-light. It implements Web Mercator/raster tile placement directly in the web client and receives only public map configuration from `/v1/bootstrap`:

```text
map.tileUrlTemplate
map.attribution
map.attributionUrl
map.minZoom
map.maxZoom
```

Map behavior:

- first live location auto-centers the map;
- multi-rider snapshots can auto-fit the crew;
- a rider can manually pan/zoom without the map fighting them on every GPS sample;
- `Fit crew` restores group framing;
- accuracy is displayed as a geographic ring;
- heading rotates a marker indicator when the device reports it;
- speed is presentation-only and derived from the current ephemeral sample;
- aging/stale visual treatment uses the same server staleness budget;
- the server remains authoritative for when a coordinate is removed.

The default OpenStreetMap tile template is a development/light-testing default, not a production scaling decision. Production can replace it through environment configuration without changing the client protocol.


## Alpha.5 shared soundtrack control plane

The room synchronization plane carries an opaque media reference and timing state, never the media stream itself:

```json
{
  "trackId": "echoverse-track-id",
  "status": "playing",
  "positionMs": 42000,
  "anchorServerTs": "2026-08-28T03:00:00.000Z",
  "epoch": 7,
  "updatedBy": "room-member-id"
}
```

`positionMs` is the media position at `anchorServerTs`. While `status=playing`, a client projects the target position forward using its estimate of server time. `presence.ping/pong` provides a lightweight clock-offset estimate. The server periodically emits `playback.sync` while a room is playing; these hints do not mutate state or advance the playback epoch.

Only signed-in `host` / `co_host` room members can mutate playback. Identity establishes who the controller is; room role establishes authority. Every mutation can carry `expectedEpoch`. If another controller has already changed the soundtrack, the stale command receives `epoch_conflict` instead of overwriting newer room state. Reconnect snapshots include the full current playback state, so cellular handoff does not require a separate music session endpoint.

Control authority is intentionally separate from media entitlement. The room may know an opaque `track_id`; full catalog browse remains behind each member's live `echoverse.library.listen` grant. A legitimate guest room member may receive only a short-lived current-track media grant so the crew can hear the shared selection. The grant is bound to room + member + current `track_id` and never exposes the host's broader library entitlement.

Recommended client correction policy is exposed through bootstrap thresholds:

- drift `< PLAYBACK_SOFT_DRIFT_MS`: do nothing;
- soft ≤ drift < hard: temporarily use 1.03x when behind or 0.97x when ahead;
- drift `>= PLAYBACK_HARD_DRIFT_MS`: hard-seek to the projected room target.

The browser now attaches a protected same-origin audio client. Signed-in members with a live EchoVerse capability can mint a full short-lived media grant; guest room members can mint only a current-room-track grant. Android/Media3 uses the same playback state machine and protected media boundary.

## Alpha.4 EchoVerse boundary

RydeSync now owns the public consumer boundary for its EchoVerse integration:

```text
Browser / Android
      |
      | AV Identity / RydeSync authorization
      v
RydeSync /v1/echoverse/*
      |
      | private server-to-server request
      v
http://echoverse-library-api:5304
      |
      +-- /api/catalog
      +-- /api/audio/{track_id}
      +-- /api/file/{path}
```

The upstream URL is never returned to the client and the retired `echoverse-catalog:5300` service is not used.

`GET /v1/echoverse/catalog` requires `echoverse.library.listen`, calls the existing canonical `/api/catalog` RydeSync dump, and normalizes it to a stable product contract:

```json
{
  "contract": "rydesync-catalog-v1",
  "source": "echoverse-library-api",
  "total": 1,
  "tracks": [
    {
      "id": "track-id",
      "title": "Track title",
      "artist": "Artist",
      "album": "Album",
      "artworkUrl": null,
      "streamUrl": "/v1/echoverse/audio/track-id"
    }
  ]
}
```

The proxy does not forward a user's AeroVista bearer token to EchoVerse. RydeSync performs the AV capability check first, then uses the trusted private network path. If the Library API later requires a dedicated service bearer, `ECHOVERSE_UPSTREAM_BEARER_TOKEN` is server-only.

Audio and file routes preserve safe response metadata and audio byte ranges. That is suitable for Android Media3. Browser audio playback is intentionally not declared complete yet because the current AV Identity adapter resolves bearer tokens while a native `<audio>` element cannot attach that header. The stable browser-session transport should solve that boundary; do not put AV identity tokens into audio query strings as a shortcut.

## Alpha.6 playback clients

The control plane and media plane remain separate. Room WebSocket messages carry only authoritative playback state. A browser that has already passed live AV Identity/AVCC authorization may exchange that authorization for a short-lived HttpOnly same-origin EchoVerse **media session**. This cookie is scoped to `/v1/echoverse/`; it is not an AeroVista credential, cannot call room/admin/catalog endpoints, and is cleared when the listener opts out. Android does not need this browser cookie: Media3 requests can attach the AV bearer through the platform token-provider adapter.

`apps/android` is intentionally a sibling client of this service. It does not introduce a second backend or a Tailnet-only API. The Android project owns platform concerns (Media3 service/session, Android Auto, foreground playback, device identity token retrieval); RydeSync server remains the public room/media boundary.


## Alpha.7 member entry, guest listening and PTT

### Entry contract

```text
Guest landing
  +-- Join Ryde
  +-- Sign In
  `-- no Start Ryde action

AeroVista member session
  +-- Start Ryde
  +-- Join Ryde
  `-- member capability surfaces
```

`POST /v1/rooms` requires authenticated identity on the server. `POST /v1/rooms/:code/join` remains guest-capable. This prevents anonymous room ownership while preserving invite frictionlessness.

The browser sign-in boundary uses the existing Access Convergence shape: `/auth/login` creates a random state and redirects to the account site; `/auth/callback` validates state and exchanges the returned one-time code server-side; RydeSync then stores a local encrypted HttpOnly `__session`. The exact exchange endpoint is deployment configuration and is not inferred from naming.

### Shared music permissions

```text
Guest rider
  +-- hear current shared track
  +-- local volume / mute / Stop Listening
  `-- cannot browse library or mutate room playback

Signed-in host/co-host
  +-- play / pause / seek / select / clear shared playback
  `-- can browse EchoVerse only when AVCC grants echoverse.library.listen
```

The guest media grant is purposefully narrower than an EchoVerse entitlement. Audio requests recheck that the room exists, the member still belongs to it, and the requested track is still the room's current track. Arbitrary `/v1/echoverse/file/*` access is not included.

### Push-to-talk

PTT reuses the authenticated room WebSocket as a control/signaling plane and WebRTC as the media plane. After a rider explicitly grants microphone access, `voice.join` registers that room member with the voice mesh. SDP/ICE is forwarded only to another active member in the same room. A single server-owned `voiceFloorMemberId` controls who may transmit; the browser enables its local audio track only after receiving floor ownership and disables it immediately on release/disconnect.

STUN-only operation is useful for development and some same-network/NAT cases. `TURN_URLS` + credentials must be configured and tested with two independent cellular clients before production voice reliability is claimed. Cloudflare Tunnel carries HTTPS/WebSocket traffic and does not replace TURN.

### Remaining durability boundary

Rooms, membership, playback, location, voice-floor state and sequence state are still process-memory state in alpha.7. A process restart ends active Rydes. Redis/Postgres durability and multi-instance realtime coordination remain a later production-hardening gate.
