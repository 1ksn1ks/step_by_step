// Hover card for a topic marker or polygon. The title stays, and the card
// also names the payer and the topic. A share pin shows the original post,
// the same person and topic the popup opens.

import { usernames } from './loadalladata.js';
import { globalLoadedTopicIdsWithNames } from './letall.js';
import { earlyHashinalNumber } from './earlyhashinal.js';

// Early Hashinal holders get the locked popup theme (style.css
// .early-holder-popup), not the viewer's popup colour pickers.
const HASHINAL_TIP_COLORS = Object.freeze({
  title: '#ffffff',
  name: '#f6e27a',
  id: '#e9d5ff',
});

function bubble(node) {
  const wrap = document.createElement('div');
  wrap.className = 'map-tip-bubble';
  wrap.appendChild(node);
  return wrap;
}

function text(value) {
  return String(value == null ? '' : value).replace(/\r\n/g, '\n').replace(/\n/g, ' ').trim();
}

function topicNameFromList(topicId) {
  if (!topicId) return '';
  const prefix = topicId + ' - ';
  for (const entry of globalLoadedTopicIdsWithNames) {
    const row = String(entry || '');
    if (row.startsWith(prefix)) return row.slice(prefix.length).trim();
  }
  return '';
}

function readCard(source) {
  if (!source) return null;
  const props = source.properties || {};
  let data = null;
  const stored = props.popupData || source.popupData;
  if (typeof stored === 'function') {
    try { data = stored(); } catch { data = null; }
  } else if (stored && typeof stored === 'object') {
    data = stored;
  }
  const payer = text((data && (data.payer || data.payerInfo)) || source.payer);
  const liveName = payer && usernames[payer] && usernames[payer].username;
  const username = text(liveName || (data && data.username));
  const topicId = text((data && data.topicId) || source.topicId);
  const topicName = text((data && data.loadedTopicName) || topicNameFromList(topicId));
  const title = text((data && data.title) || props.title || source.title);
  if (!title && !payer && !topicId && !topicName) return null;
  return { title, payer, username, topicId, topicName };
}

function pickerColor(id, fallback) {
  const input = document.getElementById(id);
  return (input && input.value) || fallback;
}

function line(label, name, id, colors) {
  if (!name && !id) return null;
  const row = document.createElement('div');
  row.className = 'map-tip-row';
  const key = document.createElement('span');
  key.className = 'map-tip-k';
  key.textContent = label;
  const body = document.createElement('span');
  body.className = 'map-tip-body';
  if (id) {
    const idNode = document.createElement('span');
    idNode.className = 'map-tip-id';
    idNode.textContent = id;
    if (colors && colors.id) idNode.style.color = colors.id;
    body.appendChild(idNode);
  }
  if (name && name !== id) {
    const nameNode = document.createElement('span');
    nameNode.className = 'map-tip-name';
    nameNode.textContent = name;
    if (colors && colors.name) nameNode.style.color = colors.name;
    body.appendChild(nameNode);
  }
  row.append(key, body);
  return row;
}

// Fills the tip. Returns false when the post has nothing to show.
export function fillMapTip(tip, source) {
  const card = readCard(source);
  tip.replaceChildren();
  if (!card) return false;
  const hashinal = !!(card.payer && earlyHashinalNumber(card.payer));
  if (card.title) {
    const title = document.createElement('div');
    title.className = 'map-tip-title';
    title.textContent = card.title;
    title.style.color = hashinal ? HASHINAL_TIP_COLORS.title : pickerColor('color-picker-popup-titles', '#ffffff');
    tip.appendChild(bubble(title));
  }
  const payerRow = line('By', card.username, card.payer, hashinal ? HASHINAL_TIP_COLORS : {
    name: pickerColor('color-picker-popup-username', '#ffffff'),
    id: pickerColor('color-picker-popup-accid', '#ffffff'),
  });
  if (payerRow) tip.appendChild(bubble(payerRow));
  const topicRow = line('On', card.topicName, card.topicId);
  if (topicRow) tip.appendChild(bubble(topicRow));
  return tip.childElementCount > 0;
}
