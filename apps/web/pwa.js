const MANIFEST_HREF = '/manifest.webmanifest';
const INSTALL_LABEL = 'Install app';
let deferredInstall = null;
let waitingRegistration = null;
let reloadForUpdate = false;

function ensureHeadLinks() {
  if (!document.querySelector(`link[rel="manifest"][href="${MANIFEST_HREF}"]`)) {
    const manifest = document.createElement('link');
    manifest.rel = 'manifest';
    manifest.href = MANIFEST_HREF;
    document.head.append(manifest);
  }
  if (!document.querySelector('link[rel="icon"]')) {
    const icon = document.createElement('link');
    icon.rel = 'icon';
    icon.href = '/icon.svg';
    icon.type = 'image/svg+xml';
    document.head.append(icon);
  }
  if (!document.querySelector('meta[name="mobile-web-app-capable"]')) {
    const capable = document.createElement('meta');
    capable.name = 'mobile-web-app-capable';
    capable.content = 'yes';
    document.head.append(capable);
  }
  if (!document.querySelector('meta[name="apple-mobile-web-app-capable"]')) {
    const capable = document.createElement('meta');
    capable.name = 'apple-mobile-web-app-capable';
    capable.content = 'yes';
    document.head.append(capable);
  }
  if (!document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')) {
    const bar = document.createElement('meta');
    bar.name = 'apple-mobile-web-app-status-bar-style';
    bar.content = 'black-translucent';
    document.head.append(bar);
  }
}

function standalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function ensureInstallUi() {
  const topbar = document.querySelector('.topbar');
  const identity = document.querySelector('#identityPill');
  if (!topbar || !identity) return null;

  let actions = topbar.querySelector('.pwa-top-actions');
  if (!actions) {
    actions = document.createElement('div');
    actions.className = 'pwa-top-actions';
    identity.before(actions);
    actions.append(identity);
  }

  let button = actions.querySelector('#pwaAction');
  if (!button) {
    button = document.createElement('button');
    button.id = 'pwaAction';
    button.type = 'button';
    button.className = 'mini pwa-action';
    button.hidden = true;
    actions.append(button);
  }

  if (!document.querySelector('#pwaRuntimeStyles')) {
    const style = document.createElement('style');
    style.id = 'pwaRuntimeStyles';
    style.textContent = '.pwa-top-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}.pwa-action{min-height:34px;padding:8px 11px;border-color:#2b6672;background:#0c252c;color:#dff8fb}.pwa-action.update{border-color:#22604f;color:#5ef0c7}.pwa-action.install{border-color:#2b6672;color:#8fced9}@media(max-width:760px){.pwa-top-actions{margin-top:18px;justify-content:flex-start}.pwa-top-actions .pill{margin-top:0}}';
    document.head.append(style);
  }
  return button;
}

function showInstall() {
  const button = ensureInstallUi();
  if (!button || standalone()) return;
  button.hidden = false;
  button.classList.remove('update');
  button.classList.add('install');
  button.textContent = INSTALL_LABEL;
}

function showUpdate(registration) {
  waitingRegistration = registration;
  const button = ensureInstallUi();
  if (!button) return;
  button.hidden = false;
  button.classList.remove('install');
  button.classList.add('update');
  button.textContent = 'Update ready';
}

async function handleAction() {
  if (waitingRegistration?.waiting) {
    reloadForUpdate = true;
    waitingRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
    return;
  }
  if (!deferredInstall) return;
  const prompt = deferredInstall;
  deferredInstall = null;
  await prompt.prompt();
  await prompt.userChoice.catch(() => null);
  const button = ensureInstallUi();
  if (button) button.hidden = true;
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadForUpdate) window.location.reload();
  });

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
    if (registration.waiting && navigator.serviceWorker.controller) showUpdate(registration);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdate(registration);
      });
    });
  } catch (error) {
    console.warn('[rydesync] PWA service worker registration failed', error);
  }
}

ensureHeadLinks();
const action = ensureInstallUi();
action?.addEventListener('click', handleAction);

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstall = event;
  showInstall();
});
window.addEventListener('appinstalled', () => {
  deferredInstall = null;
  const button = ensureInstallUi();
  if (button) button.hidden = true;
});

registerServiceWorker();
