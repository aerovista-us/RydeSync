import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './lib/config.js';
import { HttpError, json, readJson } from './lib/http.js';
import { resolveIdentity, requireCapability, requireIdentity } from './lib/identity.js';
import { RoomStore } from './lib/rooms.js';
import { RealtimeHub } from './lib/realtime.js';
import { echoverseAudioPath, echoverseFilePath, fetchCatalog, proxyEchoVerseBinary } from './lib/echoverse.js';
import { clearMediaSessionCookie, issueMediaSession, issueRoomMediaSession, mediaSessionCookie, mediaSessionFromRequest } from './lib/media-session.js';
import { beginBrowserLogin, browserLoginConfigured, browserLogout, completeBrowserLogin } from './lib/browser-auth.js';
import { verifyRoomToken } from './lib/room-token.js';
import { issueTurnIceServers, turnIsConfigured } from './lib/turn-credentials.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, '../web');

async function serveWebFile(res, fileName) {
  const filePath = path.join(webRoot, fileName);
  const content = await fs.readFile(filePath);
  const type = fileName.endsWith('.html') ? 'text/html; charset=utf-8'
    : fileName.endsWith('.js') ? 'text/javascript; charset=utf-8'
      : 'text/css; charset=utf-8';
  res.writeHead(200, { 'content-type': type, 'content-length': content.length, 'cache-control': 'no-cache' });
  return res.end(content);
}

export function createApp(config = loadConfig()) {
  const rooms = new RoomStore(config);
  let realtimeHub = null;

  function resolveRoomMemberFromToken(roomToken, message = 'A valid Ryde room session is required') {
    let claims;
    try { claims = verifyRoomToken(roomToken, config.roomTokenSecret); }
    catch { throw new HttpError(401, 'room_auth_required', message); }
    const room = rooms.resolve(claims.room_id);
    const member = room.members.get(claims.member_id);
    if (!member || member.role !== claims.role || member.identityId !== claims.identity_id) {
      throw new HttpError(401, 'room_auth_required', 'Ryde room membership is no longer valid');
    }
    return { claims, room, member };
  }

  async function route(req, res) {
    const url = new URL(req.url, config.publicBaseUrl);
    const pathname = url.pathname;

    if (req.method === 'GET' && pathname === '/health') {
      return json(res, 200, { ok: true, service: 'rydesync', version: '3.0.0-alpha.7' });
    }

    if (req.method === 'GET' && pathname === '/v1/bootstrap') {
      const turnConfigured = turnIsConfigured(config);
      return json(res, 200, {
        service: 'rydesync',
        version: '3.0.0-alpha.7',
        identity: {
          mode: config.identity.mode,
          configured: Boolean(config.identity.baseUrl && config.identity.verifyPath),
          loginConfigured: browserLoginConfigured(config),
          loginPath: browserLoginConfigured(config) ? '/auth/login' : null,
          logoutPath: '/auth/logout'
        },
        features: {
          guestRooms: true,
          avIdentity: config.identity.mode !== 'off',
          echoverseEntitlementGate: true,
          realtime: true,
          liveLocation: true,
          crewMap: true,
          echoverseCatalogProxy: true,
          sharedPlayback: true,
          playbackClient: true,
          androidFoundation: true,
          authenticatedHosting: true,
          pushToTalk: Boolean(config.voice?.enabled),
          turnReady: turnConfigured
        },
        playback: {
          syncIntervalMs: config.playback?.syncIntervalMs ?? 10000,
          softDriftMs: config.playback?.softDriftMs ?? 250,
          hardDriftMs: config.playback?.hardDriftMs ?? 1500
        },
        voice: {
          enabled: Boolean(config.voice?.enabled),
          maxPeers: config.voice?.maxPeers ?? 12,
          // Public bootstrap contains only STUN. TURN credentials are issued
          // after a valid room token is presented to /v1/voice/ice.
          iceServers: config.voice?.stunUrls?.length ? [{ urls: config.voice.stunUrls }] : [],
          turnConfigured,
          turnCredentialMode: turnConfigured
            ? (config.voice?.turnSharedSecret ? 'room-ephemeral' : 'room-static-legacy')
            : 'none'
        },
        location: {
          minIntervalMs: config.location.minIntervalMs,
          staleAfterMs: config.location.staleAfterMs
        },
        map: {
          tileUrlTemplate: config.map?.tileUrlTemplate || '',
          attribution: config.map?.attribution || '',
          attributionUrl: config.map?.attributionUrl || '',
          minZoom: config.map?.minZoom ?? 2,
          maxZoom: config.map?.maxZoom ?? 18
        },
        echoverse: {
          contract: 'rydesync-catalog-v1',
          upstream: 'private-canonical-library-api',
          mediaSessionTtlSeconds: config.echoverse?.mediaSessionTtlSeconds ?? 600
        }
      });
    }

    if (req.method === 'GET' && pathname === '/auth/login') {
      return beginBrowserLogin(res, config, url);
    }

    if (req.method === 'GET' && pathname === '/auth/callback') {
      return completeBrowserLogin(req, res, url, config);
    }

    if (req.method === 'GET' && pathname === '/auth/logout') {
      return browserLogout(req, res, config);
    }

    if (req.method === 'GET' && pathname === '/v1/session') {
      const principal = await resolveIdentity(req, config);
      return json(res, 200, { principal });
    }

    if (req.method === 'POST' && pathname === '/v1/voice/ice') {
      if (!config.voice?.enabled) throw new HttpError(409, 'voice_disabled', 'Push-to-talk is disabled on this deployment');
      const body = await readJson(req);
      const { room, member } = resolveRoomMemberFromToken(body.roomToken, 'A valid Ryde room session is required for voice relay credentials');
      const issued = issueTurnIceServers({ roomId: room.id, memberId: member.id, roomExpiresAt: room.expiresAt }, config);
      return json(res, 200, {
        ...issued,
        roomId: room.id,
        memberId: member.id,
        secretExposed: false
      });
    }

    if (req.method === 'GET' && pathname === '/v1/echoverse/access') {
      const principal = await resolveIdentity(req, config);
      requireCapability(principal, 'echoverse.library.listen');
      return json(res, 200, {
        allowed: true,
        identityId: principal.identityId,
        capability: 'echoverse.library.listen',
        upstreamExposed: false
      });
    }

    if (req.method === 'GET' && pathname === '/v1/echoverse/catalog') {
      const principal = await resolveIdentity(req, config);
      requireCapability(principal, 'echoverse.library.listen');
      return json(res, 200, await fetchCatalog(req, config));
    }

    if (req.method === 'POST' && pathname === '/v1/echoverse/media-session') {
      const principal = await resolveIdentity(req, config);
      requireCapability(principal, 'echoverse.library.listen');
      const session = issueMediaSession(principal, config);
      return json(res, 200, {
        allowed: true,
        expiresAt: session.expiresAt,
        scope: 'echoverse-media',
        credentialExposed: false
      }, { 'set-cookie': mediaSessionCookie(session, config) });
    }

    if (req.method === 'DELETE' && pathname === '/v1/echoverse/media-session') {
      return json(res, 200, { cleared: true }, { 'set-cookie': clearMediaSessionCookie(config) });
    }

    if (req.method === 'POST' && pathname === '/v1/echoverse/room-media-session') {
      const body = await readJson(req);
      const { room, member } = resolveRoomMemberFromToken(body.roomToken, 'A valid Ryde room session is required for shared music');
      const playback = realtimeHub?.playbackForRoom(room.id);
      if (!playback?.trackId) throw new HttpError(409, 'no_shared_track', 'The Ryde does not currently have a shared track');
      const session = issueRoomMediaSession({ roomId: room.id, memberId: member.id, trackId: playback.trackId }, config);
      return json(res, 200, {
        allowed: true,
        trackId: playback.trackId,
        expiresAt: session.expiresAt,
        scope: 'current-room-track',
        credentialExposed: false,
        libraryGranted: false
      }, { 'set-cookie': mediaSessionCookie(session, config) });
    }

    const audioMatch = /^\/v1\/echoverse\/audio\/([^/]+)$/.exec(pathname);
    if (req.method === 'GET' && audioMatch) {
      const trackId = decodeURIComponent(audioMatch[1]);
      const media = mediaSessionFromRequest(req, config);
      if (media?.aud === 'echoverse-room-media') {
        let room;
        try { room = rooms.resolve(media.room); }
        catch { throw new HttpError(403, 'media_scope_violation', 'This room media session is no longer active'); }
        const member = room.members.get(media.member);
        const currentTrackId = realtimeHub?.playbackForRoom(room.id)?.trackId || null;
        if (!member || media.track !== trackId || currentTrackId !== trackId) {
          throw new HttpError(403, 'media_scope_violation', 'This room media session is limited to the current shared track');
        }
      }
      if (!media) {
        const principal = await resolveIdentity(req, config);
        requireCapability(principal, 'echoverse.library.listen');
      }
      return proxyEchoVerseBinary(req, res, config, echoverseAudioPath(trackId));
    }

    const fileMatch = /^\/v1\/echoverse\/file\/(.+)$/.exec(pathname);
    if (req.method === 'GET' && fileMatch) {
      const media = mediaSessionFromRequest(req, config);
      if (!media || media.aud === 'echoverse-room-media') {
        const principal = await resolveIdentity(req, config);
        requireCapability(principal, 'echoverse.library.listen');
      }
      return proxyEchoVerseBinary(req, res, config, echoverseFilePath(decodeURIComponent(fileMatch[1])));
    }

    if (req.method === 'POST' && pathname === '/v1/rooms') {
      const principal = await resolveIdentity(req, config);
      requireIdentity(principal);
      const body = await readJson(req);
      const created = rooms.create(body, principal);
      return json(res, 201, created);
    }

    const roomMatch = /^\/v1\/rooms\/([^/]+)$/.exec(pathname);
    if (req.method === 'GET' && roomMatch) {
      return json(res, 200, { room: rooms.publicRoom(rooms.resolve(decodeURIComponent(roomMatch[1]))) });
    }

    const joinMatch = /^\/v1\/rooms\/([^/]+)\/join$/.exec(pathname);
    if (req.method === 'POST' && joinMatch) {
      const principal = await resolveIdentity(req, config);
      const body = await readJson(req);
      const joined = rooms.join(decodeURIComponent(joinMatch[1]), body, principal);
      return json(res, 200, joined);
    }

    const invitePageMatch = /^\/join\/([A-HJ-NP-Z2-9]{8})\/?$/i.exec(pathname);
    if (req.method === 'GET' && invitePageMatch) {
      return serveWebFile(res, 'join.html');
    }

    const staticFiles = new Set([
      '/',
      '/app.js',
      '/styles.css',
      '/product-ui.css',
      '/ui-shell.js',
      '/catalog-bridge.js',
      '/library-ui.js',
      '/library-core.js',
      '/qr-lite.js',
      '/join.js',
      '/join.css',
      '/map.js',
      '/map-core.js',
      '/sync-core.js',
      '/audio-engine.js',
      '/voice.js'
    ]);
    if (req.method === 'GET' && staticFiles.has(pathname)) {
      const fileName = pathname === '/' ? 'index.html' : pathname.slice(1);
      return serveWebFile(res, fileName);
    }

    throw new HttpError(404, 'not_found', 'Route not found');
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'same-origin');
    res.setHeader('permissions-policy', 'geolocation=(self), microphone=(self), camera=()');
    try {
      await route(req, res);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const code = error instanceof HttpError ? error.code : 'internal_error';
      const message = error instanceof HttpError ? error.message : 'Unexpected server error';
      if (!(error instanceof HttpError)) console.error(error);
      json(res, status, { error: { code, message, details: error.details ?? null } });
    }
  });
  realtimeHub = new RealtimeHub({ server, rooms, config });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  const server = createApp(config);
  server.listen(config.port, () => {
    if (config.generatedDevSecret) {
      console.warn('[rydesync] ROOM_TOKEN_SECRET was not set; using an ephemeral development secret.');
    }
    console.log(`[rydesync] listening on ${config.publicBaseUrl}`);
    console.log(`[rydesync] identity mode=${config.identity.mode} configured=${Boolean(config.identity.baseUrl && config.identity.verifyPath)}`);
  });
}
