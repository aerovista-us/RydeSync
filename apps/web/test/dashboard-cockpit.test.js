import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const dashboardJs = await fs.readFile(new URL('../dashboard.js', import.meta.url), 'utf8');
const dashboardCss = await fs.readFile(new URL('../dashboard.css', import.meta.url), 'utf8');

test('dashboard cockpit keeps the intended primary duplicate surfaces', () => {
  for (const contract of ['dashMiniMap', 'dashCrewStrip', 'dashPttButton', 'dashTransportToggle', 'dashListenToggle', 'dashboard-health']) {
    assert.match(`${dashboardJs}\n${dashboardCss}`, new RegExp(contract));
  }
});

test('dashboard controls proxy canonical room controls instead of creating a second authority', () => {
  for (const sourceId of ['talkButton', 'voiceEnable', 'playbackBack', 'playbackPlay', 'playbackPause', 'playbackForward', 'audioListenToggle', 'audioMuteToggle']) {
    assert.match(dashboardJs, new RegExp(sourceId));
  }
  assert.doesNotMatch(dashboardJs, /\/v1\/rooms\//);
  assert.doesNotMatch(dashboardJs, /type:\s*['\"]playback\./);
  assert.doesNotMatch(dashboardJs, /type:\s*['\"]voice\./);
});


test('mobile cockpit is viewport-bound and exposes speed, floating PTT, and a player drawer', () => {
  for (const contract of ['100dvh', 'dashboard-speed', 'dashboard-mode-settings', 'dashboard-mini-play', 'music-drawer-open']) {
    assert.match(`${dashboardJs}\n${dashboardCss}`, new RegExp(contract));
  }
  assert.match(dashboardCss, /body\.dashboard-active #dashboardView/);
  assert.match(dashboardCss, /overflow:hidden/);
});

test('dashboard mode preferences remain device-local and browser-permission aware', () => {
  assert.match(dashboardJs, /rydesync:mode-preferences:v1/);
  for (const mode of ['group_ride', 'listening_party', 'classroom', 'band_practice', 'campaign']) assert.match(dashboardJs, new RegExp(mode));
  assert.match(dashboardJs, /navigator\.permissions/);
  assert.match(dashboardJs, /autoPtt/);
  assert.match(dashboardJs, /autoLocation/);
});

test('dashboard speed is sourced from the canonical location watcher rather than a second geolocation authority', async () => {
  const appJs = await fs.readFile(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(appJs, /rydesync:self-location/);
  assert.match(dashboardJs, /rydesync:self-location/);
  assert.doesNotMatch(dashboardJs, /watchPosition/);
  assert.match(dashboardJs, /2\.2369362921/);
});
