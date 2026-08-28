# Changelog

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
