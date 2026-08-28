import test from 'node:test';
import assert from 'node:assert/strict';
import { fitLocations, latToWorldY, lonToWorldX, metersPerPixel, worldXToLon, worldYToLat } from '../map-core.js';

test('web mercator round trips longitude and latitude', () => {
  const zoom = 13;
  const lon = -116.7805;
  const lat = 47.6777;
  assert.ok(Math.abs(worldXToLon(lonToWorldX(lon, zoom), zoom) - lon) < 1e-7);
  assert.ok(Math.abs(worldYToLat(latToWorldY(lat, zoom), zoom) - lat) < 1e-7);
});

test('fitLocations centers a crew and chooses a useful zoom', () => {
  const fit = fitLocations([
    { latitude: 47.6777, longitude: -116.7805 },
    { latitude: 47.6900, longitude: -116.7600 },
    { latitude: 47.6650, longitude: -116.8000 }
  ], 900, 600, { minZoom: 2, maxZoom: 18, padding: 72 });
  assert.ok(fit);
  assert.ok(fit.zoom >= 12 && fit.zoom <= 16);
  assert.ok(fit.latitude > 47.66 && fit.latitude < 47.70);
});

test('metersPerPixel decreases as zoom increases', () => {
  assert.ok(metersPerPixel(45, 14) < metersPerPixel(45, 10));
});
