// installchoice.js — the install screen's "Start in" step (onboarding.js
// shows it above the steps and Install): which community the installed app
// opens, the name under its icon, and the icon. Each change points what
// the browser installs at the choice (installapp.js pointInstall), so
// Install, ours or the browser's own, makes exactly that app. The browser
// reads the name and icon from the manifest when it installs; afterwards
// only iPhone lets a person rename it, while adding.
//
// Start in is a text field, prefilled from this link, plus the same 👥
// button topic chat uses (followsuggest.js). Empty means Web3Globe. A name
// or a topic id is asked of the server (GET /api/install-target,
// server/installmanifest.js): its default name, and its picture when it
// has one. One it does not know stays typed, and Install stays on the last
// community that resolved. The suggestion list and the Following picker
// already sit above this intro (z-index), and closing them returns here.

import { ICON_PIC, LABEL_MAX, cleanLabel, cleanStart, isDefaultStart, startFromUrl } from './installtarget.js';
import { keepUrlForInstall, pointInstall } from './installapp.js';
import { BACKEND_URL } from './msgbackend.js';
import { attachFollowSuggest, bindPickButton } from './followsuggest.js';

const APP_ICON_SRC = '/icons/icon-192.png';
// A name is applied once typing pauses this long (each change has Chrome
// check the manifest again).
const TYPE_MS = 400;
const RETRY_MS = 3000;
const answers = new Map();

// What a start opens. null is a real unknown: 404, or a body with ok:false.
// A network error, a 5xx, or any other failure is {retry:true} and is not
// cached, so the next call asks the server again.
export function installTarget(start) {
  const clean = cleanStart(start);
  const key = isDefaultStart(clean) ? '' : clean;
  if (!answers.has(key)) {
    let ask;
    ask = fetch(`${BACKEND_URL}/api/install-target?start=${encodeURIComponent(key)}`)
      .then(async (res) => {
        if (res.status === 404) return null;
        if (!res.ok) throw new Error('install-target');
        const data = await res.json();
        if (data && data.ok === true) return data;
        if (data && data.ok === false) return null;
        throw new Error('install-target');
      })
      .catch(() => {
        if (answers.get(key) === ask) answers.delete(key);
        return { retry: true };
      });
    answers.set(key, ask);
  }
  return answers.get(key);
}

function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function iconOption(value, text) {
  const label = el('label', 'install-choice-icon');
  const radio = el('input');
  radio.type = 'radio';
  radio.name = 'install-choice-icon';
  radio.value = value;
  const img = el('img');
  img.alt = '';
  img.width = 48;
  img.height = 48;
  img.decoding = 'async';
  label.append(radio, img, el('span', '', text));
  return { label, radio, img };
}

// The step, ready to put in the install screen. Hidden until the server
// has said what the first choice opens, or a hint has something to say.
export function createInstallChoice() {
  const box = el('div', 'install-choice');
  box.hidden = true;
  // A short name with its default already in it: no × to empty it
  // (fieldclear.js).
  box.setAttribute('data-no-clear', '');

  const startRow = el('div', 'install-choice-row');
  const startWrap = el('div', 'install-choice-start');
  const startInput = el('input', 'install-choice-input install-choice-start-input');
  startInput.type = 'text';
  startInput.placeholder = 'Web3Globe';
  startInput.autocomplete = 'off';
  startInput.autocapitalize = 'off';
  startInput.spellcheck = false;
  startInput.enterKeyHint = 'done';
  const pickBtn = el('button', 'follow-pick-btn', '👥');
  pickBtn.type = 'button';
  pickBtn.setAttribute('aria-label', 'Choose from following');
  const hint = el('p', 'install-choice-hint');
  hint.id = 'install-choice-start-hint';
  hint.hidden = true;
  hint.setAttribute('role', 'status');
  hint.setAttribute('aria-live', 'polite');
  const startName = el('span', 'install-choice-name', 'Start in');
  startName.id = 'install-choice-start-name';
  startInput.setAttribute('aria-labelledby', startName.id);
  startWrap.append(startInput, pickBtn, hint);
  startRow.append(startName, startWrap);

  const nameRow = el('label', 'install-choice-row');
  const input = el('input', 'install-choice-input');
  input.type = 'text';
  input.maxLength = LABEL_MAX;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.enterKeyHint = 'done';
  nameRow.append(el('span', 'install-choice-name', 'Name'), input);

  const iconRow = el('div', 'install-choice-row');
  const iconName = el('span', 'install-choice-name', 'Icon');
  iconName.id = 'install-choice-icon-name';
  const icons = el('div', 'install-choice-icons');
  icons.setAttribute('role', 'radiogroup');
  icons.setAttribute('aria-labelledby', iconName.id);
  const appIcon = iconOption('app', 'App');
  appIcon.img.src = APP_ICON_SRC;
  appIcon.radio.checked = true;
  const picIcon = iconOption(ICON_PIC, 'Community');
  picIcon.label.hidden = true;
  icons.append(appIcon.label, picIcon.label);
  iconRow.append(iconName, icons);

  box.append(startRow, nameRow, iconRow);
  // The card sits over the map: its clicks stay in it.
  box.addEventListener('click', (event) => event.stopPropagation());

  let current = null;
  let asking = 0;
  let typing = 0;
  let startTyping = 0;
  let retryTimer = 0;
  // The text written for the community that resolved. Typing that same
  // text again is not a new start (a display name can contain a space).
  let shown = '';

  function apply() {
    clearTimeout(typing);
    typing = 0;
    if (!current) return;
    const typed = cleanLabel(input.value);
    const usePicture = picIcon.radio.checked && !!current.picture;
    pointInstall({
      start: current.start,
      label: typed && typed !== current.label ? typed : '',
      icon: usePicture ? ICON_PIC : '',
      title: typed || current.label,
      appleIcon: usePicture ? current.picture.apple : '',
    });
    keepUrlForInstall(current.start);
  }

  function stayedLabel() {
    return current && current.label ? current.label : 'Web3Globe';
  }

  function showHint(text) {
    hint.textContent = text || '';
    hint.hidden = !text;
    if (text) startInput.setAttribute('aria-describedby', hint.id);
    else startInput.removeAttribute('aria-describedby');
    if (text) box.hidden = false;
  }

  async function choose(start, again, quiet) {
    if (!again) clearTimeout(retryTimer);
    const ask = ++asking;
    const target = await installTarget(start);
    if (ask !== asking) return;
    if (target && target.retry) {
      // One later try. The typed text stays, and Install stays on the last
      // community that resolved. The hint names that community.
      if (!again) {
        showHint('Couldn\'t reach the server, trying again…');
        retryTimer = setTimeout(() => {
          if (ask !== asking) return;
          choose(start, true, quiet);
        }, RETRY_MS);
      } else {
        showHint(`Couldn't load that community. Install stays on ${stayedLabel()}`);
      }
      return;
    }
    if (!target) {
      // Not a community. Leave the typed text, and leave Install where it was.
      // A pause while typing stays quiet; Enter, blur, or a pick says so.
      if (start && !quiet) {
        const typed = startInput.value.trim() || start;
        showHint(`No community called ${typed}, Install stays on ${stayedLabel()}`);
      }
      return;
    }
    current = target;
    showHint('');
    clearTimeout(startTyping);
    startTyping = 0;
    startInput.value = target.start ? (target.name || target.start) : '';
    shown = startInput.value;
    startInput.placeholder = 'Web3Globe';
    input.value = target.label;
    input.placeholder = target.label;
    appIcon.radio.checked = true;
    picIcon.label.hidden = !target.picture;
    if (target.picture) picIcon.img.src = target.picture.icon;
    box.hidden = false;
    apply();
  }

  // What the field holds, as a start. Empty is Web3Globe. A name cleanStart
  // rejects is ignored. The text of a community that already resolved is
  // left as its display name. Either way a lookup still running for the
  // previous text is dropped, so it cannot overwrite the field.
  function submitStart(quiet) {
    clearTimeout(startTyping);
    startTyping = 0;
    clearTimeout(retryTimer);
    asking += 1;
    const raw = startInput.value;
    if (raw === shown) {
      showHint('');
      return;
    }
    const text = raw.trim();
    if (!text) {
      showHint('');
      choose('');
      return;
    }
    const start = cleanStart(raw);
    if (!start) {
      showHint('Not a valid community name');
      return;
    }
    showHint('');
    choose(start, false, quiet === true);
  }

  attachFollowSuggest(startInput, { kinds: ['topics'], submit: submitStart });
  bindPickButton(pickBtn, startInput);
  startInput.addEventListener('input', () => {
    clearTimeout(startTyping);
    startTyping = setTimeout(() => submitStart(true), TYPE_MS);
  });
  startInput.addEventListener('change', submitStart);
  startInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.defaultPrevented) return;
    submitStart();
    startInput.blur();
  });
  input.addEventListener('input', () => {
    clearTimeout(typing);
    typing = setTimeout(apply, TYPE_MS);
  });
  input.addEventListener('change', apply);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') input.blur();
  });
  for (const option of [appIcon, picIcon]) option.radio.addEventListener('change', apply);

  const fromLink = cleanStart(startFromUrl(window.location.href));
  const linkStart = isDefaultStart(fromLink) ? '' : fromLink;
  startInput.placeholder = 'Web3Globe';
  startInput.value = linkStart;
  choose(linkStart);
  return box;
}
