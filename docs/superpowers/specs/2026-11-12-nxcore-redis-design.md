# RydeSync dedicated NXCore Redis

Decision approved by Timbr in the RydeSync final-audit conversation on 2026-11-12: dedicated self-hosted Redis on NXCore, private Docker networking, AOF plus snapshot backups, live location ephemeral, and $0/month new external spending. A managed provider requires separate approval; $10 warning / $15 critical / $20 ceiling are proposed future thresholds, not authorized spending or configured provider alerts.

## System map and approved implementation

- Authority: Timbr approves the provider/budget; RydeSync remains the authority for room roles; AVCC/Identity Gateway remains the account/capability authority.
- Source: `aerovista-us/RydeSync`, main baseline `3190b5cbce297010b46abfe76cd39163feb826e9`; isolated branch `feat/nxcore-redis-durability-20261112`. NXCore deployment tooling is separately owned in `/srv/core`.
- Flow: authenticated REST/WS mutation -> serialized draft room -> lease-guarded Redis write -> publish to process memory -> response/broadcast. No memory fallback on write failure. Acknowledgement loss poisons this writer until restart/rehydration.
- Persistence: room metadata, member identity IDs/roles, join codes, lock and playback anchor/epoch. Per-room Redis TTL equals room expiry. Fixed schema projection excludes credentials, tokens, location, presence, peer connections and voice floor.
- Execution: one Node process and dedicated Redis on an internal Docker network. A renewable writer lease rejects a second process for the same namespace. This does not implement horizontal fan-out, Redis HA, or durable event replay.
- Restart: acquire lease, validate/hydrate unexpired room records, then accept traffic. Existing unexpired room tokens work because membership and the durable room-token signing secret remain consistent. Reconnect snapshots restore playback; voice/location require fresh participation.
- Failure: Redis disconnection, lease loss, uncertain commit or invalid persisted data fails closed. Storage health returns 503. No raw client errors or credentialed URLs enter logs.
- Recovery: retained original app container/image, separate Redis volume; consistent RDB backup copied outside the live volume and restored into a fresh isolated instance before acceptance. AOF everysec can lose approximately one second on host/storage failure; acknowledged commands are not a zero-data-loss promise.
- Alternatives: managed Redis adds a new bill and leaves the NXCore-only backend constraint; retaining memory costs nothing but loses rooms on restart. The approved dedicated instance provides bounded single-host durability without either change.
- Resource proposal: 256 MiB Redis maxmemory, noeviction, 512 MiB container memory; measure write/rewrite headroom before promotion. Memory warning/critical/urgent at 70/85/95 percent are local operational thresholds, distinct from spending approvals.
- Evidence: baseline 134 tests; deterministic failure/concurrency/privacy tests; real Redis token-bound restart, lease exclusion/loss, TTL, failed-write and backup/restore checks. Public/authenticated/mobile field behavior is not inferred from these tests.

## Delivery and rollout boundary

Record provider/budget decision as resolved. Storage integration and production acceptance remain engineering gates. Prepare a reviewable branch/PR and isolated pilot. Promote through the guarded NXCore deployment path only with a clean mainline artifact, required private-network wiring, and rollback evidence. Do not edit unrelated dirty worktrees, legacy runtimes, Cloudflare routes or identity configuration.
