import { CrewMap } from '/map.js';

const MPH_PER_MPS = 2.2369362921;
const originalSetLocations = CrewMap.prototype.setLocations;
let canonicalSnapshot = { locations: [], members: [], selfMemberId: null };
let decorateQueued = false;

function clean(value) {
  return String(value || '').trim();
}

function speedMph(speed) {
  return Number.isFinite(speed) && speed >= 0 ? speed * MPH_PER_MPS : null;
}

function locationsByUniqueName() {
  const members = new Map(canonicalSnapshot.members.map((member) => [member.id, member]));
  const byName = new Map();
  const duplicates = new Set();

  for (const entry of canonicalSnapshot.locations) {
    const name = clean(members.get(entry.memberId)?.displayName);
    if (!name) continue;
    if (byName.has(name)) duplicates.add(name);
    byName.set(name, entry);
  }

  for (const name of duplicates) byName.delete(name);
  return byName;
}

function decorateCrewStrip() {
  const byName = locationsByUniqueName();
  for (const chip of document.querySelectorAll('#dashCrewStrip .dashboard-crew-chip')) {
    const name = clean(chip.querySelector('strong')?.textContent);
    const detail = chip.querySelector('small');
    if (!detail) continue;

    if (!detail.dataset.rydeRole) detail.dataset.rydeRole = clean(detail.textContent) || 'rider';
    const mph = speedMph(byName.get(name)?.speed);
    detail.textContent = mph == null ? detail.dataset.rydeRole : `${detail.dataset.rydeRole} · ${mph.toFixed(0)} MPH`;
    detail.classList.toggle('dashboard-crew-speed', mph != null);
  }
}

function decorateMiniMapLabels() {
  const byName = locationsByUniqueName();
  for (const label of document.querySelectorAll('#dashMiniMap .map-label')) {
    const riderName = clean(label.querySelector('strong')?.textContent);
    const source = riderName === 'You'
      ? canonicalSnapshot.locations.find((entry) => entry.memberId === canonicalSnapshot.selfMemberId)
      : byName.get(riderName);
    const mph = speedMph(source?.speed);
    let detail = label.querySelector('small');

    if (mph == null) {
      if (detail?.dataset.rydePolish === 'speed') detail.remove();
      continue;
    }

    if (!detail) {
      detail = document.createElement('small');
      detail.dataset.rydePolish = 'speed';
      label.appendChild(detail);
    }
    detail.textContent = `${mph.toFixed(0)} mph`;
  }
}

function decorateDashboard() {
  decorateCrewStrip();
  decorateMiniMapLabels();
}

function queueDecorate() {
  if (decorateQueued) return;
  decorateQueued = true;
  requestAnimationFrame(() => {
    decorateQueued = false;
    decorateDashboard();
  });
}

CrewMap.prototype.setLocations = function setLocationsWithRiderPolish(locations, options = {}) {
  const list = Array.isArray(locations) ? locations : [];
  const elementId = this.el?.id || '';

  if (elementId === 'crewMap') {
    canonicalSnapshot = {
      locations: list.map((entry) => ({ ...entry })),
      members: Array.isArray(options.members) ? options.members.map((member) => ({ ...member })) : [],
      selfMemberId: options.selfMemberId || null
    };
    const result = originalSetLocations.call(this, locations, options);
    queueDecorate();
    return result;
  }

  if (elementId === 'dashMiniMap' && canonicalSnapshot.locations.length) {
    const byName = locationsByUniqueName();
    const enhanced = list.map((entry) => {
      const source = byName.get(clean(entry.name));
      if (!source) return entry;
      return {
        ...entry,
        speed: source.speed,
        heading: source.heading,
        receivedAt: source.receivedAt || source.serverTs || entry.receivedAt
      };
    });
    const result = originalSetLocations.call(this, enhanced, options);
    queueDecorate();
    return result;
  }

  return originalSetLocations.call(this, locations, options);
};

const observer = new MutationObserver(queueDecorate);
function initializeRiderPolish() {
  observer.observe(document.body, { childList: true, subtree: true });
  queueDecorate();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeRiderPolish, { once: true });
} else {
  initializeRiderPolish();
}
window.addEventListener('rydesync:self-location', queueDecorate);
