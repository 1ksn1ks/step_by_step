import { toast } from './toast.js';

// A 0.0. topic id written inside a bio. Fresh regex each scan so lastIndex
// never sticks on the shared pattern.
const TOPIC_ID = /0\.0\.\d+/g;

export function useTopicId(topicId) {
  const field = document.getElementById('input-field');
  if (!field) return;
  field.value = topicId;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  toast.success('Filled ' + topicId);
}

// Split bio text into plain nodes and clickable topic ids. className is
// optional so a caller can keep its own look; this function adds none.
export function fillTopicIds(bioEl, bio, className) {
  bioEl.replaceChildren();
  const re = new RegExp(TOPIC_ID.source, 'g');
  let last = 0;
  let match;
  while ((match = re.exec(bio)) !== null) {
    if (match.index > last) {
      bioEl.appendChild(document.createTextNode(bio.slice(last, match.index)));
    }
    const topicId = match[0];
    const hit = document.createElement('span');
    if (className) hit.className = className;
    hit.textContent = topicId;
    hit.addEventListener('click', (event) => {
      event.stopPropagation();
      useTopicId(topicId);
    });
    bioEl.appendChild(hit);
    last = match.index + topicId.length;
  }
  if (last < bio.length) bioEl.appendChild(document.createTextNode(bio.slice(last)));
}
