const $ = (selector) => document.querySelector(selector);

function roomCodeFromPath() {
  const match = /^\/join\/([^/]+)\/?$/i.exec(location.pathname);
  return match ? decodeURIComponent(match[1]).trim().toUpperCase() : '';
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body?.error?.message || `HTTP ${response.status}`), { body, status: response.status });
  return body;
}

function saveRoomSession(room, member, token) {
  const value = { room, member, token, savedAt: new Date().toISOString() };
  localStorage.setItem(`rydesync:session:${room.id}`, JSON.stringify(value));
  localStorage.setItem('rydesync:last-session', JSON.stringify(value));
}

function showError(message) {
  const el = $('#joinError');
  el.textContent = message;
  el.classList.remove('hidden');
  $('#choicePanel')?.classList.add('hidden');
  $('#memberPanel')?.classList.add('hidden');
}

function finishJoin(joined) {
  saveRoomSession(joined.room, joined.member, joined.token);
  location.replace(`/?room=${encodeURIComponent(joined.room.joinCode)}#room`);
}

async function joinRoom(code, displayName = '') {
  const joined = await api(`/v1/rooms/${encodeURIComponent(code)}/join`, {
    method: 'POST',
    body: JSON.stringify({ displayName: displayName || 'Guest Rider' })
  });
  finishJoin(joined);
}

async function init() {
  const code = roomCodeFromPath();
  $('#roomCode').textContent = code || 'INVALID';
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) return showError('This Ryde invite is not valid. Ask the host for a new QR code or join link.');

  try {
    const [roomBody, bootstrap, session] = await Promise.all([
      api(`/v1/rooms/${encodeURIComponent(code)}`),
      api('/v1/bootstrap'),
      api('/v1/session')
    ]);
    const room = roomBody.room;
    $('#roomName').textContent = room.name || 'Ryde';
    $('#roomMeta').textContent = `${String(room.mode || 'group ride').replaceAll('_', ' ')} · ${room.memberCount || 0} in room${room.locked ? ' · locked to new riders' : ''}`;
    document.title = `Join ${room.name || 'Ryde'} · RydeSync`;

    if (room.locked) return showError('This Ryde is currently locked to new riders.');

    const next = `/join/${encodeURIComponent(code)}`;
    const signIn = $('#memberSignIn');
    signIn.href = bootstrap.identity?.loginConfigured ? `/auth/login?next=${encodeURIComponent(next)}` : '#';
    signIn.classList.toggle('disabled', !bootstrap.identity?.loginConfigured);
    if (!bootstrap.identity?.loginConfigured) $('#memberHint').textContent = 'AeroVista sign-in is temporarily unavailable. Guest join is still available.';

    if (session.principal?.authenticated) {
      $('#choicePanel').classList.add('hidden');
      $('#memberPanel').classList.remove('hidden');
      const label = session.principal.displayName || 'AeroVista Member';
      $('#memberStatus').textContent = `Signed in as ${label}. Joining this Ryde…`;
      const signedInReturn = new URLSearchParams(location.search).get('signed_in') === '1';
      if (signedInReturn) {
        try { await joinRoom(code, label); }
        catch (error) { showError(error.body?.error?.message || error.message); }
        return;
      }
      const button = $('#memberJoin');
      button.textContent = `Join as ${label}`;
      button.classList.remove('hidden');
      button.addEventListener('click', async () => {
        button.disabled = true;
        try { await joinRoom(code, label); }
        catch (error) { button.disabled = false; showError(error.body?.error?.message || error.message); }
      }, { once: true });
      return;
    }

    $('#choicePanel').classList.remove('hidden');
    $('#guestJoinForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = event.currentTarget.querySelector('button[type="submit"]');
      button.disabled = true;
      button.textContent = 'Joining…';
      try { await joinRoom(code, $('#guestName').value.trim()); }
      catch (error) {
        button.disabled = false;
        button.textContent = 'Continue as Guest';
        showError(error.body?.error?.message || error.message);
      }
    });
  } catch (error) {
    const codeName = error.body?.error?.code;
    showError(codeName === 'room_not_found' ? 'This Ryde has ended or the invite has expired.' : (error.body?.error?.message || error.message));
  }
}

init().catch((error) => showError(error.message));
