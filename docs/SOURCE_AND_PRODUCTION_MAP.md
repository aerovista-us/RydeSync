# RydeSync / Identity — Canonical Source and Production Map

Last reconciled: **2026-08-29**.

This is the authoritative answer to: **Which repo owns this? Which branch? Which source path is deployed? Which path is live? What is reference-only?**

## 1. RydeSync

| Layer | Canonical location | Status |
|---|---|---|
| Product repo | `aerovista-us/RydeSync` | canonical app source |
| Alpha.7 integration branch | `upgrade/alpha7-global-foundation` | current Alpha.7 line; being promoted to `main` after this documentation sync |
| Default branch before reconciliation | `main` | was 18 commits behind Alpha.7; no divergent commits |
| Production source checkout | `/srv/NXDrive/EchoVerse/rydesync-global-foundation` | live-host source location |
| Public production | `https://rydesync.aerovista.us` | current public origin |
| Production host binding | `127.0.0.1:8080` → container `:9000` | tunnel target/runtime |
| Deployed Alpha.7 release SHA | `1be4b5e33c77c32014b1f9963315a3219f45d778` | deployed artifact pin |
| Current Alpha.7 source head before this docs pass | `374b3ea330c303eb371e9dc1723cc816dc7490e7` | later changes are acceptance tests/docs; runtime application code remains equivalent to deployed release |
| Production image observed | `aerovista-rydesync:1be4b5e33c77` | deployed image identity |
| Beta lane | host port `9001` | prior/parallel validation lane |
| Legacy/trial lane | host port `9000` | do not confuse with public prod bind `8080` |
| Runtime env | `/etc/acos-secrets/rydesync.env` | server-only secrets/config |
| Cloudflare tunnel config | `/etc/cloudflared/config.yml` | ingress ownership outside app repo |
| EchoVerse upstream | `http://echoverse-library-api:5304` | private canonical Library API |

**Sync definition:** repository/head synchronization and production deployment are different operations. The current repository contains post-release test/documentation commits. Do not claim production was redeployed merely because `main` is promoted.

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
| Deploy source mirror | `/srv/ACOS/_deploy_source/aerovista-command-center.git` | NXCore deployment mirror |
| Deploy snapshots | `/srv/ACOS/_deploy_snapshots/identity-gateway` | rollback/source snapshots |

Current broker routes consumed by RydeSync are implemented in this ACOS service:

- `POST /v1/handoff/exchange`
- `POST /v1/session/resolve`
- `POST /v1/session/revoke`
- `POST /v1/authorization/check`

The service also owns Firebase-facing bootstrap/profile/account routes.

### Standalone `aerovista-us/identity-gateway`

**Classification: REFERENCE / EXTRACTED MIRROR / REGRESSION HARNESS — NOT canonical production source.**

It was reconstructed/extracted from an earlier healthy production shape and now contains useful synthetic acceptance tests, but its route set has drifted from the ACOS production service. Never deploy it over ACOS merely because the repository name looks canonical.

Its synthetic acceptance PR merged at:

```text
488aaca1db1cc56536c56b724095cb92fc75b14d
```

The standalone install also reported 13 npm audit findings during CI (10 moderate, 2 high, 1 critical). That finding applies to the standalone dependency snapshot until separately reconciled with the ACOS canonical package lock; it is not evidence that the deployed canonical service has the identical audit result.

## 3. AVCC / authorization authority

AVCC remains the canonical identity/access authorization authority behind Identity Gateway and staff/member access. RydeSync does not infer capabilities locally from labels or membership plan.

Critical capability:

```text
echoverse.library.listen
```

Explicit grant state is authoritative. `staff` and `member` are identity classes, not automatic EchoVerse grants.

## 4. Account and staff SSO

| Surface | Purpose |
|---|---|
| `https://account.aerocoreos.com/` | public/customer Account, relying-party handoff source |
| `https://login.aerocoreos.com/` | staff/member SSO entry |
| Cloudflare Access | staff access enforcement / JWT layer |
| Authentik | staff IdP / stable subject |
| AVCC | canonical identity/access convergence |

Staff SSO preserves `client_id`, `return_to` and `state`, then resumes the app handoff. Staff are not silently converted into ordinary public Account identities.

## 5. `member-access` and acceptance probe

| Layer | Location | Status |
|---|---|---|
| Shared middleware | `aerovista-us/member-access` | canonical shared Cloudflare Access → Authentik → AVCC middleware |
| Latest synthetic matrix merge | `dca457fcfe60f6faf8ad179966c10327fea52239` | named staff/member/revoke/suspend/HMAC tests |
| Acceptance app | `aerovista-us/member-auth-probe` | throwaway acceptance harness |
| Live probe | `member-probe.aerocoreos.com` | protected staff/member E2E probe |

The probe is not RydeSync production and must not become a general application dependency.

## 6. AeroCore app adapter

| Layer | Location | Status |
|---|---|---|
| RydeSync runtime bridge | `aerovista-us/RydeSync/apps/api/lib/aerocore-app-adapter.js` | current Alpha.7 runtime integration |
| Shared TypeScript package | `aerovista-us/ACOS`, branch `feat/aerocore-app-adapter-v0`, path `packages/aerocore-app-adapter` | canonical shared-package incubation |
| Target package | `@aerovista/app-adapter`-style consumable shared package | target; not yet the RydeSync runtime dependency |

The runtime bridge and shared package use the same broker/HMAC model. The local bridge remains required until shared-package publication/consumption is complete and contract tests pass.

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

Operational scripts:

```text
ops/tools/deploy-identity-gateway.sh
ops/tools/deploy-rydesync-alpha7-stack.sh
```

`deploy-rydesync-alpha7-stack.sh` pins the release pair used for the controlled Alpha.7 stack deployment:

```text
Identity Gateway ACOS SHA: 411e5f56426da8ded41b6b4d902dc2676e4e7f67
RydeSync SHA:              1be4b5e33c77c32014b1f9963315a3219f45d778
```

Do not bump these pins merely to include documentation/test-only commits. Change deploy pins only as part of an intentional new runtime release and acceptance cycle.

## 8. Current verified runtime state

Observed through the user-facing Alpha.7 UI:

```text
ECHOVERSE LIBRARY
Your account does not currently have EchoVerse Library access.

PUSH TO TALK
Ready
TURN not configured · same-network voice may work
```

Interpretation:

- Account/app session path is reaching authenticated identity state.
- EchoVerse denial is a capability result, not a generic login outage.
- PTT feature/signaling bootstrap is enabled.
- STUN/easy-NAT path exists.
- TURN is not configured, so reliable cellular/NAT relay is not yet accepted.

A read-only GitHub Actions public smoke attempt was stopped at Cloudflare Browser Challenge (`403`, `server: cloudflare`, `Just a moment...`) before requests reached RydeSync. That result is an edge automation limitation, not an application failure.

## 9. Synthetic identity matrix across layers

Shared semantic identities:

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

RydeSync full suite: **69/69 pass**. Standalone Identity Gateway acceptance: **10/10 on Node 20 + 10/10 on Node 22**. `member-access` extends the same semantic matrix through signed Access JWT/JWKS and AVCC HMAC resolution.

## 10. Canonical ownership rule

When documentation disagrees, resolve source truth in this order:

1. **Deployed runtime observation** for what is currently running.
2. **Canonical repo/subtree** named in this document for intended source.
3. **NXCore operational deployment script/pin** for how the artifact was deployed.
4. Feature/integration branch for unreleased next-state work.
5. Standalone mirrors/reference repos only as supporting evidence.

Do not infer production synchronization from filename similarity, repository name, or a passing isolated unit suite.
