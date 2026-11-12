# Dedicated NXCore Redis operations

## Decision and state

Timbr approved dedicated self-hosted Redis and **$0/month new external spend** on 2026-11-12. The decision manifest is `deploy/redis/decision.json`; design/plan are under `docs/superpowers/`. The $10/$15/$20 managed-provider figures remain a future proposal requiring separate approval.

This branch implements single-writer durable rooms, member/role bindings, locks and playback. It does not implement horizontal WebSocket fan-out, Redis HA, a durable event journal, persistent location, ride history or production promotion.

The live app remains SHA `3190b5cbce297010b46abfe76cd39163feb826e9`, memory-backed. The Redis pilot and its restored copy have no host ports and use an internal Docker network. Production deployment is gated on host persistence configuration, guarded deployment wiring, source review, and acceptance. Preserve existing physical-device/PWA/field-QA gates.

## Source and secrets

- Worktree: `/srv/ACOS/_worktrees/rydesync-redis-20261112`
- Branch: `feat/nxcore-redis-durability-20261112`
- Pilot config: `/home/glyph/.config/aerovista/rydesync-redis-pilot`
- Future production config: `/home/glyph/.config/aerovista/rydesync-redis`
- Pilot evidence/backups: `/srv/ACOS/_deploy_snapshots/rydesync-redis/20261112`
- Existing live app secrets: `/etc/acos-secrets/rydesync.env` (not modified)

Provisioning writes credentials once, retaining them on rerun. Private directories are 0700; credential/config files are 0440 for the existing operator group 1000, and the app env fragment is 0600. The container runs as UID 999/group 1000. Do not print, commit or attach any of these files. The new `app.env` is a separate fragment, not an edit to the live app env.

## Provision / validate

From the isolated worktree:

```bash
python3 scripts/provision-redis.py

docker compose -p rydesync-redis -f deploy/redis/compose.yml config --quiet
# Run only after the host prerequisite and rollout gate are satisfied:
docker compose -p rydesync-redis -f deploy/redis/compose.yml up -d
python3 scripts/redis-status.py
```

Redis image is pinned to 7.4.12's published digest. AOF everysec, automatic RDB saves, noeviction, a 256 MiB maxmemory setting and 512 MiB container limit are explicit. App/observer/operator ACLs are distinct. There is no host port mapping. App keys are restricted to `rydesync:*`; the app cannot run CONFIG, FLUSHALL, SAVE or arbitrary administrator commands.

NXCore currently has `vm.overcommit_memory=0`. Redis's production guidance recommends 1 so background save/rewrite forks can proceed. An authorized host administrator must configure and verify `vm.overcommit_memory=1` through the host's approved administration path. The available remote-command policy blocks `sudo`; this work did not change host kernel settings or weaken that policy. See https://redis.io/docs/latest/operate/oss_and_stack/management/admin/ . A tiny passing restore does not establish memory-pressure safety.

## Pilot tests

The pilot uses container `rydesync-redis-pilot`, network `rydesync-storage-pilot`, and volume `rydesync_redis_pilot_data`. Provision with `--secrets-dir /home/glyph/.config/aerovista/rydesync-redis-pilot --hostname rydesync-redis-pilot`; supply the same directory and those names through the Compose variables `RYDESYNC_REDIS_CONFIG_DIR`, `RYDESYNC_REDIS_CONTAINER`, `RYDESYNC_REDIS_NETWORK`, `RYDESYNC_REDIS_VOLUME`.

```bash
docker run --rm --network rydesync-storage-pilot \
  --env-file /home/glyph/.config/aerovista/rydesync-redis-pilot/app.env \
  -v /srv/ACOS/_worktrees/rydesync-redis-20261112:/source:ro -w /source \
  aerovista-rydesync:redis-pilot-20261112 \
  sh -c 'export REDIS_TEST_URL="$REDIS_URL"; exec npm test'
```

With no `REDIS_TEST_URL`, four integration tests are explicitly skipped; do not report them as passed. They use random `rydesync:test:*` namespaces and no production identities. `scripts/redis-recovery-fixture.js` additionally refuses a host other than `rydesync-redis-pilot` or `rydesync-redis-restore`; its fixture contains only synthetic credentials and is never committed.

## Backup and recovery

```bash
python3 scripts/redis-backup.py --container rydesync-redis-pilot \
  --output-dir /srv/ACOS/_deploy_snapshots/rydesync-redis/20261112/backups
```

The backup tool uses an authenticated replication snapshot, runs `redis-check-rdb`, copies it outside the live Docker volume with 0600 permissions, prints its SHA-256, and removes only its temporary export. A backup command alone reports `restore_tested: false`. Automatic RDB saves are configured; external backup scheduling and notification delivery are separate operational tasks and are not claimed here.

Restore into a **new isolated Docker volume** and a separately named container. Copy the chosen validated snapshot to that volume as `/data/dump.rdb`, owner 999:1000, mode 0600. Start the restored server with `deploy/redis/restore.override.yml` so `appendonly no` is used for the initial RDB load. Verify the recovered synthetic fixture/membership/token binding before changing persistence. Using the operator credential inside the restored container, enable `CONFIG SET appendonly yes`, wait for AOF rewrite completion, restart the restored container, and verify again. Do not start from an empty AOF and assume it will select an older RDB backup.

The 2026-11-12 rehearsal restored the snapshot with SHA-256 `76280156cbdf7d5857ad09344692f29ef5d7d42c6d46e9452aed7ee88ae4afd3` into `rydesync_redis_restore_data_20261112`, verified both token bindings/lock/playback, enabled and completed AOF rewrite, restarted and verified again. An abrupt SIGKILL/start of the original pilot also recovered the fixture. This proves the tested small dataset, not zero-loss storage or a loaded-host guarantee. AOF everysec may lose approximately one second after host/storage failure.

## App startup / cutover contract

`ROOM_STORAGE_DRIVER=memory` preserves existing behavior. `redis` requires a valid `REDIS_URL`, a validated prefix, a successful exclusive writer lease, and successful schema validation/hydration before listening. Reads/joins/media grants fail closed when storage is unavailable. All durable mutations commit before HTTP/WS acknowledgement; an uncertain write result requires process restart/rehydration. Room TTL is enforced in Redis and process memory. Limits: 1,000 active rooms and 128 members per room. Live location/voice/presence and room/browser/media bearer tokens are excluded from the persisted projection. Sequence numbers remain process-local; reconnect uses authoritative snapshots.

Before production promotion:

1. Resolve/verify the host memory setting and measure save/rewrite headroom.
2. Merge reviewed source. Extend the **canonical NXCore guarded deploy path** to attach the app to both its existing gateway network and `rydesync-storage`, and consume the protected storage env fragment. Current deploy tooling only accepts one initial Docker network; do not improvise a public Redis port or bypass mainline/secret/rollback guards.
3. Preserve the exact old app container/image and existing room-token signing secret. The first cutover cannot migrate active rooms from the old process memory; schedule an interruption window for those Rydes.
4. Accept the new app's health/storage mode, hosting/guest/role gates, restart recovery, outage behavior and relevant public/authenticated-device checks. The earlier public health request returned 403 from the agent's network; public-edge acceptance was not renewed here.
5. On failed acceptance, stop/remove the candidate and restore the exact preserved old app container. Keep the Redis volume for investigation. Rolling back to the old memory-only app does not preserve Redis-backed active Rydes.

## Monitoring and capacity

`python3 scripts/redis-status.py` reports memory usage, AOF/RDB status, host overcommit preflight, and the $0 new-external-spend policy. It exits 2 on warning/failure. Memory thresholds are 70/85/95%; they are distinct from dollar budgets. Output is local JSON/exit status only; no email/push notification or recurring job was configured. Redis is single-host, single-writer and private; adding another Node instance requires a separately designed realtime-coordination migration.
