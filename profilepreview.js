// Live card in Edit Profile. Shows the saved picture, name, link, and bio,
// then swaps in whatever is currently typed or uploaded.
import { connectedAccount } from './web3.js';
import { profilePictures, usernames, click2url, topicBio } from './loadalladata.js';
import { payerUsernameNode, safeHttpUrl } from './payerlink.js';

const DEFAULT_PIC = 'https://kiloscribe.com/api/inscription-cdn/0.0.4819119';

const picEl = document.getElementById('profile-live-pic');
const circleEl = document.getElementById('profile-circle-preview-img');
const accountEl = document.getElementById('profile-live-account');
const nameEl = document.getElementById('profile-live-username');
const bioEl = document.getElementById('profile-live-bio');
const nameInput = document.getElementById('toolbar-input');
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

function sectionOpen(id) {
  const el = document.getElementById(id);
  return !!el && el.style.display !== 'none';
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

function render() {
  if (!picEl) return;
  const nextPic = pictureUrl();
  if (picEl.getAttribute('src') !== nextPic) picEl.src = nextPic;
  if (circleEl && circleEl.getAttribute('src') !== nextPic) circleEl.src = nextPic;

  accountEl.textContent = connectedAccount || 'Not connected';
  accountEl.style.color = colorOf('color-picker-popup-accid', '#800080');

  const name = (draftUsername !== null ? draftUsername : savedUsername()).trim();
  const link = (draftLink !== null ? draftLink : savedLink()).trim();
  const nameColor = colorOf('color-picker-popup-username', '#ff9933');
  nameEl.replaceChildren();
  if (name) {
    const node = payerUsernameNode(name, link, {
      className: safeHttpUrl(link) ? 'profile-live-name is-link' : 'profile-live-name'
    });
    node.style.color = nameColor;
    nameEl.appendChild(node);
  }

  const bio = draftBio !== null ? draftBio : savedBio();
  const hasBio = bio.trim().length > 0;
  bioEl.textContent = hasBio ? bio : 'No bio yet';
  bioEl.classList.toggle('is-empty', !hasBio);
}

function useFallback(src) {
  failedPic = src;
  if (picEl.getAttribute('src') !== DEFAULT_PIC) picEl.src = DEFAULT_PIC;
  if (circleEl && circleEl.getAttribute('src') !== DEFAULT_PIC) circleEl.src = DEFAULT_PIC;
}

picEl.addEventListener('error', () => useFallback(picEl.src));
if (circleEl) circleEl.addEventListener('error', () => useFallback(circleEl.src));

nameInput.addEventListener('input', () => {
  if (sectionOpen('edit-profile-username')) draftUsername = nameInput.value;
  if (sectionOpen('edit-profile-click2link')) draftLink = nameInput.value;
  render();
});

bioInput.addEventListener('input', () => {
  draftBio = bioInput.value;
  render();
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
