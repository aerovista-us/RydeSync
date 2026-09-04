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
