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
  const labels = { access: 'Login', ride: 'Ryde', room: 'Room + Map', music: 'Music' };
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

function syncRideState() {
  const hasResult = result && !result.classList.contains('hidden');
  if (rideEmpty) rideEmpty.hidden = Boolean(hasResult);
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
