import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const bridge = await fs.readFile(new URL('../catalog-bridge.js', import.meta.url), 'utf8');

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


test('room and map are separate navigation surfaces with location owned by map', async () => {
  const html = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8');
  const shell = await fs.readFile(new URL('../ui-shell.js', import.meta.url), 'utf8');
  const roomStart = html.indexOf('id="roomView"');
  const mapStart = html.indexOf('id="mapView"');
  const musicStart = html.indexOf('id="musicView"');
  const roomBlock = html.slice(roomStart, mapStart);
  const mapBlock = html.slice(mapStart, musicStart);
  assert.ok(roomStart >= 0 && mapStart > roomStart && musicStart > mapStart);
  assert.doesNotMatch(roomBlock, /id="crewMap"|id="locationToggle"/);
  assert.match(mapBlock, /id="crewMap"/);
  assert.match(mapBlock, /id="locationToggle"/);
  assert.match(shell, /map:\s*'Map'/);
});
