import { map } from './map.js';
import { visibleBottom } from './keyboardlayout.js';
import { appAlreadyInstalled, runInstallPrompt, canPromptInstall, installPromptPending, installSteps } from './installapp.js';
import { createInstallChoice } from './installchoice.js';
import { connectedAccount } from './web3.js';
import { avatarSrc } from './avatarsrc.js';
import { DEFAULT_PIC, profilePicUrl, profileUsername } from './profileface.js';
import { mountPicture, pictureElement } from './loopmedia.js';
import { paintProfileAvatar } from './earlyhashinal.js';

// First-load onboarding. The install question is the first page.
// An installed app skips the whole introduction.

// How far the centred install card moves up so the Name field clears the
// keyboard. Rects are layout coordinates, the same ones visibleBottom uses.
// currentLift is already in the rects. A covered field moves up by the
// overlap plus the gap, and never so far that the card top passes safeTop.
export function onboardCardLift(spec) {
  const field = Number(spec && spec.fieldBottom);
  const top = Number(spec && spec.cardTop);
  const edge = Number(spec && spec.visibleBottom);
  const clearance = Number(spec && spec.gap);
  const safe = Number(spec && spec.safeTop);
  const have = Number(spec && spec.currentLift);
  const held = Number.isFinite(have) && have > 0 ? have : 0;
  if (![field, top, edge].every(Number.isFinite)) return held;
  let coveredBy = field - (edge - (Number.isFinite(clearance) ? clearance : 0));
  if (Math.abs(coveredBy) < 1) coveredBy = 0;
  let next = held + coveredBy;
  if (next < 0) next = 0;
  const room = top + held - (Number.isFinite(safe) ? safe : 0);
  if (next > room) next = room > 0 ? room : 0;
  return next;
}

let unbindOnboardKeyboard = null;

function keyboardEdge() {
  const view = window.visualViewport;
  const offsetTop = view && Number.isFinite(view.offsetTop) ? view.offsetTop : 0;
  const height = view && view.height ? view.height : window.innerHeight;
  const scale = view && Number.isFinite(view.scale) ? view.scale : 1;
  return visibleBottom(offsetTop, height, window.innerHeight, scale);
}

function prefersStill() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
}

// The overlay keeps its closed size. This only translates the card, and
// only while the Name field is focused and the keyboard would cover it.
function bindOnboardKeyboard(overlay, card) {
  if (unbindOnboardKeyboard) unbindOnboardKeyboard();
  let lift = 0;
  let input = null;
  let gap = 0;
  let scrollTop = 0;
  let restoreScroll = false;
  let frame = 0;
  const view = window.visualViewport;

  function readGap() {
    const prev = card.style.outlineOffset;
    card.style.outlineOffset = 'var(--onboard-kb-gap)';
    const n = parseFloat(getComputedStyle(card).outlineOffset);
    card.style.outlineOffset = prev;
    gap = Number.isFinite(n) && n > 0 ? n : 0;
  }

  function paint(next, slideHome) {
    const home = slideHome && next === 0 && lift > 0 && !prefersStill();
    lift = next;
    if (next > 0) {
      card.classList.remove('is-kb-return');
      // Measured overlap. The unit is the pixel the viewport reported.
      card.style.translate = `0 ${-next}px`;
      return;
    }
    if (home) {
      card.classList.add('is-kb-return');
      card.style.translate = '0 0';
      return;
    }
    card.classList.remove('is-kb-return');
    card.style.translate = '';
  }

  function safeTop() {
    const pad = parseFloat(getComputedStyle(overlay).paddingTop) || 0;
    const origin = view && Number.isFinite(view.offsetTop) ? view.offsetTop : 0;
    const top = overlay.getBoundingClientRect().top;
    return Math.max(top + pad, origin + pad);
  }

  function measure() {
    if (!overlay.isConnected || !input || !input.isConnected) {
      paint(0, true);
      input = null;
      return;
    }
    if (restoreScroll && card.scrollTop !== scrollTop) card.scrollTop = scrollTop;
    restoreScroll = false;
    const next = onboardCardLift({
      fieldBottom: input.getBoundingClientRect().bottom,
      cardTop: card.getBoundingClientRect().top,
      visibleBottom: keyboardEdge(),
      gap,
      safeTop: safeTop(),
      currentLift: lift,
    });
    paint(next, next === 0);
  }

  function schedule() {
    if (!input || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      measure();
    });
  }

  function onPointerDown(event) {
    const node = event.target && event.target.closest && event.target.closest('.install-choice-input');
    if (!node || !overlay.contains(node)) return;
    scrollTop = card.scrollTop;
    restoreScroll = true;
  }

  function onFocusIn(event) {
    const node = event.target;
    if (!node || !node.closest || !node.closest('.install-choice-input') || !overlay.contains(node)) return;
    input = node;
    readGap();
    schedule();
  }

  function onFocusOut(event) {
    const next = event.relatedTarget;
    if (next && next.closest && next.closest('.install-choice-input') && overlay.contains(next)) return;
    input = null;
    restoreScroll = false;
    paint(0, true);
  }

  function onTransitionEnd(event) {
    if (event.propertyName !== 'translate' || event.target !== card || lift !== 0) return;
    card.classList.remove('is-kb-return');
    card.style.translate = '';
  }

  function onResize() {
    readGap();
    schedule();
  }

  overlay.addEventListener('pointerdown', onPointerDown, true);
  overlay.addEventListener('focusin', onFocusIn);
  overlay.addEventListener('focusout', onFocusOut);
  card.addEventListener('transitionend', onTransitionEnd);
  window.addEventListener('resize', onResize);
  if (view) {
    view.addEventListener('resize', schedule);
    view.addEventListener('scroll', schedule);
  }

  unbindOnboardKeyboard = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    input = null;
    lift = 0;
    overlay.removeEventListener('pointerdown', onPointerDown, true);
    overlay.removeEventListener('focusin', onFocusIn);
    overlay.removeEventListener('focusout', onFocusOut);
    card.removeEventListener('transitionend', onTransitionEnd);
    window.removeEventListener('resize', onResize);
    if (view) {
      view.removeEventListener('resize', schedule);
      view.removeEventListener('scroll', schedule);
    }
    card.classList.remove('is-kb-return');
    card.style.translate = '';
    unbindOnboardKeyboard = null;
  };
}

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
// The "Start in" step above the install steps (installchoice.js), made once
// per intro so going back to the page keeps what was picked.
let installChoice = null;
// Top left, the ✕'s twin: Connect, or the connected account's picture, its
// name (when it has one) and its id.
let walletBtn = null;
let walletFace = null;
let walletCopy = null;
let walletName = null;
let walletId = null;

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
// Right after "Start in" changes, Chrome checks the new manifest before it
// hands over a new dialog: Install waits, greyed, until then.
function paintInstallNav() {
  const prompt = canPromptInstall();
  const waiting = !prompt && installPromptPending();
  installBtn.style.display = prompt || waiting ? '' : 'none';
  installBtn.disabled = waiting;
  installBtn.textContent = waiting ? 'Getting ready…' : 'Install';
  notNowBtn.textContent = prompt || waiting ? 'Not now' : 'Got it';
  notNowBtn.className = prompt || waiting ? 'onboard-prev' : 'onboard-next';
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
    if (slide.install && guide.choose !== false) {
      if (!installChoice) installChoice = createInstallChoice();
      rowsEl.appendChild(installChoice);
    }
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

// The connected account, from web3.js. Not #account-id: updateUI announces
// the account before it writes that label, so the label can still be the
// old one when wallet-account-changed arrives.
function introAccount() {
  const account = typeof connectedAccount === 'string' ? connectedAccount.trim() : '';
  return /^\d+\.\d+\.\d+$/.test(account) && account.length <= 40 ? account : '';
}

// The hidden Connect, the way an upload or a place starts it: with
// skipOverlayClose the connect flow leaves the intro open. A second tap
// while it is connecting clicks again, and web3.js reopens the sheet.
function connectFromIntro() {
  const connect = document.getElementById('connect-wallet-btn');
  if (!connect) return;
  connect.skipOverlayClose = true;
  try { connect.click(); }
  finally { connect.skipOverlayClose = false; }
}

// Disconnected: "Connect". Connected: the drawer account row's picture, then
// the name over the full id, as the post header shows a profile (the id
// alone when there is no name; never "Anonymous"). Nothing else on the
// intro changes, so a connect keeps the slide.
function paintIntroWallet() {
  if (!walletBtn) return;
  const id = introAccount();
  const name = id ? profileUsername(id) : '';
  walletBtn.classList.toggle('is-connected', !!id);
  walletBtn.setAttribute('aria-label', id ? `Wallet ${name ? `${name} ` : ''}${id}` : 'Connect wallet');
  if (!id) {
    walletFace = null;
    walletCopy = null;
    walletName = null;
    walletId = null;
    const text = document.createElement('span');
    text.className = 'onboard-wallet-text';
    text.textContent = 'Connect';
    walletBtn.replaceChildren(text);
    return;
  }
  if (!walletId) {
    walletFace = pictureElement(avatarSrc(DEFAULT_PIC), { className: 'onboard-wallet-face', alt: '', fallback: DEFAULT_PIC });
    walletCopy = document.createElement('span');
    walletCopy.className = 'onboard-wallet-copy';
    walletId = document.createElement('span');
    walletId.className = 'onboard-wallet-id';
    walletCopy.appendChild(walletId);
    walletBtn.replaceChildren(walletFace, walletCopy);
  }
  if (name) {
    if (!walletName) {
      walletName = document.createElement('span');
      walletName.className = 'onboard-wallet-name';
      walletCopy.insertBefore(walletName, walletId);
    }
    walletName.textContent = name;
  } else if (walletName) {
    walletName.remove();
    walletName = null;
  }
  walletId.textContent = id;
  // The id's length: style.css shrinks a long one to fit, never clips it.
  walletId.style.setProperty('--wallet-id-chars', String(id.length));
  walletFace = mountPicture(walletFace, avatarSrc(profilePicUrl(id)), {
    className: 'onboard-wallet-face',
    fallback: DEFAULT_PIC,
  });
  paintProfileAvatar(walletFace, id);
}

function bindIntroWallet() {
  document.addEventListener('wallet-account-changed', paintIntroWallet);
  document.addEventListener('profiles-loaded', paintIntroWallet);
}

function unbindIntroWallet() {
  document.removeEventListener('wallet-account-changed', paintIntroWallet);
  document.removeEventListener('profiles-loaded', paintIntroWallet);
  walletBtn = null;
  walletFace = null;
  walletCopy = null;
  walletName = null;
  walletId = null;
}

function closeOnboarding() {
  if (!overlay) return;
  if (unbindOnboardKeyboard) unbindOnboardKeyboard();
  unbindIntroWallet();
  document.documentElement.classList.remove('intro-open');
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
  installChoice = null;
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

  walletBtn = document.createElement('button');
  walletBtn.type = 'button';
  walletBtn.className = 'onboard-wallet';
  walletBtn.onclick = (e) => {
    e.stopPropagation();
    if (introAccount()) return;
    connectFromIntro();
  };
  card.appendChild(walletBtn);

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
  // The wallet sheet goes above the intro while it is up (style.css).
  document.documentElement.classList.add('intro-open');
  bindIntroWallet();
  paintIntroWallet();
  bindOnboardKeyboard(overlay, card);
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
