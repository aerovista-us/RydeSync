# AeroVista Identity Integration Contract

## Status

The product is wired to an adapter, but the production verification endpoint is intentionally **not guessed**. Configure it only after the native/public application-session contract is confirmed.

## Runtime modes

- `off`: RydeSync behaves as guest-only.
- `optional` (recommended during integration): verified tokens become members; missing/unavailable identity leaves public surfaces usable as guests; protected surfaces deny.
- `required`: inability to verify identity returns `503 identity_unavailable`.

## Expected normalized principal

RydeSync internally uses:

```json
{
  "kind": "member",
  "authenticated": true,
  "identityId": "canonical-avcc-identity-id",
  "displayName": "Rider",
  "email": "optional@example.com",
  "capabilities": ["rydesync.use", "echoverse.library.listen"],
  "authState": "verified"
}
```

The adapter currently accepts common field variants (`identity_id`, `identityId`, `identity.id`) to reduce coupling during stabilization, but production should converge on one explicit contract and tests.

## Security invariants

- A bearer token is not trusted merely because it exists.
- A failed/malformed AV Identity response never creates a member principal.
- Guest continuation is allowed only on guest-capable routes.
- EchoVerse access requires an authenticated principal and explicit capability.
- The EchoVerse internal URL is server configuration and is never returned to the client.
- No Firebase service credential, AVCC credential, or upstream EchoVerse credential belongs in a browser or APK.

## Next integration step

Once the current AV Identity native-app verification/handoff endpoint is selected:

1. set `AV_IDENTITY_BASE_URL`
2. set `AV_IDENTITY_VERIFY_PATH`
3. capture a real successful response
4. replace permissive field mapping with the exact contract
5. add fixtures for valid, expired, revoked, malformed, and unavailable sessions
6. prove AVCC revocation is observed by RydeSync without restarting a room
