import { addTrackId, filterAndSortTracks, paginateTracks, removeTrackId, trackKey } from './library-core.js';

const STORAGE_KEY = 'rydesync:playlists:v1';
const PAGE_SIZE = 48;
const $ = (selector) => document.querySelector(selector);

const search = $('#librarySearch');
const artist = $('#libraryArtist');
const album = $('#libraryAlbum');
const sort = $('#librarySort');
const resultCount = $('#libraryResultCount');
const clearFilters = $('#libraryClearFilters');
const prev = $('#libraryPrev');
const next = $('#libraryNext');
const pageInfo = $('#libraryPageInfo');
const trackGrid = $('#echoverseTracks');
const playlistForm = $('#playlistCreateForm');
const playlistName = $('#playlistName');
const playlistSelect = $('#playlistSelect');
const playlistSummary = $('#playlistSummary');
const playlistTracks = $('#playlistTracks');
const playbackControls = $('#sharedPlaybackControls');

const state = {
  tracks: [],
  page: 1,
  query: '',
  artist: '',
  album: '',
  sort: 'title',
  playlists: [],
  activePlaylistId: null
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}

function loadPlaylistState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    state.playlists = Array.isArray(parsed.playlists) ? parsed.playlists.map((playlist) => ({
      id: String(playlist.id || crypto.randomUUID()),
      name: String(playlist.name || 'Untitled playlist'),
      trackIds: Array.isArray(playlist.trackIds) ? playlist.trackIds.map(String) : [],
      createdAt: playlist.createdAt || new Date().toISOString(),
      updatedAt: playlist.updatedAt || playlist.createdAt || new Date().toISOString()
    })) : [];
    state.activePlaylistId = state.playlists.some((playlist) => playlist.id === parsed.activePlaylistId)
      ? parsed.activePlaylistId
      : state.playlists[0]?.id || null;
  } catch {
    state.playlists = [];
    state.activePlaylistId = null;
  }
}

function persistPlaylists() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    version: 1,
    activePlaylistId: state.activePlaylistId,
    playlists: state.playlists
  }));
}

function activePlaylist() {
  return state.playlists.find((playlist) => playlist.id === state.activePlaylistId) || null;
}

function trackById(id) {
  return state.tracks.find((track) => trackKey(track) === String(id));
}

function uniqueValues(key) {
  return [...new Set(state.tracks.map((track) => String(track?.[key] || '').trim()).filter(Boolean))]
    .toSorted((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
}

function fillSelect(element, label, values, selected = '') {
  if (!element) return;
  element.innerHTML = `<option value="">${escapeHtml(label)}</option>${values.map((value) => `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}`;
}

function canControlPlayback() {
  return Boolean(playbackControls && !playbackControls.hidden);
}

function selectedTrackIds() {
  return new Set(activePlaylist()?.trackIds || []);
}

function renderTrackCard(track, selectedIds) {
  const id = trackKey(track);
  const title = track.title || 'Untitled track';
  const detail = [track.artist, track.album].filter(Boolean).join(' · ') || 'EchoVerse';
  const artwork = track.artworkUrl ? `<img src="${escapeHtml(track.artworkUrl)}" alt="" loading="lazy" />` : '<span>EV</span>';
  const inPlaylist = selectedIds.has(id);
  return `
    <article class="track-card" data-library-track-id="${escapeHtml(id)}">
      <div class="track-art">${artwork}</div>
      <div class="track-copy">
        <strong title="${escapeHtml(title)}">${escapeHtml(title)}</strong>
        <small title="${escapeHtml(detail)}">${escapeHtml(detail)}</small>
      </div>
      <span class="track-stream-state">Protected stream · per-rider entitlement</span>
      <div class="track-actions">
        <button type="button" class="mini track-sync" data-track-id="${escapeHtml(id)}" ${canControlPlayback() ? '' : 'disabled'}>Sync to room</button>
        <button type="button" class="mini track-playlist ${inPlaylist ? 'added' : ''}" data-track-id="${escapeHtml(id)}" ${activePlaylist() ? '' : 'disabled'}>${inPlaylist ? 'In playlist' : '+ Playlist'}</button>
      </div>
    </article>`;
}

function renderLibrary() {
  if (!state.tracks.length) return;
  const filtered = filterAndSortTracks(state.tracks, state);
  const page = paginateTracks(filtered, state.page, PAGE_SIZE);
  state.page = page.page;
  const selectedIds = selectedTrackIds();

  trackGrid.innerHTML = page.items.length
    ? page.items.map((track) => renderTrackCard(track, selectedIds)).join('')
    : '<div class="muted">No tracks match these filters.</div>';

  const from = page.total ? page.start + 1 : 0;
  resultCount.textContent = `Showing ${from.toLocaleString()}–${page.end.toLocaleString()} of ${page.total.toLocaleString()} matching tracks · ${state.tracks.length.toLocaleString()} total`;
  pageInfo.textContent = `Page ${page.page.toLocaleString()} of ${page.pageCount.toLocaleString()}`;
  prev.disabled = page.page <= 1;
  next.disabled = page.page >= page.pageCount;
  clearFilters.disabled = !(state.query || state.artist || state.album || state.sort !== 'title');
}

function renderPlaylistSelect() {
  if (!state.playlists.length) {
    playlistSelect.innerHTML = '<option value="">No playlist selected</option>';
    playlistSelect.value = '';
    return;
  }
  playlistSelect.innerHTML = state.playlists.map((playlist) => `<option value="${escapeHtml(playlist.id)}">${escapeHtml(playlist.name)} · ${playlist.trackIds.length}</option>`).join('');
  playlistSelect.value = state.activePlaylistId || state.playlists[0].id;
}

function renderPlaylist() {
  renderPlaylistSelect();
  const playlist = activePlaylist();
  if (!playlist) {
    playlistSummary.className = 'playlist-summary muted';
    playlistSummary.textContent = 'Create a playlist, then add tracks from the library.';
    playlistTracks.innerHTML = '';
    renderLibrary();
    return;
  }

  playlistSummary.className = 'playlist-summary';
  playlistSummary.innerHTML = `
    <strong>${escapeHtml(playlist.name)}</strong><br />
    ${playlist.trackIds.length.toLocaleString()} track${playlist.trackIds.length === 1 ? '' : 's'} saved on this device.
    <div class="playlist-summary-actions">
      <button id="playlistDelete" type="button" class="mini danger">Delete playlist</button>
    </div>`;

  const rows = playlist.trackIds.map((id) => ({ id, track: trackById(id) }));
  playlistTracks.innerHTML = rows.length ? rows.map(({ id, track }) => `
    <div class="playlist-track" data-playlist-track-id="${escapeHtml(id)}">
      <div>
        <strong>${escapeHtml(track?.title || id)}</strong>
        <small>${escapeHtml(track ? [track.artist, track.album].filter(Boolean).join(' · ') || 'EchoVerse' : 'Track not in current catalog')}</small>
      </div>
      <button type="button" class="mini playlist-remove" data-track-id="${escapeHtml(id)}" aria-label="Remove ${escapeHtml(track?.title || id)}">Remove</button>
    </div>`).join('') : '<div class="playlist-empty">No tracks yet. Browse the library and tap + Playlist.</div>';

  $('#playlistDelete')?.addEventListener('click', () => {
    const doomed = activePlaylist();
    if (!doomed) return;
    state.playlists = state.playlists.filter((candidate) => candidate.id !== doomed.id);
    state.activePlaylistId = state.playlists[0]?.id || null;
    persistPlaylists();
    renderPlaylist();
  });
  renderLibrary();
}

function createPlaylist(name) {
  const clean = String(name || '').trim();
  if (!clean) return;
  const playlist = {
    id: crypto.randomUUID(),
    name: clean,
    trackIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  state.playlists.unshift(playlist);
  state.activePlaylistId = playlist.id;
  persistPlaylists();
  renderPlaylist();
}

function addToActivePlaylist(trackId) {
  const playlist = activePlaylist();
  if (!playlist) return;
  const nextIds = addTrackId(playlist.trackIds, trackId);
  if (nextIds.length === playlist.trackIds.length) return;
  playlist.trackIds = nextIds;
  playlist.updatedAt = new Date().toISOString();
  persistPlaylists();
  renderPlaylist();
}

function removeFromActivePlaylist(trackId) {
  const playlist = activePlaylist();
  if (!playlist) return;
  playlist.trackIds = removeTrackId(playlist.trackIds, trackId);
  playlist.updatedAt = new Date().toISOString();
  persistPlaylists();
  renderPlaylist();
}

function acceptCatalog(body) {
  const tracks = Array.isArray(body?.tracks) ? body.tracks.filter((track) => trackKey(track)) : [];
  if (!tracks.length) return;
  state.tracks = tracks;
  state.page = 1;
  fillSelect(artist, 'All artists', uniqueValues('artist'), state.artist);
  fillSelect(album, 'All albums', uniqueValues('album'), state.album);
  for (const control of [search, artist, album, sort, clearFilters]) control.disabled = false;
  renderPlaylist();
}

search?.addEventListener('input', () => {
  state.query = search.value;
  state.page = 1;
  renderLibrary();
});
artist?.addEventListener('change', () => {
  state.artist = artist.value;
  state.page = 1;
  renderLibrary();
});
album?.addEventListener('change', () => {
  state.album = album.value;
  state.page = 1;
  renderLibrary();
});
sort?.addEventListener('change', () => {
  state.sort = sort.value;
  state.page = 1;
  renderLibrary();
});
clearFilters?.addEventListener('click', () => {
  state.query = '';
  state.artist = '';
  state.album = '';
  state.sort = 'title';
  state.page = 1;
  search.value = '';
  artist.value = '';
  album.value = '';
  sort.value = 'title';
  renderLibrary();
});
prev?.addEventListener('click', () => {
  state.page = Math.max(1, state.page - 1);
  renderLibrary();
  trackGrid.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
next?.addEventListener('click', () => {
  state.page += 1;
  renderLibrary();
  trackGrid.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
playlistForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  createPlaylist(playlistName.value);
  playlistName.value = '';
});
playlistSelect?.addEventListener('change', () => {
  state.activePlaylistId = playlistSelect.value || null;
  persistPlaylists();
  renderPlaylist();
});
trackGrid?.addEventListener('click', (event) => {
  const button = event.target.closest?.('.track-playlist');
  if (!button || button.disabled) return;
  addToActivePlaylist(button.dataset.trackId);
});
playlistTracks?.addEventListener('click', (event) => {
  const button = event.target.closest?.('.playlist-remove');
  if (!button) return;
  removeFromActivePlaylist(button.dataset.trackId);
});

new MutationObserver(() => {
  if (state.tracks.length) renderLibrary();
}).observe(playbackControls, { attributes: true, attributeFilter: ['hidden'] });

window.addEventListener('rydesync:catalog', (event) => acceptCatalog(event.detail));
loadPlaylistState();
renderPlaylist();
if (window.__rydesyncCatalog) acceptCatalog(window.__rydesyncCatalog);
