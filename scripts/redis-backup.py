#!/usr/bin/env python3
"""Export a consistent RDB, validate it and copy outside the live volume."""
import argparse, datetime, hashlib, json, os, pathlib, subprocess, uuid
p = argparse.ArgumentParser(); p.add_argument('--container', default='rydesync-redis'); p.add_argument('--output-dir', required=True); a = p.parse_args()
root = pathlib.Path(a.output_dir); root.mkdir(parents=True, exist_ok=True, mode=0o700)
os.chmod(root, 0o700)
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
name = 'backup-' + uuid.uuid4().hex + '.rdb'
remote = '/data/' + name
out = root / ('rydesync-redis-' + stamp + '-' + name)
command = 'export REDISCLI_AUTH="$(cat /run/secrets/operator-password)"; exec redis-cli --user operator --rdb ' + remote
try:
    subprocess.run(['docker', 'exec', a.container, 'sh', '-c', command], check=True, capture_output=True, timeout=90)
    subprocess.run(['docker', 'exec', a.container, 'redis-check-rdb', remote], check=True, capture_output=True, timeout=30)
    subprocess.run(['docker', 'cp', a.container + ':' + remote, str(out)], check=True, capture_output=True, timeout=30)
    os.chmod(out, 0o600)
    print(json.dumps({'status': 'backup_validated', 'path': str(out), 'sha256': hashlib.sha256(out.read_bytes()).hexdigest(), 'restore_tested': False}))
finally:
    subprocess.run(['docker', 'exec', a.container, 'rm', '-f', remote], check=False, capture_output=True, timeout=10)
