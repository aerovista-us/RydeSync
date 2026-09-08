const MPH_PATTERN = /(-?\d+(?:\.\d+)?)\s*mph/i;
let decorateQueued = false;

function installPolishStyles() {
  if (typeof document === 'undefined' || document.querySelector('link[href="/rider-polish.css"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/rider-polish.css';
  document.head.appendChild(link);
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function mapSpeedsByUniqueName() {
  const speeds = new Map();
  const duplicates = new Set();
  if (typeof document === 'undefined') return speeds;

  for (const label of document.querySelectorAll('#crewMap .map-label')) {
    const name = clean(label.querySelector('strong')?.textContent);
    const match = clean(label.querySelector('small')?.textContent).match(MPH_PATTERN);
    if (!name || name === 'You' || !match) continue;
    if (speeds.has(name)) duplicates.add(name);
    speeds.set(name, `${Math.round(Number(match[1]))} MPH`);
  }

  for (const name of duplicates) speeds.delete(name);
  return speeds;
}

function decorateCrewStrip(speeds) {
  for (const chip of document.querySelectorAll('#dashCrewStrip .dashboard-crew-chip')) {
    const name = clean(chip.querySelector('strong')?.textContent);
    const detail = chip.querySelector('small');
    if (!detail) continue;

    if (!detail.dataset.rydeRole) detail.dataset.rydeRole = clean(detail.textContent) || 'rider';
    const mph = speeds.get(name);
    detail.textContent = mph ? `${detail.dataset.rydeRole} · ${mph}` : detail.dataset.rydeRole;
    detail.classList.toggle('dashboard-crew-speed', Boolean(mph));
  }
}

function decorateMiniMapLabels(speeds) {
  for (const label of document.querySelectorAll('#dashMiniMap .map-label')) {
    const name = clean(label.querySelector('strong')?.textContent);
    const mph = speeds.get(name);
    let detail = label.querySelector('small');

    if (!mph) {
      if (detail?.dataset.rydePolish === 'speed') detail.remove();
      continue;
    }

    if (!detail) {
      detail = document.createElement('small');
      detail.dataset.rydePolish = 'speed';
      label.appendChild(detail);
    }
    detail.textContent = mph.toLowerCase();
  }
}

function decorateDashboard() {
  if (typeof document === 'undefined') return;
  const speeds = mapSpeedsByUniqueName();
  decorateCrewStrip(speeds);
  decorateMiniMapLabels(speeds);
}

function queueDecorate() {
  if (decorateQueued || typeof document === 'undefined') return;
  decorateQueued = true;
  const schedule = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (callback) => setTimeout(callback, 0);
  schedule(() => {
    decorateQueued = false;
    decorateDashboard();
  });
}

function initializeRiderPolish() {
  if (typeof document === 'undefined') return;
  installPolishStyles();
  if (typeof MutationObserver === 'function') {
    new MutationObserver(queueDecorate).observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  queueDecorate();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeRiderPolish, { once: true });
  } else {
    initializeRiderPolish();
  }
}
if (typeof window !== 'undefined') window.addEventListener('rydesync:self-location', queueDecorate);
