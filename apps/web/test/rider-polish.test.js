import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const dashboardCore = await fs.readFile(new URL('../dashboard-core.js', import.meta.url), 'utf8');
const polishJs = await fs.readFile(new URL('../rider-polish.js', import.meta.url), 'utf8');
const polishCss = await fs.readFile(new URL('../rider-polish.css', import.meta.url), 'utf8');
const swJs = await fs.readFile(new URL('../sw.js', import.meta.url), 'utf8');

test('dashboard loads the rider polish layer and PWA caches it', () => {
  assert.match(dashboardCore, /rider-polish\.js/);
  assert.match(polishJs, /rider-polish\.css/);
  assert.match(swJs, /rider-polish\.js/);
  assert.match(swJs, /rider-polish\.css/);
});

test('dashboard rider MPH reuses the canonical Map labels without a second location watcher', () => {
  assert.match(polishJs, /#crewMap \.map-label/);
  assert.match(polishJs, /#dashCrewStrip \.dashboard-crew-chip/);
  assert.match(polishJs, /#dashMiniMap \.map-label/);
  assert.match(polishJs, /MPH_PATTERN/);
  assert.match(polishJs, /MPH/);
  assert.doesNotMatch(polishJs, /watchPosition/);
});

test('rider labels and controls are larger and respect viewport safe areas', () => {
  assert.match(polishCss, /\.map-label strong\{font-size:14px/);
  assert.match(polishCss, /dashboard-mini-map \.map-label small\{display:block!important/);
  assert.match(polishCss, /safe-area-inset-top/);
  assert.match(polishCss, /safe-area-inset-bottom/);
  assert.match(polishCss, /min-height:44px/);
});
