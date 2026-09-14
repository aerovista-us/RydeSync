import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const bridge = await fs.readFile(new URL('../catalog-bridge.js', import.meta.url), 'utf8');
const html = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8');
const uiShell = await fs.readFile(new URL('../ui-shell.js', import.meta.url), 'utf8');

test('stale realtime rooms terminate reconnect and clean the local active session', () => {
  assert.match(bridge, /event\.code === 1006/);
  assert.match(bridge, /roomAvailability\(this\.roomRef\)/);
  assert.match(bridge, /code:\s*4010/);
  assert.match(bridge, /clearLocalRoomSession/);
  assert.match(bridge, /removeSaved:\s*true/);
});

test('forwarded WebSocket events are cloned before redispatch', () => {
  assert.match(bridge, /new Event\('open'\)/);
  assert.match(bridge, /new MessageEvent\('message'/);
  assert.match(bridge, /new Event\('error'\)/);
  assert.doesNotMatch(bridge, /dispatchEvent\(event\)/);
});

test('explicit leave closes realtime and preserves a saved room for later', () => {
  assert.match(bridge, /leave\(roomRef\)/);
  assert.match(bridge, /close\(4005, 'Left Ryde on this device'\)/);
  assert.match(bridge, /removeSaved:\s*false/);
});

test('room experience exposes active room, save, leave, and Your Rooms controls', () => {
  for (const contract of ['activeRydeCard', 'activeRydeSave', 'activeRydeLeave', 'yourRoomsSelect', 'forgetSavedRoom']) {
    assert.match(bridge, new RegExp(contract));
  }
  assert.match(bridge, /SAVED_ROOMS_KEY = 'rydesync:saved-rooms'/);
});

test('host-created rooms are kept in Your Rooms and start-a-Ryde is suppressed while active', () => {
  assert.match(bridge, /session\.member\?\.role === 'host'\) saveRoomBookmark\(session\)/);
  assert.match(bridge, /createCard\.classList\.add\('hidden'\)/);
  assert.match(bridge, /rideEmpty\.hidden = true/);
});

test('all existing room modes have an intentional presentation profile', () => {
  for (const mode of ['group_ride', 'listening_party', 'classroom', 'band_practice', 'campaign']) {
    assert.match(bridge, new RegExp(`${mode}:`));
  }
  assert.match(bridge, /body\.classList\.add\(`mode-\$\{mode\}`\)/);
  assert.match(bridge, /createHint/);
  assert.match(bridge, /roomTitle/);
  assert.match(bridge, /musicTitle/);
});


test('Room and Map are separate first-class views while sharing the same realtime authority', () => {
  assert.match(html, /data-view-target="room"[^>]*><span>03<\/span>Room<\/button>/);
  assert.match(html, /data-view-target="map"[^>]*><span>04<\/span>Map<\/button>/);
  assert.match(html, /id="roomView"[\s\S]*id="mapView"/);
  const roomStart = html.indexOf('id="roomView"');
  const mapStart = html.indexOf('id="mapView"');
  const musicStart = html.indexOf('id="musicView"');
  const roomBlock = html.slice(roomStart, mapStart);
  const mapBlock = html.slice(mapStart, musicStart);
  assert.doesNotMatch(roomBlock, /id="crewMap"|id="locationToggle"/);
  assert.match(mapBlock, /id="crewMap"/);
  assert.match(mapBlock, /id="locationToggle"/);
  assert.match(uiShell, /mapPanel/);
  assert.match(uiShell, /mapEmpty/);
  assert.match(uiShell, /map:\s*'Map'/);
});

test('active Ryde actions expose Room and Map independently', () => {
  assert.match(bridge, /activeRydeOpen/);
  assert.match(bridge, /activeRydeMap/);
  assert.match(bridge, /location\.hash = 'room'/);
  assert.match(bridge, /location\.hash = 'map'/);
});
