import { TILE_SIZE, fitLocations, latToWorldY, lonToWorldX, metersPerPixel, normalizeLon, worldXToLon, worldYToLat } from '/map-core.js';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}

function tileUrl(template, z, x, y) {
  return template.replaceAll('{z}', String(z)).replaceAll('{x}', String(x)).replaceAll('{y}', String(y));
}

function ageClass(entry, staleAfterMs) {
  const age = Date.now() - Date.parse(entry.receivedAt || entry.serverTs || 0);
  if (!Number.isFinite(age) || age > staleAfterMs * 0.75) return 'stale';
  if (age > Math.min(30_000, staleAfterMs * 0.35)) return 'aging';
  return 'fresh';
}

export class CrewMap {
  constructor(element, config = {}) {
    this.el = element;
    this.config = {
      tileUrlTemplate: config.tileUrlTemplate || '',
      attribution: config.attribution || '',
      attributionUrl: config.attributionUrl || '',
      minZoom: Number(config.minZoom) || 2,
      maxZoom: Number(config.maxZoom) || 18,
      staleAfterMs: Number(config.staleAfterMs) || 120000
    };
    this.center = { latitude: 20, longitude: 0 };
    this.zoom = Math.max(this.config.minZoom, Math.min(this.config.maxZoom, 2));
    this.locations = [];
    this.members = [];
    this.selfMemberId = null;
    this.userInteracted = false;
    this.drag = null;
    this.pointers = new Map();
    this.pinch = null;
    this.#build();
    this.#bind();
    this.resizeObserver = new ResizeObserver(() => this.render());
    this.resizeObserver.observe(this.el);
  }

  #build() {
    this.el.innerHTML = `
      <div class="map-tiles" aria-hidden="true"></div>
      <div class="map-accuracy" aria-hidden="true"></div>
      <div class="map-markers"></div>
      <div class="map-empty">Waiting for a rider to share location</div>`;
    this.tilesEl = this.el.querySelector('.map-tiles');
    this.accuracyEl = this.el.querySelector('.map-accuracy');
    this.markersEl = this.el.querySelector('.map-markers');
    this.emptyEl = this.el.querySelector('.map-empty');
  }

  #bind() {
    this.el.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.userInteracted = true;
      this.zoomBy(event.deltaY < 0 ? 1 : -1, { x: event.offsetX, y: event.offsetY });
    }, { passive: false });
    const pointerDistance = () => {
      const points = [...this.pointers.values()];
      if (points.length < 2) return 0;
      return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    };
    this.el.addEventListener('pointerdown', (event) => {
      this.userInteracted = true;
      this.el.setPointerCapture(event.pointerId);
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pointers.size === 1) {
        this.drag = { x: event.clientX, y: event.clientY, centerX: lonToWorldX(this.center.longitude, this.zoom), centerY: latToWorldY(this.center.latitude, this.zoom) };
        this.pinch = null;
      } else if (this.pointers.size === 2) {
        this.drag = null;
        this.pinch = { distance: pointerDistance() };
      }
    });
    this.el.addEventListener('pointermove', (event) => {
      if (!this.pointers.has(event.pointerId)) return;
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pointers.size >= 2 && this.pinch) {
        const distance = pointerDistance();
        if (distance > this.pinch.distance * 1.28) {
          this.zoomBy(1);
          this.pinch.distance = distance;
        } else if (distance < this.pinch.distance * 0.78) {
          this.zoomBy(-1);
          this.pinch.distance = distance;
        }
        return;
      }
      if (!this.drag) return;
      const point = this.pointers.get(event.pointerId);
      const x = this.drag.centerX - (point.x - this.drag.x);
      const y = this.drag.centerY - (point.y - this.drag.y);
      this.center = { latitude: worldYToLat(y, this.zoom), longitude: worldXToLon(x, this.zoom) };
      this.render();
    });
    const end = (event) => {
      this.pointers.delete(event.pointerId);
      this.pinch = null;
      if (this.pointers.size === 1) {
        const [pointerId, point] = this.pointers.entries().next().value;
        this.drag = { pointerId, x: point.x, y: point.y, centerX: lonToWorldX(this.center.longitude, this.zoom), centerY: latToWorldY(this.center.latitude, this.zoom) };
      } else {
        this.drag = null;
      }
    };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
  }

  setConfig(config = {}) {
    Object.assign(this.config, config);
    this.render();
  }

  setLocations(locations, { members = [], selfMemberId = null, autoFit = false } = {}) {
    const hadNone = this.locations.length === 0;
    this.locations = Array.isArray(locations) ? locations : [];
    this.members = Array.isArray(members) ? members : [];
    this.selfMemberId = selfMemberId;
    if (this.locations.length && (autoFit || (hadNone && !this.userInteracted))) this.fitCrew();
    else this.render();
  }

  fitCrew() {
    const bounds = fitLocations(this.locations, this.el.clientWidth, this.el.clientHeight, {
      minZoom: this.config.minZoom,
      maxZoom: this.config.maxZoom,
      padding: this.el.clientWidth < 600 ? 42 : 72
    });
    if (bounds) {
      this.center = { latitude: bounds.latitude, longitude: bounds.longitude };
      this.zoom = bounds.zoom;
      this.userInteracted = false;
    }
    this.render();
  }

  zoomBy(delta, anchor = null) {
    const next = Math.max(this.config.minZoom, Math.min(this.config.maxZoom, this.zoom + delta));
    if (next === this.zoom) return;
    const width = this.el.clientWidth || 1;
    const height = this.el.clientHeight || 1;
    let anchorGeo = null;
    if (anchor) {
      const cx = lonToWorldX(this.center.longitude, this.zoom);
      const cy = latToWorldY(this.center.latitude, this.zoom);
      anchorGeo = {
        longitude: worldXToLon(cx + anchor.x - width / 2, this.zoom),
        latitude: worldYToLat(cy + anchor.y - height / 2, this.zoom)
      };
    }
    this.zoom = next;
    if (anchorGeo && anchor) {
      const ax = lonToWorldX(anchorGeo.longitude, next);
      const ay = latToWorldY(anchorGeo.latitude, next);
      this.center = {
        longitude: worldXToLon(ax - anchor.x + width / 2, next),
        latitude: worldYToLat(ay - anchor.y + height / 2, next)
      };
    }
    this.render();
  }

  render() {
    const width = this.el.clientWidth;
    const height = this.el.clientHeight;
    if (!width || !height) return;
    const centerX = lonToWorldX(this.center.longitude, this.zoom);
    const centerY = latToWorldY(this.center.latitude, this.zoom);
    const left = centerX - width / 2;
    const top = centerY - height / 2;
    this.#renderTiles(left, top, width, height);
    this.#renderLocations(left, top);
    this.emptyEl.hidden = this.locations.length > 0;
  }

  #renderTiles(left, top, width, height) {
    if (!this.config.tileUrlTemplate) {
      this.tilesEl.innerHTML = '';
      this.el.classList.add('map-no-tiles');
      return;
    }
    this.el.classList.remove('map-no-tiles');
    const count = 2 ** this.zoom;
    const minX = Math.floor(left / TILE_SIZE);
    const maxX = Math.floor((left + width) / TILE_SIZE);
    const minY = Math.max(0, Math.floor(top / TILE_SIZE));
    const maxY = Math.min(count - 1, Math.floor((top + height) / TILE_SIZE));
    const nodes = [];
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const wrappedX = ((x % count) + count) % count;
        const px = x * TILE_SIZE - left;
        const py = y * TILE_SIZE - top;
        nodes.push(`<img draggable="false" alt="" src="${escapeHtml(tileUrl(this.config.tileUrlTemplate, this.zoom, wrappedX, y))}" style="transform:translate(${Math.round(px)}px,${Math.round(py)}px)" />`);
      }
    }
    this.tilesEl.innerHTML = nodes.join('');
  }

  #renderLocations(left, top) {
    const memberMap = new Map(this.members.map((m) => [m.id, m]));
    const accuracy = [];
    const markers = [];
    for (const entry of this.locations) {
      if (!Number.isFinite(entry.latitude) || !Number.isFinite(entry.longitude)) continue;
      const x = lonToWorldX(entry.longitude, this.zoom) - left;
      const y = latToWorldY(entry.latitude, this.zoom) - top;
      const mpp = Math.max(0.01, metersPerPixel(entry.latitude, this.zoom));
      const diameter = Math.max(14, Math.min(300, (Number(entry.accuracy) || 0) * 2 / mpp));
      const member = memberMap.get(entry.memberId);
      const name = member?.displayName || 'Rider';
      const self = entry.memberId === this.selfMemberId;
      const state = ageClass(entry, this.config.staleAfterMs);
      const heading = Number.isFinite(entry.heading) ? entry.heading : 0;
      const speedMph = Number.isFinite(entry.speed) ? entry.speed * 2.236936 : null;
      accuracy.push(`<div class="map-accuracy-ring ${state}${self ? ' self' : ''}" style="left:${x}px;top:${y}px;width:${diameter}px;height:${diameter}px"></div>`);
      markers.push(`<div class="map-rider ${state}${self ? ' self' : ''}" style="left:${x}px;top:${y}px" title="${escapeHtml(name)}">
        <span class="map-heading" style="transform:rotate(${heading}deg)"></span>
        <span class="map-dot"></span>
        <span class="map-label"><strong>${escapeHtml(self ? 'You' : name)}</strong>${speedMph != null ? `<small>${speedMph.toFixed(0)} mph</small>` : ''}</span>
      </div>`);
    }
    this.accuracyEl.innerHTML = accuracy.join('');
    this.markersEl.innerHTML = markers.join('');
  }
}
