#!/usr/bin/env python3
"""Generate private credentials/config once. Uses an operator-owned private directory; never prints secrets."""
import argparse, hashlib, os, pathlib, secrets
p = argparse.ArgumentParser()
p.add_argument('--secrets-dir', default=str(pathlib.Path.home() / '.config/aerovista/rydesync-redis'))
p.add_argument('--hostname', default='rydesync-redis')
a = p.parse_args()
if not a.hostname.replace('-', '').isalnum(): p.error('Invalid internal hostname')
root = pathlib.Path(a.secrets_dir)
root.mkdir(parents=True, exist_ok=True, mode=0o700)
credentials = {}
for role in ['rydesync', 'observer', 'operator']:
    file = root / (role + '-password')
    if not file.exists():
        file.write_text(secrets.token_urlsafe(48) + '\n')
    value = file.read_text().strip()
    if len(value) < 48: raise SystemExit('Existing credential is too short; refusing implicit rotation')
    credentials[role] = value
    os.chmod(file, 0o440)
acl = 'user default off\n'
for role, commands in [
    ('rydesync', '~rydesync:* +get +set +del +pexpire +eval +scan +ping +client|setinfo +client|setname'),
    ('observer', '+ping +info +lastsave'),
    ('operator', '~* &* +@all')
]:
    acl += 'user ' + role + ' on #' + hashlib.sha256(credentials[role].encode()).hexdigest() + ' ' + commands + '\n'
config = '''bind 0.0.0.0
protected-mode yes
port 6379
dir /data
aclfile /usr/local/etc/redis/users.acl
appendonly yes
appendfsync everysec
aof-use-rdb-preamble yes
save 900 1
save 300 10
save 60 10000
stop-writes-on-bgsave-error yes
maxmemory 256mb
maxmemory-policy noeviction
logfile ""
'''
for name, value in [('users.acl', acl), ('redis.conf', config)]:
    file = root / name
    file.write_text(value); os.chmod(file, 0o440)
# A separate fragment: the live RydeSync env is never modified by provisioning.
env = root / 'app.env'
env.write_text('ROOM_STORAGE_DRIVER=redis\nREDIS_URL=redis://rydesync:' + credentials['rydesync'] + '@' + a.hostname + ':6379/0\nREDIS_KEY_PREFIX=rydesync:v1:\nREDIS_TIMEOUT_MS=2500\nREDIS_WRITER_LEASE_MS=15000\n')
os.chmod(env, 0o600)
os.chmod(root, 0o700)
print('Redis credentials/config ready; existing passwords retained; app env fragment created separately.')
