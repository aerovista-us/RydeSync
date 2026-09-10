const RELEASE_ID = '2026-09-09.3';
const RELEASE_KEY = 'rydesync:release-id';
const RELEASE_PARAM = '_ryde_release';

function readStoredRelease() {
  try { return localStorage.getItem(RELEASE_KEY) || ''; }
  catch { return ''; }
}

function rememberRelease() {
  try { localStorage.setItem(RELEASE_KEY, RELEASE_ID); }
  catch { /* URL marker prevents a reload loop when storage is unavailable. */ }
}

async function releaseState() {
  const registrations = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistrations() : [];
  const cacheKeys = 'caches' in window ? await caches.keys() : [];
  const ownRegistrations = registrations.filter((registration) => {
    try { return new URL(registration.scope).origin === location.origin; }
    catch { return false; }
  });
  const shellCaches = cacheKeys.filter((key) => key.startsWith('rydesync-shell-'));
  return { ownRegistrations, shellCaches };
}

async function prepareRelease() {
  const url = new URL(location.href);
  const urlRelease = url.searchParams.get(RELEASE_PARAM) || '';
  const storedRelease = readStoredRelease();
  if (storedRelease === RELEASE_ID || urlRelease === RELEASE_ID) {
    rememberRelease();
    if (url.searchParams.has(RELEASE_PARAM)) {
      url.searchParams.delete(RELEASE_PARAM);
      history.replaceState(history.state, '', url);
    }
    return false;
  }

  const { ownRegistrations, shellCaches } = await releaseState();
  if (!ownRegistrations.length && !shellCaches.length) {
    rememberRelease();
    return false;
  }

  await Promise.all(ownRegistrations.map((registration) => registration.unregister()));
  await Promise.all(shellCaches.map((key) => caches.delete(key)));
  rememberRelease();
  url.searchParams.set(RELEASE_PARAM, RELEASE_ID);
  location.replace(url);
  return true;
}

function loadClassicScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${src}?release=${encodeURIComponent(RELEASE_ID)}`;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.append(script);
  });
}

async function boot() {
  if (await prepareRelease()) return;
  await loadClassicScript('/catalog-bridge.js');
  await import(`/app.js?release=${encodeURIComponent(RELEASE_ID)}`);
  await import(`/ui-shell.js?release=${encodeURIComponent(RELEASE_ID)}`);
  await import(`/library-ui.js?release=${encodeURIComponent(RELEASE_ID)}`);
}

boot().catch((error) => {
  console.error('[rydesync] release bootstrap failed', error);
  document.body?.setAttribute('data-boot-error', 'true');
});
