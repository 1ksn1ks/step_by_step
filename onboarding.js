import { map } from './map.js';
import { appAlreadyInstalled, runInstallPrompt } from './installapp.js';

// First-load onboarding. The install question is the first page.
// An installed app skips the whole introduction.

const INTRO = [
  {
    icons: ['📋', '🕐'],
    title: 'Coordinates & clock',
    body: 'The top right follows the spot you are looking at.',
    rows: [
      { name: '📋 Coordinates', note: 'Tap it to copy this spot.' },
      { name: '🕐 Clock', note: 'Shows the current time at those coordinates.' }
    ]
  },
  {
    icons: ['📍', '🔷'],
    title: 'Marker & polygon',
    body: 'Tap (phone) or left-click (PC) anywhere on the map.',
    rows: [
      { name: '📍 Marker', note: 'Opens a marker at this spot.' },
      { name: '🔷 Polygon', note: 'First tap is the top left. The next tap is the bottom right.' }
    ]
  },
  {
    icons: ['🗺', '📡'],
    title: 'Maps & live',
    body: 'Right-click (PC) or hold (phone) on the map.',
    rows: [
      { name: '🗺 Open in Maps', note: 'Opens this spot in your maps app.' },
      { name: '📡 Look for Live', note: 'Shows that country\'s live markers from the last 24 hours.' }
    ]
  }
];

function slidesForThisVisit() {
  return [
    {
      icon: '📲',
      title: 'Install on homescreen?',
      body: 'Installing removes this intro.',
      install: true
    },
    ...INTRO
  ];
}

let slideIndex = 0;
let slides = INTRO;
let overlay = null;
let iconEl = null;
let titleEl = null;
let bodyEl = null;
let rowsEl = null;
let dotsEl = null;
let prevBtn = null;
let nextBtn = null;
let introNav = null;
let installNav = null;

function renderSlide(direction = 1) {
  const slide = slides[slideIndex];
  iconEl.replaceChildren();
  const icons = slide.icons || (slide.icon ? [slide.icon] : []);
  icons.forEach((emoji, i) => {
    if (i > 0) {
      const join = document.createElement('span');
      join.className = 'onboard-icon-join';
      join.textContent = '&';
      iconEl.appendChild(join);
    }
    const item = document.createElement('span');
    item.textContent = emoji;
    iconEl.appendChild(item);
  });
  titleEl.textContent = slide.title;
  bodyEl.textContent = slide.body || '';
  bodyEl.style.display = slide.body ? '' : 'none';
  bodyEl.style.marginBottom = slide.rows ? '1.2vh' : '';
  rowsEl.replaceChildren();
  if (slide.rows && slide.rows.length) {
    rowsEl.style.display = '';
    for (const row of slide.rows) {
      const item = document.createElement('div');
      item.className = 'onboard-row';
      const name = document.createElement('div');
      name.className = 'onboard-row-name';
      name.textContent = row.name;
      const note = document.createElement('div');
      note.className = 'onboard-row-note';
      note.textContent = row.note;
      item.append(name, note);
      rowsEl.appendChild(item);
    }
  } else {
    rowsEl.style.display = 'none';
  }
  Array.from(dotsEl.children).forEach((dot, i) => {
    dot.classList.toggle('onboard-dot-active', i === slideIndex);
  });
  const installPage = !!slide.install;
  introNav.style.display = installPage ? 'none' : 'flex';
  installNav.style.display = installPage ? 'flex' : 'none';
  const lastSlide = slideIndex === slides.length - 1;
  nextBtn.textContent = lastSlide ? 'Got it' : 'Next ›';
  nextBtn.classList.toggle('is-quiet', !lastSlide);
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
  // Back/Forward: the overlay is removed from the DOM (no display to
  // watch), so its own close paths report it directly.
  if (window.layerClosedByUI) window.layerClosedByUI("onboard");
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

  rowsEl = document.createElement('div');
  rowsEl.className = 'onboard-rows';

  dotsEl = document.createElement('div');
  dotsEl.className = 'onboard-dots';
  slides.forEach(() => {
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
    if (slideIndex < slides.length - 1) {
      slideIndex++;
      renderSlide(1);
    } else {
      closeOnboarding();
    }
  };

  introNav = document.createElement('div');
  introNav.className = 'onboard-nav';
  introNav.append(prevBtn, nextBtn);

  const notNowBtn = document.createElement('button');
  notNowBtn.className = 'onboard-prev';
  notNowBtn.textContent = 'Not now';
  notNowBtn.onclick = (e) => {
    e.stopPropagation();
    if (slideIndex < slides.length - 1) {
      slideIndex++;
      renderSlide(1);
    } else {
      closeOnboarding();
    }
  };

  const installBtn = document.createElement('button');
  installBtn.className = 'onboard-next';
  installBtn.textContent = 'Install';
  installBtn.onclick = async (e) => {
    e.stopPropagation();
    const accepted = await runInstallPrompt();
    if (accepted) closeOnboarding();
  };

  installNav = document.createElement('div');
  installNav.className = 'onboard-nav';
  installNav.append(installBtn, notNowBtn);

  content.append(iconEl, titleEl, bodyEl, rowsEl, dotsEl, introNav, installNav);
  card.appendChild(content);
  document.body.appendChild(overlay);
  if (window.layerOpened) window.layerOpened("onboard");

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

// Open in app from the notification app lands on ?place=marker|polygon.
// That visit is here to see a pin, so the coordinates/drawing intro stays off.
function openedFromNotification() {
  try {
    const kind = new URL(window.location.href).searchParams.get('place');
    return kind === 'marker' || kind === 'polygon';
  } catch {
    return false;
  }
}

// Back closes the prompt; Forward has nothing cheap to bring back (it is
// a one-time install prompt, not a restorable panel).
if (window.defineLayer) {
  window.defineLayer("onboard", {
    open: () => {},
    close: () => closeOnboarding(),
  });
}

function start() {
  if (openedFromNotification()) return;
  const show = async () => {
    if (document.getElementById('onboard-overlay')) return;
    if (await appAlreadyInstalled()) return;
    if (document.getElementById('onboard-overlay')) return;
    slides = slidesForThisVisit();
    slideIndex = 0;
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
