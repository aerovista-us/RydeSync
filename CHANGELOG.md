# Changelog

## 3.0.0-alpha.7 — Member Entry + PTT Parity

### 2026-09-01 production acceptance checkpoint

- Accepted/deployed RydeSync runtime: `21012670ad4452bd86d1a7e7aaa2e777d60fb061`.
- Accepted Account/AVCC staff handoff deployment: ACOS `9f2b68842b42154349d0fc247b2e1ff9c9addad9`.
- Accepted NXCore TURN deployment tooling: `eb8471114da51fe6c20957c9b484c043c355768d`.
- Production verifier passes localhost, Traefik origin, Account handoff assets, public root and `/admin` Cloudflare Access protection.
- TURN verifier passes shared-secret alignment, UDP/TCP advertisement, coturn hardening, stable container state, listeners and public DNS.
- Field test passed bidirectional audible PTT with host + guest rider and phone on cellular.
- `turn.aerovista.us` is publicly reachable from the carrier path; TURN is classified as **configured/reachable fallback**. The field test did not force `iceTransportPolicy: 'relay'`, so selected media relay through coturn remains optional diagnostic evidence rather than a blocker.
- Added cross-repository restore refs for the accepted RydeSync, ACOS handoff and NXCore TURN tooling commits.
- Captured the Traefik file-provider incident: `git stash -u` had removed local/untracked middleware/startup files, invalidating routers that referenced `secure-headers@file`; selective restoration repaired Account/RydeSync routing without restarting Traefik. Runtime-config ownership hardening remains follow-up work.
- Reconciled AeroCore App Adapter HMAC docs with implementation truth: current v0.1 signs `METHOD\nPATHNAME\nTIMESTAMP\nRAW_BODY`; older `PATH_WITH_QUERY` wording was stale.

### Alpha.7 delivered surface

- Locked guest entry UX to **Join Ryde + Sign In**; `Start Ryde` requires authenticated identity server-side.
- Added Account relying-party handoff: state-bound one-time code → server-side HMAC exchange → encrypted HttpOnly local `__session`.
- Added staff SSO app handoff through the protected AVCC route while preserving registered `client_id`, `return_to` and `state`.
- Current broker contract is explicitly mapped through the AeroCore app adapter to Identity Gateway: `/v1/handoff/exchange`, `/v1/session/resolve`, `/v1/session/revoke`, `/v1/authorization/check`.
- Canonical production Identity Gateway source identified as `aerovista-us/ACOS/main/services/identity-gateway`; standalone `aerovista-us/identity-gateway` remains an extracted/reference regression harness, not deploy source.
- Preserved guest-capable public flow while protected identity/capability operations fail closed.
- Restored room-scoped WebRTC PTT with explicit microphone opt-in, room-scoped SDP/ICE signaling, and server-authoritative single-speaker talk floor.
- Added room-token-gated temporary TURN REST credentials with six-hour default ceiling capped by the actual Ryde lifetime; permanent relay secret remains server-only.
- Added first-party QR `/join/<code>` scan-to-join flow with guest/member continuation and no room token in the invitation URL.
- Added signed-in host Lock/End Ryde controls.
- Tightened shared soundtrack mutation to authenticated host/co-host room roles.
- Added current-room-track-only guest media grants without broader EchoVerse entitlement.
- Kept full library browse behind live `echoverse.library.listen` AVCC capability.
- Added full EchoVerse library browsing/search/filter/sort/pagination and device-local playlists while avoiding false server/cloud playlist persistence.
- Improved browser shared-audio autoplay retry and synchronization precision with post-load target recomputation, 3s correction cadence, 150ms soft / 750ms hard drift thresholds and ±5% bounded rate correction.
- Added baseline browser security/permission headers.
- Added named synthetic identity acceptance matrix covering staff/member allow/deny, guest boundaries, live revocation, stale authorization, expired/unknown credentials, STUN-only and TURN-ready states.
- Extended cross-layer identity regression coverage into the standalone Identity Gateway harness and `member-access` staff/SSO middleware.
- Added canonical system, identity, adapter and source/production schematics under `docs/`.
- Added `docs/PRODUCTION_ACCEPTANCE_2026-09-01.md` as the accepted field checkpoint and restore-point manifest.

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
