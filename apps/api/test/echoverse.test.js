import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../server.js';
import { normalizeCatalogPayload } from '../lib/echoverse.js';

function baseConfig(upstreamUrl) {
  return {
    nodeEnv: 'test', port: 0, publicBaseUrl: 'http://127.0.0.1', roomTokenSecret: 'x'.repeat(48), generatedDevSecret: false,
    roomTtlSeconds: 3600, memberTokenTtlSeconds: 3600,
    identity: { mode: 'optional', baseUrl: upstreamUrl, verifyPath: '/verify', timeoutMs: 1000, appId: 'rydesync', loginUrl: '' },
    realtime: { authTimeoutMs: 5000, heartbeatMs: 60000, maxMessageBytes: 32768 },
    location: { minIntervalMs: 1000, staleAfterMs: 120000, maxClientAgeMs: 30000, maxFutureSkewMs: 10000, maxAccuracyMeters: 5000 },
    map: { tileUrlTemplate: '', attribution: '', attributionUrl: '', minZoom: 2, maxZoom: 18 },
    echoverse: { libraryApiUrl: upstreamUrl, timeoutMs: 1000, serviceToken: '', mediaSessionTtlSeconds: 600 }
  };
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) { await new Promise((resolve) => server.close(resolve)); }

async function withServers(fn) {
  const hits = [];
  const upstream = http.createServer((req, res) => {
    hits.push({ url: req.url, range: req.headers.range, auth: req.headers.authorization });
    if (req.url === '/verify') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ identity_id: 'id_test_123', display_name: 'Test Rider', capabilities: ['echoverse.library.listen'] }));
    }
    if (req.url.startsWith('/api/catalog')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ tracks: [{ track_id: 'trk-1', track: 'Current', artist: 'EchoVerse', album: 'Test Album' }] }));
    }
    if (req.url === '/api/audio/trk-1') {
      assert.equal(req.headers.range, 'bytes=0-3');
      res.writeHead(206, { 'content-type': 'audio/mpeg', 'accept-ranges': 'bytes', 'content-range': 'bytes 0-3/10', 'content-length': '4' });
      return res.end(Buffer.from('test'));
    }
    res.writeHead(404); res.end();
  });
  const upstreamUrl = await listen(upstream);
  const app = createApp(baseConfig(upstreamUrl));
  const appUrl = await listen(app);
  try { await fn({ appUrl, hits }); }
  finally { await close(app); await close(upstream); }
}

test('normalizes the existing RydeSync catalog dump contract', () => {
  assert.deepEqual(normalizeCatalogPayload({ tracks: [{ track_id: 7, track: 'Ghost Current', artist: 'EchoVerse', album: 'Spiral Out' }] }), {
    contract: 'rydesync-catalog-v1', source: 'echoverse-library-api', total: 1,
    tracks: [{ id: '7', title: 'Ghost Current', artist: 'EchoVerse', album: 'Spiral Out', artworkUrl: null, streamUrl: '/v1/echoverse/audio/7' }]
  });
});

test('catalog proxy requires AV capability and does not expose the private upstream', async () => {
  await withServers(async ({ appUrl, hits }) => {
    const guest = await fetch(`${appUrl}/v1/echoverse/catalog`);
    assert.equal(guest.status, 401);
    assert.equal(hits.filter((h) => h.url.startsWith('/api/catalog')).length, 0);

    const response = await fetch(`${appUrl}/v1/echoverse/catalog`, { headers: { authorization: 'Bearer test-user-token' } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.contract, 'rydesync-catalog-v1');
    assert.equal(body.tracks[0].streamUrl, '/v1/echoverse/audio/trk-1');
    assert.equal(JSON.stringify(body).includes('127.0.0.1'), false);
  });
});

test('audio proxy forwards byte ranges only after capability authorization', async () => {
  await withServers(async ({ appUrl }) => {
    const response = await fetch(`${appUrl}/v1/echoverse/audio/trk-1`, {
      headers: { authorization: 'Bearer test-user-token', range: 'bytes=0-3' }
    });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 0-3/10');
    assert.equal(await response.text(), 'test');
  });
});


test('browser media session converts AV authorization into an HttpOnly same-origin media grant', async () => {
  await withServers(async ({ appUrl }) => {
    const sessionRes = await fetch(`${appUrl}/v1/echoverse/media-session`, {
      method: 'POST', headers: { authorization: 'Bearer test-user-token', 'content-type': 'application/json' }, body: '{}'
    });
    assert.equal(sessionRes.status, 200);
    const cookie = sessionRes.headers.get('set-cookie');
    assert.match(cookie, /rydesync_media=/);
    assert.match(cookie, /HttpOnly/);
    assert.equal(cookie.includes('test-user-token'), false);

    const response = await fetch(`${appUrl}/v1/echoverse/audio/trk-1`, {
      headers: { cookie: cookie.split(';')[0], range: 'bytes=0-3' }
    });
    assert.equal(response.status, 206);
    assert.equal(await response.text(), 'test');
  });
});
