# RydeSync — Global Foundation

RydeSync is a public ride-room product for small crews: frictionless joining, room-scoped realtime presence and location, push-to-talk voice, and near-synchronized EchoVerse playback. The public app does not require Tailscale. AeroVista Identity is the account authority for hosting and member capabilities; EchoVerse stays behind RydeSync's private server boundary.

## Current milestone — 3.0.0-alpha.7

Alpha.7 is the **member + feature-parity build** focused on the two gaps found during the alpha.6 field deploy: sign-in/hosting UX and push-to-talk.

### Entry and permissions

The landing contract is deliberate:

- **Guest:** sees `Join Ryde` and `Sign In`. `Start Ryde` is absent.
- **Signed-in AeroVista member:** sees `Start Ryde` and `Join Ryde`.
- **Guest room member:** can use room presence, opt-in live location, crew map, PTT when the room mode permits it, and listen to the room's current shared track.
- **Signed-in host/co-host:** can control the shared soundtrack. Identity alone does not grant control; room role does.
- **EchoVerse library browse:** still requires the member's own live `echoverse.library.listen` AVCC capability.

Guests never inherit the host's EchoVerse library entitlement. A guest listener receives only a short-lived media grant scoped to the room's **current track**. Shared play/pause/seek remains host/co-host authority; every rider keeps only local volume, mute, and Stop Listening.

### Alpha.7 additions

- AeroVista `Join Ryde` / `Sign In` landing flow with authenticated `Start Ryde`.
- Configurable Access Convergence relying-party handoff: short-lived one-time code → server-side exchange → encrypted local `__session` browser session.
- No Firebase or AVCC token is placed in a redirect/media URL.
- Guest-capable WebRTC push-to-talk over the existing authenticated room WebSocket signaling plane.
- Single server-authoritative talk floor so two riders cannot transmit over one another by accident.
- STUN configuration plus explicit TURN readiness/status for real cellular/NAT operation.
- Signed-in host room controls: Lock Ryde and End Ryde.
- Signed-in + host/co-host shared music mutation policy.
- Current-track-only guest media grants for shared listening without broader library access.
- Guest UI exposes only local mute/volume/Stop Listening, not shared playback controls.
- Baseline `nosniff`, referrer and browser geolocation/microphone permission headers.
- Clean fail-closed `503 handoff_unavailable` behavior when the account handoff exchange is offline.

Alpha.7 preserves the existing alpha.6 crew map, ephemeral live location, canonical EchoVerse `:5304` proxy, browser shared-audio engine, playback drift correction, and Android client foundation.

## Run

Node 22+ is required. The server has no external runtime npm dependencies.

```bash
cp .env.example .env
npm test
npm start
```

Open `http://localhost:9000`.

## Production identity setup

Do **not** guess the Access Convergence exchange endpoint. Set these to the exact proven AeroVista deployment values:

```env
AV_IDENTITY_MODE=optional
AV_ACCOUNT_LOGIN_URL=https://account.aerocoreos.com/login
AV_HANDOFF_EXCHANGE_URL=<exact proven relying-party exchange endpoint>
AV_HANDOFF_AUDIENCE=rydesync
```

`optional` is intentional during integration: public guest joining/PTT can continue if Identity is unavailable, while hosting, library access, and other protected actions still fail closed.

The browser handoff creates an encrypted, HttpOnly local `__session`. If the handoff provides a reusable verifier credential, RydeSync performs live Identity/AVCC verification on protected capability checks. If it does not, the local identity can still establish signed-in hosting, but capability-gated EchoVerse library browse remains fail-closed until a live verifier path exists.

See `docs/IDENTITY_INTEGRATION.md`.

## Production voice setup

PTT signaling travels over `/v1/realtime`; audio travels over WebRTC. The application tunnel is **not** a TURN relay.

Development/same-network voice can use STUN only. Reliable cellular/NAT voice requires TURN:

```env
VOICE_ENABLED=true
VOICE_MAX_PEERS=12
STUN_URLS=stun:stun.l.google.com:19302
TURN_URLS=turn:turn.example.com:3478,turns:turn.example.com:5349
TURN_USERNAME=<turn username>
TURN_CREDENTIAL=<turn credential>
```

Do not call voice production-ready until a two-phone, independent-cellular test passes. See `docs/VOICE_DEPLOYMENT.md`.

## EchoVerse model

Canonical private upstream:

```text
http://echoverse-library-api:5304
```

Public consumers use only RydeSync routes:

- `GET /v1/echoverse/catalog` — signed-in member + live `echoverse.library.listen` capability.
- `GET /v1/echoverse/audio/{track_id}` — full member media grant, direct authenticated native request, or current-room-track guest media grant.
- `GET /v1/echoverse/file/{path}` — full authorized member only; room guest grants do not unlock arbitrary files/artwork.

RydeSync synchronizes control state, not audio bytes. Each client independently streams the current track and applies the same room-clock/drift policy.

## Realtime + privacy invariants

- Room token is sent only after the WebSocket opens; never in invite or WebSocket URLs.
- Live location is opt-in and memory-only; it clears on stop, disconnect, staleness, or room expiry.
- Microphone capture is opt-in; PTT audio is never written to room state or sent as WebSocket payloads.
- A room can expose an opaque track ID without exposing the private EchoVerse upstream.
- Hosting and music control are server-enforced permissions, not UI-only hiding.

## Known alpha limitations

- Room/member/playback state is still memory-only; a server restart ends active Rydes.
- No Redis/Postgres or horizontal multi-instance coordination yet.
- TURN must be configured and field-tested on NXCore before cellular PTT is considered reliable.
- Role promotion/co-host management UI is not yet restored, so moderated classroom/campaign voice promotion is incomplete.
- Persistent crews, ride history/recaps, saved routes, push notifications and profile personalization are member roadmap features, not alpha.7 claims.
- Android source exists under `apps/android`, but a full Android SDK/APK build gate still needs to run on an Android-capable build host.

## Deployment

Production requires a durable `ROOM_TOKEN_SECRET` of at least 32 characters. Preserve it across deploys or active room/browser/media session grants will invalidate.

See:

- `docs/ARCHITECTURE.md`
- `docs/IDENTITY_INTEGRATION.md`
- `docs/VOICE_DEPLOYMENT.md`
