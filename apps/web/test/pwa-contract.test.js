import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createApp } from '../../api/server.js';

function config() {
  return {
    nodeEnv: 'test', port: 0, publicBaseUrl: 'http://127.0.0.1',
    roomTokenSecret: 't'.repeat(48), generatedDevSecret: false,
    roomTtlSeconds: 3600, memberTokenTtlSeconds: 3600,
    identity: { mode: 'optional', baseUrl: '', verifyPath: '', timeoutMs: 250, appId: 'rydesync', loginUrl: '', verifyToken: async () => ({ identity_id: 'identity_test_host', display_name: 'Test Host', capabilities: [] }) },
    realtime: { authTimeoutMs: 5000, heartbeatMs: 60000, maxMessageBytes: 32768 },
    location: { minIntervalMs: 1000, staleAfterMs: 120000, maxClientAgeMs: 30000, maxFutureSkewMs: 10000, maxAccuracyMeters: 5000 },
    echoverse: { libraryApiUrl: 'http://echoverse-library-api:5304' }
  };
}

async function withServer(fn) {
  const server = createApp(config());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try { await fn(`http://127.0.0.1:${port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('PWA manifest and shell assets are publicly served with installable metadata', async () => {
  await withServer(async (base) => {
    const manifestResponse = await fetch(`${base}/manifest.webmanifest`);
    assert.equal(manifestResponse.status, 200);
    assert.match(manifestResponse.headers.get('content-type') || '', /^application\/manifest\+json/);
    const manifest = await manifestResponse.json();
    assert.equal(manifest.id, '/');
    assert.equal(manifest.scope, '/');
    assert.equal(manifest.start_url, '/#dashboard');
    assert.equal(manifest.display, 'standalone');
    assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));

    for (const [pathname, contentType] of [
      ['/sw.js', /^text\/javascript/],
      ['/pwa.js', /^text\/javascript/],
      ['/offline.html', /^text\/html/],
      ['/icon.svg', /^image\/svg\+xml/],
      ['/icon-maskable.svg', /^image\/svg\+xml/]
    ]) {
      const response = await fetch(`${base}${pathname}`);
      assert.equal(response.status, 200, `${pathname} should be served`);
      assert.match(response.headers.get('content-type') || '', contentType);
      assert.ok((await response.text()).length > 0);
    }

    const sw = await fetch(`${base}/sw.js`);
    assert.equal(sw.headers.get('service-worker-allowed'), '/');
  });
});

test('service worker caches only the static shell and leaves live/auth/media routes network-only', async () => {
  const sw = await fs.readFile(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(sw, /rydesync-shell-/);
  assert.match(sw, /pathname\.startsWith\('\/v1\/'\)/);
  assert.match(sw, /pathname\.startsWith\('\/auth\/'\)/);
  assert.doesNotMatch(sw, /\/v1\/echoverse\/audio\/.+SHELL_ASSETS/s);
  assert.match(sw, /request\.mode === 'navigate'/);
  assert.match(sw, /caches\.match\('\/offline\.html'\)/);
});

test('PWA bootstrap is additive and update activation remains user-triggered', async () => {
  const bridge = await fs.readFile(new URL('../catalog-bridge.js', import.meta.url), 'utf8');
  const pwa = await fs.readFile(new URL('../pwa.js', import.meta.url), 'utf8');
  assert.match(bridge, /import\('\/pwa\.js'\)/);
  assert.match(pwa, /beforeinstallprompt/);
  assert.match(pwa, /Update ready/);
  assert.match(pwa, /SKIP_WAITING/);
  assert.match(pwa, /reloadForUpdate/);
  assert.doesNotMatch(pwa, /location\.reload\(\);\s*}\s*registerServiceWorker\(\)/s);
});
