import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const readWeb = (name) => fs.readFile(new URL(`../${name}`, import.meta.url), 'utf8');
const readApi = (name) => fs.readFile(new URL(`../../api/lib/${name}`, import.meta.url), 'utf8');

test('release bootstrap provides deterministic clean reload and stale-release detection', async () => {
  const boot = await readWeb('release-bootstrap.js');
  assert.match(boot, /RELEASE_ID = '2026-09-21\.1'/);
  assert.match(boot, /CLEAN_PARAM = '_ryde_clean'/);
  assert.match(boot, /registration\.unregister\(\)/);
  assert.match(boot, /key\.startsWith\('rydesync-shell-'\)/);
  assert.match(boot, /cleanReload\('new-release-detected'\)/);
  assert.match(boot, /fetch\(`\/release-bootstrap\.js\?probe=/);
  assert.match(boot, /cache: 'no-store'/);
});

test('mobile Dashboard navigation is hard-bounded to the bottom bar', async () => {
  const boot = await readWeb('release-bootstrap.js');
  assert.match(boot, /body\.dashboard-active \.app-nav/);
  assert.match(boot, /inset:auto 0 0 0!important/);
  assert.match(boot, /top:auto!important/);
  assert.match(boot, /max-height:calc\(60px \+ env\(safe-area-inset-bottom\)\)!important/);
  assert.match(boot, /overflow-y:hidden!important/);
});

test('device setup centralizes account, microphone, location, audio, refresh, and resync', async () => {
  const boot = await readWeb('release-bootstrap.js');
  for (const expected of [
    'Device setup',
    'AeroVista account',
    'Microphone / PTT',
    'Location sharing',
    'Crew audio',
    'Connection & music sync',
    'Refresh app',
    'Resync'
  ]) assert.match(boot, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(boot, /navigator\.permissions\?\.query/);
  assert.match(boot, /controlButton\('voiceEnable'\)/);
  assert.match(boot, /controlButton\('locationToggle'\)/);
  assert.match(boot, /controlButton\('audioListenToggle'\)/);
  assert.match(boot, /controlButton\('rtRefresh'\)/);
  assert.match(boot, /Opening secure sign-in/);
  assert.doesNotMatch(boot, /rydeReadyEnableAll/);
});

test('device setup is discoverable once and gives denied permissions a recovery path', async () => {
  const boot = await readWeb('release-bootstrap.js');
  assert.match(boot, /READY_SEEN_KEY = 'rydesync:device-ready-seen'/);
  assert.match(boot, /if \(!hasSeenDeviceReady\(\)\) setTimeout\(openPanel, 450\)/);
  assert.match(boot, /Fix permission/);
  assert.match(boot, /Blocked by browser\/site settings/);
  assert.match(boot, /Device ready' : 'Device setup'/);
});

test('resync refreshes canonical room state without changing crew audio', async () => {
  const boot = await readWeb('release-bootstrap.js');
  const handler = boot.match(/document\.getElementById\('rydeReadyResync'\)[\s\S]*?document\.getElementById\('rydeReadyCleanReload'\)/)?.[0] || '';
  assert.match(handler, /controlButton\('rtRefresh'\)/);
  assert.doesNotMatch(handler, /audioListenToggle/);
  assert.match(handler, /without changing your audio setting/);
});

test('login errors are surfaced in device setup and removed from the URL after handling', async () => {
  const boot = await readWeb('release-bootstrap.js');
  assert.match(boot, /url\.searchParams\.delete\('login_error'\)/);
  assert.match(boot, /This sign-in attempt is stale/);
  assert.match(boot, /panel\.hidden = false/);
  assert.match(boot, /markDeviceReadySeen\(\)/);
  assert.match(boot, /history\.replaceState\(history\.state, '', url\)/);
});

test('shared playback defaults favor tighter synchronization without removing environment overrides', async () => {
  const config = await readApi('config.js');
  assert.match(config, /PLAYBACK_SYNC_INTERVAL_MS', 1500/);
  assert.match(config, /PLAYBACK_SOFT_DRIFT_MS', 100/);
  assert.match(config, /PLAYBACK_HARD_DRIFT_MS', 500/);
  assert.match(config, /intEnv\('PLAYBACK_SYNC_INTERVAL_MS'/);
});

test('service worker cache advances with the device-setup UX release', async () => {
  const sw = await readWeb('sw.js');
  assert.match(sw, /rydesync-shell-2026-09-21-1/);
  assert.doesNotMatch(sw, /release-bootstrap\.js[',]/);
});
