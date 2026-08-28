# RydeSync Push-to-Talk Deployment & QA

## Architecture

Alpha.7 restores PTT as a small-crew WebRTC mesh.

```text
Authenticated Ryde realtime WebSocket
  +-- voice.join / leave
  +-- room-scoped SDP + ICE signaling
  +-- single-speaker talk-floor authority

WebRTC peer connections
  +-- microphone audio only
  +-- STUN discovery
  +-- TURN relay fallback for NAT/cellular
```

The WebSocket never carries audio samples. Cloudflare Tunnel terminates the web/realtime application path, but it is **not a TURN relay**.

## Permission behavior

- `group_ride`: guest `rider` can PTT.
- `listening_party`: listener/rider/speaker can use voice when enabled.
- `band_practice`: `speaker` can use voice.
- `classroom` / `campaign`: listeners are not speakers until promoted. Alpha.7 does not yet restore the host role-promotion UX, so these moderated modes are not voice-parity complete.
- host/co-host are voice-capable.

Microphone capture never begins automatically. The rider must press **Enable PTT** and grant browser microphone permission.

## Environment

```env
VOICE_ENABLED=true
VOICE_MAX_PEERS=12
STUN_URLS=stun:stun.l.google.com:19302
TURN_URLS=
TURN_USERNAME=
TURN_CREDENTIAL=
```

Multiple STUN/TURN URLs are comma-separated.

When TURN credentials are absent the UI explicitly reports that TURN is not configured. Same-LAN or easy NAT paths may still work through STUN, but that is not enough to declare cellular voice reliable.

## TURN deployment rule

TURN must be publicly reachable by the phones themselves. Do not point `TURN_URLS` at the RydeSync HTTP Cloudflare Tunnel and do not assume the tunnel can relay UDP/RTP media.

A typical coturn deployment exposes at least:

- `3478/udp` and usually `3478/tcp`
- optionally `5349/tcp` for TURN over TLS (`turns:`)
- a configured relay port range in the host firewall/NAT

Use a real public hostname/IP that resolves/reaches the TURN server from cellular networks.

Static username/credential variables are supported for the current alpha. For a larger public deployment, replace long-lived shared credentials with time-limited TURN credentials before broad exposure.

## Required field test

Do not call PTT production-ready until this passes:

1. Phone A on cellular only; Wi-Fi off.
2. Phone B on a different cellular path/network if possible; Wi-Fi off.
3. Both open `https://rydesync.aerovista.us`.
4. One signed-in member starts a Ryde; second phone joins as guest.
5. Both enable PTT and grant microphone permission.
6. Verify UI says TURN configured.
7. Hold-to-talk A → B; confirm B hears clear audio.
8. Hold-to-talk B → A; confirm A hears clear audio.
9. Attempt simultaneous talk: second rider should receive channel-busy/floor-denied until first releases.
10. Background/foreground each browser and verify realtime reconnect + voice rejoin.
11. Transition one device cellular ↔ Wi-Fi and confirm room reconnect behavior.
12. Watch browser/server logs for signaling errors; confirm no microphone audio payloads appear in server messages/logs.

Also test same-Wi-Fi as a separate baseline; it must not substitute for the cellular test.

## Current scale

The alpha uses a peer mesh and caps room voice membership with `VOICE_MAX_PEERS` (default 12). This is appropriate for small ride crews. Larger rooms eventually need an SFU rather than increasing the mesh cap indefinitely.
