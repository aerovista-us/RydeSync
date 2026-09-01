# RydeSync Push-to-Talk Deployment & QA

Last field reconciliation: **2026-09-01**.

## Current state

Alpha.7 PTT is implemented, TURN is configured, and the real cellular field gate has passed.

Observed production UI during acceptance:

```text
PUSH TO TALK
Ready · 1 voice peer
TURN ready · cellular fallback configured
```

Accepted field result:

```text
RydeSync cellular PTT: ACCEPTED
TURN fallback: READY / PUBLICLY REACHABLE
Forced relay candidate selection: OPTIONAL / NOT YET PROVEN
```

A signed-in host and guest rider established room presence and bidirectional audible WebRTC PTT with the phone on cellular. coturn also observed carrier-origin connection attempts during the session, confirming public listener reachability.

This distinction matters: successful cellular PTT proves the product voice path across independent networks. Because the test did not force `iceTransportPolicy: 'relay'`, WebRTC may have selected a direct/STUN candidate while probing TURN. Do not claim that the media itself definitely traversed coturn until a relay-only diagnostic proves a selected `relay` candidate.

## Architecture

```text
Authenticated Ryde realtime WebSocket
  +-- voice.join / leave
  +-- room-scoped SDP + ICE signaling
  +-- single-speaker server talk-floor authority

WebRTC peer connections
  +-- microphone audio only
  +-- direct ICE / STUN preferred
  +-- TURN relay fallback for difficult NAT/cellular
```

The WebSocket never carries audio samples. Cloudflare Tunnel carries application HTTPS/WebSocket traffic but is **not** a TURN relay.

## Realtime voice contract

Room-scoped signaling/talk-floor messages:

```text
voice.join
voice.leave
voice.signal
voice.talk.start
voice.talk.stop
voice.floor
voice.floor.denied
voice.error
```

The room token authenticates the realtime membership. SDP/ICE signaling is forwarded only inside that room boundary. Audio remains WebRTC media-plane traffic.

Local microphone tracks begin disabled. The browser enables the local audio track only while all three conditions are true:

1. the voice client is joined;
2. the server-owned floor belongs to this member; and
3. the member is actively holding PTT.

Releasing PTT or losing the floor mutes the local track immediately.

## Permission behavior

- `group_ride`: guest rider can PTT when enabled.
- `listening_party`: permitted listener/rider/speaker roles can voice.
- `band_practice`: speaker can voice.
- `classroom` / `campaign`: listeners require promotion; Alpha.7 still lacks the full host role-promotion UX.
- host/co-host are voice-capable.

Microphone capture never begins automatically. The rider explicitly enables PTT and grants browser/device microphone permission.

## Production TURN topology

```text
turn.aerovista.us
  -> DNS-only public IPv4 135.134.145.137
  -> eero WAN / explicit port forwards
  -> NXCore 192.168.7.253
  -> rydesync-turn coturn container
```

Required public forwarding:

```text
3478/udp
3478/tcp
49160-49415/udp
```

Current coturn image:

```text
coturn/coturn:4.17.2-r0
```

UPnP was not available during acceptance, so explicit forwarding is the production rule. The public WAN address matched the TURN DNS address; no CGNAT/double-NAT mismatch was observed.

## Production environment contract

Application-side shape:

```env
VOICE_ENABLED=true
VOICE_MAX_PEERS=12
STUN_URLS=stun:stun.l.google.com:19302
TURN_URLS=turn:turn.aerovista.us:3478?transport=udp,turn:turn.aerovista.us:3478?transport=tcp
TURN_SHARED_SECRET=<server-only shared secret>
TURN_REALM=turn.aerovista.us
TURN_CREDENTIAL_TTL_SECONDS=21600
```

Legacy static `TURN_USERNAME` / `TURN_CREDENTIAL` support may remain for controlled environments, but production Alpha.7 uses room-scoped temporary TURN REST credentials. Permanent relay credentials must not be emitted by public bootstrap.

## TURN credential contract

Clients obtain relay credentials only through:

```text
POST /v1/voice/ice
```

The request must contain a valid live Ryde room token. RydeSync then issues temporary TURN REST credentials scoped to the room/member subject.

Credential properties:

- coturn `use-auth-secret` / TURN REST model;
- permanent shared secret remains server-side;
- username contains expiry + room/member subject;
- credential uses HMAC-SHA1/base64 as required by coturn TURN REST authentication;
- configured TTL ceiling defaults to 21,600 seconds / six hours;
- actual credential expiry is capped at the server-side Ryde expiration;
- browser never receives the permanent shared secret;
- ICE credentials refresh before peer creation/rejoin when required.

## coturn hardening contract

Production configuration includes:

```text
fingerprint
use-auth-secret
realm/server-name turn.aerovista.us
no-cli
no-multicast-peers
no-loopback-peers
no-tcp-relay
stale-nonce=600
unauthorized-ratelimit
unauthorized-ratelimit-rps=10
user-quota=16
total-quota=512
max-bps=262144
bps-capacity=8388608
no-tls
no-dtls
relay range 49160-49415
```

Server secret/config locations:

```text
/etc/acos-secrets/rydesync-turn
/etc/acos-secrets/rydesync-turn/turnserver.conf
/etc/acos-secrets/rydesync-turn.env
```

## Server-side verification

The accepted production verifier passes all internal TURN gates:

```text
PASS RydeSync and coturn share the same hidden auth secret
PASS RydeSync advertises UDP and TCP TURN transports
PASS coturn auth and relay hardening are present
PASS coturn container stable, restart count 0
PASS UDP 3478 listening
PASS TCP 3478 listening
PASS turn.aerovista.us resolves publicly to 135.134.145.137
```

The verifier intentionally leaves the carrier/NAT/media field gate outside server-local automation.

## 2026-09-01 field acceptance

Completed:

1. Production Account/staff SSO handoff restored and verified.
2. Host started a real Ryde.
3. Guest rider joined and appeared in realtime presence.
4. PTT enabled on both endpoints with one voice peer.
5. Phone used cellular network during the external-path test.
6. Host → guest audible PTT succeeded.
7. Guest → host audible PTT succeeded.
8. Talk-floor UI/state visibly followed the transmitting rider.
9. coturn logged carrier-origin TCP connection attempts from the cellular path.

Result:

> **CELLULAR PTT ACCEPTED.** TURN infrastructure is configured, credentialed, hardened, reachable and available as fallback.

Not claimed:

> The selected media candidate was not explicitly inspected/forced to `relay`, so this field test is not labeled “forced TURN media relay proven.”

## Optional forced-relay diagnostic

If absolute TURN-path evidence is required later, temporarily construct the peer connection with:

```js
new RTCPeerConnection({
  iceServers,
  iceTransportPolicy: 'relay'
})
```

Then repeat bidirectional PTT while inspecting coturn allocation/permission/channel traffic and/or the browser-selected ICE candidate pair. This is a diagnostic mode only; normal production should continue preferring direct ICE and use TURN as fallback.

## Browser audio UX note

Remote tracks are attached to hidden autoplay/playsInline audio elements. Browsers can still reject `audio.play()` until a user gesture. Alpha.7 surfaces a `gesture_required` state, but the current recovery interaction can be clearer. The field issue observed during acceptance was mostly user/device audio state rather than a WebRTC failure, so this remains a UX follow-up rather than a release blocker.

Recommended future improvement: explicitly retry remote-audio `.play()` on a deliberate PTT/voice user gesture without forcing the rider to tear down the peer session.

## Scale boundary

Alpha.7 uses a WebRTC peer mesh capped by `VOICE_MAX_PEERS` (default 12). This is appropriate for small crews. Larger rooms should move to an SFU rather than indefinitely raising the mesh cap.

## Automated coverage

The Alpha.7 suite covers:

- PTT feature/bootstrap behavior;
- room-scoped signaling/floor boundaries;
- STUN behavior;
- complete synthetic TURN configuration;
- TURN REST HMAC credential generation;
- room-token gating;
- secret non-exposure;
- credential expiry bounded by room lifetime;
- production Compose validation.

Automated tests cannot fully prove carrier NAT behavior or selected ICE media routing. Those remain field/diagnostic evidence.

## Restore point

Accepted voice runtime:

```text
RydeSync SHA: 21012670ad4452bd86d1a7e7aaa2e777d60fb061
Restore branch: restore/2026-09-01-cellular-ptt-accepted

NXCore TURN tooling SHA: eb8471114da51fe6c20957c9b484c043c355768d
Restore branch: restore/2026-09-01-rydesync-turn-infra
```

For the cross-repository Account/Identity and Traefik incident checkpoint, see `PRODUCTION_ACCEPTANCE_2026-09-01.md`.
