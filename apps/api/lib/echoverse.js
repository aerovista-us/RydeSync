import { HttpError } from './http.js';

const SAFE_FORWARD_HEADERS = ['accept', 'if-none-match', 'if-modified-since', 'range'];
const SAFE_RESPONSE_HEADERS = ['accept-ranges', 'cache-control', 'content-length', 'content-range', 'content-type', 'etag', 'last-modified'];

function timeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

function safeTrackId(value) {
  const id = String(value || '').trim();
  if (!id || id.length > 240 || /[\0\r\n]/.test(id)) {
    throw new HttpError(400, 'invalid_track_id', 'Track ID is invalid');
  }
  return id;
}

function normalizeName(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return value.name ?? value.title ?? null;
  return null;
}

function rewriteFileUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  if (value.startsWith('/api/file/')) return `/v1/echoverse/file/${value.slice('/api/file/'.length)}`;
  return null;
}

export function normalizeCatalogTrack(track) {
  if (!track || typeof track !== 'object') return null;
  const id = track.track_id ?? track.trackId ?? track.id ?? null;
  if (id == null) return null;
  const normalizedId = String(id);
  return {
    id: normalizedId,
    title: normalizeName(track.track) ?? normalizeName(track.title) ?? normalizeName(track.name) ?? 'Untitled track',
    artist: normalizeName(track.artist),
    album: normalizeName(track.album),
    artworkUrl: rewriteFileUrl(track.artwork_url ?? track.artworkUrl ?? track.cover_url ?? track.coverUrl ?? null),
    streamUrl: `/v1/echoverse/audio/${encodeURIComponent(normalizedId)}`
  };
}

export function normalizeCatalogPayload(payload) {
  const sourceTracks = Array.isArray(payload) ? payload
    : Array.isArray(payload?.tracks) ? payload.tracks
      : Array.isArray(payload?.items) ? payload.items
        : null;
  if (!sourceTracks) {
    throw new HttpError(502, 'echoverse_contract_error', 'EchoVerse catalog response did not contain a track list');
  }
  const tracks = sourceTracks.map(normalizeCatalogTrack).filter(Boolean);
  return {
    contract: 'rydesync-catalog-v1',
    source: 'echoverse-library-api',
    total: Number.isFinite(payload?.total) ? payload.total : tracks.length,
    tracks
  };
}

function upstreamBase(config) {
  let url;
  try { url = new URL(config.echoverse.libraryApiUrl); }
  catch { throw new HttpError(503, 'echoverse_unconfigured', 'EchoVerse Library API URL is invalid'); }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new HttpError(503, 'echoverse_unconfigured', 'EchoVerse Library API must use HTTP or HTTPS');
  }
  return url;
}

function upstreamUrl(config, pathname, search = '') {
  const base = upstreamBase(config);
  const url = new URL(pathname, `${base.origin}/`);
  url.search = search;
  return url;
}

function requestHeaders(req, config, { binary = false } = {}) {
  const headers = new Headers();
  for (const name of SAFE_FORWARD_HEADERS) {
    const value = req.headers[name];
    if (value) headers.set(name, value);
  }
  if (!binary) headers.set('accept', 'application/json');
  if (config.echoverse.serviceToken) headers.set('authorization', `Bearer ${config.echoverse.serviceToken}`);
  return headers;
}

async function upstreamFetch(req, config, pathname, { search = '', binary = false } = {}) {
  const timer = timeoutSignal(config.echoverse.timeoutMs);
  try {
    return await fetch(upstreamUrl(config, pathname, search), {
      method: 'GET',
      headers: requestHeaders(req, config, { binary }),
      redirect: 'manual',
      signal: timer.signal
    });
  } catch (error) {
    const detail = error?.name === 'AbortError' ? 'timeout' : 'network_error';
    throw new HttpError(502, 'echoverse_unavailable', 'EchoVerse Library API is unavailable', { cause: detail });
  } finally {
    timer.clear();
  }
}

function mapUpstreamError(response) {
  if (response.status === 404) return new HttpError(404, 'echoverse_not_found', 'EchoVerse resource was not found');
  if (response.status === 401 || response.status === 403) {
    return new HttpError(502, 'echoverse_upstream_auth_failed', 'RydeSync could not authenticate to the private EchoVerse upstream');
  }
  return new HttpError(502, 'echoverse_upstream_error', `EchoVerse Library API returned HTTP ${response.status}`);
}

export async function fetchCatalog(req, config) {
  const requestUrl = new URL(req.url, config.publicBaseUrl);
  const allowed = new URLSearchParams();
  for (const key of ['q', 'artist', 'album', 'genre', 'sort', 'limit', 'offset']) {
    for (const value of requestUrl.searchParams.getAll(key)) allowed.append(key, value);
  }
  const response = await upstreamFetch(req, config, '/api/catalog', { search: allowed.toString() });
  if (!response.ok) throw mapUpstreamError(response);
  let payload;
  try { payload = await response.json(); }
  catch { throw new HttpError(502, 'echoverse_contract_error', 'EchoVerse catalog response was not valid JSON'); }
  return normalizeCatalogPayload(payload);
}

export async function proxyEchoVerseBinary(req, res, config, upstreamPath) {
  const response = await upstreamFetch(req, config, upstreamPath, { binary: true });
  if (!response.ok && response.status !== 206 && response.status !== 304) throw mapUpstreamError(response);

  const headers = {};
  for (const name of SAFE_RESPONSE_HEADERS) {
    const value = response.headers.get(name);
    if (value != null) headers[name] = value;
  }
  headers['x-content-type-options'] = 'nosniff';
  headers['cache-control'] ??= 'private, max-age=60';
  res.writeHead(response.status, headers);
  if (response.status === 304 || !response.body) return res.end();
  for await (const chunk of response.body) res.write(chunk);
  res.end();
}

export function echoverseAudioPath(trackId) {
  return `/api/audio/${encodeURIComponent(safeTrackId(trackId))}`;
}

export function echoverseFilePath(rawPath) {
  const value = String(rawPath || '').replace(/^\/+/, '');
  if (!value || value.length > 1200) throw new HttpError(400, 'invalid_file_path', 'EchoVerse file path is invalid');
  const segments = value.split('/').filter(Boolean);
  if (!segments.length || segments.some((part) => part === '.' || part === '..' || /[\0\r\n]/.test(part))) {
    throw new HttpError(400, 'invalid_file_path', 'EchoVerse file path is invalid');
  }
  return `/api/file/${segments.map(encodeURIComponent).join('/')}`;
}
