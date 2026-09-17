import { map } from './map.js';

// First-load onboarding: a 4-slide glass overlay shown on every site
// refresh, explaining the basics of the app.

const SLIDES = [
  {
    icon: '𝒊',
    title: 'Info overlays',
    body: 'The 𝒊 button (top bar) switches the help overlays on ✅ / off ⛔. When on, opening any panel pops up a short explanation of it.'
  },
  {
    icon: '📋',
    title: 'Coordinates',
    body: 'The coordinates field (top right) always shows where you are on the map — tap it to copy them.'
  },
  {
    icon: '📍',
    title: 'Drawing',
    body: 'Tap (phone) or left-click (PC) anywhere on the map to drop a pin — then add a 📍 marker there or draw a 🔷 polygon.'
  }
];

let slideIndex = 0;
let overlay = null;
let iconEl = null;
let titleEl = null;
let bodyEl = null;
let dotsEl = null;
let prevBtn = null;
let nextBtn = null;

function renderSlide(direction = 1) {
  const slide = SLIDES[slideIndex];
  iconEl.textContent = slide.icon;
  titleEl.textContent = slide.title;
  bodyEl.textContent = slide.body;
  Array.from(dotsEl.children).forEach((dot, i) => {
    dot.classList.toggle('onboard-dot-active', i === slideIndex);
  });
  nextBtn.textContent = slideIndex === SLIDES.length - 1 ? 'Got it' : 'Next ›';
  prevBtn.style.display = slideIndex === 0 ? 'none' : 'inline-block';
  // Slide-in: fade + nudge with the app's spring (nudges from the direction you came)
  const content = overlay.querySelector('.onboard-content');
  content.animate(
    [
      { opacity: 0, transform: `translateX(${24 * direction}px) scale(0.98)` },
      { opacity: 1, transform: 'translateX(0) scale(1)' }
    ],
    { duration: 260, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }
  );
}

function closeOnboarding() {
  if (!overlay) return;
  const el = overlay;
  overlay = null;
  // Stop blocking the map instantly and stop the border pulse so nothing
  // keeps the card "alive" while it fades
  el.style.pointerEvents = 'none';
  const card = el.querySelector('.onboard-card');
  if (card) card.style.animation = 'none';
  // Plain CSS transition for the fade (same technique as the loader), then
  // remove once the fade is done
  el.style.transition = 'opacity 0.25s ease-out';
  el.style.opacity = '0';
  setTimeout(() => el.remove(), 300);
}

function build() {
  overlay = document.createElement('div');
  overlay.className = 'onboard-overlay';
  overlay.id = 'onboard-overlay';

  const scrim = document.createElement('div');
  scrim.className = 'onboard-scrim';
  // Tapping the dark background closes only the onboarding — stopping the
  // click keeps the document handlers (CloseALL / pin close) from firing
  scrim.onclick = (e) => {
    e.stopPropagation();
    closeOnboarding();
  };
  overlay.appendChild(scrim);

  const card = document.createElement('div');
  card.className = 'onboard-card';
  overlay.appendChild(card);

  const skip = document.createElement('button');
  skip.className = 'onboard-skip';
  skip.textContent = '✕';
  skip.onclick = (e) => {
    e.stopPropagation();
    closeOnboarding();
  };
  card.appendChild(skip);

  const content = document.createElement('div');
  content.className = 'onboard-content';

  iconEl = document.createElement('div');
  iconEl.className = 'onboard-icon';

  titleEl = document.createElement('h3');
  titleEl.className = 'onboard-title';

  bodyEl = document.createElement('p');
  bodyEl.className = 'onboard-body';

  dotsEl = document.createElement('div');
  dotsEl.className = 'onboard-dots';
  SLIDES.forEach(() => {
    const dot = document.createElement('span');
    dot.className = 'onboard-dot';
    dotsEl.appendChild(dot);
  });

  prevBtn = document.createElement('button');
  prevBtn.className = 'onboard-prev';
  prevBtn.textContent = '‹ Prev';
  prevBtn.onclick = (e) => {
    e.stopPropagation();
    if (slideIndex > 0) {
      slideIndex--;
      renderSlide(-1);
    }
  };

  nextBtn = document.createElement('button');
  nextBtn.className = 'onboard-next';
  nextBtn.onclick = (e) => {
    e.stopPropagation();
    if (slideIndex < SLIDES.length - 1) {
      slideIndex++;
      renderSlide(1);
    } else {
      closeOnboarding();
    }
  };

  const nav = document.createElement('div');
  nav.className = 'onboard-nav';
  nav.append(prevBtn, nextBtn);

  content.append(iconEl, titleEl, bodyEl, dotsEl, nav);
  card.appendChild(content);
  document.body.appendChild(overlay);

  scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, easing: 'ease-out' });
  // Keep the centering transform in the keyframes, or the card pops off-center
  card.animate(
    [
      { opacity: 0, transform: 'translate(-50%, -50%) scale(0.9)' },
      { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' }
    ],
    { duration: 300, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }
  );

  renderSlide();
}

function start() {
  const show = () => {
    if (document.getElementById('onboard-overlay')) return;
    build();
  };
  // Let the loader fade first, then pop the onboarding on top of the map
  if (map.isStyleLoaded()) {
    setTimeout(show, 900);
  } else {
    map.once('load', () => setTimeout(show, 900));
  }
}

start();
