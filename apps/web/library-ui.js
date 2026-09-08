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
const audioListenToggle = $('#audioListenToggle');
const sharedAudio = $('#sharedAudio');

const state = {
  tracks: [],
  page: 1,
  query: '',
  artist: '',
  album: '',
  sort: 'title',
  playlists: [],
  activePlaylistId: null,
  queue: {
    playlistId: null,
    trackIds: [],
    index: -1,
    active: false
  }
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

function playableTrackIds(playlist = activePlaylist()) {
  if (!playlist) return [];
  return playlist.trackIds.filter((id) => Boolean(trackById(id)));
}

function ensureLocalListening() {
  if (!audioListenToggle || audioListenToggle.disabled) return;
  if (/listen with crew/i.test(audioListenToggle.textContent || '')) audioListenToggle.click();
}

function requestTrackPlayback(trackId) {
  const id = String(trackId || '');
  if (!id || !canControlPlayback()) return false;

  ensureLocalListening();
  const existing = [...trackGrid.querySelectorAll('.track-sync')].find((button) => button.dataset.trackId === id && !button.disabled);
  if (existing) {
    existing.click();
    return true;
  }

  const bridge = document.createElement('button');
  bridge.type = 'button';
  bridge.className = 'track-sync';
  bridge.dataset.trackId = id;
  bridge.hidden = true;
  trackGrid.appendChild(bridge);
  bridge.click();
  bridge.remove();
  return true;
}

function clearRoomPlayback() {
  const clear = $('#playbackClear');
  if (clear && !clear.disabled) clear.click();
}

function stopQueue({ clearRoom = false } = {}) {
  state.queue = { playlistId: null, trackIds: [], index: -1, active: false };
  if (clearRoom) clearRoomPlayback();
}

function playQueueIndex(index) {
  if (!state.queue.active || index < 0 || index >= state.queue.trackIds.length) return false;
  const trackId = state.queue.trackIds[index];
  if (!requestTrackPlayback(trackId)) return false;
  state.queue.index = index;
  renderPlaylist();
  return true;
}

function startPlaylistQueue(startTrackId = null) {
  const playlist = activePlaylist();
  const trackIds = playableTrackIds(playlist);
  if (!playlist || !trackIds.length || !canControlPlayback()) return false;
  let index = startTrackId ? trackIds.indexOf(String(startTrackId)) : 0;
  if (index < 0) index = 0;
  state.queue = { playlistId: playlist.id, trackIds, index, active: true };
  return playQueueIndex(index);
}

function advanceQueue(delta = 1) {
  if (!state.queue.active || !state.queue.trackIds.length) return false;
  const nextIndex = state.queue.index + Number(delta || 0);
  if (nextIndex < 0) return playQueueIndex(0);
  if (nextIndex >= state.queue.trackIds.length) {
    stopQueue({ clearRoom: true });
    renderPlaylist();
    return false;
  }
  return playQueueIndex(nextIndex);
}

function queueStatus(playlist) {
  if (!state.queue.active || state.queue.playlistId !== playlist?.id) return '';
  const currentId = state.queue.trackIds[state.queue.index];
  const current = trackById(currentId);
  return `<div class="playlist-flash">Queued ${state.queue.index + 1} of ${state.queue.trackIds.length} · ${escapeHtml(current?.title || currentId)}</div>`;
}

function installPlayerPlaylistControls() {
  if ($('#playlistPlayerControls')) return;
  const playbackPanel = playbackControls?.closest('.playback-panel');
  if (!playbackPanel) return;
  const surface = document.createElement('div');
  surface.id = 'playlistPlayerControls';
  surface.className = 'playlist-summary';
  surface.innerHTML = `
    <div class="card-kicker">PLAYLIST QUEUE</div>
    <label>Playlist<select id="playerPlaylistSelect" aria-label="Playlist to play"></select></label>
    <div class="playlist-summary-actions">
      <button id="playerPlaylistPlay" type="button" class="mini">Play playlist</button>
      <button id="playerPlaylistPrevious" type="button" class="mini secondary">Previous</button>
      <button id="playerPlaylistNext" type="button" class="mini secondary">Next</button>
      <button id="playerPlaylistStop" type="button" class="mini secondary">Stop queue</button>
    </div>
    <small id="playerPlaylistStatus" class="playback-meta">Choose a playlist to queue in the shared player.</small>`;
  const listenerControls = playbackPanel.querySelector('.listener-controls');
  if (listenerControls) listenerControls.before(surface);
  else playbackPanel.appendChild(surface);

  $('#playerPlaylistSelect')?.addEventListener('change', (event) => {
    state.activePlaylistId = event.currentTarget.value || null;
    persistPlaylists();
    renderPlaylist();
  });
  $('#playerPlaylistPlay')?.addEventListener('click', () => startPlaylistQueue());
  $('#playerPlaylistPrevious')?.addEventListener('click', () => advanceQueue(-1));
  $('#playerPlaylistNext')?.addEventListener('click', () => advanceQueue(1));
  $('#playerPlaylistStop')?.addEventListener('click', () => {
    stopQueue();
    renderPlaylist();
  });
}

function renderPlayerPlaylistControls() {
  const select = $('#playerPlaylistSelect');
  const play = $('#playerPlaylistPlay');
  const previous = $('#playerPlaylistPrevious');
  const nextButton = $('#playerPlaylistNext');
  const stop = $('#playerPlaylistStop');
  const status = $('#playerPlaylistStatus');
  if (!select || !play || !previous || !nextButton || !stop || !status) return;

  const playlist = activePlaylist();
  if (!state.playlists.length) {
    select.innerHTML = '<option value="">No playlists yet</option>';
    select.value = '';
    select.disabled = true;
  } else {
    select.disabled = false;
    select.innerHTML = state.playlists.map((candidate) => `<option value="${escapeHtml(candidate.id)}">${escapeHtml(candidate.name)} · ${candidate.trackIds.length}</option>`).join('');
    select.value = state.activePlaylistId || state.playlists[0].id;
  }

  const playableIds = playableTrackIds(playlist);
  const queueActive = Boolean(state.queue.active);
  play.disabled = !playlist || !playableIds.length || !canControlPlayback();
  play.textContent = queueActive && state.queue.playlistId === playlist?.id ? 'Restart playlist' : 'Play playlist';
  previous.disabled = !queueActive || !canControlPlayback();
  nextButton.disabled = !queueActive || !canControlPlayback();
  stop.disabled = !queueActive;

  if (queueActive) {
    const queuedPlaylist = state.playlists.find((candidate) => candidate.id === state.queue.playlistId);
    const currentId = state.queue.trackIds[state.queue.index];
    const current = trackById(currentId);
    status.textContent = `${queuedPlaylist?.name || 'Playlist'} · ${state.queue.index + 1}/${state.queue.trackIds.length} · ${current?.title || currentId}`;
  } else if (!playlist) {
    status.textContent = 'Create a playlist, then queue it here.';
  } else if (!canControlPlayback()) {
    status.textContent = 'Host or co-host playback control is required to start this playlist.';
  } else if (!playableIds.length) {
    status.textContent = 'This playlist has no tracks available in the current EchoVerse catalog.';
  } else {
    status.textContent = `${playableIds.length} playable track${playableIds.length === 1 ? '' : 's'} ready to queue.`;
  }
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
        <button type="button" class="mini track-sync" data-track-id="${escapeHtml(id)}" title="Play now in the shared Ryde player" ${canControlPlayback() ? '' : 'disabled'}>Play now</button>
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
  renderPlayerPlaylistControls();
  const playlist = activePlaylist();
  if (!playlist) {
    playlistSummary.className = 'playlist-summary muted';
    playlistSummary.textContent = 'Create a playlist, then add tracks from the library.';
    playlistTracks.innerHTML = '';
    renderLibrary();
    return;
  }

  const playableIds = playableTrackIds(playlist);
  const queueActive = state.queue.active && state.queue.playlistId === playlist.id;
  playlistSummary.className = 'playlist-summary';
  playlistSummary.innerHTML = `
    <strong>${escapeHtml(playlist.name)}</strong><br />
    ${playlist.trackIds.length.toLocaleString()} track${playlist.trackIds.length === 1 ? '' : 's'} saved on this device.
    ${queueStatus(playlist)}
    <div class="playlist-summary-actions">
      <button id="playlistPlay" type="button" class="mini" ${playableIds.length && canControlPlayback() ? '' : 'disabled'}>${queueActive ? 'Restart playlist' : 'Play playlist'}</button>
      ${queueActive ? '<button id="playlistPrevious" type="button" class="mini secondary">Previous</button><button id="playlistNext" type="button" class="mini secondary">Next</button><button id="playlistStop" type="button" class="mini secondary">Stop queue</button>' : ''}
      <button id="playlistDelete" type="button" class="mini danger">Delete playlist</button>
    </div>`;

  const rows = playlist.trackIds.map((id) => ({ id, track: trackById(id) }));
  playlistTracks.innerHTML = rows.length ? rows.map(({ id, track }) => `
    <div class="playlist-track" data-playlist-track-id="${escapeHtml(id)}">
      <div>
        <strong>${escapeHtml(track?.title || id)}</strong>
        <small>${escapeHtml(track ? [track.artist, track.album].filter(Boolean).join(' · ') || 'EchoVerse' : 'Track not in current catalog')}</small>
      </div>
      <div class="track-actions">
        <button type="button" class="mini playlist-play" data-track-id="${escapeHtml(id)}" ${track && canControlPlayback() ? '' : 'disabled'}>Play</button>
        <button type="button" class="mini playlist-remove" data-track-id="${escapeHtml(id)}" aria-label="Remove ${escapeHtml(track?.title || id)}">Remove</button>
      </div>
    </div>`).join('') : '<div class="playlist-empty">No tracks yet. Browse the library and tap + Playlist.</div>';

  $('#playlistPlay')?.addEventListener('click', () => startPlaylistQueue());
  $('#playlistPrevious')?.addEventListener('click', () => advanceQueue(-1));
  $('#playlistNext')?.addEventListener('click', () => advanceQueue(1));
  $('#playlistStop')?.addEventListener('click', () => {
    stopQueue();
    renderPlaylist();
  });
  $('#playlistDelete')?.addEventListener('click', () => {
    const doomed = activePlaylist();
    if (!doomed) return;
    if (state.queue.playlistId === doomed.id) stopQueue({ clearRoom: false });
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
  const play = event.target.closest?.('.playlist-play');
  if (play && !play.disabled) {
    startPlaylistQueue(play.dataset.trackId);
    return;
  }
  const remove = event.target.closest?.('.playlist-remove');
  if (!remove) return;
  removeFromActivePlaylist(remove.dataset.trackId);
});
sharedAudio?.addEventListener('ended', () => {
  if (state.queue.active && canControlPlayback()) advanceQueue(1);
});

new MutationObserver(() => {
  if (state.tracks.length) renderPlaylist();
}).observe(playbackControls, { attributes: true, attributeFilter: ['hidden'] });

window.addEventListener('rydesync:catalog', (event) => acceptCatalog(event.detail));
installPlayerPlaylistControls();
loadPlaylistState();
renderPlaylist();
if (window.__rydesyncCatalog) acceptCatalog(window.__rydesyncCatalog);
