import {getTopicInfo} from './hedera'
import { prepareHoldings, fetchAccountTokens } from './nftcache.js'
import {sendMessage, popupView, knownPopupViews, setPopupViewTotal, fetchPost} from './msgbackend'
import {getTopicData as getMessages} from './topicdata'
import { adjustTextareaHeight } from './adjusttextarea';
import { activePolygonPopups, newActivePolygonPopups, addPolygonWithImageFill, dropPolygonCover} from './polygons';
import { activeMarkerPopups, newActiveMarkerPopups, updateClusters, index } from './marker';
import { removeUfoModel, changePopupState, closeTransientMapUI} from './cssLogic'
import { polygons, geojson, storedMarkers, storedPolygons, storedMarkersFiltered, storedPolygonsFiltered, currentUfoModelInGLTF,  newExistingMarkers,  existingMarkers, newStoredMarkers, newStoredPolygons,
  accidTopicChatColor, usernameTopicChatColor, textTopicChatColor, innerContainerTopicChatColor, topicChatHeaderColor,
  textFontSizeTopicChat, timestampFontSizeTopicChat, headerFontSizeTopicChat } from './letall';
import {updateRulesForModelNFTState} from './confirmnft'
import { animateMapTo, cancelAnimateMapTo } from './animatemapto';
import { ringCenter, zoomForPolygon } from './polygonframe.js';
import { profilePictures, usernames, click2url, profileTopics } from './loadalladata'
import { confirmShare, unshareFromMyTopic, sharePin } from './followtopic'
import { clearShareTopic, noteShare, shareState, shareMine, takeSharePin, takeUnsharePin } from './sharecount.js'
import { readPostCard, writePostCard, forgetPostCard } from './postcache.js'
import { openPreview } from './fullscreenmedia';
import maplibregl from 'maplibre-gl';
import { map } from './map';
import { applyAllStyles } from './loadprofilepopup';
import { scene } from './threejs'
import { parsePrivateKey, decryptMessage, parsePublicKey, encryptMessage, encryptWithPassword, decryptWithPassword } from './sodium'
import { signer, connectedAccount } from './web3';
import { refitPopups } from './popupanim';
import { copyTextToClipboard } from './handleallmessages';
import { toast } from './toast'
import { stackedTopicRules, smallestPolygonSize } from './topicrules.js'
import { payerUsernameNode } from './payerlink.js'

// A drawing counts toward the NFT allowance only when it is a real marker
// or polygon. Likes, comments, deletes, and other messages do not.
function markerCoordinates(cordData) {
  let coords;
  if (typeof cordData === 'string') {
    coords = cordData.split(',').map((num) => parseFloat(num.trim()));
  } else if (Array.isArray(cordData)) {
    coords = cordData;
  } else {
    return null;
  }
  if (!Array.isArray(coords) || coords.length !== 2 || coords.some((num) => Number.isNaN(num))) {
    return null;
  }
  return coords;
}

function polygonCoordinates(cordStr) {
  if (typeof cordStr !== 'string') return null;
  const validCoordPattern = /^\[-?\d+\.?\d*,\s*-?\d+\.?\d*\](,\s*\[-?\d+\.?\d*,\s*-?\d+\.?\d*\])*$/;
  if (!validCoordPattern.test(cordStr)) return null;
  try {
    const coordinates = JSON.parse(`[${cordStr}]`);
    if (!Array.isArray(coordinates) || coordinates.length < 3) return null;
    return coordinates;
  } catch {
    return null;
  }
}

// null means the account is not in the cache yet. 0 means they hold none.
function slotsFromHoldings(holdings, payerId, rules, idKey, countKey) {
  if (!holdings.has(payerId)) return null;
  const tokens = holdings.get(payerId);
  let total = 0;
  for (const rule of rules) {
    const count = Number(tokens[rule[idKey]]) || 0;
    if (count > 0) total += count * Number(rule[countKey]);
  }
  return total;
}

// null: this post has no number. New drawings omit it.
// false: a number is present but it is not a whole number, so the post stays unloaded.
// otherwise: the number already written on an older post. An old delete still names it.
function legacyShapeNumber(value) {
  if (value == null || String(value).trim() === '') return null;
  if (!Number.isInteger(Number(value))) return false;
  return value;
}

// Newest valid drawing first, so the mirror queue starts at the messages
// the map should show before the older ones.
function newestPayerOrder(messages) {
  const order = [];
  const seen = new Set();
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    let parsed = message;
    try {
      if (typeof message === 'string') parsed = JSON.parse(message);
    } catch {
      continue;
    }
    const payer = message && (message.payer || parsed.payer);
    if (!payer || seen.has(payer)) continue;
    const marker = parsed.marker && parsed.marker.data;
    const polygon = parsed.polygon && parsed.polygon.data;
    const markerOk = marker && legacyShapeNumber(marker.numberOfMarker) !== false && markerCoordinates(marker.cord);
    const polygonOk = polygon && legacyShapeNumber(polygon.numberOfPolygon) !== false && polygonCoordinates(polygon.cord);
    if (!markerOk && !polygonOk) continue;
    seen.add(payer);
    order.push(payer);
  }
  if (order.length > 0) return order;
  for (let index = messages.length - 1; index >= 0; index--) {
    const payer = messages[index] && messages[index].payer;
    if (!payer || seen.has(payer)) continue;
    seen.add(payer);
    order.push(payer);
  }
  return order;
}

// Newest-first pass already used to bucket messages. The topic name and the
// newest-drawing payer order come from that same walk.
function indexNewestMessages(messages, topicAdmin) {
  let loadedTopicName = '';
  const payerOrder = [];
  const payerSeen = new Set();
  let sawDrawing = false;
  const messagesByPayer = new Map();
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    let parsed = message;
    let parsedOk = typeof message !== 'string';
    if (typeof message === 'string') {
      try {
        parsed = JSON.parse(message);
        parsedOk = true;
      } catch {
        parsedOk = false;
      }
    }
    const envelopePayer = message && message.payer;
    const payerId = envelopePayer || (parsedOk && parsed && parsed.payer) || '';
    if (parsedOk && parsed && !loadedTopicName && parsed.changeName && (topicAdmin.length === 0 || topicAdmin.includes(envelopePayer))) {
      loadedTopicName = parsed.changeName;
    }
    if (parsedOk && parsed && payerId && !payerSeen.has(payerId)) {
      const marker = parsed.marker && parsed.marker.data;
      const polygon = parsed.polygon && parsed.polygon.data;
      const markerOk = marker && legacyShapeNumber(marker.numberOfMarker) !== false && markerCoordinates(marker.cord);
      const polygonOk = polygon && legacyShapeNumber(polygon.numberOfPolygon) !== false && polygonCoordinates(polygon.cord);
      if (markerOk || polygonOk) {
        payerSeen.add(payerId);
        payerOrder.push(payerId);
        sawDrawing = true;
      }
    }
    if (!envelopePayer) continue;
    let bucket = messagesByPayer.get(envelopePayer);
    if (!bucket) {
      bucket = [];
      messagesByPayer.set(envelopePayer, bucket);
    }
    bucket.push(message);
  }
  if (!sawDrawing) {
    payerOrder.length = 0;
    const seen = new Set();
    for (let index = messages.length - 1; index >= 0; index--) {
      const payer = messages[index] && messages[index].payer;
      if (!payer || seen.has(payer)) continue;
      seen.add(payer);
      payerOrder.push(payer);
    }
  }
  return { loadedTopicName, payerOrder, messagesByPayer };
}

async function assignDrawingOwnership({
  hasRulesForMarker,
  hasRulesForPolygon,
  markerPayers,
  polygonPayers,
  markerRules,
  polygonRules,
}) {
  const payerIds = [];
  const seen = new Set();
  const addPayer = (payerId) => {
    if (!payerId || seen.has(payerId)) return;
    seen.add(payerId);
    payerIds.push(payerId);
  };
  if (hasRulesForMarker) {
    for (const payerId of markerPayers) addPayer(payerId);
  }
  if (hasRulesForPolygon) {
    for (const payerId of polygonPayers) addPayer(payerId);
  }
  const holdings = await prepareHoldings(payerIds);
  const markerOwnershipArray = [];
  const polygonOwnershipArray = [];

  if (hasRulesForMarker) {
    for (const payerId of markerPayers) {
      const slots = slotsFromHoldings(holdings, payerId, markerRules, 'markerTopicId', 'markerMessagesPerNft');
      markerOwnershipArray.push({
        payerId,
        numberOfMessages: slots || 0,
        numberOfMarker: [],
        pending: slots === null,
      });
    }
  } else {
    for (const payerId of markerPayers) {
      markerOwnershipArray.push({ payerId, numberOfMarker: [], pending: false });
    }
  }

  if (hasRulesForPolygon) {
    for (const payerId of polygonPayers) {
      const slots = slotsFromHoldings(holdings, payerId, polygonRules, 'polygonTopicId', 'polygonMessagesPerNft');
      polygonOwnershipArray.push({
        payerId,
        numberOfMessages: slots || 0,
        numberOfPolygon: [],
        pending: slots === null,
      });
    }
  } else {
    for (const payerId of polygonPayers) {
      polygonOwnershipArray.push({ payerId, numberOfPolygon: [], pending: false });
    }
  }

  return { holdings, markerOwnershipArray, polygonOwnershipArray, payerIds };
}

let clusterTimer = null;
let indexWarned = false;

// One post is one drawing. The same post (same consensus timestamp) can
// reach the live list through more than one loaded topic, and a second copy
// would paint a dot on top of the first — so a drawing whose timestamp is
// already live is dropped.
function dedupeByTimestamp(drawings, liveList) {
  // Normalize: the backend path stores ISO strings, the mirror path stores
  // Date objects — the same instant must produce the same key.
  const keyOf = (value) => {
    if (value == null || value === '') return '';
    return messageCreated(value) || String(value);
  };
  const seen = new Set(liveList.map((d) => keyOf(d && d.created)).filter(Boolean));
  const fresh = [];
  for (const drawing of drawings) {
    const key = keyOf(drawing && drawing.created);
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    fresh.push(drawing);
  }
  return fresh;
}

function publishApprovedDrawings(features, polys, state, sync) {
  const markers = features.slice(state.markers);
  const nextPolys = polys.slice(state.polys);
  state.markers = features.length;
  state.polys = polys.length;
  const freshMarkers = dedupeByTimestamp(markers, geojson.features);
  const freshPolys = dedupeByTimestamp(nextPolys, polygons);
  if (freshMarkers.length > 0) geojson.features.push(...freshMarkers);
  if (freshPolys.length > 0) {
    polygons.push(...freshPolys);
    for (const polygon of freshPolys) addPolygonWithImageFill(map, polygon);
  }
  const flush = () => {
    clusterTimer = null;
    if (geojson.features.length === 0) return;
    try {
      index.load(geojson.features);
      updateClusters();
    } catch (err) {
      if (!indexWarned) {
        indexWarned = true;
        console.warn('marker index update skipped');
      }
    }
  };
  if (sync) {
    if (clusterTimer) clearTimeout(clusterTimer);
    flush();
    return;
  }
  if (freshMarkers.length === 0) return;
  if (clusterTimer) return;
  clusterTimer = setTimeout(flush, 400);
}

// Cached accounts are drawn in one newest-to-oldest pass. Each missing
// account is fetched, saved, and drawn before the next request goes out.
function deferConnectedAccount(ctx) {
  if (!connectedAccount || !ctx.payerIds.includes(connectedAccount)) return;
  ctx.holdings.delete(connectedAccount);
  const touch = (list, hasRules, numbersKey) => {
    if (!hasRules) return;
    const owner = list.find((row) => row.payerId === connectedAccount);
    if (!owner) return;
    owner.pending = true;
    owner.numberOfMessages = 0;
    owner[numbersKey] = [];
  };
  touch(ctx.markerOwnershipArray, ctx.hasRulesForMarker, 'numberOfMarker');
  touch(ctx.polygonOwnershipArray, ctx.hasRulesForPolygon, 'numberOfPolygon');
}

async function showDrawingsAsApproved(ctx) {
  deferConnectedAccount(ctx);
  const publishState = { markers: 0, polys: 0 };
  const publish = (sync) => publishApprovedDrawings(ctx.features, ctx.polygonsOut, publishState, sync);
  await ctx.drawLoaded();
  publish(false);
  const pendingPayers = ctx.payerIds.filter((payerId) => ctx.payerWaiting(payerId));
  const payerRank = Array.isArray(ctx.payerOrder) ? ctx.payerOrder : newestPayerOrder(ctx.messages);
  pendingPayers.sort((a, b) => {
    const ai = payerRank.indexOf(a);
    const bi = payerRank.indexOf(b);
    const limit = payerRank.length;
    return (ai < 0 ? limit : ai) - (bi < 0 ? limit : bi);
  });
  if (connectedAccount) {
    const mine = pendingPayers.indexOf(connectedAccount);
    if (mine > 0) {
      pendingPayers.splice(mine, 1);
      pendingPayers.unshift(connectedAccount);
    }
  }
  for (const payerId of pendingPayers) {
    let tokens;
    try {
      tokens = await fetchAccountTokens(payerId, payerId === connectedAccount);
    } catch (err) {
      console.warn('NFT holdings unavailable for', payerId);
      continue;
    }
    ctx.holdings.set(payerId, tokens);
    if (ctx.hasRulesForMarker) {
      const markerOwner = ctx.markerOwnershipArray.find((owner) => owner.payerId === payerId);
      if (markerOwner && markerOwner.pending) {
        markerOwner.numberOfMessages = slotsFromHoldings(ctx.holdings, payerId, ctx.markerRules, 'markerTopicId', 'markerMessagesPerNft') || 0;
        markerOwner.pending = false;
      }
    }
    if (ctx.hasRulesForPolygon) {
      const polygonOwner = ctx.polygonOwnershipArray.find((owner) => owner.payerId === payerId);
      if (polygonOwner && polygonOwner.pending) {
        polygonOwner.numberOfMessages = slotsFromHoldings(ctx.holdings, payerId, ctx.polygonRules, 'polygonTopicId', 'polygonMessagesPerNft') || 0;
        polygonOwner.pending = false;
      }
    }
    ctx.drawState.batch = ctx.messagesByPayer.get(payerId) || [];
    await ctx.drawLoaded();
    publish(false);
  }
  publish(true);
}




export let allLoadedMessages = [];

const PAGER_MODE_KEY = 'meritocracy-pager-mode';
let popupSettingsTarget = null;
let popupSettingsBound = false;
let popupDeleteBusy = false;

function pagerMode() {
  try {
    const mode = localStorage.getItem(PAGER_MODE_KEY);
    if (mode === 'time' || mode === 'random' || mode === 'account') return mode;
  } catch {
    // A blocked store just keeps the default for this visit.
  }
  return 'account';
}

function walkTarget(value) {
  if (!value || value.payer == null || value.number == null || !value.topicId) return null;
  return value;
}

function setPopupPreview(open) {
  const preview = document.getElementById('popup-settings-preview');
  const toggle = document.getElementById('popup-settings-preview-toggle');
  const colors = document.getElementById('popup-column-2');
  const pickers = document.getElementById('popup-column-container-3');
  if (preview) preview.style.display = open ? 'flex' : 'none';
  if (toggle) toggle.textContent = open ? 'Hide preview' : 'Preview';
  // Border, Close, Font, and the other color buttons, plus Save popup,
  // only belong next to the sample. They stay hidden until Preview is open.
  if (colors) colors.style.display = open ? 'block' : 'none';
  if (pickers) pickers.style.display = open ? 'block' : 'none';
}

function paintPagerModes() {
  const mode = pagerMode();
  for (const name of ['account', 'time', 'random']) {
    const btn = document.getElementById('popup-pager-' + name);
    if (btn) btn.classList.toggle('is-on', name === mode);
  }
}

function paintDeleteButton() {
  const btn = document.getElementById('popup-settings-delete');
  if (!btn) return;
  const walk = popupSettingsTarget;
  const mine = !!(walk && signer && connectedAccount && walk.payer === connectedAccount);
  if (!mine) {
    btn.style.display = 'none';
    return;
  }
  const label = walk.share ? 'Delete share' : 'Delete';
  btn.style.display = 'flex';
  btn.setAttribute('aria-label', label);
  btn.title = label;
}

function closePopupSettings() {
  const backdrop = document.getElementById('popup-settings-backdrop');
  const card = document.getElementById('popup-settings-card');
  const column = document.getElementById('popup-column-container-3');
  if (backdrop) backdrop.style.display = 'none';
  if (card) card.style.display = 'none';
  if (column) column.style.display = 'none';
  popupSettingsTarget = null;
  setPopupPreview(false);
}

function bindPopupSettings() {
  if (popupSettingsBound) return;
  const toggle = document.getElementById('popup-settings-preview-toggle');
  if (!toggle) return;
  popupSettingsBound = true;
  const card = document.getElementById('popup-settings-card');
  // Document clicks run CloseALL, which hides this card. The trash has to
  // stay here, so a click inside the card stops there. The × still closes
  // because its own handler calls CloseALL.
  if (card) card.addEventListener('click', (event) => event.stopPropagation());
  toggle.addEventListener('click', () => {
    const preview = document.getElementById('popup-settings-preview');
    if (!preview) return;
    setPopupPreview(preview.style.display === 'none');
  });
  for (const mode of ['account', 'time', 'random']) {
    const btn = document.getElementById('popup-pager-' + mode);
    if (!btn) continue;
    btn.addEventListener('click', () => {
      try { localStorage.setItem(PAGER_MODE_KEY, mode); } catch { /* keep it for this visit */ }
      paintPagerModes();
    });
  }
  const del = document.getElementById('popup-settings-delete');
  if (del) del.addEventListener('click', (event) => {
    event.stopPropagation();
    deletePopupTarget();
  });
}

window.openPopupSettings = function(target) {
  requestAnimationFrame(() => {
    // Same frame as the map popup. The backdrop hides it and closes on tap.
    const backdrop = document.getElementById("popup-settings-backdrop");
    const card = document.getElementById("popup-settings-card");
    if (!backdrop || !card) return;
    if (backdrop.style.display === "block") {
      closePopupSettings();
    } else {
      bindPopupSettings();
      popupSettingsTarget = walkTarget(target);
      setPopupPreview(false);
      paintPagerModes();
      paintDeleteButton();
      backdrop.style.display = "block";
      card.style.display = "block";
      refitPopups();
      removeUfoModel();
    }
  });
};

function payerHasLike(actions, timestamp, type) {
  const row = actions && actions.get(timestamp);
  if (!row || !connectedAccount) return false;
  const mine = row.get(connectedAccount);
  return !!(mine && mine.type === type);
}

let heartLikeSeq = 0;

function createHeartLike({ count, liked, mini, className, onToggle }) {
  const total = Number(count) || 0;
  const base = liked ? Math.max(0, total - 1) : total;
  const root = document.createElement('div');
  root.className = mini ? 'heart-like heart-like-mini' : 'heart-like';
  if (className) root.className += ' ' + className;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = `heart-like-${++heartLikeSeq}`;
  input.checked = !!liked;
  const label = document.createElement('label');
  label.htmlFor = input.id;
  label.dataset.count = String(base);
  label.dataset.next = String(base + 1);
  label.appendChild(document.createElement('span'));
  root.appendChild(input);
  root.appendChild(label);
  root.addEventListener('click', (event) => event.stopPropagation());
  let busy = false;
  input.addEventListener('change', async () => {
    if (busy) return;
    const wantLike = input.checked;
    root.classList.remove('is-pop', 'is-down');
    void root.offsetWidth;
    root.classList.add(wantLike ? 'is-pop' : 'is-down');
    busy = true;
    try {
      const ok = await onToggle(wantLike);
      if (!ok) {
        input.checked = !wantLike;
        root.classList.remove('is-pop', 'is-down');
      }
    } catch {
      input.checked = !wantLike;
      root.classList.remove('is-pop', 'is-down');
    }
    busy = false;
  });
  return root;
}

let commentBubbleInput = null;
let commentsClosing = false;

function createCommentBubble({ count, mini, onToggle }) {
  const total = Number(count) || 0;
  const root = document.createElement('div');
  root.className = mini ? 'heart-like heart-like-mini comment-bubble' : 'heart-like comment-bubble';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = `comment-bubble-${++heartLikeSeq}`;
  const label = document.createElement('label');
  label.htmlFor = input.id;
  label.dataset.count = String(total);
  label.dataset.next = String(total);
  label.appendChild(document.createElement('span'));
  root.appendChild(input);
  root.appendChild(label);
  root.addEventListener('click', (event) => event.stopPropagation());
  let busy = false;
  input.addEventListener('change', () => {
    if (busy) return;
    const open = input.checked;
    root.classList.remove('is-pop', 'is-down');
    void root.offsetWidth;
    root.classList.add(open ? 'is-pop' : 'is-down');
    busy = true;
    try {
      if (onToggle(open) === false) input.checked = !open;
      if (input.checked !== open) root.classList.remove('is-pop', 'is-down');
    } finally {
      busy = false;
    }
  });
  return root;
}

function createShareBubble({ count, shared, onToggle }) {
  return createHeartLike({
    count,
    liked: shared,
    className: 'share-bubble',
    onToggle,
  });
}

function isValidUrl(url) {
  try {
      new URL(url);
      return true;
  } catch {
      return false;
  }
}

// Phone swipe and keyboard arrows share one pager. A mouse drag is a text
// selection, so it never turns the page. Left is the previous message,
// right is the next one, matching the ← → chips.
const popupPagers = new Set();
let popupKeysBound = false;
let popupStepQueue = 0;
let popupStepScheduled = false;

// A card is built once and reused the next time that post is shown. Dropping
// its pager while it is off the map makes the arrows die the moment you come
// back to it (the 8th press on a stack of 9). Detached cards stay registered.
function latestPopupPager() {
  let pager = null;
  for (const candidate of popupPagers) {
    if (candidate.container.isConnected) pager = candidate;
  }
  return pager;
}

function touchPopupPager(container) {
  if (!container) return;
  for (const entry of popupPagers) {
    if (entry.container !== container) continue;
    popupPagers.delete(entry);
    popupPagers.add(entry);
    return;
  }
}

// The popup is rebuilt on every step. Doing that inside keydown removes the
// focused button before the key press finishes, and the browser then drops
// the rest of a fast repeat. Steps run after the key press, one per press.
function schedulePopupStep(direction) {
  popupStepQueue += direction;
  if (popupStepScheduled) return;
  popupStepScheduled = true;
  requestAnimationFrame(() => {
    popupStepScheduled = false;
    const steps = popupStepQueue;
    popupStepQueue = 0;
    const count = Math.abs(steps);
    const forward = steps > 0;
    for (let i = 0; i < count; i++) {
      const pager = latestPopupPager();
      if (!pager) return;
      if (forward) pager.goNext();
      else pager.goPrev();
    }
  });
}

// The message's ISO time. Same string the server stores as the view key.
function messageCreated(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

// A delete names the post's time. Older deletes still name the marker or
// polygon number, and those posts stay hidden. The number list also keeps
// one drawing from being added twice.
function rememberShapeDelete(owner, numbersKey, data) {
  if (!owner || !data) return;
  const marker = numbersKey === 'numberOfMarker';
  const numberKey = marker ? 'deleteMarkerNumber' : 'deletePolygonNumber';
  const createdKey = marker ? 'deleteMarkerCreated' : 'deletePolygonCreated';
  const stampKey = marker ? 'deleteMarkerTimestamp' : 'deletePolygonTimestamp';
  const rawNumber = data[numberKey];
  if (rawNumber != null && String(rawNumber).trim() !== '') owner[numbersKey].push(rawNumber);
  if (!owner.deletedCreated) owner.deletedCreated = new Set();
  if (!owner.deletedTimestamp) owner.deletedTimestamp = new Set();
  const created = messageCreated(data[createdKey]);
  if (created) owner.deletedCreated.add(created);
  const stamp = data[stampKey];
  if (stamp != null && String(stamp).trim() !== '') owner.deletedTimestamp.add(String(stamp));
}

function postWasDeleted(owner, numbersKey, slot, created, timestamp) {
  if (!owner) return false;
  const numbers = owner[numbersKey];
  if (numbers && numbers.includes(slot)) return true;
  const iso = messageCreated(created);
  if (iso && owner.deletedCreated && owner.deletedCreated.has(iso)) return true;
  if (timestamp && owner.deletedTimestamp && owner.deletedTimestamp.has(String(timestamp))) return true;
  return false;
}

const POPUP_VIEWS_KEY = 'meritocracy-popup-views';
const popupViewsCounted = new Set();

function rememberedPopupViews() {
  try {
    const raw = localStorage.getItem(POPUP_VIEWS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list : []);
  } catch {
    return new Set();
  }
}

function rememberPopupView(key) {
  popupViewsCounted.add(key);
  try {
    const seen = rememberedPopupViews();
    seen.add(key);
    localStorage.setItem(POPUP_VIEWS_KEY, JSON.stringify([...seen]));
  } catch {
    // The server already counted this open. A full phone store just
    // means the next visit on this browser may count once more.
  }
}

function tagPopupView(container, topicId, created) {
  const iso = messageCreated(created);
  if (!iso || !/^\d+\.\d+\.\d+$/.test(String(topicId || ''))) return;
  container.dataset.viewTopic = String(topicId);
  container.dataset.viewCreated = iso;
}

const popupViewInflight = new Map();

function viewLabel(n) {
  return n === 1 ? '1 view' : n + ' views';
}

// The number is written while the card is built, with the time and the
// title. The first open from this browser adds one. Later opens keep that
// number. Nothing is fetched just to fill the pill in afterwards.
function paintPopupView(el, topicId, created, fallback) {
  if (!el) return;
  const iso = messageCreated(created);
  if (!iso || !/^\d+\.\d+\.\d+$/.test(String(topicId || ''))) return;
  const key = topicId + '|' + iso;
  let known = knownPopupViews(topicId, iso);
  if (Number.isFinite(fallback)) known = known == null ? fallback : Math.max(known, fallback);
  const already = popupViewsCounted.has(key) || rememberedPopupViews().has(key);
  let shown;
  if (already) {
    popupViewsCounted.add(key);
    if (known == null) return;
    shown = known;
  } else {
    shown = (known == null ? 0 : known) + 1;
    popupViewsCounted.add(key);
    setPopupViewTotal(topicId, iso, shown);
    if (!popupViewInflight.has(key)) {
      const job = popupView(topicId, iso, 1).then((views) => {
        popupViewInflight.delete(key);
        if (views == null) return;
        rememberPopupView(key);
        setPopupViewTotal(topicId, iso, views);
        if (views === shown) return;
        document.querySelectorAll(
          `[data-view-topic="${topicId}"][data-view-created="${iso}"] .popup-views`
        ).forEach((node) => {
          node.textContent = viewLabel(views);
          node.classList.add('is-shown');
        });
      });
      popupViewInflight.set(key, job);
    }
  }
  el.textContent = viewLabel(shown);
  el.classList.add('is-shown');
}

function bindPopupPager(container, goPrev, goNext) {
  let swipeX = null;
  let swipeY = null;
  container.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    if (e.target.closest('.popup-media-card, .payer-link')) return;
    swipeX = e.clientX;
    swipeY = e.clientY;
  });
  container.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'touch' || swipeX === null) return;
    const dx = e.clientX - swipeX;
    const dy = e.clientY - swipeY;
    swipeX = swipeY = null;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) goNext();
    else goPrev();
  });
  container.addEventListener('pointercancel', () => {
    swipeX = swipeY = null;
  });
  popupPagers.add({ container, goPrev, goNext });
  if (popupKeysBound) return;
  popupKeysBound = true;
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || active.isContentEditable)) return;
    if (document.getElementById('media-fullscreen')) return;
    const pager = latestPopupPager();
    if (!pager) return;
    event.preventDefault();
    event.stopPropagation();
    const focused = document.activeElement;
    if (focused && focused.closest && focused.closest('.maplibregl-popup')) focused.blur();
    schedulePopupStep(event.key === 'ArrowLeft' ? -1 : 1);
  }, true);
}

// A rebuilt card carries the server's share count. A card built from the
// topic walk still uses the messages already seen this visit.
function shownShareState(data, topicId, timestamp) {
  if (data && Number.isFinite(data.shareCount)) {
    return { count: data.shareCount, mine: !!data.sharedByMe };
  }
  return shareState(topicId, timestamp, connectedAccount);
}

function shareField(value) {
  if (Array.isArray(value)) return shareField(value[0]);
  return typeof value === 'string' ? value : '';
}

// A share is a pin on the sharer's topic. The front card is the original post.
// It does not use a marker or polygon allowance. An unshare removes that pin.
const sharePinDecisions = new WeakMap();

function pinDecisions(features) {
  let decisions = sharePinDecisions.get(features);
  if (!decisions) {
    decisions = new Map();
    sharePinDecisions.set(features, decisions);
  }
  return decisions;
}

function appendShareFeature(features, ctx) {
  const parsed = ctx.parsedMessage;
  const sharer = ctx.message && ctx.message.payer;
  const decisions = pinDecisions(features);
  const unshare = parsed && parsed.unshare;
  if (unshare && typeof unshare === 'object') {
    const topic = typeof unshare.topic === 'string' ? unshare.topic.trim() : '';
    const created = messageCreated(unshare.created);
    if (sharer && /^\d+\.\d+\.\d+$/.test(topic) && created) {
      takeUnsharePin(decisions, features, sharer + '|' + topic + '|' + created);
    }
    return;
  }
  const share = parsed && parsed.share;
  if (!share || typeof share !== 'object') return;
  const pin = markerCoordinates(share.pin || share.coords) || sharePin(share.pin || share.coords);
  const original = typeof share.topic === 'string' ? share.topic.trim() : '';
  const created = messageCreated(share.created);
  if (!sharer || !/^\d+\.\d+\.\d+$/.test(original) || !pin || !created) return;
  const author = typeof share.payer === 'string' ? share.payer : '';
  const defaultProfilePic = 'https://kiloscribe.com/api/inscription-cdn/0.0.4819119';
  const authorPic = author && profilePictures[author] && profilePictures[author].url;
  const profileUrl = isValidUrl(authorPic) ? authorPic : defaultProfilePic;
  const username = author && usernames[author] ? ` ${usernames[author].username}` : '';
  const click2link = author && click2url[author] ? ` ${click2url[author].click2url}` : '';
  const kind = share.kind === 'polygon' ? 'polygon' : 'marker';
  const image = shareField(share.image);
  const cover = shareField(share.cover);
  const topicName = shareField(share.topicName);
  const title = shareField(share.title);
  const msg = shareField(share.msg);
  const number = share.number == null ? '' : share.number;
  // Older pins copied the card into the message. A new pin is only a
  // pointer, so those fields are empty until the phone cache or the
  // server rebuilds the original post. Missing numbers fall back to zero.
  const savedViews = Number(share.views);
  const savedLikes = Number(share.likes);
  const savedComments = Number(share.comments);
  const timestamp = new Date(created).toLocaleString('en-US', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const record = () => ({
    markernumber: number,
    polygonnumber: number,
    topicId: original,
    loadedTopicName: topicName,
    profileUrl,
    payer: author,
    payerInfo: author || 'Anonymous',
    username,
    click2link,
    title,
    image,
    coverimage: cover,
    msg,
    timestamp,
    created,
    likeCountMarker: Number.isFinite(savedLikes) ? savedLikes : 0,
    likeCountPolygon: Number.isFinite(savedLikes) ? savedLikes : 0,
    likedByMe: false,
    comments: [],
    commentsCount: Number.isFinite(savedComments) ? savedComments : null,
    coords: pin,
    coordinates: pin,
    viewCount: Number.isFinite(savedViews) ? savedViews : null,
    kind,
    share: { sharer, home: ctx.topicId },
  });
  takeSharePin(decisions, features, sharer + '|' + original + '|' + created, {
    topicId: ctx.topicId,
    // The original post's timestamp (share.created), not this share message's
    // own — so the pin and the original post dedupe to one drawing, and the
    // GO date filter treats the pin as a post from the original's date.
    created: created,
    msgNumber: 'share-' + created + '-' + sharer,
    shareKey: sharer + '|' + original + '|' + created,
    type: 'Feature',
    payer: sharer,
    properties: {
      popupData: record,
      // The dot wears the same face as the original post: its cover image,
      // else the original owner's picture — never the sharer's.
      imageUrl: isValidUrl(cover) ? cover : profileUrl,
      title: String(title || '').slice(0, 20),
    },
    geometry: {
      type: 'Point',
      coordinates: pin,
    },
  });
}

// Helper function to create marker popup HTML using DOM
// (exported so the 24h local-news markers reuse the exact same popup)
export function createMarkerPopupHTML(data) {
  const {
    markernumber,
    topicId,
    loadedTopicName,
    profileUrl,
    payer,
    payerInfo,
    username,
    click2link,
    title,
    image,
    msg,
    timestamp,
    likeCountMarker,
    likedByMe,
    comments,
    coords,
    created,
    viewCount,
    coverimage,
    commentsCount,
    // Optional (live-marker view): walk a custom list instead of the topic
    onPrev,
    onNext
  } = data;

  const container = document.createElement('div');
  container.className = 'popup-sheet';
  tagPopupView(container, topicId, created);
  const goPrevMarker = () => onPrev ? onPrev() : window.prevMsgFromPayerMarker(payer, markernumber, topicId);
  const goNextMarker = () => onNext ? onNext() : window.nextMsgFromPayerMarker(payer, markernumber, topicId);
  bindPopupPager(container, goPrevMarker, goNextMarker);

  // Top row: settings on the left, × on the right.
  const topHeader = document.createElement('div');
  topHeader.className = 'popup-top-row';

  const topicSpan = document.createElement('span');
  topicSpan.className = 'popup-top-topic';
  topicSpan.style.cssText = 'cursor: pointer; max-width: 100%; min-width: 0; overflow: hidden; text-overflow: ellipsis;';
  topicSpan.textContent = `${topicId} ${loadedTopicName}`;

  topicSpan.addEventListener("click", async () => {
    try {
      await copyTextToClipboard(topicId);
      toast.success("Copied topic id");

      const originalText = topicSpan.textContent;
      topicSpan.textContent = "Copyed!";
      setTimeout(() => {
        topicSpan.textContent = originalText;
      }, 1000);

    } catch (err) {
      console.error("Error: ", err);
    }
  });

  container.appendChild(topHeader);

  // Profile section
  const profileSection = document.createElement('div');
  profileSection.className = 'popup-profile-bubble';

  const profileImg = document.createElement('img');
  profileImg.src = profileUrl;
  profileImg.alt = 'Profile photo';
  profileImg.style.cssText = 'width: calc(var(--u) * 7); height: calc(var(--u) * 7); flex-shrink: 0; border-radius: 50%; object-fit: cover; object-position: center; cursor: pointer; border: calc(var(--u) * 0.12) solid rgba(255, 255, 255, 0.25); box-shadow: 0 calc(var(--u) * 0.4) calc(var(--u) * 1) rgba(0, 0, 0, 0.45);';
  profileImg.onclick = (event) => {
    event.stopPropagation();
    window.loadBio4PIC(payer);
  };
  profileSection.appendChild(profileImg);

  const headerDiv = document.createElement('div');
  const h2 = document.createElement('h2');

  const payerLink = document.createElement('a');
  payerLink.href = `https://explore.hashpack.app/${encodeURIComponent(payerInfo)}`;
  payerLink.target = '_blank';
  payerLink.rel = 'noopener noreferrer';
  payerLink.className = 'payer-info';
  payerLink.style.textDecoration = 'none';
  payerLink.textContent = payerInfo;
  h2.appendChild(payerLink);

  h2.appendChild(document.createElement('br'));

  const trimmedUsername = username.trim();
  if (trimmedUsername) {
    h2.appendChild(payerUsernameNode(trimmedUsername, click2link, { className: 'username' }));
  }

  headerDiv.appendChild(h2);
  profileSection.appendChild(headerDiv);
  container.appendChild(profileSection);

  // Content section. Image and text scroll. The arrow row stays under the name.
  const contentSection = document.createElement('div');
  contentSection.className = 'popup-body';
  contentSection.style.textAlign = 'center';

  // Navigation and title. Side inset matches the gear: out of the content pad
  // so the pad does not cover the arrow circles.
  const navSection = document.createElement('div');
  navSection.className = 'popup-nav';

  const prevSpan = document.createElement('span');
  prevSpan.className = 'popup-icon-chip';
  prevSpan.textContent = '←';
  prevSpan.onclick = onPrev
    ? () => onPrev()
    : () => window.prevMsgFromPayerMarker(payer, markernumber, topicId);
  navSection.appendChild(prevSpan);

  const titleDiv = document.createElement('div');
  titleDiv.style.cssText = 'text-align: center; flex-grow: 1;';
  const titleStrong = document.createElement('strong');
  titleStrong.className = 'title_color popup-title-bubble';
  titleStrong.textContent = String(title || '').slice(0, 20);
  titleDiv.appendChild(titleStrong);
  navSection.appendChild(titleDiv);

  const nextSpan = document.createElement('span');
  nextSpan.className = 'popup-icon-chip';
  nextSpan.textContent = '→';
  nextSpan.onclick = onNext
    ? () => onNext()
    : () => window.nextMsgFromPayerMarker(payer, markernumber, topicId);
  navSection.appendChild(nextSpan);

  // Image — or video when the user pasted a .mp4/.webm URL into the Image
  // field (the dot still shows the Cover Image still, so no video ever loads
  // into the marker DOM). The file itself downloads only on play.
  if (isValidUrl(image)) {
    const imageDiv = document.createElement('div');
    imageDiv.className = 'popup-media-card'; // glass media card (style.css)
    const isVideo = /\.(mp4|webm)(\?|#|$)/i.test(image);
    const media = isVideo ? document.createElement('video') : document.createElement('img');
    media.src = image;
    if (isVideo) {
      media.controls = true;
      media.playsInline = true; // iOS: play inline, no full-screen takeover
      media.preload = 'metadata'; // opening the popup costs a few KB, not the file
    } else {
      // Tap the picture → fullscreen overlay (tap backdrop / × / Esc closes)
      media.style.cursor = 'zoom-in';
      media.addEventListener('click', () => openPreview(image));
      const chip = document.createElement('button');
      chip.className = 'popup-media-expand';
      chip.title = 'Expand';
      chip.textContent = '⤢';
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        openPreview(image);
      });
      imageDiv.appendChild(chip);
    }
    imageDiv.appendChild(media);
    contentSection.appendChild(imageDiv);
  }

  // Message text
  const msgDiv = document.createElement('div');
  const msgP = document.createElement('p');
  msgP.className = 'text_color popup-text-bubble';
  msgP.textContent = msg;
  msgDiv.appendChild(msgP);
  contentSection.appendChild(msgDiv);

  // Title sits under the profile. The picture and text follow it.
  // The gap takes the spare room, so the hearts and the topic stay
  // on the bottom of the frame.
  container.appendChild(navSection);
  container.appendChild(contentSection);
  const markerGap = document.createElement('div');
  markerGap.className = 'popup-gap';
  container.appendChild(markerGap);

  // Row 6 — heart, comment, and share centered (topic id + timestamp live in row 7)
  const bottomRow = document.createElement('div');
  bottomRow.className = 'popup-dock';
  bottomRow.style.cssText = 'position: relative; height: calc(var(--u) * 6.2); line-height: 1; margin-top: calc(var(--u) * 0.4); overflow: visible;';

  // Timestamp (row 7, right side)
  const viewsDiv = document.createElement('div');
  viewsDiv.className = 'popup-timestamp popup-views';
  paintPopupView(viewsDiv, topicId, created, Number.isFinite(viewCount) ? viewCount : null);
  const timestampDiv = document.createElement('div');
  timestampDiv.className = 'popup-timestamp';
  timestampDiv.style.cssText = 'flex-shrink: 0;';
  timestampDiv.textContent = timestamp;

  const likeDislikeDiv = document.createElement('div');
  likeDislikeDiv.style.cssText = 'position: absolute; top: calc(var(--u) * 0.15); left: 50%; transform: translateX(-50%); display: flex; align-items: flex-start; gap: calc(var(--u) * 0.5);';
  likeDislikeDiv.appendChild(createHeartLike({
    count: likeCountMarker,
    liked: likedByMe,
    onToggle: (wantLike) => window.likeMarker(timestamp, topicId, !wantLike),
  }));

  const markerCommentsId = `marker-comments-${topicId}-${timestamp}`;
  likeDislikeDiv.appendChild(createCommentBubble({
    count: Number.isFinite(commentsCount) ? commentsCount : countAllMessages(comments),
    onToggle: (open) => toggleCommentsBubble(open, markerCommentsId),
  }));
  // The pin stores the topic and the post time. The card is filled later
  // from the phone cache and then from the server.
  const markerShare = {
    kind: 'marker',
    topicId,
    created,
    payer,
    coords,
    number: markernumber,
    timestamp,
  };
  const markerShareState = shownShareState(data, topicId, timestamp);
  likeDislikeDiv.appendChild(createShareBubble({
    count: markerShareState.count,
    shared: markerShareState.mine,
    onToggle: async (wantShare) => {
      if (wantShare) return confirmShare(markerShare);
      const ok = await unshareFromMyTopic(markerShare);
      if (ok) dropSharePin(markerShare);
      return ok;
    },
  }));

  bottomRow.appendChild(likeDislikeDiv);

  // Settings (row 7)
  const settingsSpan = document.createElement('span');
  settingsSpan.className = 'popup-icon-chip';
  settingsSpan.textContent = '⚙️';
  settingsSpan.onclick = (event) => {
    event.stopPropagation();
    window.openPopupSettings(data.walk);
  };
  topHeader.appendChild(settingsSpan);
  // Row 7 — topic id and name on the left, timestamp on the right.
  // -0.5u cancels the content's side pad so the pills are not covered.
  const bottomLeftRow = document.createElement('div');
  bottomLeftRow.className = 'popup-dock';
  bottomLeftRow.style.cssText = 'position: relative; display: flex; align-items: center; gap: calc(var(--u) * 0.7); height: calc(var(--u) * 4); margin-top: 0; margin-left: calc(var(--u) * -0.5); margin-right: calc(var(--u) * -0.5); margin-bottom: calc(var(--u) * -0.3);';
  const metaRight = document.createElement('div');
  metaRight.style.cssText = 'margin-left: auto; display: flex; align-items: center; gap: calc(var(--u) * 0.45); flex-shrink: 0;';
  metaRight.append(viewsDiv, timestampDiv);
  bottomLeftRow.appendChild(topicSpan);
  bottomLeftRow.appendChild(metaRight);

  container.appendChild(bottomRow);
  container.appendChild(bottomLeftRow);

  // Comments (below the bottom row, hidden until 💬 is pressed)
  const markerComments = buildCommentsSection(markerCommentsId, comments, (input) => window.sendMarkerComment(timestamp, topicId, input), (parentId, input) => window.sendMarkerReply(timestamp, parentId, topicId, input), topicId, 'marker');
  markerComments._bubbleInput = likeDislikeDiv.querySelector('.comment-bubble input');
  container.appendChild(markerComments);

  return container;
}

// Helper function to create polygon popup HTML using DOM
function createPolygonPopupHTML(data) {
  const {
    polygonnumber,
    topicId,
    loadedTopicName,
    profileUrl,
    payer,
    payerInfo,
    username,
    click2link,
    title,
    image,
    msg,
    timestamp,
    likeCountPolygon,
    likedByMe,
    comments,
    coordinates,
    created,
    viewCount,
    coverimage,
    commentsCount,
    onPrev,
    onNext
  } = data;

  const container = document.createElement('div');
  container.className = 'popup-sheet';
  tagPopupView(container, topicId, created);
  const goPrevPolygon = () => onPrev ? onPrev() : window.prevMsgFromPayerPolygon(payer, polygonnumber, topicId);
  const goNextPolygon = () => onNext ? onNext() : window.nextMsgFromPayerPolygon(payer, polygonnumber, topicId);
  bindPopupPager(container, goPrevPolygon, goNextPolygon);

  // Top row: settings on the left, × on the right.
  const topHeader = document.createElement('div');
  topHeader.className = 'popup-top-row';

  const topicSpan = document.createElement('span');
  topicSpan.className = 'popup-top-topic';
  topicSpan.style.cssText = 'cursor: pointer; max-width: 100%; min-width: 0; overflow: hidden; text-overflow: ellipsis;';
  topicSpan.textContent = `${topicId} ${loadedTopicName}`;

  topicSpan.addEventListener("click", async () => {
    try {
      await copyTextToClipboard(topicId);
      toast.success("Copied topic id");

      const originalText = topicSpan.textContent;
      topicSpan.textContent = "Copyed!";
      setTimeout(() => {
        topicSpan.textContent = originalText;
      }, 1000);
  
    } catch (err) {
      console.error("Error: ", err);
    }
  });

  container.appendChild(topHeader);

  // Profile section
  const profileSection = document.createElement('div');
  profileSection.className = 'popup-profile-bubble';

  const profileImg = document.createElement('img');
  profileImg.src = profileUrl;
  profileImg.alt = 'Profile photo';
  profileImg.style.cssText = 'width: calc(var(--u) * 7); height: calc(var(--u) * 7); flex-shrink: 0; border-radius: 50%; object-fit: cover; object-position: center; cursor: pointer; border: calc(var(--u) * 0.12) solid rgba(255, 255, 255, 0.25); box-shadow: 0 calc(var(--u) * 0.4) calc(var(--u) * 1) rgba(0, 0, 0, 0.45);';
  profileImg.onclick = (event) => {
    event.stopPropagation();
    window.loadBio4PIC(payer);
  };
  profileSection.appendChild(profileImg);

  const headerDiv = document.createElement('div');
  const h2 = document.createElement('h2');

  const payerLink = document.createElement('a');
  payerLink.href = `https://explore.hashpack.app/${encodeURIComponent(payerInfo)}`;
  payerLink.target = '_blank';
  payerLink.rel = 'noopener noreferrer';
  payerLink.className = 'payer-info';
  payerLink.style.textDecoration = 'none';
  payerLink.textContent = payerInfo;
  h2.appendChild(payerLink);

  h2.appendChild(document.createElement('br'));

  const trimmedUsername = username.trim();
  if (trimmedUsername) {
    h2.appendChild(payerUsernameNode(trimmedUsername, click2link, { className: 'username' }));
  }

  headerDiv.appendChild(h2);
  profileSection.appendChild(headerDiv);
  container.appendChild(profileSection);

  // Content section
  const contentSection = document.createElement('div');
  contentSection.className = 'popup-body';
  contentSection.style.textAlign = 'center';

  // Navigation and title. Side inset matches the gear.
  const navSection = document.createElement('div');
  navSection.className = 'popup-nav';

  const prevSpan = document.createElement('span');
  prevSpan.className = 'popup-icon-chip';
  prevSpan.textContent = '←';
  prevSpan.onclick = goPrevPolygon;
  navSection.appendChild(prevSpan);

  const titleDiv = document.createElement('div');
  titleDiv.style.cssText = 'text-align: center; flex-grow: 1;';
  const titleStrong = document.createElement('strong');
  titleStrong.className = 'title_color popup-title-bubble';
  titleStrong.textContent = String(title || '').slice(0, 20);
  titleDiv.appendChild(titleStrong);
  navSection.appendChild(titleDiv);

  const nextSpan = document.createElement('span');
  nextSpan.className = 'popup-icon-chip';
  nextSpan.textContent = '→';
  nextSpan.onclick = goNextPolygon;
  navSection.appendChild(nextSpan);
  container.appendChild(navSection);

  // Image — or video when the Inside image URL field holds a .mp4/.webm
  // (same behavior as marker popups: in-popup player with sound; the map
  // cover stays the muted loop). The field arrives as an ARRAY (["url"]) —
  // normalize before the url/regex checks.
  const popupImageUrl = Array.isArray(image) ? image[0] : image;
  if (isValidUrl(popupImageUrl)) {
    const imageDiv = document.createElement('div');
    imageDiv.className = 'popup-media-card'; // glass media card (style.css)
    const isVideo = /\.(mp4|webm)(\?|#|$)/i.test(popupImageUrl);
    const media = isVideo ? document.createElement('video') : document.createElement('img');
    media.src = popupImageUrl;
    if (isVideo) {
      media.controls = true;
      media.playsInline = true; // iOS: play inline, no full-screen takeover
      media.preload = 'metadata'; // opening the popup costs a few KB, not the file
    } else {
      // Tap the picture → fullscreen overlay (tap backdrop / × / Esc closes)
      media.style.cursor = 'zoom-in';
      media.addEventListener('click', () => openPreview(popupImageUrl));
      const chip = document.createElement('button');
      chip.className = 'popup-media-expand';
      chip.title = 'Expand';
      chip.textContent = '⤢';
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        openPreview(popupImageUrl);
      });
      imageDiv.appendChild(chip);
    }
    imageDiv.appendChild(media);
    contentSection.appendChild(imageDiv);
  }

  // Message text
  const msgDiv = document.createElement('div');
  const msgP = document.createElement('p');
  msgP.className = 'text_color popup-text-bubble';
  msgP.textContent = msg;
  msgDiv.appendChild(msgP);
  contentSection.appendChild(msgDiv);

  container.appendChild(contentSection);
  const polygonGap = document.createElement('div');
  polygonGap.className = 'popup-gap';
  container.appendChild(polygonGap);

  // Row 6 — heart, comment, and share centered (topic id + timestamp live in row 7)
  const bottomRow = document.createElement('div');
  bottomRow.className = 'popup-dock';
  bottomRow.style.cssText = 'position: relative; height: calc(var(--u) * 6.2); line-height: 1; margin-top: calc(var(--u) * 0.4); overflow: visible;';

  // Timestamp (row 7, right side)
  const viewsDiv = document.createElement('div');
  viewsDiv.className = 'popup-timestamp popup-views';
  paintPopupView(viewsDiv, topicId, created, Number.isFinite(viewCount) ? viewCount : null);
  const timestampDiv = document.createElement('div');
  timestampDiv.className = 'popup-timestamp';
  timestampDiv.style.cssText = 'flex-shrink: 0;';
  timestampDiv.textContent = timestamp;

  const likeDislikeDiv = document.createElement('div');
  likeDislikeDiv.style.cssText = 'position: absolute; top: calc(var(--u) * 0.15); left: 50%; transform: translateX(-50%); display: flex; align-items: flex-start; gap: calc(var(--u) * 0.5);';
  likeDislikeDiv.appendChild(createHeartLike({
    count: likeCountPolygon,
    liked: likedByMe,
    onToggle: (wantLike) => window.likePolygon(timestamp, topicId, !wantLike),
  }));

  const polygonCommentsId = `polygon-comments-${topicId}-${timestamp}`;
  likeDislikeDiv.appendChild(createCommentBubble({
    count: Number.isFinite(commentsCount) ? commentsCount : countAllMessages(comments),
    onToggle: (open) => toggleCommentsBubble(open, polygonCommentsId),
  }));
  const polygonShare = {
    kind: 'polygon',
    topicId,
    created,
    payer,
    coords: coordinates,
    number: polygonnumber,
    timestamp,
  };
  const polygonShareState = shownShareState(data, topicId, timestamp);
  likeDislikeDiv.appendChild(createShareBubble({
    count: polygonShareState.count,
    shared: polygonShareState.mine,
    onToggle: async (wantShare) => {
      if (wantShare) return confirmShare(polygonShare);
      const ok = await unshareFromMyTopic(polygonShare);
      if (ok) dropSharePin(polygonShare);
      return ok;
    },
  }));

  bottomRow.appendChild(likeDislikeDiv);

  // Settings (row 7)
  const settingsSpan = document.createElement('span');
  settingsSpan.className = 'popup-icon-chip';
  settingsSpan.textContent = '⚙️';
  settingsSpan.onclick = (event) => {
    event.stopPropagation();
    window.openPopupSettings(data.walk);
  };
  topHeader.appendChild(settingsSpan);
  // Row 7 — topic id and name on the left, timestamp on the right.
  const bottomLeftRow = document.createElement('div');
  bottomLeftRow.className = 'popup-dock';
  bottomLeftRow.style.cssText = 'position: relative; display: flex; align-items: center; gap: calc(var(--u) * 0.7); height: calc(var(--u) * 4); margin-top: 0; margin-left: calc(var(--u) * -0.5); margin-right: calc(var(--u) * -0.5); margin-bottom: calc(var(--u) * -0.3);';
  const metaRight = document.createElement('div');
  metaRight.style.cssText = 'margin-left: auto; display: flex; align-items: center; gap: calc(var(--u) * 0.45); flex-shrink: 0;';
  metaRight.append(viewsDiv, timestampDiv);
  bottomLeftRow.appendChild(topicSpan);
  bottomLeftRow.appendChild(metaRight);

  container.appendChild(bottomRow);
  container.appendChild(bottomLeftRow);

  // Comments (below the bottom row, hidden until 💬 is pressed)
  const polygonComments = buildCommentsSection(polygonCommentsId, comments, (input) => window.sendPolygonComment(timestamp, topicId, input), (parentId, input) => window.sendPolygonReply(timestamp, parentId, topicId, input), topicId, 'polygon');
  polygonComments._bubbleInput = likeDislikeDiv.querySelector('.comment-bubble input');
  container.appendChild(polygonComments);

  return container;
}

// A shared pin is a pointer. The phone shows a saved card first, then the
// server rebuilds the original post (name, hearts, comments, share count)
// and the phone saves that card. Every open asks again so the counts move.
// If the server is down, the saved card stays. An old pin that still carries
// a copy of the card keeps that copy until one of those two answers arrives.
const shareLiveInflight = new Map();

function popupHTML(record) {
  return record && record.kind === 'polygon'
    ? createPolygonPopupHTML(record)
    : createMarkerPopupHTML(record);
}

function commentsAreOpen(node) {
  if (!node || !node.querySelectorAll) return false;
  const sections = node.querySelectorAll('[id^="marker-comments-"], [id^="polygon-comments-"]');
  for (const section of sections) {
    if (section.style.display !== 'none') return true;
  }
  return false;
}

function applyShareCard(properties, record) {
  properties._shareRecord = record;
  const current = properties.message;
  // Leave the card alone while its comment thread is open on screen.
  // A closed popup is replaced so the next open shows the new counts.
  if (current && current.isConnected && commentsAreOpen(current)) return;
  bindWalk(record, properties.walkKey);
  const fresh = popupHTML(record);
  if (current && current.parentNode) {
    current.replaceWith(fresh);
    properties.message = fresh;
    touchPopupPager(fresh);
    // The new card is a fresh set of elements. Username, account, title,
    // and number colors are painted onto the elements that are on screen,
    // so the replacement has to be painted again or those links fall back
    // to the browser's default color.
    applyAllStyles();
    refitPopups();
    return;
  }
  properties.message = fresh;
}

function liveShareRecord(live, base) {
  const ts = new Date(live.created).toLocaleString('en-US', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const payer = live.payer || base.payer || '';
  const defaultProfilePic = 'https://kiloscribe.com/api/inscription-cdn/0.0.4819119';
  const authorPic = payer && profilePictures[payer] && profilePictures[payer].url;
  const profileUrl = isValidUrl(authorPic) ? authorPic : (base.profileUrl || defaultProfilePic);
  const knownName = payer && usernames[payer] && usernames[payer].username;
  const knownLink = payer && click2url[payer] && click2url[payer].click2url;
  const topicId = live.topic || base.topicId;
  const serverCount = Number(live.shares);
  let shareCount = Number.isFinite(serverCount) ? serverCount : 0;
  let sharedByMe = !!live.sharedByMe;
  // This visit already recorded this account's share or unshare. The mirror
  // may not have that message yet, so the checkbox follows the phone.
  const mine = shareMine(topicId, base.timestamp, connectedAccount);
  if (mine === true && !sharedByMe) {
    sharedByMe = true;
    shareCount += 1;
  } else if (mine === false && sharedByMe) {
    sharedByMe = false;
    shareCount = Math.max(0, shareCount - 1);
  }
  return {
    markernumber: live.number,
    polygonnumber: live.number,
    topicId,
    loadedTopicName: live.topicName || base.loadedTopicName || '',
    profileUrl,
    payer,
    payerInfo: payer || base.payerInfo || 'Anonymous',
    username: knownName ? ` ${knownName}` : (base.username || ''),
    click2link: knownLink ? ` ${knownLink}` : (base.click2link || ''),
    title: live.title,
    image: live.image,
    coverimage: live.coverimage,
    msg: live.msg,
    timestamp: ts,
    created: live.created,
    likeCountMarker: live.likes || 0,
    likeCountPolygon: live.likes || 0,
    likedByMe: !!live.likedByMe,
    comments: Array.isArray(live.comments) ? live.comments : [],
    coords: base.coords,
    coordinates: base.coordinates || base.coords,
    viewCount: Number.isFinite(live.views) ? live.views : null,
    kind: live.kind === 'polygon' ? 'polygon' : (base.kind === 'polygon' ? 'polygon' : 'marker'),
    share: base.share,
    shareCount,
    sharedByMe,
  };
}

function cachedShareRecord(cached, base) {
  if (!cached || typeof cached !== 'object') return null;
  return {
    ...cached,
    coords: base.coords,
    coordinates: base.coordinates || base.coords,
    share: base.share,
    kind: cached.kind === 'polygon' || base.kind === 'polygon' ? 'polygon' : 'marker',
  };
}

function hydrateSharePin(properties, record) {
  const key = record.topicId + '|' + record.created;
  readPostCard(record.topicId, record.created).then((cached) => {
    if (properties._shareFresh === key) return;
    const saved = cachedShareRecord(cached, record);
    if (saved) applyShareCard(properties, saved);
  }).catch(() => {});
  const flightKey = key + '|' + (connectedAccount || '');
  if (!shareLiveInflight.has(flightKey)) {
    shareLiveInflight.set(
      flightKey,
      fetchPost(record.topicId, record.created, connectedAccount || '')
        .catch(() => null)
        .finally(() => shareLiveInflight.delete(flightKey))
    );
  }
  shareLiveInflight.get(flightKey).then((live) => {
    if (live && live.deleted) {
      properties._shareFresh = key;
      forgetPostCard(record.topicId, record.created);
      applyShareCard(properties, {
        ...record,
        title: '',
        msg: 'This post was deleted',
        image: null,
        coverimage: null,
        comments: [],
        likeCountMarker: 0,
        likeCountPolygon: 0,
        shareCount: 0,
        sharedByMe: false,
        viewCount: 0,
        commentsCount: 0,
      });
      return;
    }
    if (!live) return;
    const freshRecord = liveShareRecord(live, properties._shareRecord || record);
    properties._shareFresh = key;
    writePostCard(record.topicId, record.created, freshRecord);
    applyShareCard(properties, freshRecord);
  }).catch(() => {});
}

// The card is built on the first open and kept on the feature. Topic load
// only stores the record (a function), so comments, profile, and media are
// not created for every drawing up front. 24h local-news popups still call
// createMarkerPopupHTML themselves because those open immediately.
// A share pin asks for the original post on every open.
export function markerPopupNode(properties, feature) {
  if (!properties) return null;
  if (feature && feature.payer && feature.msgNumber != null && feature.topicId) {
    // The pin's own account, even when the card shows the original author.
    properties.walkKey = {
      payer: feature.payer,
      number: feature.msgNumber,
      topicId: feature.topicId,
      shape: 'marker',
    };
  }
  if (!properties.message) {
    const data = properties.popupData;
    if (!data) return null;
    const record = typeof data === 'function' ? data() : data;
    properties._shareRecord = record;
    bindWalk(record, properties.walkKey);
    properties.message = popupHTML(record);
  }
  if (properties._shareRecord && properties._shareRecord.share) {
    hydrateSharePin(properties, properties._shareRecord);
  }
  // Showing this card again: it is the one the arrows must move.
  touchPopupPager(properties.message);
  return properties.message;
}

export function polygonPopupNode(polygon) {
  if (!polygon) return null;
  if (polygon.payer && polygon.msgNumber != null && polygon.topicId) {
    polygon.walkKey = {
      payer: polygon.payer,
      number: polygon.msgNumber,
      topicId: polygon.topicId,
      shape: 'polygon',
    };
  }
  if (!polygon.description) {
    const data = polygon.popupData;
    if (!data) return null;
    const record = typeof data === 'function' ? data() : data;
    bindWalk(record, polygon.walkKey);
    polygon.description = createPolygonPopupHTML(record);
  }
  touchPopupPager(polygon.description);
  return polygon.description;
}

export async function processTopicMessages(topicId) {
  let topicGeojsonFeatures = [];
  let topicPolygons = [];
  let loadedTopicName = '';
  let topicBio = undefined;

  try {
    const rawResult = await getMessages(topicId);


    const seen = new Map();
    const uniqueMessages = {messages:[]};

    for (let index = 0; index < rawResult.messages.length; index++) {
      const message = rawResult.messages[index];
      const seqNum = message.sequence_number;

      if (!seen.has(seqNum)) {
        seen.set(seqNum, true);
        uniqueMessages.messages.push(message);
      }
    }

    allLoadedMessages.push({topicId:topicId,uniqueMessages});


const likeCountMapMarker = new Map();
const dislikeCountMapMarker = new Map();
const likeCountMapPolygon = new Map();
const dislikeCountMapPolygon = new Map();
const payerActionsPerTimestamp = new Map();
const commentsMapMarker = new Map();
const commentsMapPolygon = new Map();
const repliesMapMarker = new Map();
const repliesMapPolygon = new Map();
clearShareTopic(topicId);

if (rawResult.messages && Array.isArray(rawResult.messages)) {
  for (const message of rawResult.messages) {
    try {
      let parsedMessage = message;
      if (typeof message === 'string') {
        parsedMessage = JSON.parse(message);
      }

      const payerId = parsedMessage.payer;
      let actionTimestamp, actionType;

      // Check for like
      if (parsedMessage.likeMarker && parsedMessage.likeMarker.timestamp && parsedMessage.payer) {
        actionTimestamp = parsedMessage.likeMarker.timestamp;
        actionType = 'likeMarker';
      }
      // Check for dislike
      if (parsedMessage.dislikeMarker && parsedMessage.dislikeMarker.timestamp && parsedMessage.payer) {
        const dislikeTimestamp = parsedMessage.dislikeMarker.timestamp;
        // If no like or dislike timestamp is newer, update action
        if (!actionTimestamp || dislikeTimestamp > actionTimestamp) {
          actionTimestamp = dislikeTimestamp;
          actionType = 'dislikeMarker';
        }
      }
      // Check for like
      if (parsedMessage.likePolygon && parsedMessage.likePolygon.timestamp && parsedMessage.payer) {
        actionTimestamp = parsedMessage.likePolygon.timestamp;
        actionType = 'likePolygon';
      }
      // Check for dislike
      if (parsedMessage.dislikePolygon && parsedMessage.dislikePolygon.timestamp && parsedMessage.payer) {
        actionTimestamp = parsedMessage.dislikePolygon.timestamp;
        actionType = 'dislikePolygon';
      }
      // Taking a like back. Unlike is not a dislike: it clears that payer's
      // like and adds nothing, so the heart count drops and no 👎 is stored.
      if (parsedMessage.unlikeMarker && parsedMessage.unlikeMarker.timestamp && parsedMessage.payer) {
        actionTimestamp = parsedMessage.unlikeMarker.timestamp;
        actionType = 'unlikeMarker';
      }
      if (parsedMessage.unlikePolygon && parsedMessage.unlikePolygon.timestamp && parsedMessage.payer) {
        actionTimestamp = parsedMessage.unlikePolygon.timestamp;
        actionType = 'unlikePolygon';
      }
      noteShare(parsedMessage, topicId);

      // Process the action if it exists
      if (actionTimestamp && actionType && payerId) {
        // Initialize map for this timestamp if it doesn't exist
        if (!payerActionsPerTimestamp.has(actionTimestamp)) {
          payerActionsPerTimestamp.set(actionTimestamp, new Map());
        }

        // Update or set the latest action for this payer at this timestamp
        const payerActions = payerActionsPerTimestamp.get(actionTimestamp);
        const existingAction = payerActions.get(payerId);

        // Only update if this is a new action or a newer timestamp
        if (!existingAction || actionTimestamp >= existingAction.timestamp) {
          // If there's an existing action, remove its previous count
          if (existingAction) {
            if (existingAction.type === 'likeMarker') {
              likeCountMapMarker.set(actionTimestamp, (likeCountMapMarker.get(actionTimestamp) || 0) - 1);
            } else if (existingAction.type === 'dislikeMarker') {
              dislikeCountMapMarker.set(actionTimestamp, (dislikeCountMapMarker.get(actionTimestamp) || 0) - 1);
            }
            if (existingAction.type === 'likePolygon') {
              likeCountMapPolygon.set(actionTimestamp, (likeCountMapPolygon.get(actionTimestamp) || 0) - 1);
            } else if (existingAction.type === 'dislikePolygon') {
              dislikeCountMapPolygon.set(actionTimestamp, (dislikeCountMapPolygon.get(actionTimestamp) || 0) - 1);
            }
          }

          // Store the new action
          payerActions.set(payerId, { type: actionType, timestamp: actionTimestamp });

          // Increment the count for the new action
          if (actionType === 'likeMarker') {
            likeCountMapMarker.set(actionTimestamp, (likeCountMapMarker.get(actionTimestamp) || 0) + 1);
          } else if (actionType === 'dislikeMarker') {
            dislikeCountMapMarker.set(actionTimestamp, (dislikeCountMapMarker.get(actionTimestamp) || 0) + 1);
          }
          if (actionType === 'likePolygon') {
            likeCountMapPolygon.set(actionTimestamp, (likeCountMapPolygon.get(actionTimestamp) || 0) + 1);
          } else if (actionType === 'dislikePolygon') {
            dislikeCountMapPolygon.set(actionTimestamp, (dislikeCountMapPolygon.get(actionTimestamp) || 0) + 1);
          }
        }
      }

      // Collect comments (each topic message is one comment; the payer is
      // the Hedera account that signed it, same as likes)
      if (parsedMessage.commentMarker && parsedMessage.commentMarker.timestamp && payerId) {
        const commentTimestamp = parsedMessage.commentMarker.timestamp;
        if (!commentsMapMarker.has(commentTimestamp)) {
          commentsMapMarker.set(commentTimestamp, []);
        }
        commentsMapMarker.get(commentTimestamp).push({
          payer: payerId,
          text: String(parsedMessage.commentMarker.text || '').slice(0, 300),
          // ISO string, NOT the Date object: like/reply messages store this
          // value through JSON (string), so map keys must be strings too
          created: new Date(parsedMessage.created).toISOString()
        });
      }
      if (parsedMessage.commentPolygon && parsedMessage.commentPolygon.timestamp && payerId) {
        const commentTimestamp = parsedMessage.commentPolygon.timestamp;
        if (!commentsMapPolygon.has(commentTimestamp)) {
          commentsMapPolygon.set(commentTimestamp, []);
        }
        commentsMapPolygon.get(commentTimestamp).push({
          payer: payerId,
          text: String(parsedMessage.commentPolygon.text || '').slice(0, 300),
          created: new Date(parsedMessage.created).toISOString()
        });
      }

      // Collect replies (nested comments; parentId = the created timestamp
      // of the comment or reply being answered)
      if (parsedMessage.replyMarker && parsedMessage.replyMarker.parentId && payerId) {
        const parentId = parsedMessage.replyMarker.parentId;
        if (!repliesMapMarker.has(parentId)) {
          repliesMapMarker.set(parentId, []);
        }
        repliesMapMarker.get(parentId).push({
          payer: payerId,
          text: String(parsedMessage.replyMarker.text || '').slice(0, 300),
          created: new Date(parsedMessage.created).toISOString()
        });
      }
      if (parsedMessage.replyPolygon && parsedMessage.replyPolygon.parentId && payerId) {
        const parentId = parsedMessage.replyPolygon.parentId;
        if (!repliesMapPolygon.has(parentId)) {
          repliesMapPolygon.set(parentId, []);
        }
        repliesMapPolygon.get(parentId).push({
          payer: payerId,
          text: String(parsedMessage.replyPolygon.text || '').slice(0, 300),
          created: new Date(parsedMessage.created).toISOString()
        });
      }
    } catch (error) {
      console.error(`Error parsing message for likes/dislikes: ${error}`);
    }
  }
}
          

          const topicInfo = await getTopicInfo(topicId);
          const topicAdmin = [];
          let hasRulesForMarker = false;
          let hasRulesForPolygon = false;
          const memo = topicInfo.memo;

          // Split the memo by commas
          const parts = memo.split(',');

          // Iterate over each part
          parts.forEach(part => {
            // Check if the part starts with "0.0."
            if (part.startsWith("0.0.")) {
              // Add it to the topicAdmin array
              topicAdmin.push(part);
            }
          });



          // Check if messages exist and is an array
          if (!rawResult.messages || !Array.isArray(rawResult.messages)) {
            console.error(`No messages found for topic ${topicId}.`, rawResult);
            return { topicGeojsonFeatures, topicPolygons }; // Return empty arrays
          }

          const messages = rawResult.messages; // Extract messages

          const loadedTopicRulesForMarker = [];
          const loadedTopicRulesForPolygon = [];



          // Each side is its own stack. The same NFT id keeps its latest
          // values. "0" on a side lets anyone post.
          const topicRules = stackedTopicRules(messages, topicAdmin);
          if (!topicRules.markers.some((rule) => rule.open)) {
            for (const rule of topicRules.markers) {
              loadedTopicRulesForMarker.push(rule);
              hasRulesForMarker = true;
            }
          }
          if (!topicRules.polygons.some((rule) => rule.open)) {
            for (const rule of topicRules.polygons) {
              loadedTopicRulesForPolygon.push(rule);
              hasRulesForPolygon = true;
            }
          }

          const uniquePayerIdsForMarker = new Set();
          const uniquePayerIdsForPolygon = new Set();

          // Extract payer IDs from messages
      for (const message of messages) {
        try {
          let parsedMessage = message;
          if (typeof message === 'string') {
            parsedMessage = JSON.parse(message);
          }

          // Add payer IDs for markers
          if (parsedMessage.marker && parsedMessage.marker.data) {
            uniquePayerIdsForMarker.add(message.payer || parsedMessage.payer);
          }

          // Add payer IDs for polygons
          if (parsedMessage.polygon && parsedMessage.polygon.data) {
            uniquePayerIdsForPolygon.add(message.payer || parsedMessage.payer);
          }

          if (parsedMessage.addTopicNFT && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
          const nfts = parsedMessage.addTopicNFT.split(',').map(nft => nft.trim());
          nfts.forEach(nft => {
            if (!loadedNFTsForModel.includes(nft)) {
              loadedNFTsForModel.push(nft);
            }
          });
          }

          if (parsedMessage.removeTopicNFT && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
            const nft = parsedMessage.removeTopicNFT.trim();
            const index = loadedNFTsForModel.indexOf(nft);
            if (index !== -1) {
              loadedNFTsForModel.splice(index, 1);
            }
          }

        if (parsedMessage.addScale && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
          const { NFT, scale } = parsedMessage.addScale;
          loadedNFTScaleForModel.push({ NFT, scale });
        }

        if (parsedMessage.removeScale && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
          const { NFT } = parsedMessage.removeScale;
          const index = loadedNFTScaleForModel.findIndex(item => item.NFT === NFT);
          if (index !== -1) {
            loadedNFTScaleForModel.splice(index, 1); // Remove the item if it exists
          } else {
            console.log(`NFT: ${NFT} not found in addScale list`);
          }
        }

        updateRulesForModelNFTState();

        } catch (error) {
          console.error("Error extracting payer ID:", error);
        }
      }

          // Cached holdings draw immediately. Missing accounts stay pending
          // until their token list returns.
          const {
            holdings,
            markerOwnershipArray,
            polygonOwnershipArray,
            payerIds,
          } = await assignDrawingOwnership({
            hasRulesForMarker,
            hasRulesForPolygon,
            markerPayers: uniquePayerIdsForMarker,
            polygonPayers: uniquePayerIdsForPolygon,
            markerRules: loadedTopicRulesForMarker,
            polygonRules: loadedTopicRulesForPolygon,
          });
          const newestMessages = messages.slice().reverse();
          const indexed = indexNewestMessages(messages, topicAdmin);
          loadedTopicName = indexed.loadedTopicName;
          const messagesByPayer = indexed.messagesByPayer;
          const payerOrder = indexed.payerOrder;
          const drawState = { batch: newestMessages };
          const payerWaiting = (payerId) => {
            const markerOwner = markerOwnershipArray.find((owner) => owner.payerId === payerId);
            const polygonOwner = polygonOwnershipArray.find((owner) => owner.payerId === payerId);
            return !!((markerOwner && markerOwner.pending) || (polygonOwner && polygonOwner.pending));
          };
          const drawLoaded = async () => {
          const drawBatch = drawState.batch;
          for (let index = 0; index < drawBatch.length; index++) {
            const message = drawBatch[index];
            if (message && message.payer && payerWaiting(message.payer)) continue;
            try {
              let parsedMessage = message;
              if (typeof message === 'string') {
                parsedMessage = JSON.parse(message);
              }

              const timestamp = new Date(parsedMessage.created)
              .toLocaleString('en-US', {
                hour12: false,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
              })


              const defaultProfilePic = "https://kiloscribe.com/api/inscription-cdn/0.0.4819119";
              const profileUrl = isValidUrl(message.payer && profilePictures[message.payer] ?
                profilePictures[message.payer].url :
                defaultProfilePic) ?
                (message.payer && profilePictures[message.payer] ? profilePictures[message.payer].url : defaultProfilePic) :
                defaultProfilePic;

              const payerInfo = message.payer ? `${message.payer}` : 'Anonymous';
              const username = message.payer && usernames[message.payer] ?
                ` ${usernames[message.payer].username}` :
                '';
              const click2link = message.payer && click2url[message.payer] ?
                ` ${click2url[message.payer].click2url}` :
                '';

              appendShareFeature(topicGeojsonFeatures, {
                message,
                parsedMessage,
                topicId,
              });

              if (parsedMessage.marker && parsedMessage.marker.data) {
                const legacyNumber = legacyShapeNumber(parsedMessage.marker.data.numberOfMarker);
                const markerOwner = markerOwnershipArray.find(owner => owner.payerId === message.payer);
                if (!markerOwner) {
                  continue;
                }

                rememberShapeDelete(markerOwner, 'numberOfMarker', parsedMessage.marker.data);

                // A stored whole number keeps dedup. No number is a new post.
                // A delete matches the post's time, and an older delete still
                // matches the number it named.
                // The envelope time is the consensus timestamp. A decrypted body
                // does not carry it, and that time is what a delete names.
                const postCreated = (message && message.created) || parsedMessage.created;
                const markernumber = legacyNumber == null
                  ? (messageCreated(postCreated) || ('draw-' + index))
                  : legacyNumber;
                const markerCoords = legacyNumber === false
                  ? null
                  : markerCoordinates(parsedMessage.marker.data.cord);

                if (markerCoords && !postWasDeleted(markerOwner, 'numberOfMarker', markernumber, postCreated, timestamp)) {
                if (!hasRulesForMarker || markerOwner.numberOfMessages > 0) {
                  markerOwner.numberOfMarker.push(markernumber);
                  if (hasRulesForMarker) {
                    markerOwner.numberOfMessages -= 1;
                  }

                  const coords = markerCoords;
                  {
                    // Card is built on the first tap. The record closes over
                    // this drawing; comments and the heart are not built now.
                    const markerPopupData = () => ({
                      markernumber,
                      topicId,
                      loadedTopicName,
                      profileUrl,
                      payer: message.payer,
                      payerInfo,
                      username,
                      click2link,
                      title: parsedMessage.marker.data.title,
                      image: parsedMessage.marker.data.image,
                      coverimage: parsedMessage.marker.data.coverimage,
                      msg: parsedMessage.marker.data.msg,
                      timestamp,
                      created: messageCreated(postCreated),
                      likeCountMarker: likeCountMapMarker.get(timestamp) || 0,
                      likedByMe: payerHasLike(payerActionsPerTimestamp, timestamp, 'likeMarker'),
                      comments: (commentsMapMarker.get(timestamp) || []).map((c) => ({
                        ...c,
                        likeCount: likeCountMapMarker.get(c.created) || 0,
                        likedByMe: payerHasLike(payerActionsPerTimestamp, c.created, 'likeMarker'),
                        replies: buildReplyTree(c, repliesMapMarker, likeCountMapMarker, dislikeCountMapMarker, 0, payerActionsPerTimestamp, 'likeMarker')
                      })),
                      coords
                    });

                    topicGeojsonFeatures.push({
                      topicId: topicId,
                      created: postCreated,
                      msgNumber: markernumber,
                      type: "Feature",
                      payer: message.payer,
                      properties: {
                        popupData: markerPopupData,
                        imageUrl: isValidUrl(parsedMessage.marker.data.coverimage) ? parsedMessage.marker.data.coverimage : profileUrl,
                        title: String(parsedMessage.marker.data.title || "").slice(0, 20)
                      },
                      geometry: {
                        type: "Point",
                        coordinates: coords
                      }
                    });
                  }
                }
              }
            }

              // Handle polygon type messages
              if (parsedMessage.polygon && parsedMessage.polygon.data) {
                const polygonOwner = polygonOwnershipArray.find(owner => owner.payerId === message.payer);
                if (!polygonOwner) {
                  continue;
                }
                const legacyPolygonNumber = legacyShapeNumber(parsedMessage.polygon.data.numberOfPolygon);

                rememberShapeDelete(polygonOwner, 'numberOfPolygon', parsedMessage.polygon.data);

                const postCreated = (message && message.created) || parsedMessage.created;
                const polygonnumber = legacyPolygonNumber == null
                  ? (messageCreated(postCreated) || ('draw-' + index))
                  : legacyPolygonNumber;
                const polygonRing = legacyPolygonNumber === false
                  ? null
                  : polygonCoordinates(parsedMessage.polygon.data.cord);

                if (polygonRing && !postWasDeleted(polygonOwner, 'numberOfPolygon', polygonnumber, postCreated, timestamp)) {
                if (!hasRulesForPolygon || polygonOwner.numberOfMessages > 0) {
                  polygonOwner.numberOfPolygon.push(polygonnumber);
                  if (hasRulesForPolygon) {
                    polygonOwner.numberOfMessages -= 1;
                  }

                  {
                    const coordinates = polygonRing;
                    if (Array.isArray(coordinates) && coordinates.length > 2) {
                      const polygonSize = hasRulesForPolygon ? smallestPolygonSize(loadedTopicRulesForPolygon) : 1;

                      // Card is built on the first tap.
                      const polygonPopupData = () => ({
                        polygonnumber,
                        topicId,
                        loadedTopicName,
                        profileUrl,
                        payer: message.payer,
                        payerInfo,
                        username,
                        click2link,
                        title: parsedMessage.polygon.data.title,
                        image: parsedMessage.polygon.data.image,
                        coverimage: parsedMessage.polygon.data.coverimage,
                        msg: parsedMessage.polygon.data.msg,
                        timestamp,
                        created: messageCreated(postCreated),
                        likeCountPolygon: likeCountMapPolygon.get(timestamp) || 0,
                        likedByMe: payerHasLike(payerActionsPerTimestamp, timestamp, 'likePolygon'),
                        comments: (commentsMapPolygon.get(timestamp) || []).map((c) => ({
                          ...c,
                          likeCount: likeCountMapPolygon.get(c.created) || 0,
                          likedByMe: payerHasLike(payerActionsPerTimestamp, c.created, 'likePolygon'),
                          replies: buildReplyTree(c, repliesMapPolygon, likeCountMapPolygon, dislikeCountMapPolygon, 0, payerActionsPerTimestamp, 'likePolygon')
                        })),
                        coordinates
                      });

                      topicPolygons.push({
                        topicId: topicId,
                        created: postCreated,
                        msgNumber: polygonnumber,
                        id: `polygon-${message.payer}-${topicId}-${polygonnumber}`,
                        payer: message.payer,
                        coordinates: [coordinates],
                        popupData: polygonPopupData,
                        title: String(parsedMessage.polygon.data.title || "").slice(0, 20),
                        imageUrl: isValidUrl(parsedMessage.polygon.data.coverimage) ? parsedMessage.polygon.data.coverimage : profileUrl
                      });
                    }
                  }
                }
              }
            }
            } catch (messageError) {
              console.error(`Error processing message ${index}:`, messageError);
            }
          }
          };

          await showDrawingsAsApproved({
            messages,
            messagesByPayer,
            payerOrder,
            drawState,
            drawLoaded,
            payerWaiting,
            holdings,
            payerIds,
            markerOwnershipArray,
            polygonOwnershipArray,
            markerRules: loadedTopicRulesForMarker,
            polygonRules: loadedTopicRulesForPolygon,
            hasRulesForMarker,
            hasRulesForPolygon,
            features: topicGeojsonFeatures,
            polygonsOut: topicPolygons,
          });

        // Topic bio: newest valid topic_bio message (same admin rule as
        // changeName — only admin payers count when the memo lists admins)
        for (let index = messages.length - 1; index >= 0; index--) {
          const message = messages[index];
          try {
            let parsedMessage = message;
            if (typeof message === 'string') {
              parsedMessage = JSON.parse(message);
            }
            if (parsedMessage.data && parsedMessage.data.topic_bio && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
              const raw = parsedMessage.data.topic_bio;
              topicBio = Array.isArray(raw) ? raw[0] : String(raw);
              break; // Stop after finding the first valid message
            }
          } catch (messageError) {
            console.error(`Error processing message ${index}:`, messageError);
          }
        }

        return { topicGeojsonFeatures, topicPolygons, loadedTopicName, topicBio };


        } catch (error) {
          console.error(`Error loading messages for topic ${topicId}:`, error);
          return { topicGeojsonFeatures: [], topicPolygons: [] }; // Return empty arrays on error
        }
      }

function postTime(item) {
  const t = new Date(item && item.created).getTime();
  return Number.isFinite(t) ? t : 0;
}

function postsFlat(groups) {
  return (groups || []).flat().filter((item) => item && item.payer);
}

function byTime(a, b) {
  const ta = postTime(a);
  const tb = postTime(b);
  if (ta !== tb) return ta - tb;
  const byPayer = String(a.payer).localeCompare(String(b.payer));
  if (byPayer !== 0) return byPayer;
  const byTopic = String(a.topicId).localeCompare(String(b.topicId));
  if (byTopic !== 0) return byTopic;
  return String(a.msgNumber).localeCompare(String(b.msgNumber));
}

// The arrows follow the pin that is open. Same account uses the person on
// the card (the original author when the pin is a share). By time and
// random stay on the pin's own list, so a share does not jump into the
// author's posts.
function bindWalk(record, walk) {
  if (!record || !walk || !walk.payer || walk.number == null || !walk.topicId) return record;
  const payer = walk.payer;
  const number = walk.number;
  const topicId = walk.topicId;
  const authorKey = record.markernumber != null && record.markernumber !== ''
    ? record.markernumber
    : record.polygonnumber;
  record.walk = {
    payer,
    number,
    topicId,
    shape: walk.shape,
    author: record.payer || payer,
    authorTopic: record.topicId || topicId,
    authorCreated: record.created || '',
    created: record.created || '',
    authorKey,
    share: record.share || null,
    timestamp: record.timestamp || '',
    kind: record.kind === 'polygon' || walk.shape === 'polygon' ? 'polygon' : 'marker',
  };
  const step = record.walk;
  if (walk.shape === 'polygon') {
    record.onPrev = () => window.prevMsgFromPayerPolygon(payer, number, topicId, step);
    record.onNext = () => window.nextMsgFromPayerPolygon(payer, number, topicId, step);
  } else {
    record.onPrev = () => window.prevMsgFromPayerMarker(payer, number, topicId, step);
    record.onNext = () => window.nextMsgFromPayerMarker(payer, number, topicId, step);
  }
  return record;
}

function findPin(posts, payer, number, topicId) {
  const key = String(number);
  const who = String(payer);
  const topic = String(topicId);
  for (let i = 0; i < posts.length; i++) {
    const item = posts[i];
    if (String(item.payer) === who && String(item.msgNumber) === key && String(item.topicId) === topic) return i;
  }
  return -1;
}

function findAuthorPost(posts, walk) {
  if (!walk) return -1;
  const author = String(walk.author || '');
  const topic = String(walk.authorTopic || '');
  const created = messageCreated(walk.authorCreated);
  const key = walk.authorKey == null ? '' : String(walk.authorKey);
  for (let i = 0; i < posts.length; i++) {
    const item = posts[i];
    if (String(item.payer) !== author || String(item.topicId) !== topic) continue;
    if (created && messageCreated(item.created) === created) return i;
    if (key !== '' && String(item.msgNumber) === key) return i;
  }
  return -1;
}

// Same account wraps inside that one account. By time is one timeline of
// every loaded post of this shape. Random picks another loaded post.
// One post, or a post that is not in the list, stays put.
function listForStep(pinGroups, pinPayer, walk) {
  const mode = pagerMode();
  if (mode === 'account') {
    const author = (walk && walk.author) || pinPayer;
    const groups = walk && walk.kind === 'polygon' ? storedPolygons : pinGroups;
    if (!author) return [];
    return postsFlat(groups).filter((item) => String(item.payer) === String(author)).sort(byTime);
  }
  return postsFlat(pinGroups).sort(byTime);
}

function stepPosts(posts, payer, number, topicId, direction, walk) {
  if (!posts || posts.length < 2) return null;
  const mode = pagerMode();
  // The open pin wins when it is already in this list (your own post, or
  // your own share). A share of someone else's post is not in their list,
  // so the step starts at the original instead. If that original is not
  // loaded either, the arrows stay put.
  let curIdx = findPin(posts, payer, number, topicId);
  if (curIdx === -1 && mode === 'account' && walk) curIdx = findAuthorPost(posts, walk);
  if (curIdx === -1) return null;
  if (mode === 'random') {
    let pick = Math.floor(Math.random() * (posts.length - 1));
    if (pick >= curIdx) pick += 1;
    return posts[pick];
  }
  const dir = direction < 0 ? -1 : 1;
  return posts[(curIdx + dir + posts.length) % posts.length];
}

function showPost(item) {
  if (!item) return null;
  if (item.geometry && item.geometry.type === 'Point') return showMarker(item);
  return showPolygon(item);
}

window.nextMsgFromPayerMarker = function(payer, markerNumber, topicId, walk) {
  if (!payer || markerNumber == null || !topicId) return null;
  const next = stepPosts(listForStep(storedMarkers, payer, walk), payer, markerNumber, topicId, 1, walk);
  return next ? showPost(next) : null;
};

function showMarker(m) {
    closeTransientMapUI(); // a popup replaces any open pin (📍/🔷 or 🗺/📡) and any other popup
    activeMarkerPopups.forEach(p => p.remove());
    newActiveMarkerPopups([]);
    activePolygonPopups.forEach(p => p.remove());
    newActivePolygonPopups([]);
    const popup = new maplibregl.Popup({ focusAfterOpen: false })
        .setLngLat(m.geometry.coordinates)
        .setDOMContent(markerPopupNode(m.properties, m))
        .addTo(map);

    activeMarkerPopups.push(popup);
    changePopupState(true);

    animateMapTo(map, m.geometry.coordinates, null);

    popup.on("close", () => {
      changePopupState(false);
        if (currentUfoModelInGLTF) {
            scene.add(currentUfoModelInGLTF);
            crosshair.style.display = "block";
        }
    });

    applyAllStyles();

    if (currentUfoModelInGLTF) {
        scene.remove(currentUfoModelInGLTF);
        crosshair.style.display = "none";
    }

    return m;
}

window.nextMsgFromPayerPolygon = function(payer, polygonNumber, topicId, walk) {
  if (!payer || polygonNumber == null || !topicId) return null;
  const next = stepPosts(listForStep(storedPolygons, payer, walk), payer, polygonNumber, topicId, 1, walk);
  return next ? showPost(next) : null;
};

function showPolygon(p) {
    closeTransientMapUI(); // a popup replaces any open pin (📍/🔷 or 🗺/📡) and any other popup
    activePolygonPopups.forEach(popup => popup.remove());
    newActivePolygonPopups([]);
    activeMarkerPopups.forEach(popup => popup.remove());
    newActiveMarkerPopups([]);

    const coordinates = p.coordinates[0];
    const bounds = coordinates.reduce((b, coord) => ({
        minLng: Math.min(b.minLng, coord[0]),
        maxLng: Math.max(b.maxLng, coord[0]),
        minLat: Math.min(b.minLat, coord[1]),
        maxLat: Math.max(b.maxLat, coord[1])
    }), { minLng: Infinity, maxLng: -Infinity, minLat: Infinity, maxLat: -Infinity });

    const centerLng = (bounds.minLng + bounds.maxLng) / 2;
    const centerLat = (bounds.minLat + bounds.maxLat) / 2;
    const targetLngLat = [centerLng, centerLat];

    const popup = new maplibregl.Popup({ focusAfterOpen: false })
        .setLngLat(targetLngLat)
        .setDOMContent(polygonPopupNode(p))
        .addTo(map);

    activePolygonPopups.push(popup);
    changePopupState(true);

    animateMapTo(map, targetLngLat, null);

    popup.on("close", () => {
      changePopupState(false);
        if (currentUfoModelInGLTF) {
            scene.add(currentUfoModelInGLTF);
            crosshair.style.display = "block";
        }
    });

    applyAllStyles();
    if (currentUfoModelInGLTF) {
        scene.remove(currentUfoModelInGLTF);
        crosshair.style.display = "none";
    }

    return p;
}

window.prevMsgFromPayerMarker = function(payer, markerNumber, topicId, walk) {
  if (!payer || markerNumber == null || !topicId) return null;
  const prev = stepPosts(listForStep(storedMarkers, payer, walk), payer, markerNumber, topicId, -1, walk);
  return prev ? showPost(prev) : null;
};

window.prevMsgFromPayerPolygon = function(payer, polygonNumber, topicId, walk) {
  if (!payer || polygonNumber == null || !topicId) return null;
  const prev = stepPosts(listForStep(storedPolygons, payer, walk), payer, polygonNumber, topicId, -1, walk);
  return prev ? showPost(prev) : null;
};

function samePin(item, walk) {
  if (!item || !walk) return false;
  if (String(item.payer) !== String(walk.payer)) return false;
  if (String(item.topicId) !== String(walk.topicId)) return false;
  if (walk.number != null && String(item.msgNumber) === String(walk.number)) return true;
  // A share pin carries the original post's time, so time alone would also
  // remove that pin. Originals match on the post time.
  if (walk.share || String(item.msgNumber || '').startsWith('share-')) return false;
  const created = messageCreated(walk.created || walk.authorCreated);
  const itemCreated = messageCreated(item.created);
  return !!(created && itemCreated && created === itemCreated);
}

function pullPin(list, walk) {
  if (!Array.isArray(list)) return;
  for (let i = list.length - 1; i >= 0; i--) {
    if (samePin(list[i], walk)) list.splice(i, 1);
  }
}

function pullPinBuckets(groups, walk) {
  for (const bucket of groups || []) pullPin(bucket, walk);
}

function removeMapLayer(id) {
  try {
    if (map.getLayer(id)) map.removeLayer(id);
  } catch (err) {
    console.error('layer remove failed', id, err);
  }
}

function removeMapSource(id) {
  try {
    if (map.getSource(id)) map.removeSource(id);
  } catch (err) {
    console.error('source remove failed', id, err);
  }
}

function closeOpenPopups() {
  activeMarkerPopups.forEach((popup) => popup.remove());
  newActiveMarkerPopups([]);
  activePolygonPopups.forEach((popup) => popup.remove());
  newActivePolygonPopups([]);
  changePopupState(false);
}

// The pin leaves the map as soon as the wallet send succeeds. A later topic
// reload still honors the delete or unshare message.
function removeLoadedPost(walk) {
  if (!walk) return;
  if (walk.share || walk.shape !== 'polygon') {
    pullPinBuckets(storedMarkers, walk);
    pullPin(geojson.features, walk);
    pullPin(storedMarkersFiltered, walk);
    try {
      index.load(geojson.features);
      updateClusters();
    } catch (err) {
      console.error('marker remove failed', err);
    }
    return;
  }
  pullPinBuckets(storedPolygons, walk);
  pullPin(storedPolygonsFiltered, walk);
  const removed = [];
  for (let i = polygons.length - 1; i >= 0; i--) {
    if (samePin(polygons[i], walk)) removed.push(polygons.splice(i, 1)[0]);
  }
  for (const polygon of removed) {
    if (!polygon || !polygon.id) continue;
    dropPolygonCover(polygon.id);
    removeMapLayer(polygon.id + '-mask-layer');
    removeMapLayer(polygon.id + '-image-layer');
    removeMapSource(polygon.id + '-mask-source');
    removeMapSource(polygon.id + '-source');
  }
}

// A share pin is a point on the sharer's connected profile topic.
function dropSharePin(source) {
  const created = messageCreated(source && source.created);
  const pinTopic = profileTopics[connectedAccount];
  if (!created || !pinTopic || !connectedAccount) return;
  removeLoadedPost({
    payer: connectedAccount,
    topicId: pinTopic,
    share: true,
    created,
    number: 'share-' + created + '-' + connectedAccount,
  });
  closeOpenPopups();
}

function hideDeleteButton() {
  const btn = document.getElementById('popup-settings-delete');
  if (btn) btn.style.display = 'none';
}

async function deletePopupTarget() {
  if (popupDeleteBusy) return;
  const walk = popupSettingsTarget;
  if (!walk || !signer || !connectedAccount || walk.payer !== connectedAccount) return;
  popupDeleteBusy = true;
  try {
    if (walk.share) {
      if (!walk.authorTopic || !walk.authorCreated || !walk.timestamp) {
        toast.error('This post cannot be deleted');
        return;
      }
      // The pin was written to the topic connected on this account's profile.
      const ok = await unshareFromMyTopic({
        topicId: walk.authorTopic,
        created: walk.authorCreated,
        timestamp: walk.timestamp,
      });
      if (!ok) return;
      dropSharePin({ created: walk.authorCreated });
    } else {
      const created = messageCreated(walk.created || walk.authorCreated);
      const timestamp = walk.timestamp ? String(walk.timestamp) : '';
      if ((!created && !timestamp) || !walk.topicId) {
        toast.error('This post cannot be deleted');
        return;
      }
      const fields = {};
      if (walk.shape === 'polygon') {
        if (created) fields.deletePolygonCreated = created;
        if (timestamp) fields.deletePolygonTimestamp = timestamp;
      } else {
        if (created) fields.deleteMarkerCreated = created;
        if (timestamp) fields.deleteMarkerTimestamp = timestamp;
      }
      const body = walk.shape === 'polygon'
        ? { polygon: { data: fields } }
        : { marker: { data: fields } };
      toast.info('Confirm in wallet 👛');
      await sendMessage(walk.topicId, JSON.stringify(body));
      toast.success('Deleted');
      removeLoadedPost(walk);
      closeOpenPopups();
    }
    // The card stays open. The pin is already gone, so the trash hides.
    hideDeleteButton();
  } catch (error) {
    console.error('popup delete failed', error);
    toast.error('Delete was not saved');
  } finally {
    popupDeleteBusy = false;
  }
}

window.likeMarker = async function(timestamp, topicId, remove) {
    if (!signer) {
      toast.error("Connect wallet first");
      return false;
    }

    const meesageobject = remove
      ? { unlikeMarker: { timestamp: timestamp } }
      : { likeMarker: { timestamp: timestamp } };

  const meesage = JSON.stringify(meesageobject);
  toast.info("Confirm in wallet 👛");
  await sendMessage(topicId, meesage);
  return true;
};

// Recursively build a reply thread (replies-to-replies supported; the
// depth guard stops malformed parentId cycles from overflowing the stack).
function buildReplyTree(node, repliesMap, likeMap, dislikeMap, depth = 0, actions = null, likeType = 'likeMarker') {
  if (depth > 50) return [];
  return (repliesMap.get(node.created) || []).map((r) => ({
    ...r,
    likeCount: likeMap.get(r.created) || 0,
    dislikeCount: dislikeMap.get(r.created) || 0,
    likedByMe: payerHasLike(actions, r.created, likeType),
    replies: buildReplyTree(r, repliesMap, likeMap, dislikeMap, depth + 1, actions, likeType)
  }));
}

// Count every message in a tree: each node plus all of its nested replies.
// Used by the popup 💬 button.
const countAllMessages = (nodes) => nodes.reduce((sum, n) => sum + 1 + (n.replies ? countAllMessages(n.replies) : 0), 0);

// Comment section for marker/polygon popups: the list of comments below the
// message plus a box to leave your own. Hidden until 💬 is pressed.
// Light panel: rounded corners, thin white border, no live blur.
function buildCommentsSection(id, comments, onSend, onReply, topicId, kind) {
  const section = document.createElement('div');
  section.id = id;
  section.style.cssText = 'display: none; margin-top: calc(var(--u) * 1); padding: calc(var(--u) * 1); border-radius: calc(var(--u) * 1.2); background: rgba(255, 255, 255, 0.10); border: calc(var(--u) * 0.05) solid rgba(255, 255, 255, 0.15); text-align: left;';

  const list = document.createElement('div');
  list.className = 'comments-scroll';
  list.style.cssText = 'margin-bottom: calc(var(--u) * 1);';
  if (comments.length === 0) {
    const empty = document.createElement('p');
    empty.style.cssText = 'font-size: calc(var(--u) * 1.3); color: gray; margin: calc(var(--u) * 0.5) 0; text-align: center;';
    empty.textContent = 'No comments yet';
    list.appendChild(empty);
  }

  // Topic-chat look: consecutive comments by the same payer form one group -
  // round profile photo on the left (opens the payer's topic), payer/username
  // header, then each comment's text with a small gray timestamp below it.
  const defaultProfilePic = 'https://kiloscribe.com/api/inscription-cdn/0.0.4819119';
  let currentGroupPayer = null;
  let currentMessagesDiv = null;

  const startGroup = (payer) => {
    currentGroupPayer = payer;
    const group = document.createElement('div');
    group.className = 'toolbar-group-messages';
    group.style.cssText = `position: relative; padding-left: 2.5em; min-height: 2.5em; border-color: ${innerContainerTopicChatColor};`;

    const payerImage = profilePictures[payer]?.url || defaultProfilePic;
    const validPayerImage = isValidUrl(payerImage) ? payerImage : defaultProfilePic;
    const img = document.createElement('img');
    img.src = validPayerImage;
    img.alt = 'Profile photo';
    img.style.cssText = 'position: absolute; left: 0.25em; top: 0.5em; width: 2em; height: 2em; border-radius: 1em; cursor: pointer;';
    img.addEventListener('click', () => window.loadBio4PIC(payer));
    group.appendChild(img);

    const contentWrapper = document.createElement('div');
    contentWrapper.style.cssText = 'display: flex; flex-direction: column;';

    const header = document.createElement('div');
    header.className = 'toolbar-group-messages-header';
    header.style.cssText = `display: flex; align-items: center; font-size: calc(var(--u) * ${headerFontSizeTopicChat});`;
    const payerLink = document.createElement('a');
    payerLink.href = `https://explore.hashpack.app/${encodeURIComponent(payer)}`;
    payerLink.target = '_blank';
    payerLink.rel = 'noopener noreferrer';
    payerLink.style.cssText = `color: ${accidTopicChatColor}; text-decoration: none;`;
    payerLink.textContent = payer;
    header.appendChild(payerLink);
    header.appendChild(document.createTextNode('\u00A0'));

    const username = usernames[payer]?.username ? ` ${usernames[payer].username}` : '';
    const click2link = click2url[payer]?.click2url ? ` ${click2url[payer].click2url}` : '';
    if (username.trim()) {
      header.appendChild(payerUsernameNode(username.trim(), click2link, {
        cssText: `color: ${usernameTopicChatColor};`
      }));
    }
    contentWrapper.appendChild(header);

    currentMessagesDiv = document.createElement('div');
    contentWrapper.appendChild(currentMessagesDiv);
    group.appendChild(contentWrapper);
    list.appendChild(group);
  };

  let replyTarget = null;

  // Render one comment/reply and its whole reply thread (recursive, so
  // replies-to-replies nest without a depth limit). A top-level comment and
  // its replies share one glass card; nesting is marked by a thin left
  // divider. A like on any node is just a regular likeMarker/likePolygon
  // with that node's own created timestamp, so the existing per-payer
  // counting applies unchanged.
  const renderNode = (node, depth) => {
    const wrapper = document.createElement('div');
    if (depth === 0) {
      wrapper.style.cssText = 'display: flex; flex-direction: column; margin-top: 0.2em; padding: calc(var(--u) * 0.6) calc(var(--u) * 1); border-radius: calc(var(--u) * 1.2); background: rgba(255, 255, 255, 0.05); border: calc(var(--u) * 0.05) solid rgba(255, 255, 255, 0.12); box-sizing: border-box;';
    } else {
      wrapper.style.cssText = 'margin-top: 0.2em;';
    }

    if (depth > 0) {
      // Match the top-level comment header: acc id in the acc
      // color, username in the username color (was one same-color link before)
      const whoRow = document.createElement('div');
      whoRow.style.cssText = `display: inline-flex; align-items: center; gap: 0.3em; padding: 0.025em 0.1em 0.025em 0.1em; border-radius: 0.4em; font-size: calc(var(--u) * ${headerFontSizeTopicChat / 2});`;
      const payerPic = document.createElement('img');
      const picUrl = profilePictures[node.payer]?.url || defaultProfilePic;
      payerPic.src = isValidUrl(picUrl) ? picUrl : defaultProfilePic;
      payerPic.alt = 'Profile photo';
      payerPic.style.cssText = 'width: 1.2em; height: 1.2em; border-radius: 1em; object-fit: cover; border: calc(var(--u) * 0.05) solid rgba(255, 255, 255, 0.35); cursor: pointer;';
      payerPic.addEventListener('click', () => window.loadBio4PIC(node.payer));
      whoRow.appendChild(payerPic);
      const payerLabel = document.createElement('a');
      payerLabel.href = `https://explore.hashpack.app/${encodeURIComponent(node.payer)}`;
      payerLabel.target = '_blank';
      payerLabel.rel = 'noopener noreferrer';
      payerLabel.style.cssText = `color: ${accidTopicChatColor}; text-decoration: none;`;
      payerLabel.textContent = node.payer;
      whoRow.appendChild(payerLabel);
      const uname = usernames[node.payer]?.username?.trim();
      const replyClick2 = click2url[node.payer]?.click2url;
      if (uname) {
        whoRow.appendChild(payerUsernameNode(uname, replyClick2, {
          cssText: `color: ${usernameTopicChatColor};`
        }));
      }
      wrapper.appendChild(whoRow);
    }

    const messageText = document.createElement('div');
    messageText.className = 'chat-msg-text';
    messageText.style.cssText = `font-size: calc(var(--u) * ${textFontSizeTopicChat}); color: ${textTopicChatColor}; white-space: pre-wrap; word-wrap: break-word;`;
    messageText.textContent = node.text;
    wrapper.appendChild(messageText);

    // Meta row: heart, reply count, reply (left) ... timestamp (right)
    const metaRow = document.createElement('div');
    metaRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-top: 0;';

    const likeDislikeDiv = document.createElement('div');
    likeDislikeDiv.style.cssText = 'display: flex; align-items: center; gap: 0.5em;';

    // Reply thread: inline in the same card as the comment (a thin left
    // divider marks the nesting). Collapsed by default; the 💬N badge on any
    // node with replies toggles it open/closed.
    const children = node.replies || [];
    let badge = null;
    let thread = null;
    if (children.length > 0) {
      thread = document.createElement('div');
      thread.className = 'reply-thread';
      thread.style.display = 'none';

      badge = createCommentBubble({
        count: countAllMessages(children),
        mini: true,
        onToggle: (open) => {
          thread.style.display = open ? '' : 'none';
        },
      });
    }

    likeDislikeDiv.appendChild(createHeartLike({
      count: node.likeCount,
      liked: node.likedByMe,
      mini: true,
      onToggle: (wantLike) => kind === 'polygon'
        ? window.likePolygon(node.created, topicId, !wantLike)
        : window.likeMarker(node.created, topicId, !wantLike),
    }));

    if (badge) likeDislikeDiv.appendChild(badge);

    const replyBtn = document.createElement('span');
    replyBtn.style.cssText = 'font-size: calc(var(--u) * 1.5); color: gray; cursor: pointer;';
    replyBtn.textContent = '↩';
    replyBtn.onclick = () => {
      replyTarget = node;
      const uname = usernames[node.payer]?.username?.trim() || '';
      const created = new Date(node.created).toLocaleString('en-US', {
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      replyChipLabel.textContent = `↩ Replying to ${node.payer}${uname ? ` ${uname}` : ''} — ${created}`;
      replyChip.style.display = 'flex';
      input.focus();
    };
    likeDislikeDiv.appendChild(replyBtn);

    metaRow.appendChild(likeDislikeDiv);

    const timestampSpan = document.createElement('span');
    timestampSpan.className = 'chat-msg-time';
    timestampSpan.style.cssText = `font-size: calc(var(--u) * 0.75); color: gray;`;
    timestampSpan.textContent = new Date(node.created).toLocaleString('en-US', {
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    metaRow.appendChild(timestampSpan);

    wrapper.appendChild(metaRow);

    if (thread) {
      children.forEach((child) => thread.appendChild(renderNode(child, depth + 1)));
      wrapper.appendChild(thread);
    }

    return wrapper;
  };

  for (const comment of comments) {
    if (comment.payer !== currentGroupPayer) {
      startGroup(comment.payer);
    }
    currentMessagesDiv.appendChild(renderNode(comment, 0));
  }
  section.appendChild(list);

  // Reply-mode chip above the input ("↩ Replying to @payer ✕")
  const replyChip = document.createElement('div');
  replyChip.style.cssText = 'display: none; align-items: center; gap: 0.5em; margin-bottom: calc(var(--u) * 0.8); font-size: calc(var(--u) * 1.2); color: gray;';
  const replyChipLabel = document.createElement('span');
  replyChipLabel.style.cssText = 'flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
  const replyChipClose = document.createElement('span');
  replyChipClose.textContent = '✕';
  replyChipClose.style.cssText = 'cursor: pointer; color: gray;';
  replyChipClose.onclick = () => { replyTarget = null; replyChip.style.display = 'none'; };
  replyChip.appendChild(replyChipLabel);
  replyChip.appendChild(replyChipClose);
  section.appendChild(replyChip);

  // Input row: rounded glass textarea + rounded pill Send button,
  // bottom-aligned so the button stays put as the textarea grows.
  const inputRow = document.createElement('div');
  inputRow.style.cssText = 'display: flex; align-items: flex-end; gap: calc(var(--u) * 1);';

  const input = document.createElement('textarea');
  input.placeholder = 'Leave a comment...';
  input.maxLength = 300;
  input.rows = 2;
  input.style.cssText = 'flex: 1; resize: none; font-size: calc(var(--u) * 1.4); padding: calc(var(--u) * 0.6) calc(var(--u) * 1); border-radius: calc(var(--u) * 1); border: calc(var(--u) * 0.05) solid rgba(255, 255, 255, 0.2); background: rgba(255, 255, 255, 0.08); color: white; outline: none;';
  input.addEventListener('input', () => adjustTextareaHeight(input));
  inputRow.appendChild(input);

  const sendBtn = document.createElement('span');
  sendBtn.textContent = 'Send';
  sendBtn.style.cssText = 'padding: calc(var(--u) * 0.6) calc(var(--u) * 1.5); border-radius: calc(var(--u) * 1.5); background: rgba(255, 255, 255, 0.9); color: black; font-size: calc(var(--u) * 1.3); font-weight: 600; cursor: pointer; user-select: none; transition: transform 0.15s ease, filter 0.15s ease;';
  sendBtn.addEventListener('mouseenter', () => { sendBtn.style.transform = 'scale(1.03)'; sendBtn.style.filter = 'brightness(1.1)'; });
  sendBtn.addEventListener('mouseleave', () => { sendBtn.style.transform = ''; sendBtn.style.filter = ''; });
  sendBtn.addEventListener('mousedown', () => { sendBtn.style.transform = 'scale(0.97)'; });
  sendBtn.addEventListener('mouseup', () => { sendBtn.style.transform = 'scale(1.03)'; });
  sendBtn.onclick = () => {
    if (replyTarget) {
      onReply(replyTarget.created, input);
      replyTarget = null;
      replyChip.style.display = 'none';
    } else {
      onSend(input);
    }
  };
  inputRow.appendChild(sendBtn);
  section.appendChild(inputRow);

  return section;
}

// One comments modal at a time: the post popup stays open (dimmed) behind it
let commentsModal = null;      // fullscreen wrapper (scrim + card)
let commentsModalSection = null; // the comments section currently inside it

function toggleCommentsBubble(open, sectionId) {
  if (open) {
    openCommentsModal(sectionId);
    if (!(commentsModalSection && commentsModalSection.id === sectionId)) return false;
    commentBubbleInput = commentsModalSection._bubbleInput || null;
    return;
  }
  if (!commentsClosing && commentsModalSection && commentsModalSection.id === sectionId) {
    closeCommentsModal();
  }
}

function closeCommentsModal() {
  if (!commentsModal || commentsClosing) return;
  commentsClosing = true;
  try {
    if (commentsModalSection) {
      const home = commentsModalSection._homeParent;
      if (home && home.isConnected) home.appendChild(commentsModalSection);
      const saved = commentsModalSection._modalSaves;
      if (saved) {
        for (const [prop, val] of Object.entries(saved)) {
          commentsModalSection.style[prop] = val;
        }
        delete commentsModalSection._modalSaves;
      }
    }
    const input = commentBubbleInput;
    commentsModal.remove();
    commentsModal = null;
    commentsModalSection = null;
    commentBubbleInput = null;
    if (input) {
      input.checked = false;
      const root = input.closest('.comment-bubble');
      if (root) {
        root.classList.remove('is-pop', 'is-down');
        void root.offsetWidth;
        root.classList.add('is-down');
      }
    }
    refitPopups();
  } finally {
    commentsClosing = false;
  }
}

function openCommentsModal(sectionId) {
  if (commentsModal) closeCommentsModal();
  const section = document.getElementById(sectionId);
  if (!section) return;

  // Fullscreen wrapper above the post popup: the wrapper's own z-index (5000)
  // beats .maplibregl-popup's z-index:1000!important, so the modal stacks on
  // top even though the card itself reuses the popup classes
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position: fixed; inset: 0; z-index: 5000;';

  const scrim = document.createElement('div');
  scrim.style.cssText = 'position: absolute; inset: 0; background: rgba(0, 0, 0, 0.72);';
  scrim.onclick = closeCommentsModal;
  scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
  wrapper.appendChild(scrim);

  // Card reuses the popup classes. It grows with the comments, then
  // popupanim shrinks the whole card so it stays inside the screen.
  const card = document.createElement('div');
  card.className = 'maplibregl-popup';
  const cardContent = document.createElement('div');
  cardContent.className = 'maplibregl-popup-content';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'maplibregl-popup-close-button';
  closeBtn.textContent = '×';
  closeBtn.onclick = (e) => {
    e.stopPropagation();
    closeCommentsModal();
  };
  cardContent.appendChild(closeBtn);

  // Move the already-built (hidden) section into the modal so its state —
  // comments, reply mode, reply target — carries over untouched
  section._homeParent = section.parentElement;
  section._modalSaves = {
    display: section.style.display,
    marginTop: section.style.marginTop,
    padding: section.style.padding,
    background: section.style.background,
    border: section.style.border,
    borderRadius: section.style.borderRadius,
    backdropFilter: section.style.backdropFilter,
    webkitBackdropFilter: section.style.webkitBackdropFilter
  };
  cardContent.appendChild(section);
  section.style.display = 'block';
  // Neutralize the section's own glass card inside the modal's card
  section.style.marginTop = '0';
  section.style.padding = '0';
  section.style.background = 'transparent';
  section.style.border = 'none';
  section.style.borderRadius = '0';
  section.style.backdropFilter = 'none';
  section.style.webkitBackdropFilter = 'none';

  card.appendChild(cardContent);
  wrapper.appendChild(card);
  document.body.appendChild(wrapper);

  commentsModal = wrapper;
  commentsModalSection = section;
  refitPopups();

  const input = section.querySelector('textarea');
  if (input) setTimeout(() => input.focus(), 100);
}

window.openMarkerComments = function(timestamp, topicId) {
  const section = document.getElementById(`marker-comments-${topicId}-${timestamp}`);
  const input = section && section._bubbleInput;
  if (input && !input.checked) input.checked = true;
  else if (!input) openCommentsModal(`marker-comments-${topicId}-${timestamp}`);
};

window.openPolygonComments = function(timestamp, topicId) {
  const section = document.getElementById(`polygon-comments-${topicId}-${timestamp}`);
  const input = section && section._bubbleInput;
  if (input && !input.checked) input.checked = true;
  else if (!input) openCommentsModal(`polygon-comments-${topicId}-${timestamp}`);
};

window.sendMarkerComment = async function(timestamp, topicId, input) {
  if (!signer) {
    toast.error("Connect wallet first");
    return;
  }
  const text = (input.value || '').trim().slice(0, 300);
  if (!text) {
    toast.error("Comment is empty");
    return;
  }
  const messageObject = {
    commentMarker: {
      timestamp: timestamp,
      text: text
    }
  };
  toast.info("Confirm in wallet 👛");
  await sendMessage(topicId, JSON.stringify(messageObject));
};

window.sendPolygonComment = async function(timestamp, topicId, input) {
  if (!signer) {
    toast.error("Connect wallet first");
    return;
  }
  const text = (input.value || '').trim().slice(0, 300);
  if (!text) {
    toast.error("Comment is empty");
    return;
  }
  const messageObject = {
    commentPolygon: {
      timestamp: timestamp,
      text: text
    }
  };
  toast.info("Confirm in wallet 👛");
  await sendMessage(topicId, JSON.stringify(messageObject));
};

window.sendMarkerReply = async function(postTimestamp, parentId, topicId, input) {
  if (!signer) {
    toast.error("Connect wallet first");
    return;
  }
  const text = (input.value || '').trim().slice(0, 300);
  if (!text) {
    toast.error("Comment is empty");
    return;
  }
  const messageObject = {
    replyMarker: {
      timestamp: postTimestamp,
      parentId: parentId,
      text: text
    }
  };
  toast.info("Confirm in wallet 👛");
  await sendMessage(topicId, JSON.stringify(messageObject));
};

window.sendPolygonReply = async function(postTimestamp, parentId, topicId, input) {
  if (!signer) {
    toast.error("Connect wallet first");
    return;
  }
  const text = (input.value || '').trim().slice(0, 300);
  if (!text) {
    toast.error("Comment is empty");
    return;
  }
  const messageObject = {
    replyPolygon: {
      timestamp: postTimestamp,
      parentId: parentId,
      text: text
    }
  };
  toast.info("Confirm in wallet 👛");
  await sendMessage(topicId, JSON.stringify(messageObject));
};

window.openPolygonNavigation = async function(coordinates) {

  try {  
    // Calculate center (centroid) of all points
    let sumLat = 0;
    let sumLng = 0;
    let count = 0;

    coordinates.forEach(point => {
      if (Array.isArray(point) && point.length >= 2) {
        const lng = point[0];   // longitude
        const lat = point[1];   // latitude
        sumLat += lat;
        sumLng += lng;
        count++;
      }
    });

    if (count === 0) {
      console.error("Invalid coordinate data");
      return;
    }

    const centerLat = sumLat / count;
    const centerLng = sumLng / count;

    const destination = `${centerLat},${centerLng}`;


    // Opens Google Maps centered on the location with a pin
    window.open( `https://www.google.com/maps?q=${destination}`, '_blank');
            

  } catch (err) {
    console.error("Error opening navigation:", err);
  }
  
};

window.openMarkerNavigation = async function(coords) {

  try {  
    const lat = coords[1];
    const lng = coords[0];

    const destination = `${lat},${lng}`;
    
    window.open( `https://www.google.com/maps?q=${destination}`, '_blank');

  } catch (err) {
    console.error("Error opening navigation:", err);
  }
  
};

window.likePolygon = async function(timestamp, topicId, remove) {
    if (!signer) {
      toast.error("Connect wallet first");
      return false;
    }

    const meesageobject = remove
      ? { unlikePolygon: { timestamp: timestamp } }
      : { likePolygon: { timestamp: timestamp } };

  const meesage = JSON.stringify(meesageobject);
  toast.info("Confirm in wallet 👛");
  await sendMessage(topicId, meesage);
  return true;
};

window.dislikeMarker = async function(timestamp, topicId) {
    if (!signer) {
      toast.error("Connect wallet first");
      return;
    }

    const meesageobject = {
    dislikeMarker: {
      timestamp: timestamp
    }
  };

  const meesage = JSON.stringify(meesageobject);
  toast.info("Confirm in wallet 👛");
  await sendMessage(topicId, meesage);
};

window.dislikePolygon = async function(timestamp, topicId) {
    if (!signer) {
      toast.error("Connect wallet first");
      return;
    }

    const meesageobject = {
    dislikePolygon: {
      timestamp: timestamp
    }
  };

  const meesage = JSON.stringify(meesageobject);
  toast.info("Confirm in wallet 👛");
  await sendMessage(topicId, meesage);
};







document.getElementById("unlock-load-all").addEventListener("click", async () => {
  try {
    let pass = document.getElementById("unlockkey-load").value;


    geojson.features = [];
    polygons.length = 0;

    existingMarkers.forEach(marker => marker.remove());
    newExistingMarkers([]);

    newStoredMarkers([]);
    newStoredPolygons([]);

    // Remove existing polygon layers
    map.getStyle().layers.forEach(layer => {
    if (layer.id.includes('-layer')) {
    map.removeLayer(layer.id);
    }
    });

    // Remove existing polygon sources
    const sourceIds = Object.keys(map.getStyle().sources);
    sourceIds.forEach(sourceId => {
    if (sourceId.includes('-source')) {
    map.removeSource(sourceId);
    }
    });


    let encryptedPrivateKey;
    let decryptedPrivateKey;

    const totalTopics = allLoadedMessages.length;
    let processedCount = 0;

    for (const topicData of allLoadedMessages) {

      const topicId = topicData.topicId; 

      const messages = Object.values(topicData.uniqueMessages).flat();

      const w = pass;

      const topicAdmin = [];
      try {
        const topicInfo = await getTopicInfo(topicId);
        const memo = topicInfo.memo || "";
        const parts = memo.split(',');
        parts.forEach(part => {
          if (part.trim().startsWith("0.0.")) {
            topicAdmin.push(part.trim());
          }
        });
      } catch (error) {

        console.error("Error getting topic info:", error);
        return;
      }

      try {
        for (let index = messages.length - 1; index >= 0; index--) {
          const message = messages[index];

          let parsedMessage = typeof message === 'string' ? JSON.parse(message) : message;

          if (parsedMessage.encryptedPrivateKeyForLoad && (topicAdmin.length === 0 || topicAdmin.includes(parsedMessage.payer))) {
  
            encryptedPrivateKey = parsedMessage.encryptedPrivateKeyForLoad;
  
            const nonce = parsedMessage.nonce;
            const salt = parsedMessage.salt;
            const password = w;
  
            decryptedPrivateKey = await decryptWithPassword(encryptedPrivateKey, nonce, salt, password);

            break;
  
          }
          else {
            decryptedPrivateKey = '';
          }
    
       }
      } catch (error) {

        console.error("Error getting public key:", error);

      }




    const { topicGeojsonFeatures, topicPolygons } = await processTopicE2EEMessages(decryptedPrivateKey, messages, topicId);

    storedMarkers.push(topicGeojsonFeatures);
    storedPolygons.push(topicPolygons);


   processedCount++;


  }

  if ( totalTopics === processedCount){

    polygons.forEach(polygon => {
      addPolygonWithImageFill(map, polygon);
    });

    if (geojson.features.length > 0) {
      index.load(geojson.features);
      updateClusters();
    }

  }

  } catch (error) {
    console.error('Error submitting message:', error);
  }
});






export async function processTopicE2EEMessages(decryptedPrivateKey, messages, topicId) {
  let topicGeojsonFeatures = [];
  let topicPolygons = [];
  let loadedTopicName = '';
  let PrivateKey;
  const rawResult = messages;

  try{
  PrivateKey = parsePrivateKey(decryptedPrivateKey);
  }catch (error) {
    console.error(`Error loading private key: ${error}`);
  }


  try {


      const likeCountMapMarker = new Map();
      const dislikeCountMapMarker = new Map();
      const likeCountMapPolygon = new Map();
      const dislikeCountMapPolygon = new Map();
      const payerActionsPerTimestamp = new Map();
      const commentsMapMarker = new Map();
      const commentsMapPolygon = new Map();
      const repliesMapMarker = new Map();
      const repliesMapPolygon = new Map();
      clearShareTopic(topicId);

if (rawResult && Array.isArray(rawResult)) {



  for (const message of rawResult) {
    try {
      let parsedMessage = message;

      if (typeof message === 'string') {
        parsedMessage = JSON.parse(message);
      }

      const payerId = parsedMessage.payer;
      let actionTimestamp, actionType;

      // Check for like
      if (parsedMessage.likeMarker && parsedMessage.likeMarker.timestamp && parsedMessage.payer) {
        actionTimestamp = parsedMessage.likeMarker.timestamp;
        actionType = 'likeMarker';
      }
      // Check for dislike
      if (parsedMessage.dislikeMarker && parsedMessage.dislikeMarker.timestamp && parsedMessage.payer) {
        const dislikeTimestamp = parsedMessage.dislikeMarker.timestamp;
        // If no like or dislike timestamp is newer, update action
        if (!actionTimestamp || dislikeTimestamp > actionTimestamp) {
          actionTimestamp = dislikeTimestamp;
          actionType = 'dislikeMarker';
        }
      }
      // Check for like
      if (parsedMessage.likePolygon && parsedMessage.likePolygon.timestamp && parsedMessage.payer) {
        actionTimestamp = parsedMessage.likePolygon.timestamp;
        actionType = 'likePolygon';
      }
      // Check for dislike
      if (parsedMessage.dislikePolygon && parsedMessage.dislikePolygon.timestamp && parsedMessage.payer) {
        actionTimestamp = parsedMessage.dislikePolygon.timestamp;
        actionType = 'dislikePolygon';
      }
      // Taking a like back. Unlike is not a dislike: it clears that payer's
      // like and adds nothing, so the heart count drops and no 👎 is stored.
      if (parsedMessage.unlikeMarker && parsedMessage.unlikeMarker.timestamp && parsedMessage.payer) {
        actionTimestamp = parsedMessage.unlikeMarker.timestamp;
        actionType = 'unlikeMarker';
      }
      if (parsedMessage.unlikePolygon && parsedMessage.unlikePolygon.timestamp && parsedMessage.payer) {
        actionTimestamp = parsedMessage.unlikePolygon.timestamp;
        actionType = 'unlikePolygon';
      }
      noteShare(parsedMessage, topicId);

      // Process the action if it exists
      if (actionTimestamp && actionType && payerId) {
        // Initialize map for this timestamp if it doesn't exist
        if (!payerActionsPerTimestamp.has(actionTimestamp)) {
          payerActionsPerTimestamp.set(actionTimestamp, new Map());
        }

        // Update or set the latest action for this payer at this timestamp
        const payerActions = payerActionsPerTimestamp.get(actionTimestamp);
        const existingAction = payerActions.get(payerId);

        // Only update if this is a new action or a newer timestamp
        if (!existingAction || actionTimestamp >= existingAction.timestamp) {
          // If there's an existing action, remove its previous count
          if (existingAction) {
            if (existingAction.type === 'likeMarker') {
              likeCountMapMarker.set(actionTimestamp, (likeCountMapMarker.get(actionTimestamp) || 0) - 1);
            } else if (existingAction.type === 'dislikeMarker') {
              dislikeCountMapMarker.set(actionTimestamp, (dislikeCountMapMarker.get(actionTimestamp) || 0) - 1);
            }
            if (existingAction.type === 'likePolygon') {
              likeCountMapPolygon.set(actionTimestamp, (likeCountMapPolygon.get(actionTimestamp) || 0) - 1);
            } else if (existingAction.type === 'dislikePolygon') {
              dislikeCountMapPolygon.set(actionTimestamp, (dislikeCountMapPolygon.get(actionTimestamp) || 0) - 1);
            }
          }

          // Store the new action
          payerActions.set(payerId, { type: actionType, timestamp: actionTimestamp });

          // Increment the count for the new action
          if (actionType === 'likeMarker') {
            likeCountMapMarker.set(actionTimestamp, (likeCountMapMarker.get(actionTimestamp) || 0) + 1);
          } else if (actionType === 'dislikeMarker') {
            dislikeCountMapMarker.set(actionTimestamp, (dislikeCountMapMarker.get(actionTimestamp) || 0) + 1);
          }
          if (actionType === 'likePolygon') {
            likeCountMapPolygon.set(actionTimestamp, (likeCountMapPolygon.get(actionTimestamp) || 0) + 1);
          } else if (actionType === 'dislikePolygon') {
            dislikeCountMapPolygon.set(actionTimestamp, (dislikeCountMapPolygon.get(actionTimestamp) || 0) + 1);
          }
        }
      }

      // Collect comments (each topic message is one comment; the payer is
      // the Hedera account that signed it, same as likes)
      if (parsedMessage.commentMarker && parsedMessage.commentMarker.timestamp && payerId) {
        const commentTimestamp = parsedMessage.commentMarker.timestamp;
        if (!commentsMapMarker.has(commentTimestamp)) {
          commentsMapMarker.set(commentTimestamp, []);
        }
        commentsMapMarker.get(commentTimestamp).push({
          payer: payerId,
          text: String(parsedMessage.commentMarker.text || '').slice(0, 300),
          // ISO string, NOT the Date object: like/reply messages store this
          // value through JSON (string), so map keys must be strings too
          created: new Date(parsedMessage.created).toISOString()
        });
      }
      if (parsedMessage.commentPolygon && parsedMessage.commentPolygon.timestamp && payerId) {
        const commentTimestamp = parsedMessage.commentPolygon.timestamp;
        if (!commentsMapPolygon.has(commentTimestamp)) {
          commentsMapPolygon.set(commentTimestamp, []);
        }
        commentsMapPolygon.get(commentTimestamp).push({
          payer: payerId,
          text: String(parsedMessage.commentPolygon.text || '').slice(0, 300),
          created: new Date(parsedMessage.created).toISOString()
        });
      }

      // Collect replies (nested comments; parentId = the created timestamp
      // of the comment or reply being answered)
      if (parsedMessage.replyMarker && parsedMessage.replyMarker.parentId && payerId) {
        const parentId = parsedMessage.replyMarker.parentId;
        if (!repliesMapMarker.has(parentId)) {
          repliesMapMarker.set(parentId, []);
        }
        repliesMapMarker.get(parentId).push({
          payer: payerId,
          text: String(parsedMessage.replyMarker.text || '').slice(0, 300),
          created: new Date(parsedMessage.created).toISOString()
        });
      }
      if (parsedMessage.replyPolygon && parsedMessage.replyPolygon.parentId && payerId) {
        const parentId = parsedMessage.replyPolygon.parentId;
        if (!repliesMapPolygon.has(parentId)) {
          repliesMapPolygon.set(parentId, []);
        }
        repliesMapPolygon.get(parentId).push({
          payer: payerId,
          text: String(parsedMessage.replyPolygon.text || '').slice(0, 300),
          created: new Date(parsedMessage.created).toISOString()
        });
      }
    } catch (error) {
      console.error(`Error parsing message for likes/dislikes: ${error}`);
    }
  }
}
          

          const topicInfo = await getTopicInfo(topicId);
          const topicAdmin = [];
          let hasRulesForMarker = false;
          let hasRulesForPolygon = false;
          const memo = topicInfo.memo;

          // Split the memo by commas
          const parts = memo.split(',');

          // Iterate over each part
          parts.forEach(part => {
            // Check if the part starts with "0.0."
            if (part.startsWith("0.0.")) {
              // Add it to the topicAdmin array
              topicAdmin.push(part);
            }
          });



          // Check if messages exist and is an array
          if (!rawResult || !Array.isArray(rawResult)) {
            console.error(`No messages found for topic ${topicId}.`, rawResult);
            return { topicGeojsonFeatures, topicPolygons }; // Return empty arrays
          }

          const messages = rawResult; // Extract messages

          const loadedTopicRulesForMarker = [];
          const loadedTopicRulesForPolygon = [];



          // Each side is its own stack. The same NFT id keeps its latest
          // values. "0" on a side lets anyone post.
          const topicRules = stackedTopicRules(messages, topicAdmin);
          if (!topicRules.markers.some((rule) => rule.open)) {
            for (const rule of topicRules.markers) {
              loadedTopicRulesForMarker.push(rule);
              hasRulesForMarker = true;
            }
          }
          if (!topicRules.polygons.some((rule) => rule.open)) {
            for (const rule of topicRules.polygons) {
              loadedTopicRulesForPolygon.push(rule);
              hasRulesForPolygon = true;
            }
          }

          const uniquePayerIdsForMarker = new Set();
          const uniquePayerIdsForPolygon = new Set();

          // Extract payer IDs from messages
      for (const message of messages) {
        try {
          let parsedMessage = message;
          if (typeof message === 'string') {
            parsedMessage = JSON.parse(message);
          }

          // Add payer IDs for markers
          if (parsedMessage.marker && parsedMessage.marker.data) {
            uniquePayerIdsForMarker.add(message.payer || parsedMessage.payer);
          }

          // Add payer IDs for polygons
          if (parsedMessage.polygon && parsedMessage.polygon.data) {
            uniquePayerIdsForPolygon.add(message.payer || parsedMessage.payer);
          }

          if (parsedMessage.addTopicNFT && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
          const nfts = parsedMessage.addTopicNFT.split(',').map(nft => nft.trim());
          nfts.forEach(nft => {
            if (!loadedNFTsForModel.includes(nft)) {
              loadedNFTsForModel.push(nft);
            }
          });
          }

          if (parsedMessage.removeTopicNFT && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
            const nft = parsedMessage.removeTopicNFT.trim();
            const index = loadedNFTsForModel.indexOf(nft);
            if (index !== -1) {
              loadedNFTsForModel.splice(index, 1);
            }
          }

        if (parsedMessage.addScale && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
          const { NFT, scale } = parsedMessage.addScale;
          loadedNFTScaleForModel.push({ NFT, scale });
        }

        if (parsedMessage.removeScale && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
          const { NFT } = parsedMessage.removeScale;
          const index = loadedNFTScaleForModel.findIndex(item => item.NFT === NFT);
          if (index !== -1) {
            loadedNFTScaleForModel.splice(index, 1); // Remove the item if it exists
          } else {
            console.log(`NFT: ${NFT} not found in addScale list`);
          }
        }

        updateRulesForModelNFTState();

        } catch (error) {
          console.error("Error extracting payer ID:", error);
        }
      }

          // Cached holdings draw immediately. Missing accounts stay pending
          // until their token list returns.
          const {
            holdings,
            markerOwnershipArray,
            polygonOwnershipArray,
            payerIds,
          } = await assignDrawingOwnership({
            hasRulesForMarker,
            hasRulesForPolygon,
            markerPayers: uniquePayerIdsForMarker,
            polygonPayers: uniquePayerIdsForPolygon,
            markerRules: loadedTopicRulesForMarker,
            polygonRules: loadedTopicRulesForPolygon,
          });
          const newestMessages = messages.slice().reverse();
          const indexed = indexNewestMessages(messages, topicAdmin);
          loadedTopicName = indexed.loadedTopicName;
          const messagesByPayer = indexed.messagesByPayer;
          const payerOrder = indexed.payerOrder;
          const drawState = { batch: newestMessages };
          const payerWaiting = (payerId) => {
            const markerOwner = markerOwnershipArray.find((owner) => owner.payerId === payerId);
            const polygonOwner = polygonOwnershipArray.find((owner) => owner.payerId === payerId);
            return !!((markerOwner && markerOwner.pending) || (polygonOwner && polygonOwner.pending));
          };
          const drawLoaded = async () => {
          const drawBatch = drawState.batch;
          for (let index = 0; index < drawBatch.length; index++) {
            const message = drawBatch[index];
            if (message && message.payer && payerWaiting(message.payer)) continue;
            try {
              let parsedMessage = message;
              let decryptedMessage;


              if (typeof message === 'string') {
                parsedMessage = JSON.parse(message);
              }
              
              if (parsedMessage.ciphertext){
                decryptedMessage = await decryptMessage(parsedMessage, PrivateKey);
                parsedMessage = JSON.parse(decryptedMessage)
              }

              const timestamp = new Date(message.created)
              .toLocaleString('en-US', {
                hour12: false,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
              })


              const defaultProfilePic = "https://kiloscribe.com/api/inscription-cdn/0.0.4819119";
              const profileUrl = isValidUrl(message.payer && profilePictures[message.payer] ?
                profilePictures[message.payer].url :
                defaultProfilePic) ?
                (message.payer && profilePictures[message.payer] ? profilePictures[message.payer].url : defaultProfilePic) :
                defaultProfilePic;

              const payerInfo = message.payer ? `${message.payer}` : 'Anonymous';
              const username = message.payer && usernames[message.payer] ?
                ` ${usernames[message.payer].username}` :
                '';
              const click2link = message.payer && click2url[message.payer] ?
                ` ${click2url[message.payer].click2url}` :
                '';

              appendShareFeature(topicGeojsonFeatures, {
                message,
                parsedMessage,
                topicId,
              });

              if (parsedMessage.marker && parsedMessage.marker.data) {
                const legacyNumber = legacyShapeNumber(parsedMessage.marker.data.numberOfMarker);
                const markerOwner = markerOwnershipArray.find(owner => owner.payerId === message.payer);
                if (!markerOwner) {
                  continue;
                }

                rememberShapeDelete(markerOwner, 'numberOfMarker', parsedMessage.marker.data);

                // A stored whole number keeps dedup. No number is a new post.
                // A delete matches the post's time, and an older delete still
                // matches the number it named.
                // The envelope time is the consensus timestamp. A decrypted body
                // does not carry it, and that time is what a delete names.
                const postCreated = (message && message.created) || parsedMessage.created;
                const markernumber = legacyNumber == null
                  ? (messageCreated(postCreated) || ('draw-' + index))
                  : legacyNumber;
                const markerCoords = legacyNumber === false
                  ? null
                  : markerCoordinates(parsedMessage.marker.data.cord);

                if (markerCoords && !postWasDeleted(markerOwner, 'numberOfMarker', markernumber, postCreated, timestamp)) {
                if (!hasRulesForMarker || markerOwner.numberOfMessages > 0) {
                  markerOwner.numberOfMarker.push(markernumber);
                  if (hasRulesForMarker) {
                    markerOwner.numberOfMessages -= 1;
                  }

                  const coords = markerCoords;
                  {
                    // Card is built on the first tap. The record closes over
                    // this drawing; comments and the heart are not built now.
                    const markerPopupData = () => ({
                      markernumber,
                      topicId,
                      loadedTopicName,
                      profileUrl,
                      payer: message.payer,
                      payerInfo,
                      username,
                      click2link,
                      title: parsedMessage.marker.data.title,
                      image: parsedMessage.marker.data.image,
                      coverimage: parsedMessage.marker.data.coverimage,
                      msg: parsedMessage.marker.data.msg,
                      timestamp,
                      created: messageCreated(postCreated),
                      likeCountMarker: likeCountMapMarker.get(timestamp) || 0,
                      likedByMe: payerHasLike(payerActionsPerTimestamp, timestamp, 'likeMarker'),
                      comments: (commentsMapMarker.get(timestamp) || []).map((c) => ({
                        ...c,
                        likeCount: likeCountMapMarker.get(c.created) || 0,
                        likedByMe: payerHasLike(payerActionsPerTimestamp, c.created, 'likeMarker'),
                        replies: buildReplyTree(c, repliesMapMarker, likeCountMapMarker, dislikeCountMapMarker, 0, payerActionsPerTimestamp, 'likeMarker')
                      })),
                      coords
                    });

                    topicGeojsonFeatures.push({
                      topicId: topicId,
                      created: postCreated,
                      msgNumber: markernumber,
                      type: "Feature",
                      payer: message.payer,
                      properties: {
                        popupData: markerPopupData,
                        imageUrl: isValidUrl(parsedMessage.marker.data.coverimage) ? parsedMessage.marker.data.coverimage : profileUrl,
                        title: String(parsedMessage.marker.data.title || "").slice(0, 20)
                      },
                      geometry: {
                        type: "Point",
                        coordinates: coords
                      }
                    });
                  }
                }
              }
            }

              // Handle polygon type messages
              if (parsedMessage.polygon && parsedMessage.polygon.data) {
                const polygonOwner = polygonOwnershipArray.find(owner => owner.payerId === message.payer);
                if (!polygonOwner) {
                  continue;
                }
                const legacyPolygonNumber = legacyShapeNumber(parsedMessage.polygon.data.numberOfPolygon);

                rememberShapeDelete(polygonOwner, 'numberOfPolygon', parsedMessage.polygon.data);

                const postCreated = (message && message.created) || parsedMessage.created;
                const polygonnumber = legacyPolygonNumber == null
                  ? (messageCreated(postCreated) || ('draw-' + index))
                  : legacyPolygonNumber;
                const polygonRing = legacyPolygonNumber === false
                  ? null
                  : polygonCoordinates(parsedMessage.polygon.data.cord);

                if (polygonRing && !postWasDeleted(polygonOwner, 'numberOfPolygon', polygonnumber, postCreated, timestamp)) {
                if (!hasRulesForPolygon || polygonOwner.numberOfMessages > 0) {
                  polygonOwner.numberOfPolygon.push(polygonnumber);
                  if (hasRulesForPolygon) {
                    polygonOwner.numberOfMessages -= 1;
                  }

                  {
                    const coordinates = polygonRing;
                    if (Array.isArray(coordinates) && coordinates.length > 2) {
                      const polygonSize = hasRulesForPolygon ? smallestPolygonSize(loadedTopicRulesForPolygon) : 1;

                      // Card is built on the first tap.
                      const polygonPopupData = () => ({
                        polygonnumber,
                        topicId,
                        loadedTopicName,
                        profileUrl,
                        payer: message.payer,
                        payerInfo,
                        username,
                        click2link,
                        title: parsedMessage.polygon.data.title,
                        image: parsedMessage.polygon.data.image,
                        coverimage: parsedMessage.polygon.data.coverimage,
                        msg: parsedMessage.polygon.data.msg,
                        timestamp,
                        created: messageCreated(postCreated),
                        likeCountPolygon: likeCountMapPolygon.get(timestamp) || 0,
                        likedByMe: payerHasLike(payerActionsPerTimestamp, timestamp, 'likePolygon'),
                        comments: (commentsMapPolygon.get(timestamp) || []).map((c) => ({
                          ...c,
                          likeCount: likeCountMapPolygon.get(c.created) || 0,
                          likedByMe: payerHasLike(payerActionsPerTimestamp, c.created, 'likePolygon'),
                          replies: buildReplyTree(c, repliesMapPolygon, likeCountMapPolygon, dislikeCountMapPolygon, 0, payerActionsPerTimestamp, 'likePolygon')
                        })),
                        coordinates
                      });

                      topicPolygons.push({
                        topicId: topicId,
                        created: postCreated,
                        msgNumber: polygonnumber,
                        id: `polygon-${message.payer}-${topicId}-${polygonnumber}`,
                        payer: message.payer,
                        coordinates: [coordinates],
                        popupData: polygonPopupData,
                        title: String(parsedMessage.polygon.data.title || "").slice(0, 20),
                        imageUrl: isValidUrl(parsedMessage.polygon.data.coverimage) ? parsedMessage.polygon.data.coverimage : profileUrl
                      });
                    }
                  }
                }
              }
            }
            } catch (messageError) {
              console.error(`Error processing message ${index}:`, messageError);
            }
          }
          };

          await showDrawingsAsApproved({
            messages,
            messagesByPayer,
            payerOrder,
            drawState,
            drawLoaded,
            payerWaiting,
            holdings,
            payerIds,
            markerOwnershipArray,
            polygonOwnershipArray,
            markerRules: loadedTopicRulesForMarker,
            polygonRules: loadedTopicRulesForPolygon,
            hasRulesForMarker,
            hasRulesForPolygon,
            features: topicGeojsonFeatures,
            polygonsOut: topicPolygons,
          });

        return { topicGeojsonFeatures, topicPolygons };


        } catch (error) {
          console.error(`Error loading messages for topic ${topicId}:`, error);
          return { topicGeojsonFeatures: [], topicPolygons: [] }; // Return empty arrays on error
        }
      }





document.getElementById("unlock-load-few").addEventListener("click", async () => {
  try {
    let pass = document.getElementById("unlockkey-load").value;


    geojson.features = [];
    polygons.length = 0;

    existingMarkers.forEach(marker => marker.remove());
    newExistingMarkers([]);

    newStoredMarkers([]);
    newStoredPolygons([]);

    // Remove existing polygon layers
    map.getStyle().layers.forEach(layer => {
    if (layer.id.includes('-layer')) {
    map.removeLayer(layer.id);
    }
    });

    // Remove existing polygon sources
    const sourceIds = Object.keys(map.getStyle().sources);
    sourceIds.forEach(sourceId => {
    if (sourceId.includes('-source')) {
    map.removeSource(sourceId);
    }
    });


    let encryptedPrivateKey;
    let decryptedPrivateKey;

    const totalTopics = allLoadedMessages.length;
    let processedCount = 0;

    for (const topicData of allLoadedMessages) {

      const topicId = topicData.topicId; 

      const messages = Object.values(topicData.uniqueMessages).flat();

      const w = pass;

      const topicAdmin = [];
      try {
        const topicInfo = await getTopicInfo(topicId);
        const memo = topicInfo.memo || "";
        const parts = memo.split(',');
        parts.forEach(part => {
          if (part.trim().startsWith("0.0.")) {
            topicAdmin.push(part.trim());
          }
        });
      } catch (error) {

        console.error("Error getting topic info:", error);
        return;
      }

      try {
        for (let index = messages.length - 1; index >= 0; index--) {
          const message = messages[index];

          let parsedMessage = typeof message === 'string' ? JSON.parse(message) : message;

          if (parsedMessage.encryptedPrivateKeyForLoad && (topicAdmin.length === 0 || topicAdmin.includes(parsedMessage.payer))) {
  
            encryptedPrivateKey = parsedMessage.encryptedPrivateKeyForLoad;
  
            const nonce = parsedMessage.nonce;
            const salt = parsedMessage.salt;
            const password = w;
  
            decryptedPrivateKey = await decryptWithPassword(encryptedPrivateKey, nonce, salt, password);

            break;
  
          }
          else {
            decryptedPrivateKey = '';
          }
    
        }
      } catch (error) {

        console.error("Error getting public key:", error);

      }




    const { topicGeojsonFeatures, topicPolygons } = await processFewTopicE2EEMessages(decryptedPrivateKey, messages, topicId);

    storedMarkers.push(topicGeojsonFeatures);
    storedPolygons.push(topicPolygons);


    processedCount++;


  }

  if ( totalTopics === processedCount){

    polygons.forEach(polygon => {
      addPolygonWithImageFill(map, polygon);
    });

    if (geojson.features.length > 0) {
      index.load(geojson.features);
      updateClusters();
    }

  }

  } catch (error) {
    console.error('Error submitting message:', error);
  }
});




export async function processFewTopicE2EEMessages(decryptedPrivateKey, messages, topicId) {
  let topicGeojsonFeatures = [];
  let topicPolygons = [];
  let loadedTopicName = '';
  let PrivateKey;
  const rawResult = messages;

  try{
  PrivateKey = parsePrivateKey(decryptedPrivateKey);
  }catch (error) {
    console.error(`Error loading private key: ${error}`);
  }


  try {


      const likeCountMapMarker = new Map();
      const dislikeCountMapMarker = new Map();
      const likeCountMapPolygon = new Map();
      const dislikeCountMapPolygon = new Map();
      const payerActionsPerTimestamp = new Map();
      const commentsMapMarker = new Map();
      const commentsMapPolygon = new Map();
      const repliesMapMarker = new Map();
      const repliesMapPolygon = new Map();
      clearShareTopic(topicId);

if (rawResult && Array.isArray(rawResult)) {



  for (const message of rawResult) {
    try {
      let parsedMessage = message;

      if (typeof message === 'string') {
        parsedMessage = JSON.parse(message);
      }

      const payerId = parsedMessage.payer;
      let actionTimestamp, actionType;

      // Check for like
      if (parsedMessage.likeMarker && parsedMessage.likeMarker.timestamp && parsedMessage.payer) {
        actionTimestamp = parsedMessage.likeMarker.timestamp;
        actionType = 'likeMarker';
      }
      // Check for dislike
      if (parsedMessage.dislikeMarker && parsedMessage.dislikeMarker.timestamp && parsedMessage.payer) {
        const dislikeTimestamp = parsedMessage.dislikeMarker.timestamp;
        // If no like or dislike timestamp is newer, update action
        if (!actionTimestamp || dislikeTimestamp > actionTimestamp) {
          actionTimestamp = dislikeTimestamp;
          actionType = 'dislikeMarker';
        }
      }
      // Check for like
      if (parsedMessage.likePolygon && parsedMessage.likePolygon.timestamp && parsedMessage.payer) {
        actionTimestamp = parsedMessage.likePolygon.timestamp;
        actionType = 'likePolygon';
      }
      // Check for dislike
      if (parsedMessage.dislikePolygon && parsedMessage.dislikePolygon.timestamp && parsedMessage.payer) {
        actionTimestamp = parsedMessage.dislikePolygon.timestamp;
        actionType = 'dislikePolygon';
      }
      // Taking a like back. Unlike is not a dislike: it clears that payer's
      // like and adds nothing, so the heart count drops and no 👎 is stored.
      if (parsedMessage.unlikeMarker && parsedMessage.unlikeMarker.timestamp && parsedMessage.payer) {
        actionTimestamp = parsedMessage.unlikeMarker.timestamp;
        actionType = 'unlikeMarker';
      }
      if (parsedMessage.unlikePolygon && parsedMessage.unlikePolygon.timestamp && parsedMessage.payer) {
        actionTimestamp = parsedMessage.unlikePolygon.timestamp;
        actionType = 'unlikePolygon';
      }
      noteShare(parsedMessage, topicId);

      // Process the action if it exists
      if (actionTimestamp && actionType && payerId) {
        // Initialize map for this timestamp if it doesn't exist
        if (!payerActionsPerTimestamp.has(actionTimestamp)) {
          payerActionsPerTimestamp.set(actionTimestamp, new Map());
        }

        // Update or set the latest action for this payer at this timestamp
        const payerActions = payerActionsPerTimestamp.get(actionTimestamp);
        const existingAction = payerActions.get(payerId);

        // Only update if this is a new action or a newer timestamp
        if (!existingAction || actionTimestamp >= existingAction.timestamp) {
          // If there's an existing action, remove its previous count
          if (existingAction) {
            if (existingAction.type === 'likeMarker') {
              likeCountMapMarker.set(actionTimestamp, (likeCountMapMarker.get(actionTimestamp) || 0) - 1);
            } else if (existingAction.type === 'dislikeMarker') {
              dislikeCountMapMarker.set(actionTimestamp, (dislikeCountMapMarker.get(actionTimestamp) || 0) - 1);
            }
            if (existingAction.type === 'likePolygon') {
              likeCountMapPolygon.set(actionTimestamp, (likeCountMapPolygon.get(actionTimestamp) || 0) - 1);
            } else if (existingAction.type === 'dislikePolygon') {
              dislikeCountMapPolygon.set(actionTimestamp, (dislikeCountMapPolygon.get(actionTimestamp) || 0) - 1);
            }
          }

          // Store the new action
          payerActions.set(payerId, { type: actionType, timestamp: actionTimestamp });

          // Increment the count for the new action
          if (actionType === 'likeMarker') {
            likeCountMapMarker.set(actionTimestamp, (likeCountMapMarker.get(actionTimestamp) || 0) + 1);
          } else if (actionType === 'dislikeMarker') {
            dislikeCountMapMarker.set(actionTimestamp, (dislikeCountMapMarker.get(actionTimestamp) || 0) + 1);
          }
          if (actionType === 'likePolygon') {
            likeCountMapPolygon.set(actionTimestamp, (likeCountMapPolygon.get(actionTimestamp) || 0) + 1);
          } else if (actionType === 'dislikePolygon') {
            dislikeCountMapPolygon.set(actionTimestamp, (dislikeCountMapPolygon.get(actionTimestamp) || 0) + 1);
          }
        }
      }

      // Collect comments (each topic message is one comment; the payer is
      // the Hedera account that signed it, same as likes)
      if (parsedMessage.commentMarker && parsedMessage.commentMarker.timestamp && payerId) {
        const commentTimestamp = parsedMessage.commentMarker.timestamp;
        if (!commentsMapMarker.has(commentTimestamp)) {
          commentsMapMarker.set(commentTimestamp, []);
        }
        commentsMapMarker.get(commentTimestamp).push({
          payer: payerId,
          text: String(parsedMessage.commentMarker.text || '').slice(0, 300),
          // ISO string, NOT the Date object: like/reply messages store this
          // value through JSON (string), so map keys must be strings too
          created: new Date(parsedMessage.created).toISOString()
        });
      }
      if (parsedMessage.commentPolygon && parsedMessage.commentPolygon.timestamp && payerId) {
        const commentTimestamp = parsedMessage.commentPolygon.timestamp;
        if (!commentsMapPolygon.has(commentTimestamp)) {
          commentsMapPolygon.set(commentTimestamp, []);
        }
        commentsMapPolygon.get(commentTimestamp).push({
          payer: payerId,
          text: String(parsedMessage.commentPolygon.text || '').slice(0, 300),
          created: new Date(parsedMessage.created).toISOString()
        });
      }

      // Collect replies (nested comments; parentId = the created timestamp
      // of the comment or reply being answered)
      if (parsedMessage.replyMarker && parsedMessage.replyMarker.parentId && payerId) {
        const parentId = parsedMessage.replyMarker.parentId;
        if (!repliesMapMarker.has(parentId)) {
          repliesMapMarker.set(parentId, []);
        }
        repliesMapMarker.get(parentId).push({
          payer: payerId,
          text: String(parsedMessage.replyMarker.text || '').slice(0, 300),
          created: new Date(parsedMessage.created).toISOString()
        });
      }
      if (parsedMessage.replyPolygon && parsedMessage.replyPolygon.parentId && payerId) {
        const parentId = parsedMessage.replyPolygon.parentId;
        if (!repliesMapPolygon.has(parentId)) {
          repliesMapPolygon.set(parentId, []);
        }
        repliesMapPolygon.get(parentId).push({
          payer: payerId,
          text: String(parsedMessage.replyPolygon.text || '').slice(0, 300),
          created: new Date(parsedMessage.created).toISOString()
        });
      }
    } catch (error) {
      console.error(`Error parsing message for likes/dislikes: ${error}`);
    }
  }
}
          

          const topicInfo = await getTopicInfo(topicId);
          const topicAdmin = [];
          let hasRulesForMarker = false;
          let hasRulesForPolygon = false;
          const memo = topicInfo.memo;

          // Split the memo by commas
          const parts = memo.split(',');

          // Iterate over each part
          parts.forEach(part => {
            // Check if the part starts with "0.0."
            if (part.startsWith("0.0.")) {
              // Add it to the topicAdmin array
              topicAdmin.push(part);
            }
          });



          // Check if messages exist and is an array
          if (!rawResult || !Array.isArray(rawResult)) {
            console.error(`No messages found for topic ${topicId}.`, rawResult);
            return { topicGeojsonFeatures, topicPolygons }; // Return empty arrays
          }

          const messages = rawResult; // Extract messages

          const loadedTopicRulesForMarker = [];
          const loadedTopicRulesForPolygon = [];



          // Each side is its own stack. The same NFT id keeps its latest
          // values. "0" on a side lets anyone post.
          const topicRules = stackedTopicRules(messages, topicAdmin);
          if (!topicRules.markers.some((rule) => rule.open)) {
            for (const rule of topicRules.markers) {
              loadedTopicRulesForMarker.push(rule);
              hasRulesForMarker = true;
            }
          }
          if (!topicRules.polygons.some((rule) => rule.open)) {
            for (const rule of topicRules.polygons) {
              loadedTopicRulesForPolygon.push(rule);
              hasRulesForPolygon = true;
            }
          }

          const uniquePayerIdsForMarker = new Set();
          const uniquePayerIdsForPolygon = new Set();

          // Extract payer IDs from messages
      for (const message of messages) {
        try {
          let parsedMessage = message;
          if (typeof message === 'string') {
            parsedMessage = JSON.parse(message);
          }

          // Add payer IDs for markers
          if (parsedMessage.marker && parsedMessage.marker.data) {
            uniquePayerIdsForMarker.add(message.payer || parsedMessage.payer);
          }

          // Add payer IDs for polygons
          if (parsedMessage.polygon && parsedMessage.polygon.data) {
            uniquePayerIdsForPolygon.add(message.payer || parsedMessage.payer);
          }

          if (parsedMessage.addTopicNFT && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
          const nfts = parsedMessage.addTopicNFT.split(',').map(nft => nft.trim());
          nfts.forEach(nft => {
            if (!loadedNFTsForModel.includes(nft)) {
              loadedNFTsForModel.push(nft);
            }
          });
          }

          if (parsedMessage.removeTopicNFT && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
            const nft = parsedMessage.removeTopicNFT.trim();
            const index = loadedNFTsForModel.indexOf(nft);
            if (index !== -1) {
              loadedNFTsForModel.splice(index, 1);
            }
          }

        if (parsedMessage.addScale && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
          const { NFT, scale } = parsedMessage.addScale;
          loadedNFTScaleForModel.push({ NFT, scale });
        }

        if (parsedMessage.removeScale && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
          const { NFT } = parsedMessage.removeScale;
          const index = loadedNFTScaleForModel.findIndex(item => item.NFT === NFT);
          if (index !== -1) {
            loadedNFTScaleForModel.splice(index, 1); // Remove the item if it exists
          } else {
            console.log(`NFT: ${NFT} not found in addScale list`);
          }
        }

        updateRulesForModelNFTState();

        } catch (error) {
          console.error("Error extracting payer ID:", error);
        }
      }

          // Cached holdings draw immediately. Missing accounts stay pending
          // until their token list returns.
          const {
            holdings,
            markerOwnershipArray,
            polygonOwnershipArray,
            payerIds,
          } = await assignDrawingOwnership({
            hasRulesForMarker,
            hasRulesForPolygon,
            markerPayers: uniquePayerIdsForMarker,
            polygonPayers: uniquePayerIdsForPolygon,
            markerRules: loadedTopicRulesForMarker,
            polygonRules: loadedTopicRulesForPolygon,
          });
          const newestMessages = messages.slice().reverse();
          const indexed = indexNewestMessages(messages, topicAdmin);
          loadedTopicName = indexed.loadedTopicName;
          const messagesByPayer = indexed.messagesByPayer;
          const payerOrder = indexed.payerOrder;
          const drawState = { batch: newestMessages };
          const payerWaiting = (payerId) => {
            const markerOwner = markerOwnershipArray.find((owner) => owner.payerId === payerId);
            const polygonOwner = polygonOwnershipArray.find((owner) => owner.payerId === payerId);
            return !!((markerOwner && markerOwner.pending) || (polygonOwner && polygonOwner.pending));
          };
          const drawLoaded = async () => {
          const drawBatch = drawState.batch;
          for (let index = 0; index < drawBatch.length; index++) {
            const message = drawBatch[index];
            if (message && message.payer && payerWaiting(message.payer)) continue;
            try {
              let parsedMessage = message;

              
              let decryptedMessage;


              if (typeof message === 'string') {
                parsedMessage = JSON.parse(message);
              }
              
              if (parsedMessage.ciphertext){
                decryptedMessage = await decryptMessage(parsedMessage, PrivateKey);
                parsedMessage = JSON.parse(decryptedMessage)
              }

              const timestamp = new Date(message.created)
              .toLocaleString('en-US', {
                hour12: false,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
              })


              const defaultProfilePic = "https://kiloscribe.com/api/inscription-cdn/0.0.4819119";
              const profileUrl = isValidUrl(message.payer && profilePictures[message.payer] ?
                profilePictures[message.payer].url :
                defaultProfilePic) ?
                (message.payer && profilePictures[message.payer] ? profilePictures[message.payer].url : defaultProfilePic) :
                defaultProfilePic;

              const payerInfo = message.payer ? `${message.payer}` : 'Anonymous';
              const username = message.payer && usernames[message.payer] ?
                ` ${usernames[message.payer].username}` :
                '';
              const click2link = message.payer && click2url[message.payer] ?
                ` ${click2url[message.payer].click2url}` :
                '';

              appendShareFeature(topicGeojsonFeatures, {
                message,
                parsedMessage,
                topicId,
              });

              if (parsedMessage.marker && parsedMessage.marker.data) {
                const legacyNumber = legacyShapeNumber(parsedMessage.marker.data.numberOfMarker);
                const markerOwner = markerOwnershipArray.find(owner => owner.payerId === message.payer);
                if (!markerOwner) {
                  continue;
                }

                rememberShapeDelete(markerOwner, 'numberOfMarker', parsedMessage.marker.data);

                // A stored whole number keeps dedup. No number is a new post.
                // A delete matches the post's time, and an older delete still
                // matches the number it named.
                // The envelope time is the consensus timestamp. A decrypted body
                // does not carry it, and that time is what a delete names.
                const postCreated = (message && message.created) || parsedMessage.created;
                const markernumber = legacyNumber == null
                  ? (messageCreated(postCreated) || ('draw-' + index))
                  : legacyNumber;
                const markerCoords = legacyNumber === false
                  ? null
                  : markerCoordinates(parsedMessage.marker.data.cord);

                if (markerCoords && !postWasDeleted(markerOwner, 'numberOfMarker', markernumber, postCreated, timestamp)) {
                if (!hasRulesForMarker || markerOwner.numberOfMessages > 0) {
                  markerOwner.numberOfMarker.push(markernumber);
                  if (hasRulesForMarker) {
                    markerOwner.numberOfMessages -= 1;
                  }

                  const coords = markerCoords;
                  {
                    // Card is built on the first tap. The record closes over
                    // this drawing; comments and the heart are not built now.
                    const markerPopupData = () => ({
                      markernumber,
                      topicId,
                      loadedTopicName,
                      profileUrl,
                      payer: message.payer,
                      payerInfo,
                      username,
                      click2link,
                      title: parsedMessage.marker.data.title,
                      image: parsedMessage.marker.data.image,
                      coverimage: parsedMessage.marker.data.coverimage,
                      msg: parsedMessage.marker.data.msg,
                      timestamp,
                      created: messageCreated(postCreated),
                      likeCountMarker: likeCountMapMarker.get(timestamp) || 0,
                      likedByMe: payerHasLike(payerActionsPerTimestamp, timestamp, 'likeMarker'),
                      comments: (commentsMapMarker.get(timestamp) || []).map((c) => ({
                        ...c,
                        likeCount: likeCountMapMarker.get(c.created) || 0,
                        likedByMe: payerHasLike(payerActionsPerTimestamp, c.created, 'likeMarker'),
                        replies: buildReplyTree(c, repliesMapMarker, likeCountMapMarker, dislikeCountMapMarker, 0, payerActionsPerTimestamp, 'likeMarker')
                      })),
                      coords
                    });

                    if (message.ciphertext){

                    topicGeojsonFeatures.push({
                      topicId: topicId,
                      created: postCreated,
                      msgNumber: markernumber,
                      type: "Feature",
                      payer: message.payer,
                      properties: {
                        popupData: markerPopupData,
                        imageUrl: isValidUrl(parsedMessage.marker.data.coverimage) ? parsedMessage.marker.data.coverimage : profileUrl,
                        title: String(parsedMessage.marker.data.title || "").slice(0, 20)
                      },
                      geometry: {
                        type: "Point",
                        coordinates: coords
                      }
                    });
                  }
                  }
                }
              }
            }

              // Handle polygon type messages
              if (parsedMessage.polygon && parsedMessage.polygon.data) {
                const polygonOwner = polygonOwnershipArray.find(owner => owner.payerId === message.payer);
                if (!polygonOwner) {
                  continue;
                }
                const legacyPolygonNumber = legacyShapeNumber(parsedMessage.polygon.data.numberOfPolygon);

                rememberShapeDelete(polygonOwner, 'numberOfPolygon', parsedMessage.polygon.data);

                const postCreated = (message && message.created) || parsedMessage.created;
                const polygonnumber = legacyPolygonNumber == null
                  ? (messageCreated(postCreated) || ('draw-' + index))
                  : legacyPolygonNumber;
                const polygonRing = legacyPolygonNumber === false
                  ? null
                  : polygonCoordinates(parsedMessage.polygon.data.cord);

                if (polygonRing && !postWasDeleted(polygonOwner, 'numberOfPolygon', polygonnumber, postCreated, timestamp)) {
                if (!hasRulesForPolygon || polygonOwner.numberOfMessages > 0) {
                  polygonOwner.numberOfPolygon.push(polygonnumber);
                  if (hasRulesForPolygon) {
                    polygonOwner.numberOfMessages -= 1;
                  }

                  {
                    const coordinates = polygonRing;
                    if (Array.isArray(coordinates) && coordinates.length > 2) {
                      const polygonSize = hasRulesForPolygon ? smallestPolygonSize(loadedTopicRulesForPolygon) : 1;

                      // Card is built on the first tap.
                      const polygonPopupData = () => ({
                        polygonnumber,
                        topicId,
                        loadedTopicName,
                        profileUrl,
                        payer: message.payer,
                        payerInfo,
                        username,
                        click2link,
                        title: parsedMessage.polygon.data.title,
                        image: parsedMessage.polygon.data.image,
                        coverimage: parsedMessage.polygon.data.coverimage,
                        msg: parsedMessage.polygon.data.msg,
                        timestamp,
                        created: messageCreated(postCreated),
                        likeCountPolygon: likeCountMapPolygon.get(timestamp) || 0,
                        likedByMe: payerHasLike(payerActionsPerTimestamp, timestamp, 'likePolygon'),
                        comments: (commentsMapPolygon.get(timestamp) || []).map((c) => ({
                          ...c,
                          likeCount: likeCountMapPolygon.get(c.created) || 0,
                          likedByMe: payerHasLike(payerActionsPerTimestamp, c.created, 'likePolygon'),
                          replies: buildReplyTree(c, repliesMapPolygon, likeCountMapPolygon, dislikeCountMapPolygon, 0, payerActionsPerTimestamp, 'likePolygon')
                        })),
                        coordinates
                      });


                      if(message.ciphertext){

                      topicPolygons.push({
                        topicId: topicId,
                        created: postCreated,
                        msgNumber: polygonnumber,
                        id: `polygon-${message.payer}-${topicId}-${polygonnumber}`,
                        payer: message.payer,
                        coordinates: [coordinates],
                        popupData: polygonPopupData,
                        title: String(parsedMessage.polygon.data.title || "").slice(0, 20),
                        imageUrl: isValidUrl(parsedMessage.polygon.data.coverimage) ? parsedMessage.polygon.data.coverimage : profileUrl
                      });
                    }
                    }
                  }
                }
              }
            }
            } catch (messageError) {
              console.error(`Error processing message ${index}:`, messageError);
            }
          }
          };

          await showDrawingsAsApproved({
            messages,
            messagesByPayer,
            payerOrder,
            drawState,
            drawLoaded,
            payerWaiting,
            holdings,
            payerIds,
            markerOwnershipArray,
            polygonOwnershipArray,
            markerRules: loadedTopicRulesForMarker,
            polygonRules: loadedTopicRulesForPolygon,
            hasRulesForMarker,
            hasRulesForPolygon,
            features: topicGeojsonFeatures,
            polygonsOut: topicPolygons,
          });

        return { topicGeojsonFeatures, topicPolygons };


        } catch (error) {
          console.error(`Error loading messages for topic ${topicId}:`, error);
          return { topicGeojsonFeatures: [], topicPolygons: [] }; // Return empty arrays on error
        }
      }