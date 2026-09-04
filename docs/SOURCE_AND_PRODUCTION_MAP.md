# RydeSync / Identity — Canonical Source and Production Map

Last reconciled: **2026-09-01**.

This is the authoritative answer to: **Which repo owns this? Which branch? Which source path is deployed? Which path is live? What is reference-only?**

For field evidence, recovery notes and cross-repository restore refs, see `PRODUCTION_ACCEPTANCE_2026-09-01.md`.

## 1. RydeSync

| Layer | Canonical location | Status |
|---|---|---|
| Product repo | `aerovista-us/RydeSync` | canonical app source |
| Alpha.7 integration branch | `upgrade/alpha7-global-foundation` | canonical current Alpha.7 line |
| Default branch | `main` | source synchronization target; production deployment is separate |
| Production source checkout | `/srv/NXDrive/EchoVerse/rydesync-global-foundation` | live-host source location |
| Public production | `https://rydesync.aerovista.us` | public origin |
| Production host binding | `127.0.0.1:8080` → container `:9000` | canonical local production bind |
| Accepted/deployed Alpha.7 SHA | `21012670ad4452bd86d1a7e7aaa2e777d60fb061` | 2026-09-01 field-accepted runtime |
| Runtime env | `/etc/acos-secrets/rydesync.env` | server-only secrets/config |
| Cloudflare tunnel config | `/etc/cloudflared/config.yml` | ingress ownership outside app repo |
| EchoVerse upstream | `http://echoverse-library-api:5304` | private canonical Library API |
| Restore ref | `restore/2026-09-01-cellular-ptt-accepted` | exact accepted RydeSync commit |

**Synchronization rule:** repository/head synchronization and production deployment are different operations. Do not infer a redeploy from a merge to `main`, documentation update, or branch movement.

## 2. Canonical Identity Gateway

| Layer | Canonical location | Status |
|---|---|---|
| Repository | `aerovista-us/ACOS` | **canonical production source** |
| Branch | `main` | production source line |
| Source path | `services/identity-gateway` | canonical service subtree |
| Live path | `/srv/ACOS/services/identity-gateway` | deployed service location |
| Public origin | `https://identity-api.aerovista.us` | public Identity Gateway |
| Local port | `3110` | service bind behind tunnel/proxy |
| Runtime env | `/etc/acos-secrets/identity-gateway.env` | server-only service configuration |
| Firebase service account | `/srv/ACOS/secrets/firebase/aerovista-us-firebase-adminsdk.json` | mounted server secret |
| Deploy source mirror | `/srv/ACOS/_deploy_source/aerovista-command-center.git` | deployment mirror |
| Deploy snapshots | `/srv/ACOS/_deploy_snapshots/identity-gateway` | rollback/source snapshots |

Broker routes consumed by RydeSync:

```text
POST /v1/handoff/exchange
POST /v1/session/resolve
POST /v1/session/revoke
POST /v1/authorization/check
```

The similarly named standalone `aerovista-us/identity-gateway` remains a **reference/extracted regression harness**, not canonical production source. Never deploy it over the ACOS service merely because its repository name appears more specific.

## 3. AVCC / authorization authority

AVCC remains the canonical identity/access authorization authority behind Identity Gateway and staff/member access. RydeSync does not infer capabilities locally from labels, account class or membership plan.

Critical current capability:

```text
echoverse.library.listen
```

Explicit live grant state is authoritative. `staff` and `member` are identity classes, not automatic EchoVerse grants.

## 4. Account and staff SSO handoff

| Layer | Canonical location | Status |
|---|---|---|
| Public Account | `https://account.aerocoreos.com/` | public/customer Account + relying-party entry |
| Staff handoff authority | `https://avcc.aerocoreos.com/api/auth/handoff/start` | Cloudflare Access-protected AVCC route |
| Staff SSO/login ecosystem | Cloudflare Access + configured staff IdP | staff identity proof |
| Accepted ACOS deployment SHA | `9f2b68842b42154349d0fc247b2e1ff9c9addad9` | Account UI + AVCC handoff accepted |
| Restore ref | `restore/2026-09-01-rydesync-account-handoff` | exact accepted ACOS commit |

RydeSync relying-party parameters:

```text
client_id=rydesync
return_to=https://rydesync.aerovista.us/auth/callback
state=<random relying-party state>
```

The AVCC route validates a registered client and exact redirect origin before issuing a short-lived, one-time, audience-bound code. Registered RydeSync origin:

```text
https://rydesync.aerovista.us
```

The 2026-09-01 guarded deployment verified that Account `staff-sso.js` is served from the pinned ACOS source and referenced by `/login`, and that `/api/auth/handoff/start` is registered behind authentication.

## 5. `member-access` and acceptance probe

| Layer | Location | Status |
|---|---|---|
| Shared middleware | `aerovista-us/member-access` | shared Cloudflare Access → identity/AVCC middleware |
| Acceptance app | `aerovista-us/member-auth-probe` | acceptance harness, not product dependency |
| Live probe | `member-probe.aerocoreos.com` | protected staff/member E2E probe |

The probe must not become a general RydeSync application dependency.

## 6. AeroCore App Adapter

| Layer | Location | Status |
|---|---|---|
| RydeSync runtime bridge | `aerovista-us/RydeSync/apps/api/lib/aerocore-app-adapter.js` | current Alpha.7 runtime integration |
| Shared TypeScript package | `aerovista-us/ACOS`, branch `feat/aerocore-app-adapter-v0`, path `packages/aerocore-app-adapter` | canonical shared-package incubation |
| Target package | consumable `@aerovista/app-adapter`-style package | target; not yet the RydeSync runtime dependency |

The local bridge remains required until shared-package publication/consumption is complete and the same RydeSync identity/adapter acceptance gates pass against it.

Current broker-facing methods:

```text
auth.exchangeHandoff(code)        -> /v1/handoff/exchange
auth.resolveSession(token)        -> /v1/session/resolve
auth.revokeSession(token)         -> /v1/session/revoke
identity.can(...)                 -> /v1/authorization/check
services.call(...)                -> registered signed service request
```

### HMAC v0.1 implementation contract

Both the RydeSync JavaScript bridge and ACOS TypeScript package currently sign:

```text
METHOD\nPATHNAME\nTIMESTAMP\nRAW_BODY
```

with HMAC-SHA256 and server-only service secret, emitting `X-AV-Service`, `X-AV-Timestamp` and `X-AV-Signature`.

Older docs that said `PATH_WITH_QUERY` / pathname + query were stale. The implementation uses pathname only. Do not change signing semantics without an explicit versioned wire-contract migration.

See `AEROCORE_APP_ADAPTER_SCHEMATIC.md`.

## 7. NXCore deployment ownership

Repository:

```text
aerovista-us/nxcore
```

Operational branch:

```text
master
```

Server checkout:

```text
/srv/core
```

**Important:** NXCore `main` and operational `master` have unrelated histories/no common ancestor. Do not merge or rebase them as a routine synchronization action.

Current accepted TURN tooling SHA:

```text
eb8471114da51fe6c20957c9b484c043c355768d
```

Restore ref:

```text
restore/2026-09-01-rydesync-turn-infra
```

Relevant operations include RydeSync deployment/verification and coturn setup/verification. TURN-specific setup intentionally treats broader Account/Traefik production verification as advisory so an unrelated web-routing issue cannot suppress the TURN-specific gate.

## 8. TURN production topology

| Layer | Accepted value |
|---|---|
| TURN hostname | `turn.aerovista.us` |
| Public IPv4 | `135.134.145.137` |
| NXCore LAN | `192.168.7.253` |
| Listener | `3478/udp` + `3478/tcp` |
| Relay ports | `49160-49415/udp` |
| coturn image | `coturn/coturn:4.17.2-r0` |
| Edge mode | DNS-only; not Cloudflare proxied |

The eero uses explicit port forwarding; UPnP was not available. The public WAN address matched TURN DNS during field acceptance.

RydeSync issues temporary room/member-scoped TURN REST credentials only after a valid room token is supplied to `POST /v1/voice/ice`. The permanent shared secret remains server-side. Credential TTL defaults to six hours and is capped by the Ryde expiration.

## 9. Current verified runtime state

Production verification after the routing repair:

```text
RydeSync production verifier: PASS
Account /login:              200
Account staff-sso.js:        verified/pinned
RydeSync public root:        200
RydeSync Traefik origin:     PASS
/admin Cloudflare Access:    protected
TURN server verifier:        PASS
```

Field UI showed a host + guest rider and:

```text
PUSH TO TALK
Ready · 1 voice peer
TURN ready · cellular fallback configured
```

Real bidirectional audible PTT succeeded with the phone on cellular. coturn observed carrier-origin connection attempts, proving public TURN listener reachability.

**Acceptance wording:**

```text
CELLULAR PTT: ACCEPTED
TURN FALLBACK: CONFIGURED / REACHABLE / SERVER-VERIFIED
FORCED RELAY MEDIA SELECTION: OPTIONAL / NOT YET PROVEN
```

Because the test did not force `iceTransportPolicy: 'relay'`, do not overstate the evidence as proof that the selected media candidate traversed TURN.

## 10. Traefik runtime preservation boundary

During the same field session, Account returned nginx 404 while the Account UI container itself was healthy. Root cause: a prior `git stash -u` under `/srv/core` had captured/removing local untracked Traefik startup/dynamic files, including the `secure-headers@file` middleware definition. Routers depending on it became invalid while the `account-deny` catch-all remained active.

Selective restoration hot-loaded the missing file-provider configuration and restored Account/RydeSync routing without a Traefik restart. Static/Compose validation then passed.

**Operational contract:** required production Traefik definitions may not remain untracked inside a Git tree where stash/clean/reset can remove them. Track canonical immutable configuration or move runtime-owned local files outside `/srv/core` and mount them explicitly. Validate required middleware/static config before Docker/Traefik restart or repository cleanup.

The current NXCore Git restore SHA does **not** by itself capture every Traefik runtime file restored from the stash; this remains the highest-priority restore-point hardening gap.

## 11. Synthetic identity matrix across layers

Shared semantic identities include:

```text
staff01     authenticated staff + EchoVerse allow
staff02     authenticated staff + EchoVerse deny
member01    authenticated member + EchoVerse allow
member02    authenticated member + EchoVerse deny
guest01     anonymous guest boundary
guest02     second guest / multi-user boundary
revoked01   allow then live revoke
stale01     identity known but authorization freshness unavailable
suspended01 AVCC account suspension
unverified01 Firebase email-not-verified gate
expired01   expired credential
unknown01   unknown credential
```

The synthetic matrix supplements, but does not replace, real Account/Access/cellular field acceptance.

## 12. Restore point

```text
RydeSync
  21012670ad4452bd86d1a7e7aaa2e777d60fb061
  restore/2026-09-01-cellular-ptt-accepted

ACOS
  9f2b68842b42154349d0fc247b2e1ff9c9addad9
  restore/2026-09-01-rydesync-account-handoff

NXCore operational master
  eb8471114da51fe6c20957c9b484c043c355768d
  restore/2026-09-01-rydesync-turn-infra
```

## 13. Canonical ownership rule

When documentation disagrees, resolve source truth in this order:

1. **Deployed runtime observation** for what is currently running.
2. **Canonical repo/subtree** named in this document for intended source.
3. **NXCore operational deployment script/pin** for how the artifact was deployed.
4. Feature/integration branch for unreleased next-state work.
5. Standalone mirrors/reference repos only as supporting evidence.

Do not infer production synchronization from filename similarity, repository name, a passing isolated unit suite, or a Git branch merge alone.
