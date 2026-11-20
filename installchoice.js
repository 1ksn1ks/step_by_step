// installchoice.js — the install screen's "Start in" step (onboarding.js
// shows it above the steps and Install): which community the installed app
// opens, the name under its icon, and the icon. Each change points what
// the browser installs at the choice (installapp.js pointInstall), so
// Install, ours or the browser's own, makes exactly that app. The browser
// reads the name and icon from the manifest when it installs; afterwards
// only iPhone lets a person rename it, while adding.
//
// The choices: this link's community (preselected), the default topic,
// and the topics the connected wallet follows. The server says what each
// opens (GET /api/install-target, server/installmanifest.js): its default
// name, and its picture when it has one. One it does not know is dropped.

import { DEFAULT_TOPIC, ICON_PIC, LABEL_MAX, cleanLabel, cleanStart, isDefaultStart, isTopicId, startFromUrl } from './installtarget.js';
import { keepUrlForInstall, pointInstall } from './installapp.js';
import { BACKEND_URL, fetchFollowing } from './msgbackend.js';

const APP_ICON_SRC = '/icons/icon-192.png';
// A name is applied once typing pauses this long (each change has Chrome
// check the manifest again).
const TYPE_MS = 400;
const FOLLOWED_MAX = 8;
const answers = new Map();

// What a start opens, as the server answers it; null when it is not a
// community (or the server cannot be reached, which is asked again later).
export function installTarget(start) {
  const clean = cleanStart(start);
  const key = isDefaultStart(clean) ? '' : clean;
  if (!answers.has(key)) {
    const ask = fetch(`${BACKEND_URL}/api/install-target?start=${encodeURIComponent(key)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => (data && data.ok ? data : null))
      .catch(() => {
        answers.delete(key);
        return null;
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
// has said what the first choice opens.
export function createInstallChoice() {
  const box = el('div', 'install-choice');
  box.hidden = true;
  // A short name with its default already in it: no × to empty it
  // (fieldclear.js).
  box.setAttribute('data-no-clear', '');

  const startRow = el('label', 'install-choice-row');
  const select = el('select', 'install-choice-select');
  startRow.append(el('span', 'install-choice-name', 'Start in'), select);

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

  const optionFor = (start) => [...select.querySelectorAll('option')].find((option) => option.value === start);

  function addOption(start, text, parent = select) {
    if (optionFor(start)) return null;
    const option = el('option', '', text);
    option.value = start;
    parent.appendChild(option);
    return option;
  }

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

  async function choose(start) {
    const ask = ++asking;
    const target = await installTarget(start);
    if (ask !== asking) return;
    if (!target) {
      // Not a community after all: drop it and start in the default.
      if (start) {
        const option = optionFor(start);
        if (option) option.remove();
        select.value = '';
        choose('');
      }
      return;
    }
    current = target;
    const option = optionFor(start);
    if (option && target.start && target.name) option.textContent = target.name;
    input.value = target.label;
    input.placeholder = target.label;
    appIcon.radio.checked = true;
    picIcon.label.hidden = !target.picture;
    if (target.picture) picIcon.img.src = target.picture.icon;
    box.hidden = false;
    apply();
  }

  async function addFollowed() {
    let account = '';
    try {
      account = (await import('./web3.js')).connectedAccount || '';
    } catch {
      account = '';
    }
    if (!account) return;
    const data = await fetchFollowing(account);
    if (!data || !Array.isArray(data.topics)) return;
    const group = el('optgroup');
    group.label = 'Topics you follow';
    for (const topic of data.topics) {
      if (group.children.length >= FOLLOWED_MAX) break;
      const id = topic && typeof topic.id === 'string' ? topic.id : '';
      if (!isTopicId(id) || id === DEFAULT_TOPIC || optionFor(id)) continue;
      addOption(id, cleanLabel(topic.name) || id, group);
    }
    if (group.children.length) select.appendChild(group);
  }

  select.addEventListener('change', () => choose(select.value));
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
  if (linkStart) addOption(linkStart, linkStart);
  addOption('', 'Web3Globe');
  select.value = linkStart;
  choose(linkStart);
  addFollowed();
  return box;
}
