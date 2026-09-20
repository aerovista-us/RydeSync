const RELEASE_ID = '2026-09-20.1';
const RELEASE_KEY = 'rydesync:release-id';
const RELEASE_PARAM = '_ryde_release';
const CLEAN_PARAM = '_ryde_clean';
const READY_STYLE_ID = 'rydesync-device-ready-styles';

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

async function clearReleaseShell() {
  const { ownRegistrations, shellCaches } = await releaseState();
  await Promise.all(ownRegistrations.map((registration) => registration.unregister()));
  await Promise.all(shellCaches.map((key) => caches.delete(key)));
  return { registrations: ownRegistrations.length, caches: shellCaches.length };
}

function cleanReload(reason = 'manual') {
  try { sessionStorage.setItem('rydesync:clean-reload-reason', reason); }
  catch { /* best effort only */ }
  const url = new URL(location.href);
  url.searchParams.delete(RELEASE_PARAM);
  url.searchParams.set(CLEAN_PARAM, '1');
  location.replace(url);
}

async function prepareRelease() {
  const url = new URL(location.href);
  const forceClean = url.searchParams.get(CLEAN_PARAM) === '1';
  const urlRelease = url.searchParams.get(RELEASE_PARAM) || '';
  const storedRelease = readStoredRelease();
  if (!forceClean && (storedRelease === RELEASE_ID || urlRelease === RELEASE_ID)) {
    rememberRelease();
    if (url.searchParams.has(RELEASE_PARAM)) {
      url.searchParams.delete(RELEASE_PARAM);
      history.replaceState(history.state, '', url);
    }
    return false;
  }

  const { ownRegistrations, shellCaches } = await releaseState();
  if (!forceClean && !ownRegistrations.length && !shellCaches.length) {
    rememberRelease();
    return false;
  }

  await Promise.all(ownRegistrations.map((registration) => registration.unregister()));
  await Promise.all(shellCaches.map((key) => caches.delete(key)));
  rememberRelease();
  url.searchParams.delete(CLEAN_PARAM);
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

function controlButton(id) {
  const button = document.getElementById(id);
  return button instanceof HTMLButtonElement ? button : null;
}

function controlActive(id, activePattern) {
  const button = controlButton(id);
  return Boolean(button && activePattern.test(button.textContent || ''));
}

async function browserPermission(name) {
  try {
    if (!navigator.permissions?.query) return 'unknown';
    return (await navigator.permissions.query({ name })).state || 'unknown';
  } catch {
    return 'unknown';
  }
}

function installReadyStyles() {
  if (document.getElementById(READY_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = READY_STYLE_ID;
  style.textContent = `
    #rydeDeviceReadyButton{position:fixed;z-index:125;right:14px;top:14px;display:flex;align-items:center;gap:8px;min-height:38px;padding:8px 12px;border:1px solid #28515b;border-radius:999px;background:rgba(5,17,21,.94);color:#dff7fb;box-shadow:0 12px 32px rgba(0,0,0,.28);font:700 10px/1.1 system-ui,sans-serif;letter-spacing:.04em;text-transform:uppercase;cursor:pointer}
    #rydeDeviceReadyButton .ready-count{display:grid;place-items:center;min-width:28px;height:22px;padding:0 6px;border-radius:999px;background:#102c33;color:#7fa7af;font-size:9px}
    #rydeDeviceReadyButton.ready .ready-count{background:#103a31;color:#6ef0cb}
    #rydeDeviceReadyPanel{position:fixed;z-index:140;right:14px;top:60px;width:min(390px,calc(100vw - 28px));max-height:min(720px,calc(100dvh - 82px));overflow:auto;padding:16px;border:1px solid #28515b;border-radius:18px;background:rgba(5,17,21,.985);color:#dff7fb;box-shadow:0 24px 80px rgba(0,0,0,.58);font-family:system-ui,sans-serif}
    #rydeDeviceReadyPanel[hidden]{display:none!important}
    .ryde-ready-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.ryde-ready-head h3{margin:4px 0 0;font-size:20px}.ryde-ready-head p{margin:5px 0 0;color:#739da6;font-size:11px;line-height:1.4}.ryde-ready-close{min-width:36px;height:34px;padding:0;border:1px solid #284a52;border-radius:10px;background:#0b2228;color:#b8d8de;font-size:18px;cursor:pointer}
    .ryde-ready-release{margin-top:3px;color:#537a83;font-size:8px;letter-spacing:.08em;text-transform:uppercase}.ryde-ready-list{display:grid;gap:8px;margin:15px 0}.ryde-ready-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:11px;border:1px solid #17363e;border-radius:12px;background:#071216}.ryde-ready-row strong,.ryde-ready-row small{display:block}.ryde-ready-row strong{font-size:11px}.ryde-ready-row small{margin-top:3px;color:#668e97;font-size:9px;line-height:1.35}.ryde-ready-state{min-width:64px;text-align:right;color:#83aab3;font-size:9px;text-transform:uppercase}.ryde-ready-state.online{color:#5ef0c7}.ryde-ready-state.warn{color:#f3cb69}.ryde-ready-state.error{color:#ffb2bd}
    .ryde-ready-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}.ryde-ready-actions button,.ryde-ready-row button{min-height:38px;padding:8px 10px;border:1px solid #2d5963;border-radius:10px;background:#0c2930;color:#e5f8fb;font-size:9px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;cursor:pointer}.ryde-ready-actions button.primary{grid-column:1/-1;border-color:#28715f;background:#103a31;color:#78f2d0}.ryde-ready-actions button.secondary{background:#0a2026;color:#a9cbd2}.ryde-ready-message{min-height:18px;margin:10px 0 0;color:#739da6;font-size:9px;line-height:1.4}
    @media(max-width:600px){
      body.dashboard-active .app-nav{position:fixed!important;inset:auto 0 0 0!important;top:auto!important;right:0!important;bottom:0!important;left:0!important;width:100%!important;height:calc(60px + env(safe-area-inset-bottom))!important;min-height:0!important;max-height:calc(60px + env(safe-area-inset-bottom))!important;overflow-x:auto!important;overflow-y:hidden!important;contain:layout paint!important;z-index:100!important}
      body.dashboard-active #dashboardView{inset:0 0 calc(60px + env(safe-area-inset-bottom)) 0!important;height:auto!important}
      #rydeDeviceReadyButton{top:auto;right:10px;bottom:calc(70px + env(safe-area-inset-bottom));min-height:36px;padding:7px 10px}
      #rydeDeviceReadyPanel{top:auto;right:10px;bottom:calc(70px + env(safe-area-inset-bottom));width:calc(100vw - 20px);max-height:calc(100dvh - 92px - env(safe-area-inset-bottom));border-radius:18px}
    }
  `;
  document.head.append(style);
}

function installDeviceReadyPanel() {
  if (document.getElementById('rydeDeviceReadyPanel')) return;
  installReadyStyles();

  const launcher = document.createElement('button');
  launcher.id = 'rydeDeviceReadyButton';
  launcher.type = 'button';
  launcher.innerHTML = '<span>Device ready</span><span id="rydeReadyCount" class="ready-count">0/3</span>';

  const panel = document.createElement('section');
  panel.id = 'rydeDeviceReadyPanel';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Device readiness');
  panel.innerHTML = `
    <div class="ryde-ready-head">
      <div><div class="ryde-ready-release">RydeSync ${RELEASE_ID}</div><h3>Device readiness</h3><p>Sign-in, microphone, location, crew audio, sync recovery, and clean reload live here.</p></div>
      <button id="rydeReadyClose" class="ryde-ready-close" type="button" aria-label="Close device readiness">×</button>
    </div>
    <div class="ryde-ready-list">
      <div class="ryde-ready-row"><div><strong>AeroVista account</strong><small id="rydeReadyIdentityDetail">Guest access is available.</small></div><div><span id="rydeReadyIdentity" class="ryde-ready-state">Guest</span><button id="rydeReadySignIn" type="button">Sign in</button></div></div>
      <div class="ryde-ready-row"><div><strong>Microphone / PTT</strong><small id="rydeReadyMicDetail">Permission is requested only from this explicit action.</small></div><div><span id="rydeReadyMic" class="ryde-ready-state">Check</span><button id="rydeReadyMicAction" type="button">Enable</button></div></div>
      <div class="ryde-ready-row"><div><strong>Location sharing</strong><small id="rydeReadyGeoDetail">Location stays off until you explicitly enable it.</small></div><div><span id="rydeReadyGeo" class="ryde-ready-state">Check</span><button id="rydeReadyGeoAction" type="button">Enable</button></div></div>
      <div class="ryde-ready-row"><div><strong>Crew audio</strong><small id="rydeReadyAudioDetail">Shared music still requires a user gesture.</small></div><div><span id="rydeReadyAudio" class="ryde-ready-state">Off</span><button id="rydeReadyAudioAction" type="button">Listen</button></div></div>
      <div class="ryde-ready-row"><div><strong>Realtime / sync</strong><small id="rydeReadySyncDetail">Request a fresh room snapshot if playback or presence looks late.</small></div><div><span id="rydeReadySync" class="ryde-ready-state">Idle</span><button id="rydeReadyResync" type="button">Resync</button></div></div>
    </div>
    <div class="ryde-ready-actions">
      <button id="rydeReadyEnableAll" class="primary" type="button">Enable PTT + location + crew audio</button>
      <button id="rydeReadyCleanReload" class="secondary" type="button">Reload clean</button>
      <button id="rydeReadyOpenDashboard" class="secondary" type="button">Open dashboard</button>
    </div>
    <p id="rydeReadyMessage" class="ryde-ready-message"></p>`;

  document.body.append(launcher, panel);

  const setMessage = (message) => {
    const element = document.getElementById('rydeReadyMessage');
    if (element) element.textContent = message || '';
  };

  const openPanel = () => {
    panel.hidden = false;
    refreshReadyState();
  };
  launcher.addEventListener('click', () => panel.hidden ? openPanel() : (panel.hidden = true));
  document.getElementById('rydeReadyClose')?.addEventListener('click', () => { panel.hidden = true; });

  document.getElementById('rydeReadyMicAction')?.addEventListener('click', () => {
    const button = controlButton('voiceEnable');
    if (button && !button.disabled && !controlActive('voiceEnable', /disable|stop/i)) button.click();
    setMessage('Microphone/PTT request sent from Device readiness.');
    setTimeout(refreshReadyState, 700);
  });
  document.getElementById('rydeReadyGeoAction')?.addEventListener('click', () => {
    const button = controlButton('locationToggle');
    if (button && !button.disabled && !controlActive('locationToggle', /stop/i)) button.click();
    setMessage('Location request sent from Device readiness.');
    setTimeout(refreshReadyState, 700);
  });
  document.getElementById('rydeReadyAudioAction')?.addEventListener('click', () => {
    const button = controlButton('audioListenToggle');
    if (button && !button.disabled && !controlActive('audioListenToggle', /stop/i)) button.click();
    setMessage('Crew audio request sent from Device readiness.');
    setTimeout(refreshReadyState, 700);
  });
  document.getElementById('rydeReadyEnableAll')?.addEventListener('click', () => {
    const voice = controlButton('voiceEnable');
    const locationButton = controlButton('locationToggle');
    const audio = controlButton('audioListenToggle');
    if (voice && !voice.disabled && !controlActive('voiceEnable', /disable|stop/i)) voice.click();
    if (locationButton && !locationButton.disabled && !controlActive('locationToggle', /stop/i)) locationButton.click();
    if (audio && !audio.disabled && !controlActive('audioListenToggle', /stop/i)) audio.click();
    setMessage('Requested device readiness from one user action. Browser/OS prompts remain authoritative.');
    setTimeout(refreshReadyState, 900);
  });
  document.getElementById('rydeReadyResync')?.addEventListener('click', () => {
    const audio = controlButton('audioListenToggle');
    if (audio && !audio.disabled && !controlActive('audioListenToggle', /stop/i)) audio.click();
    const refresh = controlButton('rtRefresh');
    if (refresh && !refresh.disabled) refresh.click();
    setMessage(refresh ? 'Fresh room state requested. Playback will correct against the latest server anchor.' : 'Join a Ryde first, then use Resync.');
    setTimeout(refreshReadyState, 700);
  });
  document.getElementById('rydeReadyCleanReload')?.addEventListener('click', () => cleanReload('device-ready'));
  document.getElementById('rydeReadyOpenDashboard')?.addEventListener('click', () => {
    location.hash = 'dashboard';
    panel.hidden = true;
  });
  document.getElementById('rydeReadySignIn')?.addEventListener('click', () => {
    const signIn = document.getElementById('signInButton');
    if (signIn instanceof HTMLAnchorElement && !signIn.classList.contains('disabled-link')) signIn.click();
    else location.hash = 'access';
  });

  const observedIds = ['identityPill', 'voiceEnable', 'talkButton', 'locationToggle', 'locationStatus', 'audioListenToggle', 'audioClientStatus', 'rtStatus', 'sharedPlaybackState'];
  const observer = new MutationObserver(() => refreshReadyState());
  for (const id of observedIds) {
    const element = document.getElementById(id);
    if (element) observer.observe(element, { attributes: true, childList: true, characterData: true, subtree: true });
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshReadyState(); });
  refreshReadyState();
}

async function refreshReadyState() {
  const launcher = document.getElementById('rydeDeviceReadyButton');
  if (!launcher) return;

  const voiceActive = controlActive('voiceEnable', /disable|stop/i) || !controlButton('talkButton')?.disabled;
  const locationActive = controlActive('locationToggle', /stop/i);
  const audioActive = controlActive('audioListenToggle', /stop/i);
  const ready = [voiceActive, locationActive, audioActive].filter(Boolean).length;
  const count = document.getElementById('rydeReadyCount');
  if (count) count.textContent = `${ready}/3`;
  launcher.classList.toggle('ready', ready === 3);

  const micPermission = await browserPermission('microphone');
  const geoPermission = await browserPermission('geolocation');
  const identityText = document.getElementById('identityPill')?.textContent?.trim() || 'Guest';
  const signedIn = !/^guest$/i.test(identityText) && !/unavailable/i.test(identityText);
  const realtimeText = document.getElementById('rtStatus')?.textContent?.trim() || 'Idle';

  const setState = (id, value, tone = '') => {
    const element = document.getElementById(id);
    if (!element) return;
    element.textContent = value;
    element.className = `ryde-ready-state ${tone}`.trim();
  };
  setState('rydeReadyIdentity', signedIn ? 'Signed in' : 'Guest', signedIn ? 'online' : '');
  setState('rydeReadyMic', voiceActive ? 'Active' : micPermission, voiceActive || micPermission === 'granted' ? 'online' : micPermission === 'denied' ? 'error' : 'warn');
  setState('rydeReadyGeo', locationActive ? 'Sharing' : geoPermission, locationActive || geoPermission === 'granted' ? 'online' : geoPermission === 'denied' ? 'error' : 'warn');
  setState('rydeReadyAudio', audioActive ? 'Listening' : 'Off', audioActive ? 'online' : 'warn');
  setState('rydeReadySync', realtimeText, /live|connected/i.test(realtimeText) ? 'online' : /error|offline|closed/i.test(realtimeText) ? 'error' : 'warn');

  const identityDetail = document.getElementById('rydeReadyIdentityDetail');
  if (identityDetail) identityDetail.textContent = signedIn ? identityText : 'Guest access remains available; sign in for member capabilities.';
  const micDetail = document.getElementById('rydeReadyMicDetail');
  if (micDetail) micDetail.textContent = voiceActive ? 'PTT is enabled on this device.' : `Browser permission: ${micPermission}.`;
  const geoDetail = document.getElementById('rydeReadyGeoDetail');
  if (geoDetail) geoDetail.textContent = locationActive ? (document.getElementById('locationStatus')?.textContent || 'Sharing location.') : `Browser permission: ${geoPermission}.`;
  const audioDetail = document.getElementById('rydeReadyAudioDetail');
  if (audioDetail) audioDetail.textContent = document.getElementById('audioClientStatus')?.textContent || 'Crew audio is off.';
  const syncDetail = document.getElementById('rydeReadySyncDetail');
  if (syncDetail) syncDetail.textContent = `${realtimeText} · ${document.getElementById('sharedPlaybackState')?.textContent?.trim() || 'music idle'} · Resync requests a fresh room snapshot.`;

  const dashApproveStrong = document.querySelector('#dashApproveAll strong');
  if (dashApproveStrong) dashApproveStrong.textContent = 'Device ready';
}

function installLoginSingleFlight() {
  const signIn = document.getElementById('signInButton');
  if (!(signIn instanceof HTMLAnchorElement) || signIn.dataset.singleFlight === 'true') return;
  signIn.dataset.singleFlight = 'true';
  let navigating = false;
  signIn.addEventListener('click', (event) => {
    if (navigating) {
      event.preventDefault();
      return;
    }
    navigating = true;
    signIn.setAttribute('aria-disabled', 'true');
    signIn.dataset.originalText = signIn.textContent || '';
    signIn.textContent = 'Opening secure sign-in…';
    setTimeout(() => {
      navigating = false;
      signIn.removeAttribute('aria-disabled');
      if (signIn.dataset.originalText) signIn.textContent = signIn.dataset.originalText;
    }, 8000);
  }, { capture: true });
}

function reconcileLoginMarkers() {
  const url = new URL(location.href);
  const signedIn = url.searchParams.get('signed_in') === '1';
  const loginError = url.searchParams.get('login_error');
  const message = document.getElementById('rydeReadyMessage');
  if (signedIn) {
    url.searchParams.delete('signed_in');
    history.replaceState(history.state, '', url);
    if (message) message.textContent = 'AeroVista sign-in completed.';
  } else if (loginError && message) {
    message.textContent = loginError === 'invalid_auth_state'
      ? 'That sign-in handoff expired or belonged to an older browser state. Use Reload clean, then sign in once.'
      : `Sign-in needs another try (${loginError}).`;
  }
}

async function checkForNewRelease() {
  if (document.hidden) return;
  try {
    const response = await fetch(`/release-bootstrap.js?probe=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return;
    const text = await response.text();
    const remote = /const RELEASE_ID = ['"]([^'"]+)['"]/.exec(text)?.[1];
    if (remote && remote !== RELEASE_ID) cleanReload('new-release-detected');
  } catch {
    // Offline/PWA operation should not fail because release probing is unavailable.
  }
}

function installReleaseProbe() {
  window.addEventListener('pageshow', () => { setTimeout(checkForNewRelease, 250); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(checkForNewRelease, 250); });
}

async function boot() {
  if (await prepareRelease()) return;
  await loadClassicScript('/catalog-bridge.js');
  await import(`/app.js?release=${encodeURIComponent(RELEASE_ID)}`);
  await import(`/ui-shell.js?release=${encodeURIComponent(RELEASE_ID)}`);
  await import(`/library-ui.js?release=${encodeURIComponent(RELEASE_ID)}`);
  installDeviceReadyPanel();
  installLoginSingleFlight();
  reconcileLoginMarkers();
  installReleaseProbe();
  window.rydeSyncRelease = Object.freeze({ id: RELEASE_ID, cleanReload, clearReleaseShell, refreshReadyState });
}

boot().catch((error) => {
  console.error('[rydesync] release bootstrap failed', error);
  document.body?.setAttribute('data-boot-error', 'true');
});
