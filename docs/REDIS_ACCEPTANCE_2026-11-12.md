# Redis decision and isolated acceptance — 2026-11-12

## Decision

Timbr approved dedicated self-hosted NXCore Redis, private networking, AOF plus snapshot backups, ephemeral location, and $0/month in new external spending. Provider/budget decisions are resolved. No managed subscription, dollar alert or additional spend was enabled.

## Implemented and tested

- Clean baseline: canonical main/deployed app SHA `3190b5cbce297010b46abfe76cd39163feb826e9`; original suite 134/134.
- Isolated branch: `feat/nxcore-redis-durability-20261112`.
- Candidate full suite with `REDIS_TEST_URL` pointing only to the private pilot: **146/146 passed, zero skipped**. Standard no-Redis run: 142 passed and 4 explicitly skipped.
- Redis 7.4.12, immutable image digest `sha256:7f7d30b7fdd09467bac58198a1f166dd69789d348d4fe859cccb20e0cf287fbe`; official MIT node-redis 6.3.1, lockfile, npm audit reports zero vulnerabilities at installation.
- Real HTTP/WS app restart retained both token-bound members, lock, selected track and playback epoch. Guest playback remained denied. Location/voice signals were absent after reconnect and absent from persisted JSON.
- Duplicate writer rejected; stolen lease fenced; lost client connection yielded 503 health/room reads/creation; room-expiry TTL removed its Redis key.
- Consistent backup passed `redis-check-rdb`; SHA-256 `76280156cbdf7d5857ad09344692f29ef5d7d42c6d46e9452aed7ee88ae4afd3`.
- Fresh-volume RDB restore recovered host/guest token bindings, lock and playback. Enabling AOF, waiting for rewrite and restarting the restored copy retained the same fixture.
- Abrupt SIGKILL/start of the original Redis pilot retained the fixture. This was a small synthetic dataset after write propagation, not a zero-loss or capacity test.
- Separate operator/observer/application ACLs, authentication, internal-only Docker network, no host ports, noeviction, bounded memory, and 1,000-room / 128-member limits.
- Status script reports local JSON/exit states, AOF/RDB status and 70/85/95% memory thresholds. Actual pilot used approximately 1.3 MiB of its 256 MiB Redis budget at observation.

## Operational verdict: ready for isolated pilot; production promotion blocked

1. NXCore reports `vm.overcommit_memory=0`; Redis recommends 1 for background persistence operations. Remote Desktop Commander's blocked-command policy rejected `sudo`; host settings and that policy were not changed. Use the approved host-administration path to resolve this prerequisite, then measure save/rewrite headroom.
2. Canonical NXCore guarded deployment currently connects the app to only one initial Docker network. Add reviewed support for the private Redis network/env fragment while preserving mainline ancestry, secret, health and exact-container rollback guards. Do not open a Redis host port to work around this.
3. Review/merge this candidate and run guarded production acceptance. Existing physical-device/PWA/cellular/permission-recovery gates remain separate.

## Production boundary

No live RydeSync container, routing, existing app env, identity service, host kernel setting, or pre-existing Redis instance was modified/restarted. The live app remains memory-backed at `3190b5cbce29`. Local production health was observed passing; the public `/health` request from the agent network returned 403, so public-edge acceptance was not renewed. No release/readiness percentage was increased from these isolated results.

## Evidence locations

- `/tmp/rydesync-redis-baseline-20261112.log`
- `/tmp/rydesync-redis-all-enabled-20261112.log`
- `/srv/ACOS/_deploy_snapshots/rydesync-redis/20261112/backups/`
- Private synthetic recovery fixture remains in the evidence directory, excluded from source control and output.

See `REDIS_OPERATIONS.md` for repeatable commands and rollback semantics.
