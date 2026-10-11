import { loadTopicBio, usernames, profilePictures, click2url } from './loadalladata';
import { activePolygonPopups } from './polygons';
import { activeMarkerPopups } from './marker';
import { CloseALL, OpenToggleToolbar } from './cssLogic';
import { adjustTextareaHeight } from './adjusttextarea';
import { fillTopicIds } from './topicidintext';

const DEFAULT_PIC = 'https://kiloscribe.com/api/inscription-cdn/0.0.4819119';
const EMPTY_BIO = 'User has not set a bio yet. You can set yours by going to OPTIONS > TOOLBAR > EDIT > BIO';

function textOf(value) {
  if (Array.isArray(value)) return String(value[0] || '');
  return typeof value === 'string' ? value : '';
}

function validUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function colorOf(id, fallback) {
  const el = document.getElementById(id);
  return el && el.value ? el.value : fallback;
}

// Tap a PFP → show that user's bio in the Load box, same card as Edit Profile.
export async function loadBio4PIC(payer) {
  try {
      const accountTopicBio = await loadTopicBio();
      const bio = textOf(accountTopicBio[payer] && accountTopicBio[payer].topic_bio);

      activePolygonPopups.forEach((popup) => popup.remove());
      activeMarkerPopups.forEach((popup) => popup.remove());
      CloseALL();
      const loadColumn = document.getElementById("load-column");
      loadColumn.style.display = "block";
      OpenToggleToolbar();
      const inputarea = document.getElementById("input-field");
      inputarea.value = '';
      const loaded_text_area = document.getElementById("loaded-topics");
      const label = document.getElementById("loaded-topics-label");
      if (label) label.style.display = "none";
      const controls = loaded_text_area.querySelector(".loaded-topics-controls");
      if (controls) controls.style.display = "none";
      const list = document.getElementById("loaded-topics-list");
      if (list) list.style.display = "none";
      const previous = document.getElementById("loaded-bio-card");
      if (previous) previous.remove();

      const card = document.createElement('div');
      card.id = 'loaded-bio-card';
      card.className = 'profile-live-preview';

      const bubble = document.createElement('div');
      bubble.className = 'profile-live-bubble';

      const img = document.createElement('img');
      img.className = 'profile-live-pic';
      img.alt = 'Profile photo';
      const rawPic = profilePictures[payer] && profilePictures[payer].url;
      img.src = validUrl(rawPic) ? rawPic : DEFAULT_PIC;
      img.addEventListener('error', () => {
        if (img.src !== DEFAULT_PIC) img.src = DEFAULT_PIC;
      });

      const names = document.createElement('div');
      names.className = 'profile-live-names';
      const account = document.createElement('a');
      account.className = 'profile-live-account';
      account.href = `https://explore.hashpack.app/${encodeURIComponent(payer)}`;
      account.target = '_blank';
      account.rel = 'noopener noreferrer';
      account.textContent = payer;
      account.style.color = colorOf('color-picker-popup-accid', '#800080');
      account.style.textDecoration = 'none';
      account.addEventListener('click', (event) => event.stopPropagation());
      names.appendChild(account);

      const name = textOf(usernames[payer] && usernames[payer].username).trim();
      const link = textOf(click2url[payer] && click2url[payer].click2url).trim();
      const nameColor = colorOf('color-picker-popup-username', '#ff9933');
      if (name) {
        const nameSlot = document.createElement('div');
        const nameEl = link ? document.createElement('a') : document.createElement('span');
        nameEl.className = 'profile-live-name';
        nameEl.textContent = name;
        nameEl.style.color = nameColor;
        nameEl.style.textDecoration = 'none';
        if (link && validUrl(link)) {
          nameEl.href = link;
          nameEl.target = '_blank';
          nameEl.rel = 'noopener noreferrer';
        }
        nameEl.addEventListener('click', (event) => event.stopPropagation());
        nameSlot.appendChild(nameEl);
        names.appendChild(nameSlot);
      }

      bubble.appendChild(img);
      bubble.appendChild(names);

      const bioEl = document.createElement('div');
      bioEl.className = 'profile-live-bio';
      const hasBio = bio.trim().length > 0;
      if (hasBio) fillTopicIds(bioEl, bio, 'profile-live-topic');
      else bioEl.textContent = EMPTY_BIO;
      bioEl.classList.toggle('is-empty', !hasBio);

      card.appendChild(bubble);
      card.appendChild(bioEl);
      loaded_text_area.appendChild(card);
      adjustTextareaHeight(loaded_text_area);

      return { bio };

  } catch (error) {
      console.log(`Error in loadBio4PIC for payer ${payer}:`, error);
      return {};
  }
}

window.loadBio4PIC = loadBio4PIC;
