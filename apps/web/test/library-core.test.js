import test from 'node:test';
import assert from 'node:assert/strict';
import { addTrackId, filterAndSortTracks, paginateTracks, removeTrackId } from '../library-core.js';

const tracks = [
  { id: '3', title: 'Night Drive', artist: 'CDA', album: 'Roads' },
  { id: '1', title: 'Blue Water', artist: 'Aero', album: 'Lake' },
  { id: '2', title: 'After Dark', artist: 'CDA', album: 'Lake' }
];

test('library search matches title, artist, and album while honoring browse filters', () => {
  assert.deepEqual(filterAndSortTracks(tracks, { query: 'lake' }).map((track) => track.id), ['2', '1']);
  assert.deepEqual(filterAndSortTracks(tracks, { artist: 'CDA' }).map((track) => track.id), ['2', '3']);
  assert.deepEqual(filterAndSortTracks(tracks, { artist: 'CDA', album: 'Lake' }).map((track) => track.id), ['2']);
});

test('library sort can pivot from title to artist', () => {
  assert.deepEqual(filterAndSortTracks(tracks, { sort: 'title' }).map((track) => track.id), ['2', '1', '3']);
  assert.deepEqual(filterAndSortTracks(tracks, { sort: 'artist' }).map((track) => track.id), ['1', '2', '3']);
});

test('library pagination clamps pages and reports visible range', () => {
  const page = paginateTracks(Array.from({ length: 101 }, (_, index) => ({ id: String(index) })), 3, 48);
  assert.equal(page.page, 3);
  assert.equal(page.pageCount, 3);
  assert.equal(page.start, 96);
  assert.equal(page.end, 101);
  assert.equal(page.items.length, 5);
});

test('playlist track helpers are idempotent and removable', () => {
  assert.deepEqual(addTrackId(['a'], 'a'), ['a']);
  assert.deepEqual(addTrackId(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(removeTrackId(['a', 'b'], 'a'), ['b']);
});
