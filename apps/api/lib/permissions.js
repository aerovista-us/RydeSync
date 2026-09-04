const MODERATED_VOICE = new Set(['classroom', 'campaign']);

export function canUseVoice(roomMode, role) {
  if (!role) return false;
  if (['host', 'co_host'].includes(role)) return true;
  if (MODERATED_VOICE.has(roomMode)) return role === 'speaker';
  if (roomMode === 'band_practice') return role === 'speaker';
  if (roomMode === 'group_ride') return ['rider', 'speaker'].includes(role);
  if (roomMode === 'listening_party') return ['listener', 'rider', 'speaker'].includes(role);
  return false;
}

export function canControlPlayback(member) {
  return Boolean(member?.identityId) && ['host', 'co_host'].includes(member?.role);
}

export function canHostRoom(principal) {
  return Boolean(principal?.authenticated && principal?.identityId);
}
