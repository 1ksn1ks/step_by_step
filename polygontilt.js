// Subtle tilt for polygon pictures on the map. The image is a quad of
// geographic corners. Those corners move a few screen pixels so the
// picture leans toward the pointer. The popup is not involved.

const MAX_DEG = 8;
const EASE_MS = 60;

const quads = new Map();
let mapRef = null;
let running = false;
let activeId = null;
let pointer = null;
let touching = false;
let listening = false;
let lastNow = 0;

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function boundsOf(points) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, maxX, minY, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

function onScreen(box, width, height) {
  return box.maxX >= -40 && box.minX <= width + 40 && box.maxY >= -40 && box.minY <= height + 40;
}

function lean(points, nx, ny, bobY) {
  const box = boundsOf(points);
  const half = Math.max(8, Math.min(box.maxX - box.minX, box.maxY - box.minY) / 2);
  const shift = half * Math.tan(MAX_DEG * Math.PI / 180);
  return points.map((p) => {
    const vx = p.x - box.cx;
    const vy = p.y - box.cy;
    const len = Math.hypot(vx, vy) || 1;
    const align = clamp((vx / len) * nx + (vy / len) * ny, -1, 1);
    return {
      x: p.x + (vx / len) * align * shift,
      y: p.y + (vy / len) * align * shift + bobY,
    };
  });
}

function closeEnough(next, base) {
  for (let i = 0; i < 4; i++) {
    if (Math.abs(next[i][0] - base[i][0]) > 15) return false;
    if (Math.abs(next[i][1] - base[i][1]) > 15) return false;
  }
  return true;
}

function writeCoordinates(source, quad, next) {
  if (!closeEnough(next, quad.coordinates)) return;
  try {
    source.setCoordinates(next);
    quad.dirty = true;
  } catch {
    quads.delete(quad.sourceId);
  }
}

function restore(quad) {
  if (!mapRef || !quad.dirty) return;
  const source = mapRef.getSource(quad.sourceId);
  if (source && source.setCoordinates) {
    try { source.setCoordinates(quad.coordinates); } catch { /* source already gone */ }
  }
  quad.dirty = false;
  quad.nx = 0;
  quad.ny = 0;
}

function restoreAll() {
  for (const quad of quads.values()) restore(quad);
}

function maskIds() {
  const ids = [];
  for (const quad of quads.values()) {
    if (mapRef.getLayer(quad.maskLayerId)) ids.push(quad.maskLayerId);
  }
  return ids;
}

function pick(event) {
  pointer = event.point || null;
  const ids = maskIds();
  if (!ids.length || !pointer) {
    activeId = null;
    return;
  }
  let hits = [];
  try {
    hits = mapRef.queryRenderedFeatures(pointer, { layers: ids });
  } catch {
    hits = [];
  }
  if (!hits.length) {
    activeId = null;
    return;
  }
  const layerId = hits[0].layer && hits[0].layer.id;
  activeId = null;
  for (const quad of quads.values()) {
    if (quad.maskLayerId === layerId) {
      activeId = quad.sourceId;
      return;
    }
  }
}

function bindPointer() {
  if (listening || !mapRef) return;
  listening = true;
  mapRef.on('mousemove', (event) => {
    if (touching) return;
    const native = event.originalEvent;
    if (native && native.pointerType === 'touch') return;
    pick(event);
  });
  mapRef.on('mouseout', () => {
    if (touching) return;
    activeId = null;
    pointer = null;
  });
  mapRef.on('touchstart', (event) => {
    touching = true;
    pick(event);
  });
  mapRef.on('touchmove', (event) => {
    if (!touching) return;
    pick(event);
  });
  mapRef.on('touchend', () => {
    touching = false;
    activeId = null;
    pointer = null;
  });
  mapRef.on('touchcancel', () => {
    touching = false;
    activeId = null;
    pointer = null;
  });
}

function frame(now) {
  if (!mapRef || quads.size === 0 || document.hidden || reducedMotion()) {
    if (reducedMotion() || document.hidden) restoreAll();
    running = false;
    if (document.hidden) {
      document.addEventListener('visibilitychange', () => ensureLoop(), { once: true });
    }
    return;
  }
  const dt = lastNow ? Math.min(64, now - lastNow) : 16;
  lastNow = now;
  const ease = 1 - Math.exp(-dt / EASE_MS);
  const canvas = mapRef.getCanvas();
  const viewW = canvas.clientWidth;
  const viewH = canvas.clientHeight;
  // 0 at the start of the cycle, -4px at the middle, back to 0. One cycle is 6s.
  const bob = (Math.cos((now / 6000) * Math.PI * 2) - 1) * 2;

  for (const quad of quads.values()) {
    const source = mapRef.getSource(quad.sourceId);
    if (!source || !source.setCoordinates) {
      quads.delete(quad.sourceId);
      continue;
    }
    let visible = false;
    try {
      visible = !!mapRef.getLayer(quad.layerId)
        && mapRef.getLayoutProperty(quad.layerId, 'visibility') !== 'none';
    } catch {
      visible = false;
    }
    if (!visible) {
      restore(quad);
      continue;
    }
    let projected;
    try {
      projected = quad.coordinates.map((coord) => mapRef.project(coord));
    } catch {
      continue;
    }
    const box = boundsOf(projected);
    if (!onScreen(box, viewW, viewH)) {
      restore(quad);
      continue;
    }
    const hot = quad.sourceId === activeId && pointer;
    let tx = 0;
    let ty = 0;
    if (hot) {
      const halfW = Math.max(8, (box.maxX - box.minX) / 2);
      const halfH = Math.max(8, (box.maxY - box.minY) / 2);
      tx = clamp((pointer.x - box.cx) / halfW, -1, 1);
      ty = clamp((pointer.y - box.cy) / halfH, -1, 1);
    }
    quad.nx += (tx - quad.nx) * ease;
    quad.ny += (ty - quad.ny) * ease;
    const mag = Math.hypot(quad.nx, quad.ny);
    const bobY = bob * (1 - Math.min(1, mag));
    if (mag < 0.02 && Math.abs(bobY) < 0.25) {
      restore(quad);
      continue;
    }
    const leaned = lean(projected, quad.nx, quad.ny, bobY);
    const next = [];
    let ok = true;
    for (const point of leaned) {
      try {
        const ll = mapRef.unproject([point.x, point.y]);
        next.push([ll.lng, ll.lat]);
      } catch {
        ok = false;
        break;
      }
    }
    if (!ok || next.length !== 4) continue;
    writeCoordinates(source, quad, next);
  }

  if (quads.size > 0 && !reducedMotion()) requestAnimationFrame(frame);
  else running = false;
}

function ensureLoop() {
  if (running || !mapRef || quads.size === 0 || reducedMotion()) return;
  running = true;
  lastNow = 0;
  requestAnimationFrame(frame);
}

export function watchPolygonTilt(map, sourceId, layerId, maskLayerId, coordinates) {
  if (reducedMotion() || !map || !sourceId || !coordinates) return;
  mapRef = map;
  quads.set(sourceId, {
    sourceId,
    layerId,
    maskLayerId,
    coordinates: coordinates.map((coord) => [coord[0], coord[1]]),
    nx: 0,
    ny: 0,
    dirty: false,
  });
  bindPointer();
  ensureLoop();
}

export function forgetPolygonTilt(polygonId) {
  if (!polygonId) return;
  const sourceId = `${polygonId}-source`;
  const quad = quads.get(sourceId);
  if (!quad) return;
  restore(quad);
  quads.delete(sourceId);
  if (activeId === sourceId) activeId = null;
}
