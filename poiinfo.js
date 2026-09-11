import maplibregl from 'maplibre-gl';
import { map } from './map.js';

// Plain tap/click on the map (PC left-click, phone tap) → a question:
// "Do you want to open this place in Google Maps?" — Yes opens Google Maps
// for that spot in a new tab, No/×/outside just closes.
//
// Right-click and press-hold (the 📍/🔷 pin in drawhere.js) must keep
// working, so the hold is mirrored here (same 500 ms / 12 px tolerance)
// and the click a hold generates is swallowed.

const HOLD_MS = 500;
const MOVE_TOLERANCE = 12; // px — same as drawhere.js

const canvas = map.getCanvas();

let suppressClickUntil = 0;
let holdTimer = null;
let holdStart = null;

canvas.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 1) return;
  const t = e.touches[0];
  holdStart = { x: t.clientX, y: t.clientY };
  holdTimer = setTimeout(() => {
    holdTimer = null;
    suppressClickUntil = Date.now() + 600; // the hold became a pin, not a tap
  }, HOLD_MS);
}, { passive: true });

canvas.addEventListener('touchmove', (e) => {
  if (!holdTimer || !holdStart) return;
  const t = e.touches[0];
  if (Math.hypot(t.clientX - holdStart.x, t.clientY - holdStart.y) > MOVE_TOLERANCE) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
}, { passive: true });

canvas.addEventListener('touchend', () => {
  if (holdTimer) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
}, { passive: true });

canvas.addEventListener('touchcancel', () => {
  if (holdTimer) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
}, { passive: true });

let question = null;
let questionPin = null;

function closeQuestion() {
  if (questionPin) {
    questionPin.remove();
    questionPin = null;
  }
  if (question) {
    question.remove();
    question = null;
  }
}

function askGoogleMaps(lngLat) {
  closeQuestion();
  const { lng, lat } = lngLat;

  // Teardrop pin at the pressed spot (same look/animation as the draw-here pin)
  const pinEl = document.createElement('div');
  pinEl.className = 'draw-here-pin';
  questionPin = new maplibregl.Marker({ element: pinEl, anchor: 'bottom' })
    .setLngLat([lng, lat])
    .addTo(map);

  const backdrop = document.createElement('div');
  backdrop.style.cssText = 'position: fixed; inset: 0; z-index: 1010; background: rgba(0, 0, 0, 0.35); display: flex; align-items: center; justify-content: center;';

  const card = document.createElement('div');
  card.style.cssText = 'position: relative; background: rgba(15, 15, 20, 0.85); -webkit-backdrop-filter: blur(10px) saturate(140%); backdrop-filter: blur(10px) saturate(140%); border: 0.2vh solid rgba(255, 255, 255, 0.3); border-radius: 1vh; padding: 2vh 2.5vh; color: white; font-family: Arial, sans-serif; text-align: center; max-width: 80vw;';

  const q = document.createElement('div');
  q.textContent = 'Do you want to open this place in Google Maps?';
  q.style.cssText = 'font-size: 2.2vh; margin-bottom: 2vh;';

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display: flex; gap: 1.5vh; justify-content: center;';

  const yes = document.createElement('button');
  yes.textContent = 'Yes';
  yes.style.cssText = 'background: rgba(34, 211, 238, 0.9); color: black; border: none; border-radius: 1vh; padding: 0.8vh 2.5vh; font-size: 1.8vh; font-weight: 600; cursor: pointer;';

  const no = document.createElement('button');
  no.textContent = 'No';
  no.style.cssText = 'background: rgba(255, 255, 255, 0.12); color: white; border: 0.1vh solid rgba(255, 255, 255, 0.3); border-radius: 1vh; padding: 0.8vh 2.5vh; font-size: 1.8vh; cursor: pointer;';

  const close = document.createElement('span');
  close.textContent = '×';
  close.style.cssText = 'position: absolute; top: 0.7vh; right: 1vh; font-size: 2.4vh; color: gray; cursor: pointer;';

  yes.onclick = () => {
    closeQuestion();
    window.open(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`, '_blank', 'noopener');
  };
  no.onclick = closeQuestion;
  close.onclick = closeQuestion;

  btnRow.appendChild(yes);
  btnRow.appendChild(no);
  card.appendChild(q);
  card.appendChild(btnRow);
  card.appendChild(close);
  backdrop.appendChild(card);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeQuestion();
  });

  document.body.appendChild(backdrop);
  question = backdrop;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeQuestion();
});

map.on('click', (e) => {
  if (Date.now() < suppressClickUntil) return; // it was a press-hold, not a tap
  // Globe mode: a tap in empty space (outside the globe) must not trigger —
  // isPointOnMapSurface does a ray/sphere intersection test (true in 2D mode).
  if (!map.transform.isPointOnMapSurface(e.point)) return;
  // Polygon taps open their own popup — don't ask twice
  const hits = map.queryRenderedFeatures(e.point);
  if (hits.some((f) => f.layer && f.layer.id.includes('-mask-layer'))) return;
  askGoogleMaps(e.lngLat);
});
