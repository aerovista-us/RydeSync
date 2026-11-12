#!/usr/bin/env python3
"""Read-only local status. JSON/exit code is an alert surface, not message delivery."""
import argparse, json, subprocess, pathlib
p = argparse.ArgumentParser(); p.add_argument('--container', default='rydesync-redis'); a = p.parse_args()
cmd = 'export REDISCLI_AUTH="$(cat /run/secrets/observer-password)"; exec redis-cli --user observer --raw INFO'
try:
    raw = subprocess.check_output(['docker', 'exec', a.container, 'sh', '-c', cmd], text=True, stderr=subprocess.DEVNULL, timeout=8)
    info = dict(line.split(':', 1) for line in raw.splitlines() if ':' in line and not line.startswith('#'))
    used, limit = int(info['used_memory']), int(info['maxmemory'])
    percent = round(100 * used / limit, 2) if limit else 0
    state = 'urgent' if percent >= 95 else 'critical' if percent >= 85 else 'warning' if percent >= 70 else 'ok'
    if info.get('aof_enabled') != '1' or info.get('aof_last_write_status') != 'ok' or info.get('rdb_last_bgsave_status') != 'ok': state = 'critical'
    overcommit = pathlib.Path('/proc/sys/vm/overcommit_memory').read_text().strip()
    if overcommit != '1' and state == 'ok': state = 'warning'
    result = {'host_overcommit_memory': overcommit, 'host_persistence_preflight': 'pass' if overcommit == '1' else 'requires_admin_configuration', 'status': state, 'used_memory_bytes': used, 'maxmemory_bytes': limit, 'memory_percent': percent,
        'rss_bytes': int(info['used_memory_rss']), 'aof_enabled': info['aof_enabled'] == '1',
        'aof_write_status': info['aof_last_write_status'], 'rdb_save_status': info['rdb_last_bgsave_status'],
        'new_external_spend_budget_usd_month': 0, 'notification_delivery': 'local JSON/exit status only'}
    print(json.dumps(result, sort_keys=True)); raise SystemExit(0 if state == 'ok' else 2)
except (subprocess.SubprocessError, KeyError, ValueError):
    print(json.dumps({'status': 'unavailable', 'new_external_spend_budget_usd_month': 0})); raise SystemExit(2)
