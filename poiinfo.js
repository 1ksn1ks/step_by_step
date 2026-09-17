import { map } from './map.js';
import { closeDrawAnchor } from './drawhere.js';

// Long-press (phone) / right-click (PC) on the map → a question:
// "Do you want to open this place in Google Maps?" — Yes opens Google Maps
// for that spot in a new tab, No/×/outside just closes.
//
// The plain tap/click (the 📍/🔷 pin in drawhere.js) must keep working,
// so the tap a hold generates is swallowed via holdJustHappened().

const HOLD_MS = 500;
const MOVE_TOLERANCE = 12; // px — same as drawhere.js

const canvas = map.getCanvas();

let suppressClickUntil = 0;
let holdTimer = null;
let holdStart = null;
let lastTouchTime = 0;

// drawhere.js checks this to skip the tap that a long-press generates
export function holdJustHappened() {
  return Date.now() < suppressClickUntil;
}

canvas.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 1) return;
  lastTouchTime = Date.now();
  const t = e.touches[0];
  holdStart = { x: t.clientX, y: t.clientY };
  holdTimer = setTimeout(() => {
    holdTimer = null;
    suppressClickUntil = Date.now() + 600; // the hold became a question, not a tap
    const rect = canvas.getBoundingClientRect();
    askGoogleMaps(map.unproject([t.clientX - rect.left, t.clientY - rect.top]));
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
  closeDrawAnchor(); // a long-press replaces an open 📍/🔷 pin
  closeQuestion();
  const { lng, lat } = lngLat;

  // The draw-here pin itself: same anchor structure, positioned with left/top
  // (a MapLibre Marker would set an inline transform the drop animation overrides)
  const pinAnchor = document.createElement('div');
  pinAnchor.className = 'draw-here-anchor';
  const pinEl = document.createElement('div');
  pinEl.className = 'draw-here-pin';
  pinEl.onclick = closeQuestion; // like the draw-here pin: tap closes
  pinAnchor.appendChild(pinEl);
  const p = map.project([lng, lat]);
  pinAnchor.style.left = p.x + 'px';
  pinAnchor.style.top = p.y + 'px';
  document.body.appendChild(pinAnchor);
  questionPin = pinAnchor;

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

// PC: right-click (the PC twin of the phone long-press)
canvas.addEventListener('contextmenu', (e) => {
  if (Date.now() - lastTouchTime < 1000) return; // touch-origin (iOS long-press ghost)
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  askGoogleMaps(map.unproject([e.clientX - rect.left, e.clientY - rect.top]));
});
