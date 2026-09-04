import { qrSvg } from './qr-lite.js';

const views = new Map([...document.querySelectorAll('[data-view]')].map((el) => [el.dataset.view, el]));
const navItems = [...document.querySelectorAll('[data-view-target]')];
const validViews = new Set(views.keys());

function activeViewFromHash() {
  const value = window.location.hash.replace(/^#/, '');
  return validViews.has(value) ? value : 'access';
}

function showView(name) {
  const target = validViews.has(name) ? name : 'access';
  for (const [viewName, element] of views) element.hidden = viewName !== target;
  for (const button of navItems) {
    const active = button.dataset.viewTarget === target;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  const labels = { access: 'Login', ride: 'Ryde', room: 'Room + Map', music: 'Music', dashboard: 'Dashboard' };
  document.title = `RydeSync · ${labels[target] || 'RydeSync'}`;
}

function go(name) {
  const target = validViews.has(name) ? name : 'access';
  if (window.location.hash === `#${target}`) showView(target);
  else window.location.hash = target;
}

navItems.forEach((button) => button.addEventListener('click', () => go(button.dataset.viewTarget)));
document.querySelectorAll('[data-view-jump]').forEach((button) => button.addEventListener('click', () => go(button.dataset.viewJump)));
window.addEventListener('hashchange', () => showView(activeViewFromHash()));

const result = document.querySelector('#result');
const rideEmpty = document.querySelector('#rideEmpty');
const rideActions = document.querySelector('#rideActions');
const realtimePanel = document.querySelector('#realtimePanel');
const roomEmpty = document.querySelector('#roomEmpty');
const roomNav = document.querySelector('[data-view-target="room"]');
const createCard = document.querySelector('#createCard');
let automaticMemberEntryDone = false;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}

function installInviteStyles() {
  if (document.querySelector('#rydeInviteStyles')) return;
  const style = document.createElement('style');
  style.id = 'rydeInviteStyles';
  style.textContent = `
    .ryde-invite{margin-top:18px;border:1px solid #1d4650;border-radius:18px;background:linear-gradient(135deg,rgba(12,31,37,.96),rgba(7,18,22,.96));padding:22px;display:grid;grid-template-columns:minmax(180px,240px) 1fr;gap:24px;align-items:center}
    .ryde-invite-qr{background:#fff;border-radius:15px;padding:10px;line-height:0}.ryde-invite-qr svg{display:block;width:100%;height:auto}
    .ryde-invite-copy h3{font-size:25px;margin:6px 0}.ryde-invite-copy p{color:#82aab3;line-height:1.5;margin:0 0 14px}.ryde-invite-code{font-size:11px;color:#668e97;letter-spacing:.14em}.ryde-invite-code strong{display:block;font-size:28px;color:#e9fbff;letter-spacing:.18em;margin-top:5px}.ryde-invite-url{display:block;margin:14px 0;color:#6fa7b2;font-size:11px;word-break:break-all}.ryde-invite-actions{display:flex;gap:8px;flex-wrap:wrap}
    @media(max-width:680px){.ryde-invite{grid-template-columns:1fr}.ryde-invite-qr{width:min(270px,100%);margin:0 auto}.ryde-invite-copy{text-align:center}.ryde-invite-actions{justify-content:center}}
  `;
  document.head.append(style);
}

function currentRoomSession() {
  const incoming = new URLSearchParams(location.search).get('room');
  if (!incoming) return null;
  try {
    const saved = JSON.parse(localStorage.getItem('rydesync:last-session') || 'null');
    if (!saved?.room?.joinCode || !saved?.token) return null;
    if (![saved.room.id, saved.room.joinCode].includes(incoming)) return null;
    return saved;
  } catch {
    return null;
  }
}

function renderInvite() {
  installInviteStyles();
  const session = currentRoomSession();
  let panel = document.querySelector('#rydeInvite');
  if (!session) {
    panel?.remove();
    return;
  }

  const room = session.room;
  const joinUrl = `${location.origin}/join/${encodeURIComponent(room.joinCode)}`;
  if (!panel) {
    panel = document.createElement('section');
    panel.id = 'rydeInvite';
    panel.className = 'ryde-invite';
    if (rideActions) rideActions.before(panel);
    else result?.after(panel);
  }
  const heading = session.member?.role === 'host' ? 'Invite the crew' : 'Share this Ryde';
  panel.innerHTML = `
    <div class="ryde-invite-qr">${qrSvg(joinUrl)}</div>
    <div class="ryde-invite-copy">
      <div class="card-kicker">SCAN TO JOIN</div>
      <h3>${escapeHtml(heading)}</h3>
      <p>Scan once. The Ryde ID is already built into the invite. Riders choose guest access or AeroVista sign-in on the next screen.</p>
      <div class="ryde-invite-code">JOIN ID<strong>${escapeHtml(room.joinCode)}</strong></div>
      <span class="ryde-invite-url">${escapeHtml(joinUrl)}</span>
      <div class="ryde-invite-actions">
        <button id="copyRydeInvite" type="button" class="mini">Copy join link</button>
        <button id="shareRydeInvite" type="button" class="mini secondary">Share</button>
      </div>
    </div>`;

  const copy = panel.querySelector('#copyRydeInvite');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      copy.textContent = 'Copied';
      setTimeout(() => { copy.textContent = 'Copy join link'; }, 1400);
    } catch {
      copy.textContent = joinUrl;
    }
  });
  const share = panel.querySelector('#shareRydeInvite');
  if (!navigator.share) share.hidden = true;
  else share.addEventListener('click', () => navigator.share({ title: `Join ${room.name || 'my Ryde'}`, text: `Join ${room.name || 'my Ryde'} on RydeSync`, url: joinUrl }).catch(() => {}));
}

function syncRideState() {
  const hasResult = result && !result.classList.contains('hidden');
  if (rideEmpty) rideEmpty.hidden = Boolean(hasResult);
  renderInvite();
}

function syncRoomState() {
  const connected = realtimePanel && !realtimePanel.classList.contains('hidden');
  if (roomEmpty) roomEmpty.hidden = Boolean(connected);
  if (rideActions) rideActions.classList.toggle('hidden', !connected);
  if (roomNav) roomNav.classList.toggle('room-ready', Boolean(connected));
  if (roomNav) {
    let dot = roomNav.querySelector('.room-ready-dot');
    if (connected && !dot) {
      dot = document.createElement('i');
      dot.className = 'room-ready-dot';
      dot.setAttribute('aria-label', 'Room connected');
      roomNav.append(dot);
    } else if (!connected && dot) dot.remove();
  }
  renderInvite();
}

function syncMemberEntry() {
  const canHost = createCard && !createCard.classList.contains('hidden');
  if (!automaticMemberEntryDone && canHost && !window.location.hash) {
    automaticMemberEntryDone = true;
    go('ride');
  }
}

new MutationObserver(syncRideState).observe(result, { attributes: true, attributeFilter: ['class'] });
new MutationObserver(syncRoomState).observe(realtimePanel, { attributes: true, attributeFilter: ['class'] });
if (createCard) new MutationObserver(syncMemberEntry).observe(createCard, { attributes: true, attributeFilter: ['class'] });

for (const formId of ['createForm', 'joinForm']) {
  document.querySelector(`#${formId}`)?.addEventListener('submit', () => go('ride'));
}

document.querySelector('#identityPill')?.addEventListener('click', () => go('access'));

syncRideState();
syncRoomState();
syncMemberEntry();
showView(activeViewFromHash());
