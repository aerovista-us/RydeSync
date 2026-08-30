# Alpha.7 NXCore Deployment / Reconciliation Checklist

This document distinguishes **repository synchronization** from **production deployment**.

## Canonical locations

```text
RydeSync repo:          aerovista-us/RydeSync
Production source:      /srv/NXDrive/EchoVerse/rydesync-global-foundation
Public URL:             https://rydesync.aerovista.us
Prod host bind:         127.0.0.1:8080 -> container :9000
Runtime env:            /etc/acos-secrets/rydesync.env
Canonical Identity:     aerovista-us/ACOS/main/services/identity-gateway
Identity live path:     /srv/ACOS/services/identity-gateway
Identity origin:        https://identity-api.aerovista.us
Deployment orchestration: aerovista-us/nxcore branch master
```

Current controlled Alpha.7 stack pins in NXCore:

```text
Identity Gateway ACOS SHA: 411e5f56426da8ded41b6b4d902dc2676e4e7f67
RydeSync release SHA:      1be4b5e33c77c32014b1f9963315a3219f45d778
```

Post-release RydeSync changes before this documentation reconciliation are acceptance tests/docs; do not bump production pins just to follow documentation commits.

## Automated gate

```bash
npm test
```

Expected current Alpha.7 result: **69/69 passing**. The PR workflow also validates the production Docker Compose configuration.

## Required production environment shape

```env
AV_IDENTITY_MODE=optional
AV_IDENTITY_APP_ID=rydesync
AV_ACCOUNT_LOGIN_URL=https://account.aerocoreos.com/login
AV_IDENTITY_GATEWAY_ORIGIN=https://identity-api.aerovista.us
AV_IDENTITY_SERVICE_SECRET=<server-only secret>
AV_BROWSER_SESSION_TTL_SECONDS=900

VOICE_ENABLED=true
VOICE_MAX_PEERS=12
STUN_URLS=stun:stun.l.google.com:19302
TURN_URLS=
TURN_USERNAME=
TURN_CREDENTIAL=
```

The old `AV_HANDOFF_EXCHANGE_URL=<guess>` step is retired. Broker path mapping is owned by the app adapter (`/v1/handoff/exchange`, session resolve/revoke, authorization check).

## Deployment procedure

Prefer the NXCore operational tooling rather than hand-recreating the runtime:

```text
/srv/core
repo: aerovista-us/nxcore
branch: master
ops/tools/deploy-rydesync-alpha7-stack.sh
```

The stack script sequences secret provisioning, canonical ACOS Identity Gateway deployment, RydeSync deployment and acceptance. `ops/tools/deploy-identity-gateway.sh` deploys from the ACOS subtree; the standalone `aerovista-us/identity-gateway` repo is not a production deploy source.

Before any new runtime release:

1. preserve `ROOM_TOKEN_SECRET` and existing production env;
2. record existing container/image/ports/network;
3. verify the candidate source SHA and tests;
4. ensure RydeSync can resolve `echoverse-library-api:5304` on the required Docker network;
5. build/tag an intentional new image;
6. perform controlled replace using the proven bind/network/restart shape;
7. verify local health/bootstrap and public application behavior;
8. retain the previous image/source pin for rollback.

## Public acceptance

Guest:

- sees Join + Sign In, not Start;
- can join a valid room without Account;
- can opt into location and permitted PTT;
- can hear only the current shared track;
- cannot browse EchoVerse or mutate shared playback.

Signed-in member/host:

- Account handoff returns through one-time code/state and creates local encrypted `__session`;
- Start Ryde appears and server accepts room creation;
- host can Lock/End;
- host/co-host can mutate shared playback;
- EchoVerse browse follows live `echoverse.library.listen` allow/deny/revoke state.

## Current observed runtime state

```text
ECHOVERSE LIBRARY
Your account does not currently have EchoVerse Library access.

PUSH TO TALK
Ready
TURN not configured · same-network voice may work
```

This proves useful application state but does not replace a full deployment acceptance record. The library message is an authorization result; PTT is enabled but WAN/cellular relay is not accepted until TURN is configured.

## PTT gate

Run `VOICE_DEPLOYMENT.md` with two independent cellular clients. Same-Wi-Fi success is a baseline, not TURN proof.

## Repository sync vs production sync

- **Repo sync:** Alpha.7 changes are integrated to the repository/default branch and all docs/tests agree.
- **Runtime-code equivalence:** current repo runtime code can be equivalent to deployed release while later commits are docs/tests only.
- **Production sync:** a new artifact is actually built/deployed and the deployed SHA/image/pin is updated and accepted.

Only claim the third state after an intentional deployment.
