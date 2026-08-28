# AeroVista Identity Integration Contract

## Alpha.7 status

RydeSync now has a complete **relying-party integration boundary**, but the exact production Access Convergence exchange endpoint remains deployment configuration rather than a guessed path.

The product rule is:

```text
Guest                     Signed-in AeroVista member
  |                                 |
  +-- Join Ryde                     +-- Start Ryde
  +-- room PTT when allowed         +-- Join Ryde
  +-- opt-in location               +-- member identity
  +-- hear current shared track     +-- host/co-host music control by room role
                                    +-- EchoVerse library only with live AVCC grant
```

Authentication establishes identity. Authorization remains live/server-enforced. Room role establishes room authority.

## Proven handoff shape

RydeSync follows the AeroVista Access Convergence pattern:

```text
rydesync.aerovista.us
       |
       | /auth/login
       v
account.aerocoreos.com/login
       |
       | Firebase authenticates user
       | AeroVista/AVCC establishes canonical identity
       v
short-lived, one-time, audience-bound handoff code
       |
       | redirect back; code + state only
       v
RydeSync /auth/callback
       |
       | SERVER-SIDE exchange through Access Convergence
       v
local encrypted HttpOnly __session
```

Never put Firebase ID tokens, AVCC session tokens, service credentials or EchoVerse credentials into redirect URLs.

## Required production configuration

```env
AV_IDENTITY_MODE=optional
AV_IDENTITY_APP_ID=rydesync
AV_ACCOUNT_LOGIN_URL=https://account.aerocoreos.com/login
AV_HANDOFF_EXCHANGE_URL=<exact proven relying-party exchange endpoint>
AV_HANDOFF_AUDIENCE=rydesync
AV_HANDOFF_RETURN_PARAM=return_to
AV_HANDOFF_STATE_PARAM=state
AV_HANDOFF_AUDIENCE_PARAM=audience
AV_HANDOFF_CODE_PARAM=code
AV_BROWSER_SESSION_TTL_SECONDS=900
```

The exchange URL must come from the actual deployed AeroVista relying-party implementation. The source material proves the handoff architecture and `__session` cookie requirement, but it does not identify the exact production endpoint path, so RydeSync intentionally does not invent one.

## Optional live bearer verification adapter

RydeSync can also verify a bearer/session verifier through:

```env
AV_IDENTITY_BASE_URL=
AV_IDENTITY_VERIFY_PATH=
AV_IDENTITY_TIMEOUT_MS=2500
```

Resolution order is:

1. explicit Bearer token, if present;
2. local encrypted `__session` from the handoff.

If the local handoff session contains a reusable verifier credential, RydeSync live-verifies through AeroVista Identity for capability-gated actions. If it contains only a canonical principal snapshot, identity-only actions (such as hosting) may continue for the local session, but capability checks remain **fail closed** because the capability set is not considered fresh.

## Runtime modes

- `off`: do not attempt AeroVista identity. Guest joining remains available; member hosting/library paths are unavailable.
- `optional`: recommended during rollout. Identity outage degrades guest-capable surfaces to guest, while protected actions still deny.
- `required`: identity verification outages return `503 identity_unavailable` instead of guest continuation.

## Normalized principal

```json
{
  "kind": "member",
  "authenticated": true,
  "identityId": "canonical-avcc-identity-id",
  "displayName": "Rider",
  "email": "optional@example.com",
  "capabilities": ["echoverse.library.listen"],
  "capabilitiesFresh": true,
  "authState": "verified"
}
```

Production should ultimately converge the permissive field mapping onto one exact Identity Gateway response contract.

## Security invariants

- A token is not trusted merely because it exists.
- A malformed/rejected Identity response never becomes a member principal.
- Cross-domain callback state must match the browser's HttpOnly state cookie.
- Handoff exchange occurs server-side.
- Handoff network/timeout failure returns `503 handoff_unavailable` and does not create a session.
- `Start Ryde` requires authenticated identity server-side; hiding the UI alone is not sufficient.
- Shared playback mutation requires both authenticated identity and host/co-host role.
- EchoVerse library browse requires a fresh explicit `echoverse.library.listen` capability.
- Guest shared listening is **not** library entitlement. Its media cookie is bound to room + member + current track and is rechecked against live room playback at audio request time.
- No Firebase service credential, AVCC service credential, EchoVerse upstream credential or long-lived identity token belongs in browser-visible URLs or the APK.

## Production acceptance gate

Before declaring AeroVista sign-in live on RydeSync:

1. identify the exact existing Access Convergence issue/consume exchange path on NXCore;
2. set `AV_HANDOFF_EXCHANGE_URL` and account login URL;
3. sign in using a real AeroVista account;
4. verify callback mints `__session` and redirects back without any auth token in the URL;
5. confirm guest still sees only Join Ryde + Sign In;
6. confirm signed-in member sees Start Ryde;
7. confirm sign-out removes Start Ryde again;
8. prove library allow/deny follows live AVCC grant state;
9. prove revocation denies protected library access without granting a guest broader access.
