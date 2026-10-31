// Profile page hero and rows. Saved picture, name, link, bio, topic, and
// key stay in sync with whatever is typed or uploaded.
import { connectedAccount } from './web3.js';
import { profilePictures, usernames, click2url, topicBio, profileTopics } from './loadalladata.js';
import { paintEarlyProfile } from './loadprofilepopup.js';
import { paintProfileAvatar } from './earlyhashinal.js';
import { watchProfilePicture } from './markertilt.js';
import { copyTextToClipboard } from './handleallmessages.js';
import { toast } from './toast.js';

const DEFAULT_PIC = 'https://kiloscribe.com/api/inscription-cdn/0.0.4819119';

const column = document.getElementById('Edit_Profile-column');
const picEl = document.getElementById('profile-live-pic');
const circleEl = document.getElementById('profile-circle-preview-img');
const accountEl = document.getElementById('profile-live-account');
const nameEl = document.getElementById('profile-live-username');
const nameInput = document.getElementById('edit-profile-username-input');
const linkInput = document.getElementById('edit-profile-click2link-input');
const bioInput = document.getElementById('Edit_Profile-bio');
const keyInput = document.getElementById('edit-profile-public-key-input');
const sheet = document.getElementById('profile-photo-sheet');

const usernameValue = document.getElementById('profile-value-username');
const bioValue = document.getElementById('profile-value-bio');
const linkValue = document.getElementById('profile-value-link');
const topicValue = document.getElementById('profile-value-topic');
const keyValue = document.getElementById('profile-value-key');

let draftUsername = null;
let draftLink = null;
let draftBio = null;
let draftKey = null;
let pinnedKey = '';
let failedPic = '';

const FIELD_EDITOR = {
  'show-username-from-edit-profile': 'edit-profile-username',
  'show-bio-from-edit-profile': 'edit-profile-bio',
  'show-click2link-from-edit-profile': 'edit-profile-click2link',
  'show-topic-from-edit-profile': 'edit-profile-topic',
  'show-public-key-from-edit-profile': 'edit-profile-public-key',
};

function textOf(value) {
  if (Array.isArray(value)) return String(value[0] || '');
  return typeof value === 'string' ? value : '';
}

function savedUsername() {
  return textOf(connectedAccount && usernames[connectedAccount] && usernames[connectedAccount].username);
}

function savedLink() {
  return textOf(connectedAccount && click2url[connectedAccount] && click2url[connectedAccount].click2url);
}

function savedBio() {
  return textOf(connectedAccount && topicBio[connectedAccount] && topicBio[connectedAccount].topic_bio);
}

function savedTopic() {
  const topic = connectedAccount && profileTopics[connectedAccount];
  return typeof topic === 'string' ? topic : topic ? String(topic) : '';
}

function savedPicture() {
  const url = connectedAccount && profilePictures[connectedAccount] && profilePictures[connectedAccount].url;
  return typeof url === 'string' && url ? url : '';
}

function pictureUrl() {
  const box = document.getElementById('preview-profile-picture');
  const img = box && box.querySelector('img');
  const chosen = (box && !box.hidden && img && !img.hidden && img.getAttribute('src')) || savedPicture() || DEFAULT_PIC;
  return chosen === failedPic ? DEFAULT_PIC : chosen;
}

function colorOf(id, fallback) {
  const el = document.getElementById(id);
  return el && el.value ? el.value : fallback;
}

function currentKey() {
  if (draftKey !== null && String(draftKey).trim()) return String(draftKey).trim();
  return pinnedKey;
}

function shortenMiddle(value, head, tail, limit) {
  const text = String(value || '').trim();
  if (!text || text.length <= limit) return text;
  return text.slice(0, head) + '\u2026' + text.slice(-tail);
}

function paintValue(el, shown, full, placeholder) {
  if (!el) return;
  const text = shown || placeholder || '';
  el.textContent = text;
  el.classList.toggle('is-placeholder', !shown && !!placeholder);
  if (full) el.title = full;
  else el.removeAttribute('title');
}

function paintCopy(id, full) {
  const button = document.getElementById(id);
  if (!button) return;
  const text = String(full || '').trim();
  button.hidden = !text;
  button.dataset.copy = text;
}

function render() {
  if (!picEl) return;
  const nextPic = pictureUrl();
  if (picEl.getAttribute('src') !== nextPic) picEl.src = nextPic;
  if (circleEl && circleEl.getAttribute('src') !== nextPic) circleEl.src = nextPic;

  if (accountEl) accountEl.textContent = connectedAccount || 'Not connected';

  const name = (draftUsername !== null ? draftUsername : savedUsername()).trim();
  const link = (draftLink !== null ? draftLink : savedLink()).trim();
  const nameColor = colorOf('color-picker-popup-username', '#ffffff');
  if (nameEl) {
    nameEl.replaceChildren();
    if (name) {
      const node = document.createElement('span');
      node.className = 'profile-live-name';
      node.textContent = name;
      node.style.color = nameColor;
      nameEl.appendChild(node);
    }
  }

  const bio = draftBio !== null ? draftBio : savedBio();
  const bioLine = String(bio || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
  const topic = savedTopic().trim();
  const key = currentKey();

  paintValue(usernameValue, name, name, '');
  paintValue(bioValue, bioLine, String(bio || '').trim(), 'Add a bio');
  paintValue(linkValue, shortenMiddle(link, 8, 6, 18), link, '');
  paintValue(topicValue, shortenMiddle(topic, 8, 6, 18), topic, '');
  paintValue(keyValue, shortenMiddle(key, 6, 4, 12), key, 'Not pinned');
  paintCopy('profile-copy-link', link);
  paintCopy('profile-copy-topic', topic);
  paintCopy('profile-copy-key', key);

  paintProfileAvatar(picEl, connectedAccount || '');
  watchProfilePicture(picEl);
  paintEarlyProfile(picEl && picEl.closest('.profile-live-preview'), connectedAccount || '');
}

function useFallback(src) {
  failedPic = src;
  if (picEl.getAttribute('src') !== DEFAULT_PIC) picEl.src = DEFAULT_PIC;
  if (circleEl && circleEl.getAttribute('src') !== DEFAULT_PIC) circleEl.src = DEFAULT_PIC;
}

if (picEl) picEl.addEventListener('error', () => useFallback(picEl.src));
if (circleEl) circleEl.addEventListener('error', () => useFallback(circleEl.src));

function keepDraft(event, input, apply) {
  // A save clears the box from code. That is not a new draft, so the card
  // goes back to the name, link, or bio that was just stored.
  apply(event.isTrusted ? input.value : null);
  render();
}

if (nameInput) {
  nameInput.addEventListener('input', (event) => {
    keepDraft(event, nameInput, (value) => { draftUsername = value; });
  });
}

if (linkInput) {
  linkInput.addEventListener('input', (event) => {
    keepDraft(event, linkInput, (value) => { draftLink = value; });
  });
}

if (bioInput) {
  bioInput.addEventListener('input', (event) => {
    keepDraft(event, bioInput, (value) => { draftBio = value; });
  });
}

if (keyInput) {
  keyInput.addEventListener('input', (event) => {
    if (event.isTrusted) draftKey = keyInput.value;
    else {
      if (draftKey && String(draftKey).trim()) pinnedKey = String(draftKey).trim();
      draftKey = null;
    }
    render();
  });
}

const pictureField = document.getElementById('input-field-profile-picture');
if (pictureField) pictureField.addEventListener('input', render);

const uploadBox = document.getElementById('preview-profile-picture');
const uploadImg = uploadBox && uploadBox.querySelector('img');
if (uploadImg) new MutationObserver(render).observe(uploadImg, { attributes: true, attributeFilter: ['src', 'hidden'] });
if (uploadBox) new MutationObserver(render).observe(uploadBox, { attributes: true, attributeFilter: ['hidden'] });

const editProfile = document.getElementById('Edit_Profile');
if (editProfile) editProfile.addEventListener('click', render);
const accountId = document.getElementById('account-id');
if (accountId) new MutationObserver(render).observe(accountId, { childList: true, characterData: true, subtree: true });
document.addEventListener('profiles-loaded', render);

const topicLabel = document.getElementById('loaded-profile-topic');
if (topicLabel) new MutationObserver(render).observe(topicLabel, { childList: true, characterData: true, subtree: true });

function closeField() {
  if (!column) return;
  column.classList.remove('is-field-open');
  column.querySelectorAll('.profile-editor').forEach((editor) => {
    editor.style.display = 'none';
  });
}

function openField(showId) {
  const show = document.getElementById(showId);
  if (show) show.click();
  if (column) column.classList.add('is-field-open');
  const page = column && (column.closest('.feed-menu-page-body') || column);
  if (page) page.scrollTop = 0;
  const editor = document.getElementById(FIELD_EDITOR[showId] || '');
  const area = editor && editor.querySelector('textarea');
  if (area) area.focus();
}

if (column) {
  column.addEventListener('click', (event) => {
    const back = event.target.closest('.profile-editor-back');
    if (back && column.contains(back)) {
      const hide = document.getElementById(back.dataset.profileBack || '');
      if (hide) hide.click();
      closeField();
      render();
      return;
    }
    const open = event.target.closest('[data-profile-open]');
    if (!open || !column.contains(open) || event.target.closest('.profile-copy')) return;
    openField(open.dataset.profileOpen);
  });
  new MutationObserver(() => {
    if (column.style.display === 'none') {
      closeField();
      closeSheet();
    }
  }).observe(column, { attributes: true, attributeFilter: ['style'] });
}

function closeSheet() {
  if (sheet) sheet.hidden = true;
}

function openSheet() {
  if (!sheet) return;
  if (sheet.parentNode !== document.body) document.body.appendChild(sheet);
  sheet.hidden = false;
  const first = document.getElementById('profile-sheet-upload');
  if (first) first.focus();
}

function clickId(id) {
  const el = document.getElementById(id);
  if (el) el.click();
}

if (sheet) {
  if (sheet.parentNode !== document.body) document.body.appendChild(sheet);
  sheet.addEventListener('click', (event) => event.stopPropagation());
  const dim = sheet.querySelector('.profile-photo-sheet-dim');
  if (dim) dim.addEventListener('click', closeSheet);
  const cancel = document.getElementById('profile-sheet-cancel');
  if (cancel) cancel.addEventListener('click', closeSheet);
  const upload = document.getElementById('profile-sheet-upload');
  if (upload) {
    upload.addEventListener('click', () => {
      closeSheet();
      clickId('upload-profile-picture');
    });
  }
  const pfp = document.getElementById('profile-sheet-pfp');
  if (pfp) {
    pfp.addEventListener('click', () => {
      closeSheet();
      clickId('button1');
    });
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && sheet && !sheet.hidden) closeSheet();
  });
}

function bindPhotoOpen(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('click', (event) => {
    event.stopPropagation();
    openSheet();
  });
}

bindPhotoOpen('profile-hero-avatar');
bindPhotoOpen('profile-change-photo');

async function copyFrom(button) {
  const text = button && button.dataset.copy;
  if (!text) return;
  try {
    await copyTextToClipboard(text);
    toast.success('Copied');
  } catch (err) {
    console.error('Copy failed:', err);
    toast.error('Could not copy');
  }
}

for (const id of ['profile-copy-link', 'profile-copy-topic', 'profile-copy-key']) {
  const button = document.getElementById(id);
  if (!button) continue;
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    event.preventDefault();
    copyFrom(button);
  });
}

render();
