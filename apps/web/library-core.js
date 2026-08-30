function text(value) {
  return String(value ?? '').trim();
}

export function trackKey(track) {
  return text(track?.id);
}

export function filterAndSortTracks(tracks, { query = '', artist = '', album = '', sort = 'title' } = {}) {
  const needle = text(query).toLocaleLowerCase();
  const artistFilter = text(artist);
  const albumFilter = text(album);
  const filtered = (Array.isArray(tracks) ? tracks : []).filter((track) => {
    if (!trackKey(track)) return false;
    const trackArtist = text(track.artist);
    const trackAlbum = text(track.album);
    if (artistFilter && trackArtist !== artistFilter) return false;
    if (albumFilter && trackAlbum !== albumFilter) return false;
    if (!needle) return true;
    return [track.title, track.artist, track.album].some((value) => text(value).toLocaleLowerCase().includes(needle));
  });

  const key = ['artist', 'album'].includes(sort) ? sort : 'title';
  return filtered.toSorted((a, b) => {
    const primary = text(a?.[key]).localeCompare(text(b?.[key]), undefined, { sensitivity: 'base', numeric: true });
    if (primary) return primary;
    return text(a?.title).localeCompare(text(b?.title), undefined, { sensitivity: 'base', numeric: true });
  });
}

export function paginateTracks(tracks, page = 1, pageSize = 48) {
  const size = Math.max(1, Number(pageSize) || 48);
  const total = Array.isArray(tracks) ? tracks.length : 0;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const safePage = Math.min(pageCount, Math.max(1, Number(page) || 1));
  const start = (safePage - 1) * size;
  return { page: safePage, pageCount, total, start, end: Math.min(total, start + size), items: tracks.slice(start, start + size) };
}

export function addTrackId(trackIds, trackId) {
  const id = text(trackId);
  const current = Array.isArray(trackIds) ? trackIds.filter(Boolean).map(String) : [];
  if (!id || current.includes(id)) return current;
  return [...current, id];
}

export function removeTrackId(trackIds, trackId) {
  const id = text(trackId);
  return (Array.isArray(trackIds) ? trackIds : []).map(String).filter((candidate) => candidate !== id);
}
