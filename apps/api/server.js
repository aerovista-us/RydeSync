import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './lib/config.js';
import { HttpError, json, readJson } from './lib/http.js';
import { resolveIdentity, requireCapability } from './lib/identity.js';
import { RoomStore } from './lib/rooms.js';
import { RealtimeHub } from './lib/realtime.js';
import { echoverseAudioPath, echoverseFilePath, fetchCatalog, proxyEchoVerseBinary } from './lib/echoverse.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, '../web');

export function createApp(config = loadConfig()) {
  const rooms = new RoomStore(config);

  async function route(req, res) {
    const url = new URL(req.url, config.publicBaseUrl);
    const pathname = url.pathname;

    if (req.method === 'GET' && pathname === '/health') {
      return json(res, 200, { ok: true, service: 'rydesync', version: '3.0.0-alpha.4' });
    }

    if (req.method === 'GET' && pathname === '/v1/bootstrap') {
      return json(res, 200, {
        service: 'rydesync',
        version: '3.0.0-alpha.4',
        identity: {
          mode: config.identity.mode,
          configured: Boolean(config.identity.baseUrl && config.identity.verifyPath),
          loginUrl: config.identity.loginUrl || null
        },
        features: {
          guestRooms: true,
          avIdentity: config.identity.mode !== 'off',
          echoverseEntitlementGate: true,
          realtime: true,
          liveLocation: true,
          crewMap: true,
          echoverseCatalogProxy: true
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
          upstream: 'private-canonical-library-api'
        }
      });
    }

    if (req.method === 'GET' && pathname === '/v1/session') {
      const principal = await resolveIdentity(req, config);
      return json(res, 200, { principal });
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

    const audioMatch = /^\/v1\/echoverse\/audio\/([^/]+)$/.exec(pathname);
    if (req.method === 'GET' && audioMatch) {
      const principal = await resolveIdentity(req, config);
      requireCapability(principal, 'echoverse.library.listen');
      return proxyEchoVerseBinary(req, res, config, echoverseAudioPath(decodeURIComponent(audioMatch[1])));
    }

    const fileMatch = /^\/v1\/echoverse\/file\/(.+)$/.exec(pathname);
    if (req.method === 'GET' && fileMatch) {
      const principal = await resolveIdentity(req, config);
      requireCapability(principal, 'echoverse.library.listen');
      return proxyEchoVerseBinary(req, res, config, echoverseFilePath(decodeURIComponent(fileMatch[1])));
    }

    if (req.method === 'POST' && pathname === '/v1/rooms') {
      const principal = await resolveIdentity(req, config);
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

    const staticFiles = new Set(['/', '/app.js', '/styles.css', '/map.js', '/map-core.js']);
    if (req.method === 'GET' && staticFiles.has(pathname)) {
      const fileName = pathname === '/' ? 'index.html' : pathname.slice(1);
      const filePath = path.join(webRoot, fileName);
      const content = await fs.readFile(filePath);
      const type = fileName.endsWith('.html') ? 'text/html; charset=utf-8'
        : fileName.endsWith('.js') ? 'text/javascript; charset=utf-8'
          : 'text/css; charset=utf-8';
      res.writeHead(200, { 'content-type': type, 'content-length': content.length, 'cache-control': 'no-cache' });
      return res.end(content);
    }

    throw new HttpError(404, 'not_found', 'Route not found');
  }

  const server = http.createServer(async (req, res) => {
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
  new RealtimeHub({ server, rooms, config });
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
