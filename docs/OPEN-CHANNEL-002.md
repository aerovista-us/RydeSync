# Open Channel 002 — provider admission and lease-v1

**Status (2026-11-25): development candidate; no live activation.**

## Scope

- `private-room-admission.js` is a fail-closed provider boundary. Its caller must supply a verified principal, trusted grant and membership lookups, and the existing room-token issuer. It binds the app, experience, room, identity, role and expiry; rechecks the grant before issuing; and caps the token at 60 seconds. It is not an HTTP route or a new identity authority.
- `voice-floor-lease.js` grants one speaker per room, bound to a specific authenticated connection and request. Leases are five seconds, renewable up to 60 seconds per grant and never beyond actor expiry. Wrong-connection or stale releases/renewals cannot affect the current floor.
- `realtime.js` integrates lease-v1 behind the programmatic `config.voice.leaseRoomIds` allowlist (empty by default). No environment configuration or live room allowlisting is added. Legacy rooms continue using their existing talk-start/stop flow.
- Opted-in clients negotiate `voice.join` with `floorProtocol: "lease-v1"`, send `voice.talk.start` with a unique requestId, and await a matching `voice.floor.granted` before enabling the microphone. Renew and release include both requestId and floorId. A denial, deadline, disconnect, replacement or revocation must mute locally. Renew before five seconds, e.g. every two seconds; a suspended tab must never resume speaking without a new grant.

## Verification

- Local Node: 12/12 tests passed for floor exclusivity, idempotency, stale connections, expiry, caps, revocation, verified principal, explicit grant/membership, role, expiry, mid-flight revocation and authority outage. The repository test uses the same cases with adjusted import paths.
- Actual patched realtime and floor source evaluated with synthetic socket, token, room and timer dependencies: eight checks passed (negotiation; exclusive request-correlated grant; duplicate/renew/stale release; timer expiry; replacement; membership removal; token expiry; legacy protocol).
- Source blobs at evaluation: realtime `2caf0e2bc0b61b97d382b466ad3929f0f9dad43e`, floor `7b56a5631b060a4dae5add7bca18fbd873f94c40`.
- This is not a real socket, signed-token, browser microphone, WebRTC media, live authorization, cross-room isolation or deployment acceptance result. Full repository tests and physical-device acceptance remain open.

## Activation gates

1. Reconcile live RydeSync image and NXCore availability. Do not merge/deploy automatically.
2. Wire admission to authenticated canonical provider and room-grant authority. Disable all alternate public/guest admission to private experiences, including aliases; verify every HTTP and WS route, room-token audience and fresh authorization. Ensure grant revocation terminates existing access (the current hub checks provider membership and token expiry, not a live grant lookup).
3. Connect Messenger CommLink core to this negotiated provider protocol. Implement independent local mute/release, receive-only gating, reconnect, expiry and bounded lease renewal. Signaling does not enforce microphone behavior on a malicious client or replace media-server policy.
4. Run full repository tests, real signed WebSocket tests and two-device audio/permission tests, including reconnect, revocation and public-room regression; prove TURN as needed.
5. Approve explicit private pilot grants and allowlist only after the above. Roll back by removing the pilot allowlist and disabling private admission; legacy public behavior stays intact.

No live room, membership, identity grant, secret, service configuration or production state was changed.
