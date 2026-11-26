// Hover card for a topic marker or polygon: a small copy of the expanded
// popup. The creator's picture, name and account at the top, then the
// title, the topic as a slim chip, then the post's likes and views. A
// share pin shows the original post, the same person and topic the popup
// opens. Nothing on it can be tapped (style.css: pointer-events: none).

import { usernames, profilePictures } from './loadalladata.js';
import { globalLoadedTopicIdsWithNames } from './letall.js';
import { earlyHashinalNumber } from './earlyhashinal.js';
import { countsNode } from './postcounts.js';
import { avatarSrc } from './avatarsrc.js';
import { forgetLoop, pictureElement } from './loopmedia.js';
import { DEFAULT_AVATAR } from './hashinalurl.js';

// Early Hashinal holders get the locked popup theme (style.css
// .early-holder-popup), not the viewer's popup colour pickers.
const HASHINAL_TIP_COLORS = Object.freeze({
  title: '#ffffff',
  name: '#f6e27a',
  id: '#e9d5ff',
});
// An early holder's frame and bubble rims: the popup's gold.
const HASHINAL_TIP_RIM = '#f6e27a';

// node: one node or a list. extra: a second class (the head, the topic).
function bubble(node, extra) {
  const wrap = document.createElement('div');
  wrap.className = extra ? `map-tip-bubble ${extra}` : 'map-tip-bubble';
  wrap.append(...(Array.isArray(node) ? node : [node]));
  return wrap;
}

function text(value) {
  return String(value == null ? '' : value).replace(/\r\n/g, '\n').replace(/\n/g, ' ').trim();
}

// A topic's name from the loaded topics list ("<id> - <name>" rows), as
// the feed's topic title reads it. The cluster list (markerstack.js) uses
// it too. Nothing is fetched.
export function topicNameFromList(topicId) {
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
  // The counts come from the record the popup opens: a share pin's fresh
  // one once it has arrived (as the cluster list reads it).
  const record = props._shareRecord || source._shareRecord || data;
  // The picture the popup and the marker face already show (a record's is
  // checked, with the default avatar for none), so it comes from the
  // browser's cache.
  const profileUrl = text(record && record.profileUrl)
    || (payer && profilePictures[payer] && profilePictures[payer].url)
    || '';
  return { title, payer, username, topicId, topicName, record, profileUrl };
}

function pickerColor(id, fallback) {
  const input = document.getElementById(id);
  return (input && input.value) || fallback;
}

// label: a word for a screen reader ("By"), or none: then the row has no
// .map-tip-k at all.
function line(label, name, id, colors) {
  if (!name && !id) return null;
  const row = document.createElement('div');
  row.className = 'map-tip-row';
  if (label) {
    const key = document.createElement('span');
    key.className = 'map-tip-k';
    key.textContent = label;
    row.appendChild(key);
  }
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
  row.appendChild(body);
  return row;
}

// Fills the tip. Returns false when the post has nothing to show.
// The popup's order: the creator (.map-tip-head: the picture and the By
// row), the title, the topic (.map-tip-topic: its ID and name, no
// label), the counts.
export function fillMapTip(tip, source) {
  const card = readCard(source);
  // A creator whose picture is a looping video: that loop lets go.
  const oldPic = tip._tipPic;
  tip._tipPic = null;
  if (oldPic && oldPic.tagName === 'VIDEO') forgetLoop(oldPic);
  tip.replaceChildren();
  if (!card) return false;
  const hashinal = !!(card.payer && earlyHashinalNumber(card.payer));
  // The frame and the bubbles' rims take the popup's Border colour.
  tip.style.setProperty('--popup-border-color', hashinal ? HASHINAL_TIP_RIM : pickerColor('color-picker-popup-border', '#ffffff'));
  const payerRow = line('By', card.username, card.payer, hashinal ? HASHINAL_TIP_COLORS : {
    name: pickerColor('color-picker-popup-username', '#ffffff'),
    id: pickerColor('color-picker-popup-accid', '#ffffff'),
  });
  if (payerRow) {
    // Drawn as the cluster rows and the popup draw it.
    const pic = pictureElement(avatarSrc(card.profileUrl || DEFAULT_AVATAR), {
      className: 'map-tip-pic',
      alt: '',
      fallback: DEFAULT_AVATAR,
    });
    pic.setAttribute('aria-hidden', 'true');
    tip._tipPic = pic;
    tip.appendChild(bubble([pic, payerRow], 'map-tip-head'));
  }
  if (card.title) {
    const title = document.createElement('div');
    title.className = 'map-tip-title';
    title.textContent = card.title;
    title.style.color = hashinal ? HASHINAL_TIP_COLORS.title : pickerColor('color-picker-popup-titles', '#ffffff');
    tip.appendChild(bubble(title));
  }
  const topicRow = line('', card.topicName, card.topicId);
  if (topicRow) tip.appendChild(bubble(topicRow, 'map-tip-topic'));
  // Last: the likes and views known now (postcounts.js).
  // Nothing is fetched and no view is counted.
  const counts = countsNode(card.record, 'map-tip-counts');
  if (counts) tip.appendChild(counts);
  return tip.childElementCount > 0;
}
