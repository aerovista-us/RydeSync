# Changelog

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
