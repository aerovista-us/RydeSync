# RydeSync Push-to-Talk Deployment & QA

## Current state

Alpha.7 PTT is implemented and the current production UI reports:

```text
PUSH TO TALK
Ready
TURN not configured · same-network voice may work
```

Interpret this narrowly: the application/signaling/PTT feature is enabled and STUN/easy-NAT operation may work. **Reliable independent-cellular PTT is not accepted until TURN is configured and the field test below passes.**

## Architecture

```text
Authenticated Ryde realtime WebSocket
  +-- voice.join / leave
  +-- room-scoped SDP + ICE signaling
  +-- single-speaker server talk-floor authority

WebRTC peer connections
  +-- microphone audio only
  +-- STUN discovery
  +-- TURN relay fallback for difficult NAT/cellular
```

The WebSocket never carries audio samples. Cloudflare Tunnel carries application HTTPS/WebSocket traffic but is **not** a TURN relay.

## Permission behavior

- `group_ride`: guest rider can PTT when enabled.
- `listening_party`: permitted listener/rider/speaker roles can voice.
- `band_practice`: speaker can voice.
- `classroom` / `campaign`: listeners require promotion; Alpha.7 still lacks the full host role-promotion UX.
- host/co-host are voice-capable.

Microphone capture never begins automatically. The rider explicitly enables PTT and grants browser/device microphone permission.

## Environment

```env
VOICE_ENABLED=true
VOICE_MAX_PEERS=12
STUN_URLS=stun:stun.l.google.com:19302
TURN_URLS=
TURN_USERNAME=
TURN_CREDENTIAL=
```

Multiple URLs are comma-separated. `turnReady`/`turnConfigured` must remain false unless URL, username and credential are all present.

## TURN deployment rule

TURN must be publicly reachable by the clients themselves. A typical coturn deployment exposes `3478/udp`, usually `3478/tcp`, optionally `5349/tcp` for `turns:`, plus a relay port range through firewall/NAT.

For broader public use prefer time-limited TURN credentials over permanent shared credentials.

## Required field acceptance

1. Phone A: cellular only, Wi-Fi off.
2. Phone B: separate cellular path/network if practical, Wi-Fi off.
3. Both open `https://rydesync.aerovista.us`.
4. Signed-in member starts a Ryde; second phone joins as guest.
5. Both explicitly enable PTT and microphone.
6. Confirm UI reports TURN configured/ready.
7. A holds talk → B hears clear audio.
8. B holds talk → A hears clear audio.
9. Simultaneous request proves talk-floor busy/deny behavior.
10. Background/foreground each browser and verify room reconnect + voice rejoin.
11. Move one device cellular ↔ Wi-Fi and verify reconnection.
12. Confirm server logs/messages contain signaling only, never microphone audio payloads.

Run same-Wi-Fi as a baseline, but never substitute that for the cellular/TURN test.

## Scale boundary

Alpha.7 uses a WebRTC peer mesh capped by `VOICE_MAX_PEERS` (default 12). This is appropriate for small crews. Larger rooms should move to an SFU rather than indefinitely raising the mesh cap.

## Automated coverage

The Alpha.7 suite proves PTT feature/bootstrap behavior, room-scoped signaling/floor boundaries, STUN-only readiness, and a synthetic complete TURN configuration. Automated tests cannot prove real-world carrier NAT traversal; that remains the field gate above.
