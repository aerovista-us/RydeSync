import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const libraryUi = await fs.readFile(new URL('../library-ui.js', import.meta.url), 'utf8');
const appJs = await fs.readFile(new URL('../app.js', import.meta.url), 'utf8');
const swJs = await fs.readFile(new URL('../sw.js', import.meta.url), 'utf8');

test('playlists expose an obvious shared-player start path', () => {
  assert.match(libraryUi, /Play playlist/);
  assert.match(libraryUi, /playlist-play/);
  assert.match(libraryUi, />Play now</);
  assert.match(libraryUi, /startPlaylistQueue/);
  assert.match(libraryUi, /requestTrackPlayback/);
});

test('playlist playback reuses the existing canonical room playback authority', () => {
  assert.match(libraryUi, /className = 'track-sync'/);
  assert.match(appJs, /\.track-sync/);
  assert.match(appJs, /sendPlayback\('playback\.select'/);
  assert.doesNotMatch(libraryUi, /new WebSocket/);
  assert.doesNotMatch(libraryUi, /playback\.select/);
});

test('starting a playlist arms local listening and advances on track end', () => {
  assert.match(libraryUi, /ensureLocalListening/);
  assert.match(libraryUi, /audioListenToggle\.click\(\)/);
  assert.match(libraryUi, /sharedAudio\?\.addEventListener\('ended'/);
  assert.match(libraryUi, /advanceQueue\(1\)/);
  assert.match(libraryUi, /playlistPrevious/);
  assert.match(libraryUi, /playlistNext/);
  assert.match(libraryUi, /playlistStop/);
});

test('playlist player remains host\/co-host gated and PWA refreshable', () => {
  assert.match(libraryUi, /canControlPlayback\(\)/);
  assert.match(libraryUi, /playableIds\.length && canControlPlayback\(\)/);
  assert.match(swJs, /rydesync-shell-2026-09-08-2/);
  assert.match(swJs, /\/library-ui\.js/);
});
