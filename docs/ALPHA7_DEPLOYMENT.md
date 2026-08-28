# Alpha.7 NXCore Deployment Checklist

Target source path:

```text
/srv/NXDrive/EchoVerse/rydesync-global-foundation
```

Alpha.7 is intended as a copy-replace upgrade over the alpha.6 foundation already field-tested for live location.

## 1. Preserve deployment secrets/config

Before replacing files:

```bash
cd /srv/NXDrive/EchoVerse/rydesync-global-foundation
cp .env /tmp/rydesync-alpha6.env.backup
```

Do not regenerate `ROOM_TOKEN_SECRET` during a routine upgrade.

## 2. Copy alpha.7 source

Replace the application files, but preserve the production `.env`. Then:

```bash
cd /srv/NXDrive/EchoVerse/rydesync-global-foundation
node -p "require('./package.json').version"
npm test
```

Expected version: `3.0.0-alpha.7`.

Expected automated result for this package: `60/60` passing.

## 3. Add alpha.7 environment values

Merge these into the existing production `.env`:

```env
AV_IDENTITY_MODE=optional
AV_IDENTITY_APP_ID=rydesync
AV_ACCOUNT_LOGIN_URL=https://account.aerocoreos.com/login
AV_HANDOFF_EXCHANGE_URL=<EXACT PROVEN ACCESS CONVERGENCE EXCHANGE ENDPOINT>
AV_HANDOFF_AUDIENCE=rydesync
AV_BROWSER_SESSION_TTL_SECONDS=900

VOICE_ENABLED=true
VOICE_MAX_PEERS=12
STUN_URLS=stun:stun.l.google.com:19302
TURN_URLS=<production TURN urls>
TURN_USERNAME=<production TURN username>
TURN_CREDENTIAL=<production TURN credential>
```

Do not guess `AV_HANDOFF_EXCHANGE_URL`. If the exact deployed path has not been located yet, leave it blank. The UI will keep guest joining live and report sign-in as not configured instead of sending users into a broken auth loop.

If TURN is not ready yet, voice can still be deployed for LAN/easy-NAT testing with the TURN fields blank, but the UI will explicitly warn that cellular fallback is not configured.

## 4. Inspect the current container before replacement

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}' | grep -i rydesync
```

Record the current container name, port mapping, network, restart policy and env-file path before changing it:

```bash
docker inspect <CURRENT_RYDESYNC_CONTAINER> > /tmp/rydesync-before-alpha7.json
```

Confirm the EchoVerse Docker network:

```bash
docker inspect echoverse-library-api \
  --format '{{range $name,$network := .NetworkSettings.Networks}}{{$name}}{{"\\n"}}{{end}}'
```

The new RydeSync container must share a network where `echoverse-library-api:5304` resolves.

## 5. Build

```bash
cd /srv/NXDrive/EchoVerse/rydesync-global-foundation
docker build --pull -t rydesync:3.0.0-alpha.7 .
```

## 6. Replace using the same proven runtime shape

Prefer reproducing the existing alpha.6 container's port/network/restart/env settings rather than inventing a second deployment pattern. If the current service is already the accepted production container, use a short controlled replacement window and retain the old image tag for rollback.

After start:

```bash
curl -sS http://127.0.0.1:9000/health
curl -sS http://127.0.0.1:9000/v1/bootstrap | jq
```

Expected health version: `3.0.0-alpha.7`.

Bootstrap should report:

- `authenticatedHosting: true`
- `pushToTalk: true`
- `turnReady: true` only when TURN is actually configured
- `identity.loginConfigured: true` only when account login + handoff exchange are both configured

## 7. Acceptance test in the public URL

Guest browser:

1. sees `Join a Ryde` + `Sign In`;
2. does **not** see `Start a Ryde`;
3. joins a valid room without AeroVista account;
4. can explicitly Enable PTT;
5. can explicitly share location;
6. can Listen with crew to the host's current track;
7. sees no shared play/pause/seek controls and cannot load the EchoVerse library.

Signed-in host browser:

1. AeroVista sign-in returns to RydeSync through one-time-code handoff;
2. `Start a Ryde` appears;
3. starts a room;
4. can Lock / End the room;
5. can use PTT;
6. can browse EchoVerse only if `echoverse.library.listen` is live in AVCC;
7. can select/play/pause/seek/clear the shared soundtrack.

## 8. PTT production gate

Run the two-independent-cellular-phone test in `VOICE_DEPLOYMENT.md`. Do not equate a same-Wi-Fi success with TURN/cellular readiness.

## 9. Rollback

Keep the alpha.6 image/tag until alpha.7 passes field acceptance. Rollback means recreating the container using the saved alpha.6 image and the same preserved `.env`/network/port shape.
