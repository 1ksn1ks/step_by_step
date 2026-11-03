// Live card in Edit Profile. Shows the saved picture, name, link, and bio,
// then swaps in whatever is currently typed or uploaded.
import { connectedAccount } from './web3.js';
import { profilePictures, usernames, click2url, topicBio } from './loadalladata.js';
import { payerUsernameNode } from './payerlink.js';
import { paintEarlyProfile } from './loadprofilepopup.js';
import { paintProfileAvatar } from './earlyhashinal.js';
import { watchProfilePicture } from './markertilt.js';
import { mountPicture } from './loopmedia.js';

const DEFAULT_PIC = 'https://kiloscribe.com/api/inscription-cdn/0.0.4819119';

const accountEl = document.getElementById('profile-live-account');
const nameEl = document.getElementById('profile-live-username');
const bioEl = document.getElementById('profile-live-bio');
const nameInput = document.getElementById('edit-profile-username-input');
const linkInput = document.getElementById('edit-profile-click2link-input');
const bioInput = document.getElementById('Edit_Profile-bio');

let draftUsername = null;
let draftLink = null;
let draftBio = null;
let failedPic = '';

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

function paintLive(el, url) {
  if (!el) return el;
  return mountPicture(el, url, { className: el.className, fallback: DEFAULT_PIC });
}

function render() {
  const live = document.getElementById('profile-live-pic');
  const circle = document.getElementById('profile-circle-preview-img');
  if (!live) return;
  const nextPic = pictureUrl();
  const shown = paintLive(live, nextPic);
  paintLive(circle, nextPic);

  accountEl.textContent = connectedAccount || 'Not connected';
  accountEl.style.color = colorOf('color-picker-popup-accid', '#ffffff');

  const name = (draftUsername !== null ? draftUsername : savedUsername()).trim();
  const link = (draftLink !== null ? draftLink : savedLink()).trim();
  const nameColor = colorOf('color-picker-popup-username', '#ffffff');
  nameEl.replaceChildren();
  if (name) {
    const node = payerUsernameNode(name, link, { className: 'profile-live-name' });
    node.style.color = nameColor;
    nameEl.appendChild(node);
  }

  const bio = draftBio !== null ? draftBio : savedBio();
  const hasBio = bio.trim().length > 0;
  bioEl.textContent = hasBio ? bio : 'No bio yet';
  bioEl.classList.toggle('is-empty', !hasBio);
  paintProfileAvatar(shown, connectedAccount || "");
  watchProfilePicture(shown);
  paintEarlyProfile(shown && shown.closest(".profile-live-preview"), connectedAccount || "");
}

function useFallback(src) {
  failedPic = src;
  const live = document.getElementById('profile-live-pic');
  const circle = document.getElementById('profile-circle-preview-img');
  paintLive(live, DEFAULT_PIC);
  paintLive(circle, DEFAULT_PIC);
}

const firstPic = document.getElementById('profile-live-pic');
const firstCircle = document.getElementById('profile-circle-preview-img');
if (firstPic) firstPic.addEventListener('error', () => useFallback(firstPic.src));
if (firstCircle) firstCircle.addEventListener('error', () => useFallback(firstCircle.src));

function keepDraft(event, input, apply) {
  // A save clears the box from code. That is not a new draft, so the card
  // goes back to the name, link, or bio that was just stored.
  apply(event.isTrusted ? input.value : null);
  render();
}

nameInput.addEventListener('input', (event) => {
  keepDraft(event, nameInput, (value) => { draftUsername = value; });
});

linkInput.addEventListener('input', (event) => {
  keepDraft(event, linkInput, (value) => { draftLink = value; });
});

bioInput.addEventListener('input', (event) => {
  keepDraft(event, bioInput, (value) => { draftBio = value; });
});

document.getElementById('input-field-profile-picture').addEventListener('input', render);

const uploadBox = document.getElementById('preview-profile-picture');
const uploadImg = uploadBox.querySelector('img');
new MutationObserver(render).observe(uploadImg, { attributes: true, attributeFilter: ['src', 'hidden'] });
new MutationObserver(render).observe(uploadBox, { attributes: true, attributeFilter: ['hidden'] });

document.getElementById('Edit_Profile').addEventListener('click', render);
new MutationObserver(render).observe(document.getElementById('account-id'), { childList: true, characterData: true, subtree: true });
document.addEventListener('profiles-loaded', render);

render();
