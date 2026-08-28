# Changelog

## 3.0.0-alpha.7 — Member Entry + PTT Parity

- Locked the entry UX to **Join Ryde or Sign In** for guests; `Start Ryde` is absent until a verified/local AeroVista member session exists.
- Enforced authenticated room creation server-side while preserving frictionless guest room joins.
- Added configurable AeroVista Access Convergence browser handoff using a short-lived one-time code, server-side exchange, state validation, and encrypted HttpOnly local `__session`.
- Added clean fail-closed handoff outage behavior (`503 handoff_unavailable`).
- Restored room-scoped WebRTC push-to-talk for permitted guest/member roles with explicit microphone opt-in.
- Added a server-authoritative single-speaker talk floor and room-scoped SDP/ICE signaling over the existing authenticated realtime connection. Audio never travels over the WebSocket.
- Added STUN/TURN bootstrap configuration and visible TURN readiness state; real cellular voice still requires a deployed/tested TURN relay.
- Added signed-in host Lock Ryde and End Ryde controls.
- Tightened shared soundtrack mutations to signed-in `host`/`co_host` members.
- Added short-lived **current-room-track-only** guest media grants so legitimate guest riders can hear the host's current shared track without receiving library browse or arbitrary media access.
- Removed native browser audio play/pause/seek controls for guest listeners; riders retain local volume, mute and Stop Listening, while shared playback authority remains host/co-host.
- Added baseline browser security/permissions headers.
- Automated Node/web suite: 58 passing.

## 3.0.0-alpha.6 — Playback Client + Android Foundation

- Added a real opt-in browser shared-audio engine driven by authoritative room playback state.
- Added `Listen with crew`, autoplay/gesture handling, track switching, seek, pause/play mirroring, periodic synchronization, bounded rate nudges, and hard-seek drift correction.
- Added short-lived HttpOnly same-origin EchoVerse media sessions so browser `<audio>` and artwork can load without putting AV credentials in media URLs.
- Media sessions are issued only after live `echoverse.library.listen` authorization, are `SameSite=Strict`, path-scoped to `/v1/echoverse/`, expire automatically, refresh while actively listening, and are cleared when the user stops listening.
- Catalog authorization remains live through AV Identity/AVCC; the media grant does not unlock catalog/room/admin APIs.
- Added native Android project foundation under `apps/android` with Compose, Media3 `MediaLibraryService`, ExoPlayer, OkHttp API/WebSocket clients, AV Identity token-provider boundary, protected byte-range playback, and Android Auto media declaration.
- Added a pure-Kotlin playback target/drift module matching the browser rules and validated it with `kotlinc` in this build environment.
- Android is a client of the same public RydeSync API and does not require direct NXCore/Tailscale access.
- Node/web automated suite: 48 passing.

## 3.0.0-alpha.5 — Shared Soundtrack Control Plane

- Added server-authoritative per-room playback state.
- Added host/co-host `select`, `play`, `pause`, `seek`, and `clear` realtime commands.
- Added playback epochs and `expectedEpoch` conflict protection.
- Added playback state to authoritative room snapshots and reconnect restore.
- Added periodic `playback.sync` drift hints that do not mutate playback epoch.
- Added client room-clock estimation through `presence.ping/pong`.
- Added portable drift correction thresholds and policy tests.
- EchoVerse entitlement remains per rider; shared control never grants media access.
- Browser playback remains intentionally deferred until AV Identity has a stable browser-native session transport.
- Test suite: 43 passing.

## 3.0.0-alpha.4 — Crew Map + Canonical EchoVerse Proxy

- Added a real interactive crew map over the existing room-scoped live-location feed.
- Added provider-neutral raster tile rendering, drag pan, wheel/pinch-style zoom controls, fit-crew auto framing, rider labels, heading indicators, speed readout, accuracy rings, self-marker styling, and aging/stale visual treatment.
- Added configurable map tile URL, attribution, and zoom limits. The default OpenStreetMap tile endpoint is intended for development/light testing; production should use an AeroVista-approved tile provider.
- Added a private EchoVerse catalog proxy targeting the canonical `echoverse-library-api:5304` contract rather than the retired `:5300` service.
- Added `GET /v1/echoverse/catalog`, normalized to stable `rydesync-catalog-v1` track DTOs.
- Added protected `GET /v1/echoverse/audio/{track_id}` with HTTP byte-range passthrough for Media3/native clients.
- Added protected `GET /v1/echoverse/file/{path}` for private artwork/file delivery.
- EchoVerse requests require `echoverse.library.listen` and never forward the caller's AV bearer token to the private library upstream.
- Added optional server-only EchoVerse upstream bearer configuration for a future service-auth requirement.
- Kept browser media playback visually deferred until the AV Identity browser-session transport is stable; catalog browsing is wired without putting credentials into media URLs.
- Expanded automated suite to 29 passing tests.

## 3.0.0-alpha.3 — Live Location Foundation

- Added opt-in ride-scoped live location over the authenticated realtime WebSocket.
- Added coordinate, accuracy and timestamp validation.
- Added server-side location rate limiting and stale-coordinate cleanup.
- Added `location.member`, `location.cleared`, `location.rate_limited`, `location.error`, and `location.stop` protocol handling.
- Added live locations to authoritative room snapshots.
- Location remains memory-only and is cleared on stop, disconnect, staleness, or room expiry.
- Added browser geolocation controls with movement/time throttling and no automatic sharing after page reload.
- Added Android-compatible location payload shape for a future foreground ride service.
- Expanded automated suite to 23 passing tests.
