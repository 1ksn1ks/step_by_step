import { map } from './map.js';
import { appAlreadyInstalled, runInstallPrompt, canPromptInstall, installSteps } from './installapp.js';

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
      { name: '📍 Marker', note: 'Puts a marker here. Drag it if needed, then ✓.' },
      { name: '🔷 Polygon', note: 'This tap is one corner. Tap the opposite corner, drag to adjust, then ✓.' }
    ]
  },
  {
    icons: ['🗺', '📡'],
    title: 'Maps & live',
    body: 'Right-click (PC) or hold (phone) on the map.',
    rows: [
      { name: '🗺 Open in Maps', note: 'Opens this spot in your maps app.' },
      { name: '📡 Look for Live', note: 'Shows live posts from the last chosen hours around that spot, up to 24. ⚙ sets how far and how recent.' }
    ]
  }
];

// The first page is this browser's Add to Home Screen guide (installapp.js
// installSteps). A browser that hands over its own install dialog also
// gets a one-tap Install there (paintInstallNav).
function slidesForThisVisit() {
  return [
    {
      icon: '📲',
      install: true,
      guide: installSteps()
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
let installBtn = null;
let notNowBtn = null;
let reassureEl = null;

// Install steps (installapp.js installSteps): each icon looks like the
// button the step taps, so the screen and the guide match.
const STEP_ICONS = {
  more: '<circle cx="6" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  dots: '<circle cx="12" cy="6" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="18" r="1.6" fill="currentColor" stroke="none"/>',
  menu: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
  share: '<path d="M12 3v12"/><path d="m8 7 4-4 4 4"/><path d="M8 10H6.5A2.5 2.5 0 0 0 4 12.5v6A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5v-6a2.5 2.5 0 0 0-2.5-2.5H16"/>',
  showmore: '<path d="m6 9 6 6 6-6"/>',
  addhome: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M12 8v8"/><path d="M8 12h8"/>',
  confirm: '<path d="M20 6 9 17l-5-5"/>',
  install: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  safari: '<circle cx="12" cy="12" r="9.5"/><path d="m15.8 8.2-2.1 5.5-5.5 2.1 2.1-5.5z"/>',
};
const SHIELD_ICON = '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>';

function svg(paths) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

// One numbered step per tap, top to bottom, joined by a thin line.
function renderGuide(guide) {
  const list = document.createElement('ol');
  list.className = 'onboard-steps';
  guide.steps.forEach((step, i) => {
    const item = document.createElement('li');
    item.className = 'onboard-step';
    item.style.setProperty('--i', String(i));
    const chip = document.createElement('span');
    chip.className = 'onboard-step-icon';
    chip.innerHTML = svg(STEP_ICONS[step.icon] || STEP_ICONS.confirm);
    const num = document.createElement('span');
    num.className = 'onboard-step-num';
    num.textContent = String(i + 1);
    chip.appendChild(num);
    const text = document.createElement('span');
    text.className = 'onboard-step-text';
    const line = document.createElement('span');
    line.className = 'onboard-step-line';
    line.append(document.createTextNode(step.verb + ' '));
    const key = document.createElement('span');
    key.className = 'onboard-key';
    key.textContent = step.key;
    line.appendChild(key);
    text.appendChild(line);
    if (step.note) {
      const note = document.createElement('span');
      note.className = 'onboard-step-note';
      note.textContent = step.note;
      text.appendChild(note);
    }
    item.append(chip, text);
    list.appendChild(item);
  });
  rowsEl.appendChild(list);
}

// The guide page's buttons. With an install dialog to open (Chrome on
// Android, desktop Chrome / Edge): Install, and Not now to move on.
// Without one (iPhone, most other browsers): only Got it, after the steps.
function paintInstallNav() {
  const prompt = canPromptInstall();
  installBtn.style.display = prompt ? '' : 'none';
  notNowBtn.textContent = prompt ? 'Not now' : 'Got it';
  notNowBtn.className = prompt ? 'onboard-prev' : 'onboard-next';
}

// Chrome can hand over its dialog after the intro is already up.
window.addEventListener('install-prompt-ready', () => {
  if (overlay && slides[slideIndex] && slides[slideIndex].install) paintInstallNav();
});

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
  const guide = slide.guide || null;
  const title = guide ? guide.title : slide.title;
  const body = guide ? guide.body : slide.body;
  titleEl.textContent = title;
  bodyEl.textContent = body || '';
  bodyEl.style.display = body ? '' : 'none';
  bodyEl.style.marginBottom = slide.rows || guide ? '1.8vh' : '';
  rowsEl.replaceChildren();
  reassureEl.replaceChildren();
  reassureEl.style.display = guide && guide.footer ? '' : 'none';
  if (guide && guide.footer) {
    reassureEl.innerHTML = svg(SHIELD_ICON);
    const words = document.createElement('span');
    words.textContent = guide.footer;
    reassureEl.appendChild(words);
  }
  if (guide) {
    rowsEl.style.display = '';
    renderGuide(guide);
  } else if (slide.rows && slide.rows.length) {
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
  paintInstallNav();
  overlay.querySelector('.onboard-card').classList.toggle('is-guide', !!guide);
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

  // Under the install steps: what adding the icon is, so it feels safe.
  reassureEl = document.createElement('p');
  reassureEl.className = 'onboard-reassure';
  reassureEl.style.display = 'none';

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

  notNowBtn = document.createElement('button');
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

  installBtn = document.createElement('button');
  installBtn.className = 'onboard-next';
  installBtn.textContent = 'Install';
  // Shown only while the browser has an install dialog to open.
  installBtn.onclick = async (e) => {
    e.stopPropagation();
    const accepted = await runInstallPrompt();
    if (accepted) closeOnboarding();
    else paintInstallNav(); // a dismissed dialog can't be opened again
  };

  installNav = document.createElement('div');
  installNav.className = 'onboard-nav';
  installNav.append(installBtn, notNowBtn);

  content.append(iconEl, titleEl, bodyEl, rowsEl, reassureEl, dotsEl, introNav, installNav);
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
