# NXCore Redis implementation plan

Goal: turn the approved $0 external-spend provider decision into a recoverable single-writer room store.

Architecture: retain RoomStore's synchronous domain API for existing tests; add a durable serialized adapter and official node-redis repository. Inject the initialized store into the HTTP/realtime app. Redis commits precede responses and broadcasts.

Tech stack: Node 22+, node-redis 6.3.1 (MIT), dedicated Redis 7.4, Docker Compose.

## Global constraints

Private Redis only; $0 new external spend; no coordinates/voice/credentials in persistence; no memory fallback after failure; preserve identity/room-role gates; no horizontal-scaling claim; no changes to unrelated dirty checkouts.

## Tasks

- [x] Inspect deployed SHA, canonical source/branch, routing and memory-only room contract; create isolated clean worktree; run baseline `npm test` (134 passing).
- [x] Write failing `apps/api/test/durable-rooms.test.js`; implement `apps/api/lib/durable-rooms.js` and RoomStore playback update. Check commit-before-publish, no grant on failed write, concurrent joins/epoch conflict, recovery/privacy/expiry.
- [x] Implement lease-guarded `apps/api/lib/redis-room-repository.js`; validate config, inject async startup store, await REST/WS durable mutations and fail closed on storage outage. Run original plus new tests.
- [x] Pin official client in package/lock and install dependencies in Dockerfile. Add dedicated private Redis Compose/config/decision manifest and repeatable health/backup tooling.
- [x] Run isolated Redis HTTP/WS restart, lease exclusion/loss, TTL and outage tests. Restore a snapshot into a fresh isolated volume and verify token-bound room state; inspect AOF contents for prohibited ephemeral fields.
- [x] Inspect complete diff, secret boundaries, rollback and operational status. Commit/push branch and create reviewable PR with precise evidence. Keep current app deployment separate from source review and persistence pilot.
