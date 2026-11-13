# RydeSync sign-in audit and Identity Gateway upgrade

Date: 2026-11-13. Baseline: production `13af343768ac8fc057a8208d02a1d0db96257642`.

## Findings and changes

| Finding | Result |
| --- | --- |
| Sign-in already exchanges one-time codes through Identity Gateway using the RYDESYNC service HMAC identity; it is not direct Firebase login inside RydeSync. | Preserve Account as the public login surface and Gateway as the server broker. |
| Local App Adapter bridge followed the old resolve-only contract and discarded display names. | Add the v0.4 `identity.describe(sessionToken)` contract, use its live canonical ID/name/status, and keep `identity.can()` as the capability authority. |
| Encrypted legacy cookie without an upstream session could still authenticate a host. | Require live upstream verification; optional invalid sessions become unauthenticated guests. |
| Local identity was not compared with the live session identity. | Reject changed canonical identity, inactive status or a mismatched service descriptor. |
| Local cookie expiry could extend beyond a shorter upstream expiry. | Clamp to the gateway expiry; reject invalid/expired mint responses and revoke failed exchanges where possible. Default local TTL remains 900 seconds; no undocumented refresh protocol is invented. |
| Logout left the protected library-media cookie active and used GET. | Same-origin POST revokes the app session and clears browser, media and pending sign-in cookies. Local cleanup still works during upstream failure. |
| Browser identity stayed visually signed in after expiry/revocation until reload. | Recheck every minute while visible and on focus/visibility return; hide member/hosting/library controls on failed verification. Existing ride membership remains a separate room-token boundary. |
| Callback failures left a code-bearing error URL. | Redirect to a clean app recovery message, expire that attempt's state cookie, and use no-referrer on auth responses. |
| Bootstrap reported identity unconfigured because it only inspected the unused legacy bearer verifier. | Report the actual Gateway configuration and provider without exposing secrets. |

Flow: Account login → registered one-time code/state → server HMAC exchange → live Gateway describe → encrypted HttpOnly/SameSite=Lax cookie → live describe/can on authenticated HTTP requests. HTTPS deployments add Secure. Parallel sign-in state cookies and same-origin invite return paths remain supported. Raw native AVCC bearer tokens are not implicitly accepted; explicitly configured legacy non-browser verification remains separate.

Only safe identity/name/email/capability fields are projected into the existing principal contract. Gateway roles, service roles and profile labels are not authority to host as someone else or browse EchoVerse. Room host/co-host roles remain app-local. Identity-off mode also disables login initiation.

## Validation and runtime state

- Targeted security regressions cover descriptor HMAC, allow/deny, mismatch, suspension, revocation, legacy-cookie rejection, outage, expiry, failed-exchange cleanup, logout CSRF/media-cookie cleanup, clean callback recovery, mode-off and revoked-cookie Guest Join.
- Live read-only production probe: existing RYDESYNC HMAC credentials were accepted by `/v1/identity/describe`; a deliberately nonexistent synthetic session returned `authenticated:false, identity:null`. No real user token or secret was printed or changed.
- Full suite on Node 22 with an isolated private real Redis: **162/162 passed, zero skipped**. The default run without `REDIS_TEST_URL` passes 156 and skips the six Redis integrations. CI head and source promotion are recorded in the pull request. Merged source and a successful contract probe do not establish deployment or a completed real-user round trip for this revision.
- Promotion uses the canonical NXCore guarded deploy with the existing Redis env fragment/private network. The agent account cannot read the protected deployment credential files; administrator execution is required if those permissions remain unchanged. Never copy secrets from container environments or weaken the guard to deploy.

## Acceptance and limits

After promotion, renew real Account sign-in/name display, invite return, parallel sign-in, sign-out, protected library denial and public Guest Join; verify the deployed SHA and `roomStorage=redis`. Preserve the prior container until acceptance. The prior stopped pre-Redis rollback remains a separate historical restore point.

The bridge mirrors the canonical `@aerovista-us/app-adapter` v0.4 wire contract. It is not a claim that the restricted package has been installed; reproducible private-package delivery is separate. This change introduces no new identity database, provider purchase, password handling, or profile/grant mutation.

Existing short-lived media grants and room tokens are distinct from the Account session: a copied media grant may remain valid until its existing TTL, and signing out does not end a room or revoke its independent room token. Sign-out clears media cookies in the current browser; no immediate global media-token revocation is claimed. If Gateway revoke is unavailable, the upstream session remains until expiry/operator revoke even though the local cookies clear.

Physical-device microphone/GPS, cellular/Bluetooth/TURN, background PWA and multi-device music sync acceptance remain separate from this sign-in change.
