import { loadTopicBio, usernames } from './loadalladata';
import { activePolygonPopups } from './polygons';
import { activeMarkerPopups } from './marker';
import { CloseALL, OpenToggleToolbar } from './cssLogic';
import { adjustTextareaHeight } from './adjusttextarea';

// Tap a PFP → show that user's bio (set via OPTIONS > TOOLBAR > EDIT > BIO),
// same account → registry-topic flow as profile picture / username / click2url
export async function loadBio4PIC(payer) {
  try {
      const accountTopicBio = await loadTopicBio();
      const bio = accountTopicBio[payer] && accountTopicBio[payer].topic_bio;

      activePolygonPopups.forEach((popup) => popup.remove());
      activeMarkerPopups.forEach((popup) => popup.remove());
      CloseALL();
      const loadColumn = document.getElementById("load-column");
      loadColumn.style.display = "block";
      OpenToggleToolbar();
      const inputarea = document.getElementById("input-field");
      inputarea.value = '';
      const loaded_text_area = document.getElementById("loaded-topics");
      loaded_text_area.value = '';

      // Built with the DOM (not innerHTML) so bio text can't inject markup
      const wrapper = document.createElement("div");
      wrapper.style.cssText = "display: flex; justify-content: left; align-items: left; padding-top: 1vh; padding-bottom: 1vh;";
      const span = document.createElement("span");
      span.style.marginLeft = "0.45vh";
      const who = document.createElement("span");
      who.style.fontWeight = "bold";
      const uname = usernames[payer]?.username ? ` ${usernames[payer].username}` : '';
      who.textContent = `User ${payer}${uname}`;
      const text = document.createElement("span");
      text.textContent = bio
        ? `\n\n${bio}`
        : "\n\nUser has not set a bio yet. You can set yours by going to OPTIONS > TOOLBAR > EDIT > BIO";
      span.appendChild(who);
      span.appendChild(text);
      wrapper.appendChild(span);
      loaded_text_area.innerHTML = '';
      loaded_text_area.appendChild(wrapper);
      adjustTextareaHeight(loaded_text_area);

      return { bio };

  } catch (error) {
      console.log(`Error in loadBio4PIC for payer ${payer}:`, error);
      return {};
  }
}

window.loadBio4PIC = loadBio4PIC;
