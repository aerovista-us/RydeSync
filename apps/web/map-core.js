export const TILE_SIZE = 256;
export const MAX_MERCATOR_LAT = 85.05112878;

export function clampLat(lat) {
  return Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, Number(lat) || 0));
}

export function normalizeLon(lon) {
  let value = Number(lon) || 0;
  while (value < -180) value += 360;
  while (value >= 180) value -= 360;
  return value;
}

export function lonToWorldX(lon, zoom) {
  const scale = TILE_SIZE * 2 ** zoom;
  return ((normalizeLon(lon) + 180) / 360) * scale;
}

export function latToWorldY(lat, zoom) {
  const scale = TILE_SIZE * 2 ** zoom;
  const rad = clampLat(lat) * Math.PI / 180;
  const merc = Math.log(Math.tan(Math.PI / 4 + rad / 2));
  return (1 - merc / Math.PI) / 2 * scale;
}

export function worldXToLon(x, zoom) {
  const scale = TILE_SIZE * 2 ** zoom;
  return normalizeLon((x / scale) * 360 - 180);
}

export function worldYToLat(y, zoom) {
  const scale = TILE_SIZE * 2 ** zoom;
  const n = Math.PI - 2 * Math.PI * y / scale;
  return clampLat(180 / Math.PI * Math.atan(Math.sinh(n)));
}

export function metersPerPixel(lat, zoom) {
  return 156543.03392 * Math.cos(clampLat(lat) * Math.PI / 180) / 2 ** zoom;
}

export function fitLocations(locations, width, height, { minZoom = 2, maxZoom = 18, padding = 72 } = {}) {
  const valid = (locations || []).filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
  if (!valid.length) return null;
  if (valid.length === 1) return { latitude: valid[0].latitude, longitude: valid[0].longitude, zoom: Math.min(15, maxZoom) };

  // Unwrap longitudes around the first point so groups near the dateline fit correctly.
  const anchor = normalizeLon(valid[0].longitude);
  const unwrapped = valid.map((p) => {
    let lon = normalizeLon(p.longitude);
    while (lon - anchor > 180) lon -= 360;
    while (lon - anchor < -180) lon += 360;
    return { latitude: clampLat(p.latitude), longitude: lon };
  });
  const minLat = Math.min(...unwrapped.map((p) => p.latitude));
  const maxLat = Math.max(...unwrapped.map((p) => p.latitude));
  const minLon = Math.min(...unwrapped.map((p) => p.longitude));
  const maxLon = Math.max(...unwrapped.map((p) => p.longitude));
  const center = { latitude: (minLat + maxLat) / 2, longitude: normalizeLon((minLon + maxLon) / 2) };

  const usableW = Math.max(64, width - padding * 2);
  const usableH = Math.max(64, height - padding * 2);
  let chosen = minZoom;
  for (let zoom = minZoom; zoom <= maxZoom; zoom += 1) {
    const xs = unwrapped.map((p) => ((p.longitude + 180) / 360) * TILE_SIZE * 2 ** zoom);
    const ys = unwrapped.map((p) => latToWorldY(p.latitude, zoom));
    if (Math.max(...xs) - Math.min(...xs) <= usableW && Math.max(...ys) - Math.min(...ys) <= usableH) chosen = zoom;
    else break;
  }
  return { ...center, zoom: Math.max(minZoom, Math.min(maxZoom, chosen)) };
}
