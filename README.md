# RydeSync — Global Foundation

Global-first RydeSync foundation. Public guest ride rooms work without Tailscale or login. AeroVista Identity is the strategic account authority, but remains isolated behind an adapter while the production identity contract is stabilized. EchoVerse access is modeled as an authenticated capability and the private library upstream is never exposed to clients.

## Run

Node 22+ only. No runtime packages are required.

```bash
cp .env.example .env
# export values from .env using your normal runtime/deploy tooling
npm test
npm start
```

Open `http://localhost:9000`.

## Current milestone — 3.0.0-alpha.3

- guest Start Ride / Join Ride
- short-lived HMAC-signed room membership tokens
- AV Identity adapter with safe `optional` mode
- fail-closed `echoverse.library.listen` entitlement boundary
- authenticated WebSocket room plane at `/v1/realtime`
- live online/offline presence
- authoritative room snapshots
- reconnect/resume using the same room token and last server sequence
- stale socket replacement when the same member reconnects
- browser exponential reconnect with full-page session restore
- heartbeat/ping cleanup for dead sockets
- explicit opt-in live location over the authenticated room socket
- server + client location throttling for battery/data protection
- immediate coordinate clearing on stop, disconnect, stale sample, or room expiry
- browser location sharing never auto-resumes after full-page reload
- browser shell sharing the same `/v1` + realtime contract intended for Android

Live location is intentionally ephemeral: it exists only in the realtime room state and is not copied into room/member records or durable history.

The WebSocket token is sent only after the socket opens. It is never placed in the WebSocket URL, invite URL, query string, or logs by design.

See `docs/ARCHITECTURE.md` and `docs/IDENTITY_INTEGRATION.md`.

## Important deployment note

In production, set a durable `ROOM_TOKEN_SECRET` with at least 32 random characters. The service refuses to start in production without it.
