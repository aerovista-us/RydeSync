# RydeSync — Global Foundation

Global-first RydeSync foundation. Public guest ride rooms work without Tailscale or login. AeroVista Identity is the strategic account authority, but remains isolated behind an adapter while the production identity contract is stabilized. EchoVerse access is an authenticated capability and the canonical private Library API is never exposed directly to clients.

## Run

Node 22+ only. No runtime npm packages are required.

```bash
cp .env.example .env
# export values from .env using your normal runtime/deploy tooling
npm test
npm start
```

Open `http://localhost:9000`.

## Current milestone — 3.0.0-alpha.5

- guest Start Ride / Join Ride
- short-lived HMAC-signed room membership tokens
- AV Identity adapter with safe `optional` mode
- fail-closed `echoverse.library.listen` entitlement boundary
- authenticated WebSocket room plane at `/v1/realtime`
- live online/offline presence and authoritative room snapshots
- reconnect/resume using the same room token and last server sequence
- explicit opt-in live location with server + client battery/data throttling
- immediate coordinate clearing on stop, disconnect, stale sample, or room expiry
- **interactive crew map** with geographic tiles, pan/zoom, fit-crew, accuracy rings, heading, speed, self-marker, and stale-state treatment
- **canonical EchoVerse catalog proxy** at `/v1/echoverse/catalog`
- protected byte-range audio proxy at `/v1/echoverse/audio/{track_id}` for Android/Media3 and future browser-native sessions
- protected private artwork/file proxy at `/v1/echoverse/file/{path}`
- **server-authoritative shared soundtrack state** with host/co-host controls, per-room epochs, play/pause/seek/clear, reconnect snapshots, and periodic drift hints
- client room-clock estimation through `presence.ping/pong`
- portable soft-drift/hard-drift correction policy (`none` → temporary 0.97/1.03 rate nudge → hard seek)
- browser shell sharing the same `/v1` + realtime contract intended for Android

Live location is intentionally ephemeral: it exists only in realtime room state and is not copied into room/member records or durable history.

EchoVerse stays private upstream. The default server target is `http://echoverse-library-api:5304`; browsers receive only RydeSync `/v1/echoverse/*` URLs. The retired `echoverse-catalog:5300` service is not used.

The current browser library UI intentionally browses the catalog without claiming browser audio playback is finished. Native clients can authorize range requests with the AV bearer flow today; browser `<audio>` cannot attach that bearer header, so browser playback waits for the stable AV Identity browser-session/cookie contract rather than placing identity credentials in media URLs.

The WebSocket room token is sent only after the socket opens. It is never placed in the WebSocket URL, invite URL, query string, or logs by design.

See `docs/ARCHITECTURE.md` and `docs/IDENTITY_INTEGRATION.md`.


## Shared soundtrack model

RydeSync synchronizes **control state, not audio bytes**. A host or co-host selects an opaque EchoVerse `track_id`; the room broadcasts that ID plus status, anchor position, server timestamp and a monotonically increasing playback epoch. Each rider must independently pass `echoverse.library.listen` before resolving metadata or media.

The browser estimates server clock offset with `presence.ping/pong`. While a track is playing, the server emits periodic `playback.sync` hints without advancing the room epoch. A playback client compares its local media position with the projected room target: drift below the soft threshold is ignored, medium drift uses a bounded temporary playback-rate nudge, and large drift hard-seeks. The current browser still does not claim authenticated `<audio>` playback until the AV Identity browser-session transport is stable; Android/Media3 can apply the same timing contract to authorized range requests.

## Map provider note

The map renderer itself has no mapping SDK dependency. It consumes a configurable `{z}/{x}/{y}` raster tile template. The `.env.example` defaults to OpenStreetMap tiles for development/light testing. A production deployment should use an AeroVista-approved tile service and preserve the configured attribution.

## Important deployment note

In production, set a durable `ROOM_TOKEN_SECRET` with at least 32 random characters. The service refuses to start in production without it.
