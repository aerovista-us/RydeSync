# Changelog

## 3.0.0-alpha.7 — Member Entry + PTT Parity

- Locked guest entry UX to **Join Ryde + Sign In**; `Start Ryde` requires authenticated identity server-side.
- Added Account relying-party handoff: state-bound one-time code → server-side HMAC exchange → encrypted HttpOnly local `__session`.
- Current broker contract is now explicitly mapped through the AeroCore app adapter to Identity Gateway: `/v1/handoff/exchange`, `/v1/session/resolve`, `/v1/session/revoke`, `/v1/authorization/check`.
- Canonical production Identity Gateway source identified as `aerovista-us/ACOS/main/services/identity-gateway`; standalone `aerovista-us/identity-gateway` classified as extracted/reference regression harness, not deploy source.
- Preserved guest-capable public flow while protected identity/capability operations fail closed.
- Restored room-scoped WebRTC PTT with explicit microphone opt-in, room-scoped SDP/ICE signaling, and server-authoritative single-speaker talk floor.
- Added STUN/TURN bootstrap/readiness. Current observed production state is **PTT Ready / TURN not configured**; independent-cellular reliability remains a TURN field gate.
- Added signed-in host Lock/End Ryde controls.
- Tightened shared soundtrack mutation to authenticated host/co-host room roles.
- Added current-room-track-only guest media grants without broader EchoVerse entitlement.
- Kept full library browse behind live `echoverse.library.listen` AVCC capability.
- Added baseline browser security/permission headers.
- Added named synthetic identity acceptance matrix covering staff/member allow/deny, guest boundaries, live revocation, stale authorization, expired/unknown credentials, STUN-only and TURN-ready states.
- Extended cross-layer identity regression coverage into the standalone Identity Gateway harness and `member-access` staff/SSO middleware.
- Added canonical system, identity, adapter and source/production schematics under `docs/`.
- Current full RydeSync automated suite: **69/69 passing**, plus production Docker Compose validation.

## 3.0.0-alpha.6 — Playback Client + Android Foundation

- Added opt-in browser shared-audio driven by authoritative room playback state.
- Added protected short-lived same-origin media sessions for browser audio/artwork without exposing AV credentials in media URLs.
- Added native Android foundation under `apps/android` with Compose, Media3 `MediaLibraryService`, ExoPlayer, OkHttp REST/WebSocket clients, protected byte-range playback and Android Auto declarations.
- Android consumes the same public RydeSync contract rather than a Tailnet-only backend.

## 3.0.0-alpha.5 — Shared Soundtrack Control Plane

- Added server-authoritative room playback state and host/co-host select/play/pause/seek/clear commands.
- Added playback epochs, stale-write conflict protection, snapshots/reconnect restore, clock estimation and drift correction.
- Kept media entitlement separate from shared control.

## 3.0.0-alpha.4 — Crew Map + Canonical EchoVerse Proxy

- Added interactive crew map over existing ephemeral location signals.
- Added canonical private EchoVerse proxy to `echoverse-library-api:5304` with catalog normalization, protected audio byte ranges and file/artwork delivery.
- Kept the private upstream and AV bearer credentials out of browser-visible URLs.

## 3.0.0-alpha.3 — Live Location Foundation

- Added explicit opt-in ride-scoped live location over authenticated realtime.
- Added coordinate/timestamp validation, rate limiting, staleness cleanup and authoritative location snapshots/events.
- Location remains memory-only and clears on stop, disconnect, staleness or room expiry.
