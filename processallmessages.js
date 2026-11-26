import { isValidUrl } from './ISVALIDURL.JS';
import { DEFAULT_AVATAR, resolveHashinalSrc } from './hashinalurl.js';
import { avatarSrc } from './avatarsrc.js';
import { collapseExpandedFields, fieldExpandOf, mountFieldExpand } from './fieldexpand.js';
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
import { profilePictures, usernames, click2url, profileTopics, profileSwaps } from './loadalladata'
import { confirmShare, unshareFromMyTopic, sharePin, followPersonControls, watchFollowPrefetch, bindPressFeedback } from './followtopic'
import { formatCount } from './countformat.js'
import { clearShareTopic, noteShare, shareState, shareMine, takeSharePin, takeUnsharePin } from './sharecount.js'
import { readPostCard, writePostCard, forgetPostCard } from './postcache.js'
import { openGallery, openPreview } from './fullscreenmedia';
import { isGifClipUrl, isGifUrl, needsGifCheck, resolveMediaUrl } from './mediaurl.js';
import { bindVideoPoster } from './videoposter.js';
import { pictureElement, presentImage, watchLoop } from './loopmedia.js';
import { mountMediaBackdrop, mountMediaTools } from './mediaframe.js';
import { mountMoreBadge } from './mediagrid.js';
import { inTimeRange } from './timefilter.js';
import { galleryImages } from './postimages.js';
import { paintHashtags, singleLineText } from './hashtag.js';
import { watchPopupText, setPopupText, paintPopupXEmbeds } from './popuptext.js';
import { bindXEmbedsSwitch, lockPopupXEmbeds } from './xembed.js';
import { isTyping } from './joystick.js';
import { normalizeMessageNewlines, clipMessage, formatHcsUsage, utf8ByteLength, HCS_TOO_LONG, HCS_MESSAGE_MAX_BYTES } from './hcschunks.js';
import {
  COMMENT_TEXT_MAX,
  clipCommentText,
  commentImageUrl,
  commentImageValue,
  commentMediaShownUrl,
  filterCommentTree,
  findComment,
  mutationVerdict,
  readCommentEvents,
  reconcileCommentTree,
  sortCommentTree,
} from './commentops.js';
import {
  cachedPinned,
  collectionNames,
  commentPinFor,
  commentPinPayers,
  commentPinText,
  lookupHolders,
  pinTopLevel,
  planCommentPinEdit,
  rememberCommentPin as storeCommentPin,
  validatePinTokens,
  whenCollectionName,
} from './commentpin.js';
import { commentFiltersActive, filterCommentsForReader, freshCommentFilters } from './commentfilter.js';
import { feedFollowSet } from './feedfollow.js';
import {
  COMMENT_MEDIA_ACCEPT,
  COMMENT_MEDIA_TYPES_TEXT,
  COMMENT_STILL_STILL_BIG,
  COMMENT_STILL_TOO_BIG,
  COMMENT_VIDEO_TOO_BIG,
  COMMENT_VIDEO_TOO_LONG,
  commentMediaKind,
  commentMediaReject,
} from './commentmedia.js';
import {
  COMMENT_PLACEHOLDER,
  DEFAULT_COMMENT_SORT,
  buildCommentComposer,
  buildCommentRow,
  buildSortToggle,
  commentNameParts,
  confirmInRow,
} from './commentsui.js';
import maplibregl from 'maplibre-gl';
import { map } from './map';
import { applyAllStyles } from './loadprofilepopup';
import { scene } from './threejs'
import { parsePrivateKey, decryptMessage, parsePublicKey, encryptMessage, encryptWithPassword, decryptWithPassword } from './sodium'
import { signer, connectedAccount } from './web3';
import { consensusOf } from './donationmath.js';
import { noteVisibleDonation } from './donations.js';
import { createPostMenu } from './postmenu.js';
import { createSwapTokenCard, paintSwapLinks, paintSwapToken } from './swapsheet.js';
import { mountClanTag } from './clantag.js';
import { refitPopups } from './popupanim';
import { copyTextToClipboard } from './handleallmessages';
import { toast } from './toast'
import { capMessageField } from './bytecap.js';
import { videoSeconds } from './mediaduration.js'
import { placeUrl } from './placeurl.js';
import { stackedTopicRules, smallestPolygonSize } from './topicrules.js'
import { currentAutoplayNft } from './loadcurrenttopic.js'
import { rememberTopicAutoplay } from './coverautoplay.js'
import { payerUsernameNode } from './payerlink.js'
import { earlyHashinalNumber, paintProfileAvatar } from './earlyhashinal.js'
import { watchProfilePicture, watchProfileTree, forgetProfileTree } from './markertilt.js'
import { loadBio4PIC } from './loadBio4PIC.js';
import {
  secondsMatch, customLength, setCustomLength, parseDuration, formatDuration,
  radiusMode, setRadiusMode, customRadius, setCustomRadius, parseKm, RADIUS_PRESETS,
  withinRadius, radiusKm, radiusLabel,
} from './arrowfilters.js';

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

// The map's topic load (handleallmessages.js) takes a token: drawings of a
// load that is no longer the newest are dropped (a topic that ran past its
// time limit keeps loading after the next load began), and only posts in
// the load's time range (timefilter.js) are drawn. Other callers pass no
// token: a place link (openplace.js) or a sealed topic draws everything.
let mapDrawToken = 0;
let mapDrawRange = null;

export function beginMapDraw(range) {
  mapDrawToken += 1;
  mapDrawRange = range || null;
  return mapDrawToken;
}

export function mapDrawCurrent(token) {
  return token === mapDrawToken;
}

function publishApprovedDrawings(features, polys, state, sync) {
  const timed = state.token != null;
  if (timed && !mapDrawCurrent(state.token)) return;
  const inRange = (drawing) => !timed || inTimeRange(drawing && drawing.created, mapDrawRange);
  const markers = features.slice(state.markers).filter(inRange);
  const nextPolys = polys.slice(state.polys).filter(inRange);
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
  const publishState = { markers: 0, polys: 0, token: ctx.token };
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
const MEDIA_MODE_KEY = 'meritocracy-media-mode';
const LENGTH_MODE_KEY = 'meritocracy-length-mode';
let popupSettingsTarget = null;
let popupSettingsBound = false;
// The gear that opened settings (popupSettingsGear), for placeSettingsHead.
let popupSettingsGearEl = null;
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

export function mediaMode() {
  try {
    const mode = localStorage.getItem(MEDIA_MODE_KEY);
    if (mode === 'pictures' || mode === 'videos' || mode === 'both' || mode === 'all') return mode;
  } catch {
    // A blocked store just keeps the default for this visit.
  }
  return 'all';
}

export function lengthMode() {
  try {
    const mode = localStorage.getItem(LENGTH_MODE_KEY);
    if (mode === 'under' || mode === 'mid' || mode === 'over' || mode === 'any' || mode === 'custom') return mode;
  } catch {
    // A blocked store just keeps the default for this visit.
  }
  return 'any';
}

function walkTarget(value) {
  if (!value || value.payer == null || value.number == null || !value.topicId) return null;
  return value;
}

const PREVIEW_PROFILE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='32' r='32' fill='%23222833'/%3E%3Ccircle cx='32' cy='26' r='10' fill='%23c5cad6'/%3E%3Cellipse cx='32' cy='54' rx='16' ry='12' fill='%23c5cad6'/%3E%3C/svg%3E";

function showPreviewFollowZero(root) {
  root.querySelectorAll('.topic-follow').forEach((box) => {
    box._refreshFollow = () => {};
    const count = box.querySelector('.topic-follow-count');
    if (!count) return;
    count.classList.remove('is-loading');
    count.setAttribute('role', 'img');
    count.setAttribute('aria-label', '0 followers');
    count.title = '0 followers';
    const value = count.querySelector('.topic-follow-num-value');
    if (value) value.textContent = '0';
  });
}

function dropPreviewPager(sheet) {
  for (const entry of popupPagers) {
    if (entry.container === sheet) popupPagers.delete(entry);
  }
}

function ensurePopupPreview(slot) {
  if (slot.querySelector(':scope > .maplibregl-popup')) return;
  const account = '0.0.9779355';
  const record = {
    markernumber: 1,
    topicId: '0.0.9609912',
    loadedTopicName: 'Freedom',
    profileUrl: PREVIEW_PROFILE,
    payer: account,
    payerInfo: account,
    username: 'username',
    title: 'message title',
    // A few lines, one long enough to wrap, so the preview shows how the
    // chosen size changes the lines and how much of a post fits.
    msg: 'This is how a post reads when its popup opens.\n'
      + 'A longer message wraps onto more lines like this one, so you can see how much text fits at the size you choose.\n'
      + 'Line breaks show as they were typed.',
    timestamp: '10/10/2026, 21:35',
    likeCountMarker: 0,
    likedByMe: false,
    comments: [],
    commentsCount: 0,
    shareCount: 0,
    sharedByMe: false,
    viewCount: 2,
  };
  // The follow chip skips reads inside #popup-settings-preview (followtopic.js).
  const sheet = markerPopupNode(
    { popupData: record },
    { payer: account, msgNumber: 1, topicId: record.topicId }
  );
  if (!sheet) return;
  dropPreviewPager(sheet);
  showPreviewFollowZero(sheet);
  // No created time, so the view counter never asks the server.
  // The pill still reads like a real popup.
  const views = sheet.querySelector('.popup-views');
  if (views) {
    setViewsCount(views, 2);
    views.classList.add('is-shown');
  }
  const popup = document.createElement('div');
  popup.className = 'maplibregl-popup';
  popup.style.pointerEvents = 'none';
  const content = document.createElement('div');
  content.className = 'maplibregl-popup-content';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'maplibregl-popup-close-button';
  close.tabIndex = -1;
  close.setAttribute('aria-hidden', 'true');
  close.textContent = '\u00d7';
  content.append(close, sheet);
  popup.appendChild(content);
  slot.appendChild(popup);
  applyAllStyles();
}

// Settings > Popups preview (index.html #popup-settings-preview): one real
// popup at the size it opens at. style.css gives it a real popup's unit
// and the map popup rules, so the Size slider and the colours show in it
// as they will on the map; nothing is scaled. It is built the first time
// the page shows (the slot gets a width), not at load.
let stylePreviewWatch = null;
function buildPopupStylePreview() {
  const slot = document.getElementById('popup-settings-preview');
  if (!slot || !slot.isConnected || !slot.getClientRects().length) return false;
  ensurePopupPreview(slot);
  return !!slot.querySelector(':scope > .maplibregl-popup');
}
function watchPopupStylePreview() {
  const slot = document.getElementById('popup-settings-preview');
  if (!slot || stylePreviewWatch) return;
  if (typeof ResizeObserver !== 'function') {
    stylePreviewWatch = true;
    requestAnimationFrame(buildPopupStylePreview);
    return;
  }
  stylePreviewWatch = new ResizeObserver(() => {
    if (buildPopupStylePreview()) stylePreviewWatch.disconnect();
  });
  stylePreviewWatch.observe(slot);
}
watchPopupStylePreview();

function paintPagerModes() {
  const mode = pagerMode();
  for (const name of ['account', 'time', 'random']) {
    const btn = document.getElementById('popup-pager-' + name);
    if (btn) btn.classList.toggle('is-on', name === mode);
  }
}

function paintMediaModes() {
  const mode = mediaMode();
  for (const name of ['all', 'pictures', 'videos', 'both']) {
    const btn = document.getElementById('popup-media-' + name);
    if (btn) btn.classList.toggle('is-on', name === mode);
  }
}

function paintLengthModes() {
  const mode = lengthMode();
  for (const name of ['any', 'under', 'mid', 'over', 'custom']) {
    const btn = document.getElementById('popup-length-' + name);
    if (btn) btn.classList.toggle('is-on', name === mode);
  }
  // The From / To fields show while Custom is the choice.
  const range = document.getElementById('popup-length-range');
  if (range) range.hidden = mode !== 'custom';
  const { min, max } = customLength();
  paintField('popup-length-min', formatDuration(min));
  paintField('popup-length-max', formatDuration(max));
}

function paintRadiusModes() {
  const mode = radiusMode();
  for (const name of [...RADIUS_PRESETS, 'custom']) {
    const btn = document.getElementById('popup-radius-' + name);
    if (btn) btn.classList.toggle('is-on', name === mode);
  }
  const range = document.getElementById('popup-radius-range');
  if (range) range.hidden = mode !== 'custom';
  const km = customRadius();
  paintField('popup-radius-km', km == null ? '' : String(km));
}

// A field shows its saved value, except while it is being typed in.
function paintField(id, value) {
  const field = document.getElementById(id);
  if (!field || document.activeElement === field) return;
  field.value = value;
  markField(field, false);
}

// The outline (the field's label) turns red for text that is not a
// length or a distance.
function markField(field, bad) {
  const box = field.closest('.popup-settings-field') || field;
  box.classList.toggle('is-invalid', bad);
}

// Custom length / distance fields: saved as they are typed when they read
// as a length or a distance (empty is an open end), tidied on leaving.
function bindCustomFields() {
  const min = document.getElementById('popup-length-min');
  const max = document.getElementById('popup-length-max');
  const note = document.getElementById('popup-length-note');
  const saveLength = (tidy) => {
    const lo = parseDuration(min.value);
    const hi = parseDuration(max.value);
    markField(min, Number.isNaN(lo));
    markField(max, Number.isNaN(hi));
    const bad = Number.isNaN(lo) || Number.isNaN(hi);
    if (note) note.classList.toggle('is-invalid', bad);
    if (bad) return;
    const saved = setCustomLength(lo, hi);
    if (tidy) {
      min.value = formatDuration(saved.min);
      max.value = formatDuration(saved.max);
    }
  };
  for (const field of [min, max]) {
    if (!field) continue;
    field.addEventListener('input', () => saveLength(false));
    field.addEventListener('change', () => saveLength(true));
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        field.blur();
      }
    });
  }
  const km = document.getElementById('popup-radius-km');
  if (km) {
    const saveKm = (tidy) => {
      const value = parseKm(km.value);
      const bad = Number.isNaN(value) || value === 0;
      markField(km, bad);
      if (bad) return;
      const saved = setCustomRadius(value);
      if (tidy) km.value = saved == null ? '' : String(saved);
    };
    km.addEventListener('input', () => saveKm(false));
    km.addEventListener('change', () => saveKm(true));
    km.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        km.blur();
      }
    });
  }
}

// Custom just picked with nothing in it yet: straight to the field (a
// mouse; a phone keeps its keyboard down until the field is tapped).
function focusEmptyField(id) {
  const field = document.getElementById(id);
  if (!field || field.value) return;
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) field.focus({ preventScroll: true });
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

// ── Popup edit ───────────────────────────────────────────────────────────
// The edit composer reuses this card: same payer gate as the trash, never
// for shares, and it names the post with the created ISO + timestamp label
// delete already uses.
let popupEditBusy = false;
// The composer's key state: undefined = resolving (counter shows the inner
// size for now), null = public topic, key = E2EE (counter shows the seal).
let popupEditKey = null;

let popupPosterDraft = null;

function hideEditComposer() {
  const box = document.getElementById('popup-settings-editbox');
  if (box) box.style.display = 'none';
  popupPosterDraft = null;
  const row = document.getElementById('popup-settings-thumb');
  if (row) row.hidden = true;
}

function firstMediaUrl(value) {
  const url = Array.isArray(value) ? value[0] : value;
  return typeof url === 'string' ? url.trim() : '';
}

// A post's first picture (its image or coverimage field), as a string. A
// Hashinal link (hcs://1/<id>, Kiloscribe) reads from our route
// (hashinalurl.js), with Kiloscribe only as its fallback.
function postMediaUrl(value) {
  return resolveHashinalSrc(firstMediaUrl(value));
}

// A dot's or shape's picture: the post's cover, else the author's. A
// marker passes the author's thumbnail (avatarSrc); a polygon's fill is a
// 512 texture and keeps the full picture.
function coverImageUrl(coverimage, profileUrl) {
  const url = postMediaUrl(coverimage);
  return isValidUrl(url) ? url : profileUrl;
}

function posterHintFor(payer, created, stamp) {
  const hit = shapeEditFor(payer, created, stamp);
  if (!hit) return null;
  return { posterOff: !!hit.posterOff, posterV: hit.posterV || 0 };
}

// An E2EE topic (admin-pinned public key) takes the edit inside the seal
// the same way its create does — the new text never lands on the topic in
// the clear. The lookup is the shared one: cached per topic (5-minute
// TTL, dropped on a fresh pin), the same source the encrypted create and
// the E2EE chat use.
//   key (Uint8Array) — the topic is E2EE
//   null             — a public topic (no admin pin)
//   throws           — the lookup itself failed; the caller must NOT fall
//                      back to a plaintext edit (that is the leak).
async function resolvePopupEditKey(topicId) {
  // Dynamic on purpose: a static import here would add a
  // processallmessages → encryptedtopicchat → chatimage → uploadmedia →
  // drawpreview → web3 edge while web3 is still initializing, and
  // drawpreview's top-level bindAccount() reads connectedAccount → TDZ on
  // every fresh load. By the time a composer opens, the graph is fully
  // evaluated, so the runtime import is safe and adds no static edge.
  const { cachedE2eeKey, setCachedE2eeKey, lookupE2eePublicKey } = await import('./encryptedtopicchat.js');
  const cached = cachedE2eeKey(topicId);
  if (cached) return cached.key;
  const lookedUp = await lookupE2eePublicKey(topicId);
  if (lookedUp.key) {
    setCachedE2eeKey(topicId, lookedUp.key, lookedUp.keyCreated);
    return lookedUp.key;
  }
  return null;
}

// crypto_box_seal is a fixed 48-byte overhead and to_base64 is unpadded,
// so the sealed outgoing size is known before encrypting — the counter
// runs without a crypto round-trip (same trick as the E2EE chat edit).
function sealedEditOutgoing(body) {
  const bytes = 48 + utf8ByteLength(JSON.stringify(body));
  const mod = bytes % 3;
  const b64 = Math.floor(bytes / 3) * 4 + (mod === 1 ? 2 : mod === 2 ? 3 : 0);
  return JSON.stringify({ ciphertext: 'x'.repeat(b64) });
}

function paintEditButton() {
  const btn = document.getElementById('popup-settings-edit');
  if (!btn) return;
  const walk = popupSettingsTarget;
  const mine = !!(walk && signer && connectedAccount && walk.payer === connectedAccount && !walk.share);
  const named = !!(walk && ((walk.created && String(walk.created).trim() !== '')
    || (walk.authorCreated && String(walk.authorCreated).trim() !== '')));
  if (!mine || !named) {
    hideEditComposer();
    btn.style.display = 'none';
    return;
  }
  btn.style.display = 'flex';
}

// The edit names the post, not its slot: same shape as the delete payload.
function editPayload(walk, msg, poster, pins) {
  const created = messageCreated(walk.created || walk.authorCreated);
  const stamp = walk.timestamp ? String(walk.timestamp) : '';
  const fields = {};
  if (typeof msg === 'string') fields.msg = msg;
  if (Array.isArray(pins)) fields.commentPin = { tokens: pins };
  if (poster && poster.posterOff) fields.posterOff = true;
  if (poster && poster.posterV > 0) fields.posterV = Math.floor(poster.posterV);
  const polygon = walk.shape === 'polygon' || walk.kind === 'polygon';
  if (polygon) {
    if (created) fields.editPolygonCreated = created;
    if (stamp) fields.editPolygonTimestamp = stamp;
  } else {
    if (created) fields.editMarkerCreated = created;
    if (stamp) fields.editMarkerTimestamp = stamp;
  }
  return polygon
    ? { polygon: { data: fields } }
    : { marker: { data: fields } };
}

// The edit's size as savePopupEdit sends it: the same cleaning, and on an
// E2EE topic the SEAL — what actually goes on the topic.
function editBytesNow() {
  const text = document.getElementById('popup-settings-edit-text');
  const walk = popupSettingsTarget;
  if (!text || !walk) return 0;
  const cleaned = normalizeMessageNewlines(text.value).trim();
  const body = editPayload(walk, cleaned, popupPosterDraft, undefined);
  const outgoing = popupEditKey ? sealedEditOutgoing(body) : JSON.stringify(body);
  return utf8ByteLength(outgoing);
}

function paintEditBytes() {
  const counter = document.getElementById('popup-settings-edit-bytes');
  const save = document.getElementById('popup-settings-edit-save');
  const text = document.getElementById('popup-settings-edit-text');
  const walk = popupSettingsTarget;
  if (!counter || !text || !walk) return;
  const usage = formatHcsUsage(editBytesNow());
  counter.textContent = usage.text;
  counter.classList.toggle('hcs-warn', usage.warn);
  counter.classList.toggle('hcs-over', usage.over);
  if (save) save.classList.toggle('hcs-send-blocked', usage.over);
}

function openEditComposer() {
  const walk = popupSettingsTarget;
  if (!walk || walk.share || !signer || !connectedAccount || walk.payer !== connectedAccount) return;
  const box = document.getElementById('popup-settings-editbox');
  const text = document.getElementById('popup-settings-edit-text');
  if (!box || !text) return;
  const created = messageCreated(walk.created || walk.authorCreated);
  if (!created) return;
  // Prefill from the open post card, so the composer shows what is on screen.
  let current = '';
  const shown = document.querySelector(
    `.popup-sheet[data-popup-payer="${walk.payer}"][data-view-created="${created}"] p.popup-text-bubble`
  );
  if (shown) current = shown.textContent;
  text.value = current;
  hideEditComposer();
  box.style.display = 'block';
  popupPosterDraft = null;
  const thumbRow = document.getElementById('popup-settings-thumb');
  const videoUrl = firstMediaUrl(walk.image);
  const video = !!(videoUrl && resolveMediaUrl(videoUrl).kind === 'video');
  if (thumbRow) thumbRow.hidden = !video;
  if (video && thumbRow && !thumbRow.dataset.bound) {
    thumbRow.dataset.bound = '1';
    const pick = document.getElementById('popup-settings-thumb-pick');
    const drop = document.getElementById('popup-settings-thumb-clear');
    if (pick) pick.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const { openCoverImagePicker, prepareThumbFile } = await import('./uploadmedia.js');
      const picked = await openCoverImagePicker();
      if (!picked) return;
      const file = await prepareThumbFile(picked);
      if (!file) {
        toast.error('Could not read that picture');
        return;
      }
      popupPosterDraft = { mode: 'custom', file };
      paintEditBytes();
    });
    if (drop) drop.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      popupPosterDraft = { mode: 'clear', file: null };
      paintEditBytes();
    });
  }
  // Is this an E2EE topic? Resolve in the background — the counter re-paints
  // with the sealed size once the admin pin is known (or stays plain).
  popupEditKey = undefined;
  paintEditBytes();
  if (walk.topicId) {
    resolvePopupEditKey(walk.topicId).then((key) => {
      if (popupSettingsTarget !== walk) return;
      popupEditKey = key;
      paintEditBytes();
    }).catch(() => {
      // Stays "resolving" — save re-resolves and refuses on failure.
    });
  }
}

async function savePopupEdit() {
  if (popupEditBusy) return;
  const walk = popupSettingsTarget;
  if (!walk || walk.share || !signer || !connectedAccount || walk.payer !== connectedAccount) return;
  const text = document.getElementById('popup-settings-edit-text');
  const save = document.getElementById('popup-settings-edit-save');
  if (!text) return;
  const cleaned = normalizeMessageNewlines(text.value).trim();
  if (!cleaned) {
    toast.error('Text is empty');
    return;
  }
  if (save && save.classList.contains('hcs-send-blocked')) {
    toast.error(HCS_TOO_LONG);
    return;
  }
  const created = messageCreated(walk.created || walk.authorCreated);
  const stamp = walk.timestamp ? String(walk.timestamp) : '';
  if ((!created && !stamp) || !walk.topicId) {
    toast.error('This post cannot be edited');
    return;
  }
  let poster = null;
  const videoUrl = firstMediaUrl(walk.image);
  if (popupPosterDraft && popupPosterDraft.mode === "clear") poster = { posterOff: true };
  if (popupPosterDraft && popupPosterDraft.mode === "custom" && popupPosterDraft.file) {
    poster = { posterV: Date.now() };
  }
  const body = editPayload(walk, cleaned, poster, undefined);
  popupEditBusy = true;
  try {
    if (poster && videoUrl) {
      const { replaceVideoPoster } = await import('./uploadmedia.js');
      try {
        await replaceVideoPoster(videoUrl, poster.posterOff ? null : popupPosterDraft.file);
      } catch (error) {
        console.error('poster edit failed', error);
        toast.error('Thumbnail was not saved');
        return;
      }
    }
    // E2EE topic: the edit rides inside the seal, the same way the create
    // does — the new text must not land on the topic in the clear. A
    // failed lookup aborts; it must never fall back to plaintext.
    let key = null;
    try {
      key = await resolvePopupEditKey(walk.topicId);
    } catch (error) {
      console.error('popup edit key lookup failed', error);
      toast.error('Could not check the topic key — edit not sent');
      return;
    }
    if (key) {
      const outgoing = JSON.stringify(await encryptMessage(JSON.stringify(body), key));
      if (utf8ByteLength(outgoing) > HCS_MESSAGE_MAX_BYTES) {
        toast.error(HCS_TOO_LONG);
        return;
      }
      toast.info('Confirm in wallet 👛');
      await sendMessage(walk.topicId, outgoing);
    } else {
      // Public topic — the existing plaintext path, unchanged.
      toast.info('Confirm in wallet 👛');
      await sendMessage(walk.topicId, JSON.stringify(body));
    }
    toast.success('Saved');
    // Apply locally right away; the topic stream confirms the same edit.
    const sent = (body.marker || body.polygon).data;
    const sentAt = new Date().toISOString();
    if (typeof sent.msg === 'string') rememberShapeEdit(connectedAccount, sent, sentAt);
    rememberCommentPin(connectedAccount, sent, sentAt);
    hideEditComposer();
  } catch (error) {
    console.error('popup edit failed', error);
    toast.error('Edit was not saved');
  } finally {
    popupEditBusy = false;
  }
}

// The NFT-utility pin field edits the post whose comments are open, or else
// the post in the open map popup (the settings target when that popup is gone).
function asPinWalk(post) {
  if (!post || !post.payer) return null;
  const created = post.created || post.authorCreated || '';
  return {
    payer: post.payer,
    created,
    authorCreated: post.authorCreated || created,
    timestamp: post.timestamp || post.stamp || '',
    commentPin: post.commentPin != null ? post.commentPin : post.base,
    topicId: post.topicId,
    kind: post.kind || post.shape || 'marker',
    shape: post.shape || post.kind || 'marker',
    share: post.share || null,
  };
}

function openMapPopupSection() {
  if (typeof document === 'undefined' || !document.querySelectorAll) return null;
  const popups = document.querySelectorAll('.maplibregl-popup');
  for (const popup of popups) {
    if (!popup.isConnected) continue;
    if (popup.closest && popup.closest('#popup-settings-card')) continue;
    const section = popup.querySelector('.popup-comments');
    if (!section || !section._pinPost || !section._pinPost.payer) continue;
    if (commentsModal && commentsModal.contains(section) && commentsModalSection && section !== commentsModalSection) continue;
    return section;
  }
  return null;
}

function utilityPinWalk() {
  if (commentsModal && commentsModalSection && commentsModalSection._pinPost && commentsModalSection._pinPost.payer) {
    return asPinWalk(commentsModalSection._pinPost);
  }
  const section = openMapPopupSection();
  if (section) return asPinWalk(section._pinPost);
  if (popupSettingsTarget && popupSettingsTarget.payer) return asPinWalk(popupSettingsTarget);
  return null;
}

function pinWalkOwned(walk) {
  return !!(walk && signer && connectedAccount && walk.payer === connectedAccount && !walk.share);
}

function pinWalkKey(walk, owned) {
  if (!walk) return '';
  return [walk.payer, walk.created || '', walk.timestamp || '', walk.topicId || '', owned ? '1' : '0'].join('|');
}

let utilityPinKey = '';
let utilityPinBusy = false;

function paintUtilityPin() {
  const field = document.getElementById('input-field-comment-pin');
  const save = document.getElementById('submit-button-comment-pin');
  const hint = document.getElementById('comment-pin-utility-hint');
  if (!field || !save) return;
  const walk = utilityPinWalk();
  const owned = pinWalkOwned(walk);
  const key = pinWalkKey(walk, owned);
  field.disabled = !owned;
  save.disabled = !owned;
  if (hint) hint.hidden = owned;
  if (key === utilityPinKey) return;
  utilityPinKey = key;
  const tokens = walk
    ? commentPinFor(walk.payer, walk.created || walk.authorCreated, walk.timestamp, walk.commentPin)
    : [];
  field.value = tokens.join(', ');
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

function sameTokenList(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function applyOpenCommentPin(walk) {
  const section = commentsModalSection;
  if (!section || typeof section._applyPin !== 'function' || !section._pinPost || !walk) return;
  const post = section._pinPost;
  if (post.payer !== walk.payer) return;
  const created = messageCreated(post.created);
  const walkCreated = messageCreated(walk.created || walk.authorCreated);
  const stamp = post.stamp != null ? String(post.stamp) : '';
  const walkStamp = walk.timestamp != null ? String(walk.timestamp) : '';
  if ((created && walkCreated && created === walkCreated) || (stamp && walkStamp && stamp === walkStamp)) {
    section._applyPin();
  }
}

async function saveUtilityPin() {
  if (utilityPinBusy) return;
  const field = document.getElementById('input-field-comment-pin');
  const walk = utilityPinWalk();
  const owned = pinWalkOwned(walk);
  if (!field || !owned) return;
  if (pinWalkKey(walk, owned) !== utilityPinKey) {
    paintUtilityPin();
    return;
  }
  const plan = planCommentPinEdit(field.value, true);
  if (!plan.ok) {
    if (plan.reason === 'invalid') toast.error('Enter collection ids like 0.0.123');
    else if (plan.reason === 'many') toast.error('Up to 5 collections');
    return;
  }
  if (plan.tokens.length) {
    const check = await validatePinTokens(plan.tokens);
    if (!check.ok) {
      toast.error(`${check.token}: ${check.reason}`);
      return;
    }
  }
  const current = commentPinFor(walk.payer, walk.created || walk.authorCreated, walk.timestamp, walk.commentPin);
  if (sameTokenList(current, plan.tokens)) return;
  const created = messageCreated(walk.created || walk.authorCreated);
  const stamp = walk.timestamp ? String(walk.timestamp) : '';
  if ((!created && !stamp) || !walk.topicId) {
    toast.error('This post cannot be edited');
    return;
  }
  const body = editPayload(walk, undefined, null, plan.tokens);
  utilityPinBusy = true;
  try {
    let key = null;
    try {
      key = await resolvePopupEditKey(walk.topicId);
    } catch (error) {
      console.error('popup edit key lookup failed', error);
      toast.error('Could not check the topic key — edit not sent');
      return;
    }
    if (key) {
      const outgoing = JSON.stringify(await encryptMessage(JSON.stringify(body), key));
      if (utf8ByteLength(outgoing) > HCS_MESSAGE_MAX_BYTES) {
        toast.error(HCS_TOO_LONG);
        return;
      }
      toast.info('Confirm in wallet 👛');
      await sendMessage(walk.topicId, outgoing);
    } else {
      toast.info('Confirm in wallet 👛');
      await sendMessage(walk.topicId, JSON.stringify(body));
    }
    toast.success('Saved');
    const sent = (body.marker || body.polygon).data;
    const sentAt = new Date().toISOString();
    rememberCommentPin(connectedAccount, sent, sentAt);
    applyOpenCommentPin(walk);
  } catch (error) {
    console.error('comment pin edit failed', error);
    toast.error('Edit was not saved');
  } finally {
    utilityPinBusy = false;
  }
}

{
  const pinSave = document.getElementById('submit-button-comment-pin');
  if (pinSave) pinSave.addEventListener('click', (event) => {
    event.stopPropagation();
    saveUtilityPin();
  });
  const utilityColumn = document.getElementById('utility-column');
  if (utilityColumn) utilityColumn.addEventListener('pointerdown', () => paintUtilityPin(), true);
  paintUtilityPin();
}

// The post popup hides its own × while settings is open, like comments-open.
let settingsHistoryOpen = false;
function syncSettingsOpen() {
  const card = document.getElementById('popup-settings-card');
  const open = !!(card && card.style.display === 'block');
  // Back/Forward: every close path (‹, backdrop, CloseALL, a map tap)
  // ends in display:none, so the transition out of open is the single
  // history funnel. Opening reports itself in openPopupSettings.
  if (open !== settingsHistoryOpen) {
    settingsHistoryOpen = open;
    if (!open) layerClosedByUI('popupsettings');
  }
  document.querySelectorAll('.maplibregl-popup').forEach((popup) => {
    if (card && card.contains(popup)) return;
    popup.classList.toggle('settings-open', open);
  });
}

// The settings header is the post popup's own top row, so the press that
// opened settings is where it closes again: the ‹ takes the place and size
// of the gear that opened it, the trash the ×'s seat, and the pencil the
// seat left of the × (the ← back to the feed, when that is showing), all
// at the gear's size; the title's text sits on the same line. The popup
// is still laid out under the card (its × and ← only turn invisible), so
// its boxes are read again after a resize. With no gear on screen
// (Forward into settings with the popup gone) everything keeps its CSS
// place.
const SETTINGS_HEAD_PROPS = ['top', 'left', 'right', 'width', 'height', 'min-width', 'min-height'];
function settingsGearOnScreen() {
  const usable = (gear) => !!gear && gear.isConnected
    && !gear.closest('#popup-settings-card, #popup-settings-preview, #draw-column')
    && gear.getBoundingClientRect().width > 0;
  if (usable(popupSettingsGearEl)) return popupSettingsGearEl;
  return [...document.querySelectorAll('.maplibregl-popup .popup-settings-gear')].find(usable) || null;
}

function clearSettingsSeat(el) {
  if (!el) return;
  for (const prop of SETTINGS_HEAD_PROPS) el.style.removeProperty(prop);
  const icon = el.querySelector('svg');
  if (icon) {
    icon.style.removeProperty('width');
    icon.style.removeProperty('height');
  }
}

// Centre el on (cx, cy) at w × h, the icon at iw × ih. Its left/top count
// from its own containing block (portrait: the card's padding box;
// landscape: a grid area), read off el itself, so either one and the
// card's scroll hold. Sizes come from layout: the press squeeze and the
// gear's spin are transforms, and only box centres are read.
function seatSettingsButton(el, cx, cy, w, h, iw, ih) {
  if (!el) return;
  const b = el.getBoundingClientRect();
  if (!(b.width > 0)) return;
  const s = getComputedStyle(el);
  const bw = el.offsetWidth || b.width;
  const bh = el.offsetHeight || b.height;
  const originX = b.left + b.width / 2 - bw / 2 - (parseFloat(s.left) || 0) - (parseFloat(s.marginLeft) || 0);
  const originY = b.top + b.height / 2 - bh / 2 - (parseFloat(s.top) || 0) - (parseFloat(s.marginTop) || 0);
  const set = (prop, value) => el.style.setProperty(prop, value, 'important');
  set('top', (cy - h / 2 - originY).toFixed(2) + 'px');
  set('left', (cx - w / 2 - originX).toFixed(2) + 'px');
  set('right', 'auto');
  set('width', w + 'px');
  set('min-width', w + 'px');
  set('height', h + 'px');
  set('min-height', h + 'px');
  const icon = el.querySelector('svg');
  if (icon && iw > 0) {
    icon.style.setProperty('width', iw + 'px', 'important');
    icon.style.setProperty('height', ih + 'px', 'important');
  }
}

function placeSettingsHead() {
  const card = document.getElementById('popup-settings-card');
  if (!card) return;
  const back = card.querySelector(':scope > .comments-back-button');
  const edit = document.getElementById('popup-settings-edit');
  const trash = document.getElementById('popup-settings-delete');
  const title = card.querySelector('.options-column-title');
  // The keyboard pins the card to the visible area (keyboardlayout.js);
  // the row keeps its place in the card until that ends.
  if (card.dataset.kbPin === '1') return;
  const gear = card.style.display === 'block' ? settingsGearOnScreen() : null;
  if (!gear) {
    for (const el of [back, edit, trash]) clearSettingsSeat(el);
    if (title) {
      title.style.removeProperty('margin-top');
      title.style.removeProperty('translate');
    }
    return;
  }
  const g = gear.getBoundingClientRect();
  const w = gear.offsetWidth || g.width;
  const h = gear.offsetHeight || g.height;
  const cy = g.top + g.height / 2;
  const glyph = gear.querySelector('svg');
  const iw = glyph ? glyph.clientWidth : 0;
  const ih = glyph ? glyph.clientHeight : 0;
  seatSettingsButton(back, g.left + g.width / 2, cy, w, h, iw, ih);
  const content = gear.closest('.maplibregl-popup-content');
  const shown = (el) => {
    const r = el && el.getBoundingClientRect();
    return r && r.width > 0 ? r : null;
  };
  const close = shown(content && content.querySelector(':scope > .maplibregl-popup-close-button:not(.feed-map-back):not(.comments-back-button)'));
  if (close) {
    const closeX = close.left + close.width / 2;
    seatSettingsButton(trash, closeX, cy, w, h, iw, ih);
    const feedBack = shown(content.querySelector(':scope > .maplibregl-popup-close-button.feed-map-back'));
    const editX = feedBack ? feedBack.left + feedBack.width / 2 : closeX - close.width - w * 0.12;
    seatSettingsButton(edit, editX, cy, w, h, iw, ih);
  } else {
    clearSettingsSeat(trash);
    clearSettingsSeat(edit);
  }
  // The title's text on the row's line: by its own margin, so what is
  // under it moves with it, or (landscape) by translate, since a sticky
  // title at top: 0 cannot be pulled above the top by a margin.
  if (title) {
    title.style.removeProperty('margin-top');
    title.style.removeProperty('translate');
    const range = document.createRange();
    range.selectNodeContents(title);
    const text = range.getBoundingClientRect();
    if (text.height > 0) {
      const ts = getComputedStyle(title);
      const shift = cy - (text.top + text.height / 2);
      if (ts.position === 'sticky') title.style.setProperty('translate', '0 ' + shift.toFixed(2) + 'px', 'important');
      else title.style.setProperty('margin-top', ((parseFloat(ts.marginTop) || 0) + shift).toFixed(2) + 'px', 'important');
    }
  }
}

let settingsHeadFrame = 0;
function queueSettingsHead() {
  if (settingsHeadFrame) return;
  settingsHeadFrame = requestAnimationFrame(() => {
    settingsHeadFrame = 0;
    placeSettingsHead();
  });
}

function closePopupSettings() {
  // A full-screen Edit text goes back before the card closes (fieldexpand.js).
  collapseExpandedFields();
  const backdrop = document.getElementById('popup-settings-backdrop');
  const card = document.getElementById('popup-settings-card');
  if (backdrop) backdrop.style.display = 'none';
  if (card) card.style.display = 'none';
  popupSettingsTarget = null;
  popupSettingsGearEl = null;
  hideEditComposer();
  syncSettingsOpen();
  paintUtilityPin();
}

function bindPopupSettings() {
  if (popupSettingsBound) return;
  const card = document.getElementById('popup-settings-card');
  if (!card) return;
  popupSettingsBound = true;
  // Document clicks run CloseALL, which hides this card. The trash has to
  // stay here, so a click inside the card stops there. The × still closes
  // because its own handler calls CloseALL.
  if (card) card.addEventListener('click', (event) => event.stopPropagation());
  // The × becomes the comments ‹. A clone drops its CloseALL handler.
  const oldClose = card && card.querySelector(':scope > .panel-close-btn');
  if (oldClose) {
    const back = oldClose.cloneNode(false);
    back.classList.add('comments-back-button');
    back.setAttribute('aria-label', 'Back');
    back.title = 'Back';
    back.appendChild(commentsBackChevron());
    back.addEventListener('click', (event) => {
      event.stopPropagation();
      window.openPopupSettings();
    });
    oldClose.replaceWith(back);
  }
  // CloseALL also hides the card, so watch it to clear the popup mark.
  if (card) new MutationObserver(syncSettingsOpen).observe(card, { attributes: true, attributeFilter: ['style'] });
  // The popup refits on a resize or a turn; the ‹ follows its gear.
  const followGear = () => {
    if (card && card.style.display === 'block') queueSettingsHead();
  };
  window.addEventListener('resize', followGear);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', followGear);
  for (const mode of ['account', 'time', 'random']) {
    const btn = document.getElementById('popup-pager-' + mode);
    if (!btn) continue;
    btn.addEventListener('click', () => {
      try { localStorage.setItem(PAGER_MODE_KEY, mode); } catch { /* keep it for this visit */ }
      paintPagerModes();
    });
  }
  for (const mode of ['all', 'pictures', 'videos', 'both']) {
    const btn = document.getElementById('popup-media-' + mode);
    if (!btn) continue;
    btn.addEventListener('click', () => {
      try { localStorage.setItem(MEDIA_MODE_KEY, mode); } catch { /* keep it for this visit */ }
      paintMediaModes();
    });
  }
  for (const mode of ['any', 'under', 'mid', 'over', 'custom']) {
    const btn = document.getElementById('popup-length-' + mode);
    if (!btn) continue;
    btn.addEventListener('click', () => {
      try { localStorage.setItem(LENGTH_MODE_KEY, mode); } catch { /* keep it for this visit */ }
      paintLengthModes();
      if (mode === 'custom') focusEmptyField('popup-length-min');
    });
  }
  for (const mode of [...RADIUS_PRESETS, 'custom']) {
    const btn = document.getElementById('popup-radius-' + mode);
    if (!btn) continue;
    btn.addEventListener('click', () => {
      setRadiusMode(mode);
      paintRadiusModes();
      if (mode === 'custom') focusEmptyField('popup-radius-km');
    });
  }
  bindCustomFields();
  const del = document.getElementById('popup-settings-delete');
  if (del) del.addEventListener('click', (event) => {
    event.stopPropagation();
    deletePopupTarget();
  });
  const edit = document.getElementById('popup-settings-edit');
  if (edit) edit.addEventListener('click', (event) => {
    event.stopPropagation();
    openEditComposer();
  });
  const editText = document.getElementById('popup-settings-edit-text');
  if (editText) {
    // Typing stops at 18 KB.
    capMessageField(editText, editBytesNow);
    editText.addEventListener('input', () => paintEditBytes());
  }
  const editSave = document.getElementById('popup-settings-edit-save');
  if (editSave) editSave.addEventListener('click', (event) => {
    event.stopPropagation();
    savePopupEdit();
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
      placePopupSettingsButtons();
      paintPagerModes();
      paintMediaModes();
      paintLengthModes();
      paintRadiusModes();
      paintDeleteButton();
      hideEditComposer();
      paintEditButton();
      paintUtilityPin();
      backdrop.style.display = "block";
      card.style.display = "block";
      // Back/Forward: the card is a layer on top of the post popup.
      layerOpened('popupsettings', { target: popupSettingsTarget || {} });
      syncSettingsOpen();
      refitPopups();
      // After the refit, so the gear is measured where it now sits.
      queueSettingsHead();
      removeUfoModel();
    }
  });
};
// Back/Forward: the history close handler needs the same funnel the ‹ uses.
window.closePopupSettings = closePopupSettings;

if (window.defineLayer) {
  window.defineLayer('comments', {
    open: (state) => {
      if (state && state.sectionId) openCommentsModal(state.sectionId);
    },
    close: () => closeCommentsModal(),
  });
  window.defineLayer('popupsettings', {
    open: (state) => window.openPopupSettings(state && state.target && state.target.payer != null ? state.target : undefined),
    close: () => closePopupSettings(),
  });
}

function payerHasLike(actions, timestamp, type) {
  const row = actions && actions.get(timestamp);
  if (!row || !connectedAccount) return false;
  const mine = row.get(connectedAccount);
  return !!(mine && mine.type === type);
}

let heartLikeSeq = 0;

const reactionViews = new Map();

function reactionNodes(key) {
  if (!key || !document.querySelectorAll) return [];
  const escaped = window.CSS && CSS.escape ? CSS.escape(key) : String(key).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return document.querySelectorAll(`[data-sync="${escaped}"]`);
}

function savedHeart(key, count, liked) {
  const total = Number(count) || 0;
  const saved = key ? reactionViews.get(key) : null;
  if (!saved || saved.comment) return { total, liked: !!liked };
  if (!!liked === !!saved.liked && total === saved.total) {
    reactionViews.delete(key);
    return { total, liked: !!liked };
  }
  return { total: saved.total, liked: !!saved.liked };
}

function writeCount(label, count, next) {
  label.dataset.count = String(count);
  label.dataset.next = String(next);
  label.dataset.countText = formatCount(count);
  label.dataset.nextText = formatCount(next);
}

// The name a screen reader reads: what the control is and the count its
// label shows right now (a checked label shows data-next).
function writeAria(input, label, kind) {
  const n = Number(input.checked ? label.dataset.next : label.dataset.count) || 0;
  let name;
  if (kind === 'replies') name = `Replies, ${n}`;
  else if (kind === 'share') name = `Share, ${n} ${n === 1 ? 'share' : 'shares'}`;
  else name = `Like, ${n} ${n === 1 ? 'like' : 'likes'}`;
  input.setAttribute('aria-label', name);
}

function applyHeartView(node, total, liked) {
  const input = node.querySelector('input');
  const label = node.querySelector('label');
  if (!input || !label) return;
  const base = liked ? Math.max(0, total - 1) : total;
  writeCount(label, base, base + 1);
  input.checked = !!liked;
  writeAria(input, label, node.classList.contains('share-bubble') ? 'share' : 'like');
}

function publishHeart(key, total, liked) {
  if (!key) return;
  reactionViews.set(key, { total, liked: !!liked });
  reactionNodes(key).forEach((node) => applyHeartView(node, total, !!liked));
}

function publishComment(key, count) {
  const total = Number(count) || 0;
  if (!key) return;
  reactionViews.set(key, { total, comment: true });
  reactionNodes(key).forEach((node) => {
    const label = node.querySelector('label');
    if (!label) return;
    writeCount(label, total, total);
    const input = node.querySelector('input');
    if (input) writeAria(input, label, 'replies');
  });
}

function createHeartLike({ count, liked, mini, className, onToggle, syncKey }) {
  const view = savedHeart(syncKey, count, liked);
  const total = view.total;
  const on = view.liked;
  const base = on ? Math.max(0, total - 1) : total;
  const root = document.createElement('div');
  root.className = mini ? 'heart-like heart-like-mini' : 'heart-like';
  if (className) root.className += ' ' + className;
  if (syncKey) root.dataset.sync = syncKey;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = `heart-like-${++heartLikeSeq}`;
  input.checked = on;
  const label = document.createElement('label');
  label.htmlFor = input.id;
  writeCount(label, base, base + 1);
  const kind = className === 'share-bubble' ? 'share' : 'like';
  writeAria(input, label, kind);
  label.appendChild(document.createElement('span'));
  root.appendChild(input);
  root.appendChild(label);
  root.addEventListener('click', (event) => event.stopPropagation());
  let busy = false;
  input.addEventListener('change', async () => {
    // The toggle flips the shown count (data-next while checked).
    writeAria(input, label, kind);
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
        writeAria(input, label, kind);
        root.classList.remove('is-pop', 'is-down');
      } else if (syncKey) {
        const baseNow = Number(label.dataset.count) || 0;
        publishHeart(syncKey, wantLike ? baseNow + 1 : baseNow, wantLike);
      }
    } catch {
      input.checked = !wantLike;
      writeAria(input, label, kind);
      root.classList.remove('is-pop', 'is-down');
    }
    busy = false;
  });
  return root;
}

let commentBubbleInput = null;
let commentsClosing = false;

function createCommentBubble({ count, mini, onToggle, syncKey }) {
  const total = Number(count) || 0;
  const root = document.createElement('div');
  root.className = mini ? 'heart-like heart-like-mini comment-bubble' : 'heart-like comment-bubble';
  if (syncKey) root.dataset.sync = syncKey;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = `comment-bubble-${++heartLikeSeq}`;
  const label = document.createElement('label');
  label.htmlFor = input.id;
  writeCount(label, total, total);
  writeAria(input, label, 'replies');
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

function createShareBubble({ count, shared, onToggle, syncKey }) {
  return createHeartLike({
    count,
    liked: shared,
    className: 'share-bubble',
    onToggle,
    syncKey,
  });
}

function reactionHost() {
  let host = document.getElementById('post-reaction-host');
  if (host) return host;
  host = document.createElement('div');
  host.id = 'post-reaction-host';
  host.hidden = true;
  document.body.appendChild(host);
  return host;
}

// Handed to buildCommentsSection for the one call that builds the section.
// The section's argument list stays as it is.
let pendingCommentPinPost = null;

function commentPinPostOf(data, kind) {
  const polygon = kind === 'polygon' || (data && (data.kind === 'polygon' || data.shape === 'polygon'));
  return {
    payer: data && data.payer,
    created: data && data.created,
    stamp: data && data.timestamp,
    base: data && data.commentPin,
    topicId: data && data.topicId,
    kind: polygon ? 'polygon' : 'marker',
    share: (data && data.share) || null,
  };
}

function ensurePostComments(data, kind, id, comments, syncKey) {
  const pinPost = commentPinPostOf(data, kind);
  const existing = document.getElementById(id);
  if (existing) {
    existing._pinPost = pinPost;
    if (syncKey) existing._commentSync = syncKey;
    if (typeof existing._setComments === 'function') existing._setComments(comments || []);
    return existing;
  }
  const polygon = kind === 'polygon';
  pendingCommentPinPost = pinPost;
  const section = buildCommentsSection(
    id,
    comments,
    // media (optional): the uploaded comment media's URL or { image }.
    (input, media) => polygon
      ? window.sendPolygonComment(data.timestamp, data.topicId, input, media)
      : window.sendMarkerComment(data.timestamp, data.topicId, input, media),
    (parentId, input, media) => polygon
      ? window.sendPolygonReply(data.timestamp, parentId, data.topicId, input, media)
      : window.sendMarkerReply(data.timestamp, parentId, data.topicId, input, media),
    data.topicId,
    polygon ? 'polygon' : 'marker',
    syncKey,
    // The post's own timestamp: the edit and delete helpers name it.
    data.timestamp,
  );
  reactionHost().appendChild(section);
  return section;
}

function adoptComments(section, host) {
  if (!section || !host || section.closest('.comments-modal')) return;
  // The popup sheet is still detached when the card is built, so it is not
  // inside .maplibregl-popup yet. A feed card is never a .popup-sheet.
  const hostInPopup = host.closest && host.closest('.maplibregl-popup');
  const hostIsMapSheet = !!(host.classList && host.classList.contains('popup-sheet') && !(host.closest && host.closest('#feed-layout')));
  if (hostInPopup || hostIsMapSheet) {
    if (section.closest('#feed-layout') || section.closest('.maplibregl-popup')) return;
    host.appendChild(section);
    section._homeParent = host;
    delete section._park;
    return;
  }
  if (section.closest('.maplibregl-popup')) return;
  host.appendChild(section);
  section._park = host;
  section._homeParent = host;
}

// Copies the same deep link the notifications "Open on the map" uses:
// place, payer, n, and at name the original place (for a shared pin, the
// original place's payer and stored pin — the same data the share uses).
function copyPostLink(source) {
  const url = placeUrl({
    kind: source && source.kind === 'polygon' ? 'polygon' : 'marker',
    topicId: source && source.topicId,
    payer: source && source.payer,
    number: source && source.number,
    cord: source && source.coords,
  });
  copyTextToClipboard(url)
    .then(() => toast.success('Link copied'))
    .catch(() => toast.error('Could not copy the link'));
}

function copySourceOf(data, payer, copyKind) {
  const coords = data && (data.coordinates || data.coords);
  const ring = Array.isArray(coords) && Array.isArray(coords[0]);
  const kind = copyKind === 'polygon' || (data && data.kind === 'polygon') || ring ? 'polygon' : 'marker';
  const number = kind === 'polygon'
    ? (data && data.polygonnumber != null ? data.polygonnumber : data && data.markernumber)
    : (data && data.markernumber != null ? data.markernumber : data && data.polygonnumber);
  return {
    kind,
    topicId: data && data.topicId,
    payer: (data && data.payer) || payer,
    number,
    coords: kind === 'polygon' ? ((data && data.coordinates) || coords) : ((data && data.coords) || coords),
  };
}

// Same heart, comment, and share controls the marker and polygon popups use.
export function mountPostReactions(cluster, data, kind, home) {
  const polygon = kind === 'polygon';
  const timestamp = data && data.timestamp;
  const topicId = data && data.topicId;
  if (!cluster || !timestamp || !topicId) return null;
  const sync = (polygon ? 'polygon|' : 'marker|') + topicId + '|' + timestamp;
  const comments = Array.isArray(data.comments) ? data.comments : [];
  const commentsId = (polygon ? 'polygon-comments-' : 'marker-comments-') + topicId + '-' + timestamp;
  const commentCount = Number.isFinite(data.commentsCount) ? data.commentsCount : countAllMessages(comments);
  const shareSource = {
    kind: polygon ? 'polygon' : 'marker',
    topicId,
    created: data.created,
    payer: data.payer,
    coords: polygon ? data.coordinates : data.coords,
    number: polygon ? data.polygonnumber : data.markernumber,
    timestamp,
  };
  // Heart, comment, and share. Copy link stays on the post menu.
  cluster.appendChild(createHeartLike({
    count: polygon ? data.likeCountPolygon : data.likeCountMarker,
    liked: data.likedByMe,
    syncKey: 'like|' + sync,
    onToggle: (wantLike) => polygon
      ? window.likePolygon(timestamp, topicId, !wantLike)
      : window.likeMarker(timestamp, topicId, !wantLike),
  }));
  const bubble = createCommentBubble({
    count: commentCount,
    syncKey: 'comment|' + sync,
    onToggle: (open) => {
      if (open && bubble.closest('#feed-layout') && typeof window.holdFeedScroll === 'function') {
        window.holdFeedScroll();
      }
      let section = document.getElementById(commentsId);
      if (open && !section) {
        section = ensurePostComments(data, polygon ? 'polygon' : 'marker', commentsId, comments, 'comment|' + sync);
        if (home && section) adoptComments(section, home);
      }
      if (section) {
        section._bubbleInput = bubble.querySelector('input');
        section._openerAnchor = bubble.closest('.popup-sheet') || bubble.closest('#feed-layout');
      }
      return toggleCommentsBubble(open, commentsId);
    },
  });
  cluster.appendChild(bubble);
  publishComment('comment|' + sync, commentCount);
  const shareStateNow = shownShareState(data, topicId, timestamp);
  cluster.appendChild(createShareBubble({
    count: shareStateNow.count,
    shared: shareStateNow.mine,
    syncKey: 'share|' + sync,
    onToggle: async (wantShare) => {
      if (wantShare) return confirmShare(shareSource);
      const ok = await unshareFromMyTopic(shareSource);
      if (ok) dropSharePin(shareSource);
      return ok;
    },
  }));
  const section = ensurePostComments(data, polygon ? 'polygon' : 'marker', commentsId, comments, 'comment|' + sync);
  if (section && !section._bubbleInput) section._bubbleInput = bubble.querySelector('input');
  if (home && section) adoptComments(section, home);
  return section;
}

// Same video check the popup uses on the Image field. An array is the
// first entry, the way a polygon popup reads image[0].
export function mediaKind(value) {
  const url = Array.isArray(value) ? value[0] : value;
  if (typeof url !== 'string' || !isValidUrl(url)) return 'none';
  return resolveMediaUrl(url).kind === 'video' ? 'video' : 'picture';
}

// Phone swipe and keyboard arrows share one pager. A mouse drag is a text
// selection, so it never turns the page. Left is the previous message,
// right is the next one, matching the ← → chips. A swipe on the picture,
// GIF, or video uses that same prev/next.
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

// A delete names the post's created time or timestamp. A legacy number
// delete does not hide a later reuse of that slot. The number list still
// keeps one live drawing from being added twice.
function rememberShapeDelete(owner, numbersKey, data) {
  if (!owner || !data) return;
  const marker = numbersKey === 'numberOfMarker';
  // Number deletes are legacy. Only created + timestamp hide a post.
  const createdKey = marker ? 'deleteMarkerCreated' : 'deletePolygonCreated';
  const stampKey = marker ? 'deleteMarkerTimestamp' : 'deletePolygonTimestamp';
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

// ── Shape edits ──────────────────────────────────────────────────────────
// HCS messages are immutable, so an edit is a new message that points at
// the original (editMarkerCreated / editMarkerTimestamp) and carries the
// new body text (msg). Only the original payer's own edits count, and the
// latest edit wins. The same created + stamp labels delete uses name the
// post, so a fresh reload that replays history shows the edited text too.
const shapeEditsByCreated = new Map(); // `${payer}|${createdIso}` → { msg, at }
const shapeEditsByStamp = new Map();   // `${payer}|${stampLabel}`  → { msg, at }

export function shapeEditFor(payer, created, stamp) {
  if (!payer) return null;
  const iso = messageCreated(created);
  if (iso) {
    const hit = shapeEditsByCreated.get(`${payer}|${iso}`);
    if (hit) return hit;
  }
  if (stamp != null && String(stamp).trim() !== '') {
    return shapeEditsByStamp.get(`${payer}|${String(stamp)}`) || null;
  }
  return null;
}

function editedMsg(fallback, payer, created, stamp) {
  const hit = shapeEditFor(payer, created, stamp);
  return hit ? hit.msg : fallback;
}

function hasShapeEdit(payer, created, stamp) {
  return !!shapeEditFor(payer, created, stamp);
}

// Returns the stored edit when this one is the latest seen, else null.
export function rememberShapeEdit(payer, data, envelope) {
  if (!payer || !data) return null;
  const created = messageCreated(data.editMarkerCreated || data.editPolygonCreated);
  const stamp = data.editMarkerTimestamp || data.editPolygonTimestamp;
  if (!created && (stamp == null || String(stamp).trim() === '')) return null;
  let msg = data.msg;
  if (Array.isArray(msg)) msg = msg[0];
  if (typeof msg !== 'string') return null;
  const at = messageCreated(envelope) || '';
  // An edit that names a post from its own future is malformed noise.
  if (created && at && at <= created) return null;
  const slots = [];
  if (created) slots.push([shapeEditsByCreated, `${payer}|${created}`]);
  if (stamp != null && String(stamp).trim() !== '') slots.push([shapeEditsByStamp, `${payer}|${String(stamp)}`]);
  // Latest wins: an older edit arriving late never replaces a newer one.
  let newestAt = '';
  for (const [map, key] of slots) {
    const prev = map.get(key);
    if (prev && prev.at && (!newestAt || prev.at > newestAt)) newestAt = prev.at;
  }
  if (newestAt && at && at < newestAt) return null;
  let prev = null;
  for (const [map, key] of slots) {
    const hit = map.get(key);
    if (hit && (!prev || (hit.at && (!prev.at || hit.at >= prev.at)))) prev = hit;
  }
  const entry = { msg, at };
  if (data.posterOff === true || data.posterOff === 1 || data.posterOff === "1") entry.posterOff = true;
  else if (prev && prev.posterOff) entry.posterOff = true;
  const rev = Number(data.posterV);
  if (!entry.posterOff && rev > 0) entry.posterV = Math.floor(rev);
  else if (!entry.posterOff && prev && prev.posterV) entry.posterV = prev.posterV;
  for (const [map, key] of slots) map.set(key, entry);
  applyShapeEditToDom(payer, created, stamp, msg);
  return entry;
}

// A pin edit may carry no msg. It is not a shape edit and does not mark
// the post edited. The newest message from the original payer wins.
export function rememberCommentPin(payer, data, envelope) {
  const hit = storeCommentPin(payer, data, envelope);
  if (hit) repaintPinnedSections(payer, data);
  return hit;
}

export { commentPinFor };

function repaintPinnedSections(payer, data) {
  if (!payer || !data || typeof document === 'undefined' || !document.querySelectorAll) return;
  const created = messageCreated(data.editMarkerCreated || data.editPolygonCreated);
  const stampRaw = data.editMarkerTimestamp != null ? data.editMarkerTimestamp : data.editPolygonTimestamp;
  const stamp = stampRaw != null && String(stampRaw).trim() !== '' ? String(stampRaw) : '';
  for (const section of document.querySelectorAll('.popup-comments')) {
    const post = section._pinPost;
    if (!post || post.payer !== payer) continue;
    const iso = messageCreated(post.created);
    const postStamp = post.stamp != null && String(post.stamp).trim() !== '' ? String(post.stamp) : '';
    const byCreated = !!(created && iso && iso === created);
    const byStamp = !!(stamp && postStamp && postStamp === stamp);
    if (!byCreated && !byStamp) continue;
    if (typeof section._applyPin === 'function') section._applyPin();
  }
}

// A live edit rewrites the text of every open post popup for the target
// post and adds the small "edited" mark next to its timestamp.
export function applyShapeEditToDom(payer, created, stamp, msg) {
  if (!payer || typeof msg !== 'string') return;
  const iso = messageCreated(created);
  if (!iso) return;
  const containers = document.querySelectorAll(
    `.popup-sheet[data-popup-payer="${payer}"][data-view-created="${iso}"]`
  );
  for (const container of containers) {
    const text = container.querySelector('p.popup-text-bubble');
    // Through popuptext.js, so Show more and its full-screen text follow the edit.
    if (text) setPopupText(text, msg);
    const stamps = [...container.querySelectorAll('.popup-timestamp')];
    const ts = stamps.find((el) => !el.classList.contains('popup-views'));
    if (ts && !ts.querySelector('.popup-edited-mark')) {
      const mark = document.createElement('span');
      mark.className = 'popup-edited-mark';
      mark.textContent = 'edited';
      ts.appendChild(mark);
    }
  }
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

// Feed chip and popup views share one markup: bar-chart icon + numeric
// count (.feed-view-count). Updates go through setViewsCount so neither
// path wipes the icon by writing textContent on the chip root.
const VIEWS_BARS = [
  ['line', { x1: '18', x2: '18', y1: '20', y2: '10' }],
  ['line', { x1: '12', x2: '12', y1: '20', y2: '4' }],
  ['line', { x1: '6', x2: '6', y1: '20', y2: '14' }],
];

export function viewsChip(num) {
  const chip = document.createElement('span');
  chip.className = 'feed-views';
  chip.appendChild(popupStrokeIcon('', VIEWS_BARS));
  const count = document.createElement('span');
  count.className = 'feed-view-count';
  count.textContent = formatCount(num);
  // One image named by the exact count, as postcounts.js labels one: the
  // short number is what shows, "1234 views" is what is read.
  const exact = viewLabel(num);
  chip.setAttribute('role', 'img');
  chip.setAttribute('aria-label', exact);
  chip.title = exact;
  chip.appendChild(count);
  return chip;
}

export function setViewsCount(chip, num) {
  if (!chip) return;
  const count = chip.querySelector('.feed-view-count');
  if (count) count.textContent = formatCount(num);
  const exact = viewLabel(num);
  chip.setAttribute('role', 'img');
  chip.setAttribute('aria-label', exact);
  chip.title = exact;
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
          setViewsCount(node, views);
          node.classList.add('is-shown');
        });
      });
      popupViewInflight.set(key, job);
    }
  }
  setViewsCount(el, shown);
  el.classList.add('is-shown');
}

// Native controls sit on the bottom of a real video. A swipe on the picture
// still turns the page; a drag on that bar keeps seeking.
function touchOnVideoControls(e) {
  const node = e.target;
  const video = node && node.closest && node.closest('video');
  if (!video || !video.controls || video.classList.contains('loop-face')) return false;
  const box = video.getBoundingClientRect();
  if (box.height < 1) return false;
  const strip = Math.min(56, Math.max(36, box.height * 0.18));
  return e.clientY > box.bottom - strip;
}

// The page rebuilds the popup before this gesture's click arrives. That
// click would open the new post's picture. Swallow one click on the media.
function armPopupMediaClickSwallow() {
  let pending = true;
  let timer = 0;
  const swallow = (event) => {
    if (!pending) return;
    pending = false;
    document.removeEventListener('click', swallow, true);
    clearTimeout(timer);
    const target = event.target;
    if (!target || !target.closest || !target.closest('.popup-media-card')) return;
    event.preventDefault();
    event.stopPropagation();
  };
  document.addEventListener('click', swallow, true);
  timer = setTimeout(() => {
    pending = false;
    document.removeEventListener('click', swallow, true);
  }, 500);
}

function bindPopupPager(container, goPrev, goNext) {
  // A new card locks again. The pager below is unchanged.
  lockPopupXEmbeds();
  let swipeX = null;
  let swipeY = null;
  container.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    if (e.target.closest('.payer-link, .comments-modal--in-card, textarea')) return;
    if (touchOnVideoControls(e)) return;
    swipeX = e.clientX;
    swipeY = e.clientY;
  });
  container.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'touch' || swipeX === null) return;
    const dx = e.clientX - swipeX;
    const dy = e.clientY - swipeY;
    swipeX = swipeY = null;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    closeCommentsForPage(container);
    armPopupMediaClickSwallow();
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
    const active = event.target && event.target.nodeType === 1 ? event.target : document.activeElement;
    if (isTyping(active) || isTyping(document.activeElement)) return;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || active.isContentEditable)) return;
    if (document.getElementById('media-fullscreen')) return;
    const pager = latestPopupPager();
    if (!pager) return;
    event.preventDefault();
    event.stopPropagation();
    const focused = document.activeElement;
    if (focused && focused.closest && focused.closest('.maplibregl-popup')) focused.blur();
    closeCommentsForPage(pager.container);
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
  const defaultProfilePic = DEFAULT_AVATAR;
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
  const sharedMedia = mediaKind(image);
  const sharedSeconds = videoSeconds(image);
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
    media: sharedMedia,
    seconds: sharedSeconds,
    shareOf: { topic: original, created },
    properties: {
      popupData: record,
      media: sharedMedia,
      seconds: sharedSeconds,
      shareOf: { topic: original, created },
      // The dot wears the same face as the original post: its cover image,
      // else the original owner's picture — never the sharer's.
      imageUrl: isValidUrl(cover) ? cover : avatarSrc(profileUrl),
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
// The marker and polygon popups, and the feed card, share this header.
// Display name on the first line, account id on the second, the post menu
// on the right where Follow used to sit.
export function buildPopupProfile({ profileUrl, payer, payerInfo, username, click2link, donation, copyKind }) {
  const profileSection = document.createElement('div');
  profileSection.className = 'popup-profile-bubble';

  const profileImg = pictureElement(avatarSrc(profileUrl), {
    alt: 'Profile photo',
    style: 'width: calc(var(--u) * 7); height: calc(var(--u) * 7); flex-shrink: 0; border-radius: 50%; object-fit: cover; object-position: center; cursor: pointer; border: calc(var(--u) * 0.12) solid rgba(255, 255, 255, 0.25); box-shadow: 0 calc(var(--u) * 0.4) calc(var(--u) * 1) rgba(0, 0, 0, 0.45);',
  });
  profileImg.onclick = (event) => {
    event.stopPropagation();
    const popupEl = profileImg.closest('.maplibregl-popup');
    const livePopup = popupEl && !popupEl.closest('#popup-settings-card, #popup-settings-preview, #draw-column');
    // Cover the popup. Do not click ×: that drops its history entry, and
    // Back from the profile would land on the bare map.
    if (livePopup && window.coverPopupsForPage) window.coverPopupsForPage(popupEl);
    if (window.openProfileFromPopup && window.openProfileFromPopup(payer)) return;
    if (livePopup && window.restorePopupsForPage) window.restorePopupsForPage();
    loadBio4PIC(payer);
  };
  watchFollowPrefetch(profileImg, payer);
  profileSection.appendChild(profileImg);
  paintProfileAvatar(profileImg, payer);
  watchProfilePicture(profileImg);

  const headerDiv = document.createElement('div');
  const h2 = document.createElement('h2');

  const trimmedUsername = String(username || '').trim();
  if (trimmedUsername) {
    h2.appendChild(payerUsernameNode(trimmedUsername, click2link, { className: 'username' }));
  } else {
    profileSection.classList.add('no-username');
  }

  const payerLink = document.createElement('a');
  payerLink.href = `https://explore.hashpack.app/${encodeURIComponent(payerInfo)}`;
  payerLink.target = '_blank';
  payerLink.rel = 'noopener noreferrer';
  payerLink.className = 'payer-info';
  payerLink.style.textDecoration = 'none';
  payerLink.textContent = payerInfo;
  h2.appendChild(payerLink);

  headerDiv.appendChild(h2);
  profileSection.appendChild(headerDiv);
  const follow = followPersonControls(payer);
  const followBtn = follow.querySelector('.topic-follow-btn');
  if (followBtn) {
    followBtn.classList.add('is-menu-source');
    followBtn.tabIndex = -1;
    followBtn.setAttribute('aria-hidden', 'true');
  }
  const menu = createPostMenu({
    followBtn,
    payer,
    donation,
    onCopy: () => copyPostLink(copySourceOf(donation, payer, copyKind)),
  });
  if (followBtn) followBtn.before(menu);
  else follow.appendChild(menu);
  profileSection.appendChild(follow);
  mountClanTag({
    bubble: profileSection,
    payerLink,
    payer,
    swaps: () => profileSwaps,
    viewer: () => connectedAccount,
    createCard: createSwapTokenCard,
    paintToken: paintSwapToken,
    paintLinks: paintSwapLinks,
  });
  return profileSection;
}

const POPUP_GEAR = [
  ['path', { d: 'M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915' }],
  ['circle', { cx: '12', cy: '12', r: '3' }],
];

export function popupStrokeIcon(className, parts) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (className) svg.classList.add(className);
  for (const [name, attrs] of parts) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    svg.appendChild(node);
  }
  return svg;
}

export function popupGearIcon() {
  return popupStrokeIcon('', POPUP_GEAR);
}

export { bindPressFeedback };

const POPUP_ARROW_LEFT = [
  ['path', { d: 'M19 12H5' }],
  ['path', { d: 'm12 19-7-7 7-7' }],
];
const POPUP_ARROW_RIGHT = [
  ['path', { d: 'M5 12h14' }],
  ['path', { d: 'm12 5 7 7-7 7' }],
];
const POPUP_CHEVRON_LEFT = [
  ['path', { d: 'm15 18-6-6 6-6' }],
];
const POPUP_CHEVRON_RIGHT = [
  ['path', { d: 'm9 18 6-6-6-6' }],
];

// Same press as the × and the gear. The arrow morphs in CSS. The step
// runs on the click and does not wait for the morph.
function popupNavArrow(kind, onStep) {
  const prev = kind === 'prev';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'popup-icon-chip popup-nav-arrow ' + (prev ? 'is-prev' : 'is-next');
  btn.setAttribute('aria-label', prev ? 'Previous' : 'Next');
  btn.title = prev ? 'Previous' : 'Next';
  const glyph = document.createElement('span');
  glyph.className = 'popup-arrow-glyph';
  glyph.setAttribute('aria-hidden', 'true');
  glyph.append(
    popupStrokeIcon('popup-arrow-rest', prev ? POPUP_ARROW_LEFT : POPUP_ARROW_RIGHT),
    popupStrokeIcon('popup-arrow-press', prev ? POPUP_CHEVRON_LEFT : POPUP_CHEVRON_RIGHT),
  );
  btn.appendChild(glyph);
  bindPressFeedback(btn);
  btn.addEventListener('click', () => {
    if (typeof onStep === 'function') onStep();
  });
  return btn;
}

// Hover and press spin in CSS. A tap spins once more. The card opens on
// the click; the spin is only visual and never gates the open. If the
// transform transition never ends, the same reset runs once after 1100ms.
function popupSettingsGear(walk) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'popup-icon-chip popup-settings-gear';
  btn.setAttribute('aria-label', 'Settings');
  btn.title = 'Settings';
  btn.appendChild(popupGearIcon());
  bindPressFeedback(btn);
  let spinning = false;
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    popupSettingsGearEl = btn;
    window.openPopupSettings(walk);
    if (spinning || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const icon = btn.querySelector('svg');
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (fine && (btn.matches(':hover') || btn.classList.contains('is-hold'))) btn.classList.add('is-again');
    btn.classList.add('is-spin');
    if (!icon) return;
    spinning = true;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      icon.removeEventListener('transitionend', onEnd);
      spinning = false;
      icon.style.transition = 'none';
      btn.classList.remove('is-spin', 'is-again');
      void icon.offsetWidth;
      icon.style.transition = '';
    };
    const onEnd = (end) => {
      if (end.target !== icon || end.propertyName !== 'transform') return;
      finish();
    };
    const timer = setTimeout(finish, 1100);
    icon.addEventListener('transitionend', onEnd);
  });
  return btn;
}

// Settings > Popups > Show media full size: popups' own switch, apart from
// the feed's (feedlayout.js), kept on this device. On, every picture and
// video in a popup starts full size, as Make bigger makes it.
const POPUP_MEDIA_WIDE_KEY = 'meritocracy-popup-media-wide';
let popupMediaWideOn = false;
try {
  popupMediaWideOn = localStorage.getItem(POPUP_MEDIA_WIDE_KEY) === 'on';
} catch {
  // A blocked store keeps it off; the switch still works for this visit.
}

function setPopupMediaWide(on) {
  popupMediaWideOn = !!on;
  try { localStorage.setItem(POPUP_MEDIA_WIDE_KEY, on ? 'on' : 'off'); } catch { /* keep it for this visit */ }
}

// Posts whose popup media the user made full size, or small again, this
// session (mediaframe.js). The popup is rebuilt on every page and refresh,
// so the choice lives here. A post's own choice beats the switch.
const popupWideMedia = new Set();
const popupNarrowMedia = new Set();

function popupMediaStartsWide(key) {
  if (key && popupWideMedia.has(key)) return true;
  if (key && popupNarrowMedia.has(key)) return false;
  return popupMediaWideOn;
}

// Popups already open follow the switch. Only the is-wide class changes, so
// a playing video keeps playing.
function resizePopupMedia() {
  for (const media of document.querySelectorAll('.maplibregl-popup .popup-media-card[data-picture]')) {
    const wide = popupMediaStartsWide(media.dataset.mediaKey || '');
    if (media.classList.contains('is-wide') === wide) continue;
    media.classList.toggle('is-wide', wide);
    if (typeof media._paintSize === 'function') media._paintSize();
  }
}

function bindPopupMediaWide() {
  const button = document.getElementById('popup-media-wide');
  if (!button || button.dataset.bound === '1') return;
  button.dataset.bound = '1';
  const paint = () => {
    button.classList.toggle('is-on', popupMediaWideOn);
    button.setAttribute('aria-checked', popupMediaWideOn ? 'true' : 'false');
  };
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    setPopupMediaWide(!popupMediaWideOn);
    paint();
    resizePopupMedia();
  });
  paint();
}
bindPopupMediaWide();

// Settings > Popups > Show X posts, the row under Show media full size:
// the same device setting as the feed's Settings > Media switch
// (xembed.js), so flipping either one moves both.
bindXEmbedsSwitch(document.getElementById('popup-x-embeds'));

function rememberPopupMediaSize(key, wide) {
  if (wide) {
    popupWideMedia.add(key);
    popupNarrowMedia.delete(key);
  } else {
    popupWideMedia.delete(key);
    popupNarrowMedia.add(key);
  }
}

// Popup media is the feed's frame (mediaframe.js): every picture, GIF and
// video starts in one compact 16:9 frame, fitted whole over a blurred copy
// of itself. The ··· makes it full size or opens it fullscreen. A tap on a
// picture or GIF shows the ···; a video's ··· follows its control bar.
// A GIF stays a still until a tap plays it in memory. The card's own
// background is the skeleton while classifyImageUrl is still running.
// A post with several pictures (postimages.js) shows the first, with "+N"
// in its corner; that badge opens the viewer at the second picture, and
// the ··· Fullscreen at the first, both able to swipe through them all.
// The popup's own swipe still turns to the next post.
function fillPopupMedia(imageDiv, url, hint, key, gallery = []) {
  if (!url) return;
  const resolved = resolveMediaUrl(url);
  const raw = String(url).trim();
  const gifLike = isGifUrl(raw) || needsGifCheck(raw);
  if (!resolved.src && !gifLike) return;
  const frame = (onFull, video) => ({
    key,
    onFull,
    video,
    startsWide: popupMediaStartsWide,
    remember: rememberPopupMediaSize,
  });
  const isVideo = resolved.kind === "video";
  if (isVideo) {
    const clip = isGifClipUrl(raw);
    const media = document.createElement("video");
    media.playsInline = true;
    media.setAttribute("playsinline", "");
    media.preload = "none";
    media.dataset.src = resolved.src;
    if (clip) {
      media.dataset.gif = "1";
      media.muted = true;
      media.defaultMuted = true;
      media.loop = true;
      media.controls = false;
      media.setAttribute("muted", "");
      media.setAttribute("loop", "");
    } else {
      media.controls = true;
    }
    bindVideoPoster(media, raw, hint);
    if (clip) {
      let reduced = false;
      try { reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { reduced = false; }
      if (!reduced) watchLoop(media);
    }
    imageDiv.appendChild(media);
    mountMediaBackdrop(imageDiv, media);
    // Fullscreen carries on from where the popup was. The popup's copy
    // pauses, so a video with sound does not play twice.
    const openFull = () => {
      const time = media.currentTime || 0;
      if (!media.paused) media.pause();
      openPreview(raw, Object.assign({ video: true, time }, hint || {}));
    };
    if (clip) {
      // A GIF clip has no control bar: a tap shows the ··· as on a picture.
      const tools = mountMediaTools(imageDiv, frame(openFull, null));
      imageDiv.addEventListener("click", (event) => tools.tap(event));
    } else {
      mountMediaTools(imageDiv, frame(openFull, media));
    }
    return;
  }
  const media = document.createElement("img");
  media.decoding = "async";
  media.loading = "eager";
  imageDiv.appendChild(media);
  presentImage(media, raw, { play: true });
  mountMediaBackdrop(imageDiv, media);
  // A GIF animates as a normal picture (a still with reduced motion). Its
  // fullscreen button opens the viewer, except while it is still pending.
  // The badge belongs to this picture only when it heads the list.
  const many = Array.isArray(gallery) && gallery.length > 1 && gallery[0] === raw;
  const tools = mountMediaTools(imageDiv, frame(() => {
    if (media.classList.contains("is-media-pending")) return;
    if (many) openGallery(gallery, 0);
    else openPreview(url);
  }, null));
  imageDiv.addEventListener("click", (event) => tools.tap(event));
  if (many) mountMoreBadge(imageDiv, gallery.length - 1, () => openGallery(gallery, 1));
}

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
  container.dataset.popupPayer = typeof payer === "string" ? payer : "";
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
  topicSpan.textContent = singleLineText(`${topicId} ${loadedTopicName}`);

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

  container.appendChild(buildPopupProfile({ profileUrl, payer, payerInfo, username, click2link, donation: data, copyKind: 'marker' }));

  // Content section. Image and text scroll. The arrow row stays under the name.
  const contentSection = document.createElement('div');
  contentSection.className = 'popup-body';
  contentSection.style.textAlign = 'center';

  // Navigation and title. Side inset matches the gear: out of the content pad
  // so the pad does not cover the arrow circles.
  const navSection = document.createElement('div');
  navSection.className = 'popup-nav';

  navSection.appendChild(popupNavArrow('prev', goPrevMarker));

  const titleDiv = document.createElement('div');
  titleDiv.style.cssText = 'text-align: center; flex-grow: 1;';
  const titleStrong = document.createElement('strong');
  titleStrong.className = 'title_color popup-title-bubble';
  paintHashtags(titleStrong, singleLineText(String(title || '').slice(0, 20)));
  titleDiv.appendChild(titleStrong);
  navSection.appendChild(titleDiv);

  navSection.appendChild(popupNavArrow('next', goNextMarker));

  // Message text, then the picture, then a linked X post: the feed's order.
  // Longer text scrolls in its own box, with Show more (full-screen page).
  const msgDiv = document.createElement('div');
  const msgP = document.createElement('p');
  msgP.className = 'text_color popup-text-bubble';
  paintHashtags(msgP, Array.isArray(msg) ? msg[0] : msg);
  msgDiv.appendChild(msgP);
  contentSection.appendChild(msgDiv);
  watchPopupText(msgDiv, msgP, Array.isArray(msg) ? msg[0] : msg, title);

  // Image, a GIF loop, or a video when the Image field holds a real
  // .mp4/.webm. The field arrives as an array (["url"]), same as a polygon.
  // The marker dot uses the cover, so this file stays in the popup.
  const popupImageUrl = postMediaUrl(image);
  if (isValidUrl(popupImageUrl)) {
    const imageDiv = document.createElement('div');
    imageDiv.className = 'popup-media-card'; // glass media card (style.css)
    fillPopupMedia(imageDiv, popupImageUrl, posterHintFor(data.payer, data.created, data.timestamp), ['m', topicId, data.payer, data.created, markernumber].join(':'), galleryImages(image));
    contentSection.appendChild(imageDiv);
  }
  // The X post's card: after the picture in portrait, last in the message
  // box in landscape (popuptext.js), so it is read where it shows.
  paintPopupXEmbeds(msgP, msgDiv);

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

  // Timestamp (row 7, right side). Views use the shared feed-chip markup.
  const viewsDiv = viewsChip(0);
  viewsDiv.classList.add('popup-views');
  paintPopupView(viewsDiv, topicId, created, Number.isFinite(viewCount) ? viewCount : null);
  const timestampDiv = document.createElement('div');
  timestampDiv.className = 'popup-timestamp';
  timestampDiv.style.cssText = 'flex-shrink: 0;';
  timestampDiv.textContent = timestamp;
  if (data.edited) {
    const editedMark = document.createElement('span');
    editedMark.className = 'popup-edited-mark';
    editedMark.textContent = 'edited';
    timestampDiv.appendChild(editedMark);
  }

  const likeDislikeDiv = document.createElement('div');
  likeDislikeDiv.style.cssText = 'position: absolute; top: calc(var(--u) * 0.15); left: 50%; transform: translateX(-50%); display: flex; align-items: flex-start; gap: calc(var(--u) * 0.5);';
  const markerComments = mountPostReactions(likeDislikeDiv, data, 'marker');
  bottomRow.appendChild(likeDislikeDiv);

  // Settings (row 7)
  topHeader.appendChild(popupSettingsGear(data.walk));
  // Row 7 — topic id and name on the left, timestamp on the right.
  // -0.5u cancels the content's side pad so the pills are not covered.
  const bottomLeftRow = document.createElement('div');
  bottomLeftRow.className = 'popup-dock';
  bottomLeftRow.classList.add('popup-footer-row');
  bottomLeftRow.style.cssText = 'position: relative; display: flex; align-items: center; gap: calc(var(--u) * 0.7); height: calc(var(--u) * 4); margin-top: 0; margin-left: calc(var(--u) * -0.5); margin-right: calc(var(--u) * -0.5); margin-bottom: calc(var(--u) * -0.3);';
  const metaRight = document.createElement('div');
  metaRight.classList.add('popup-footer-meta');
  metaRight.style.cssText = 'margin-left: auto; display: flex; align-items: center; gap: calc(var(--u) * 0.45); flex-shrink: 0;';
  metaRight.append(viewsDiv, timestampDiv);
  bottomLeftRow.appendChild(topicSpan);
  bottomLeftRow.appendChild(metaRight);

  container.appendChild(bottomRow);
  container.appendChild(bottomLeftRow);

  // Comments (below the bottom row, hidden until 💬 is pressed)
  if (markerComments) adoptComments(markerComments, container);
  noteVisibleDonation(container);

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
  container.dataset.popupPayer = typeof payer === "string" ? payer : "";
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
  topicSpan.textContent = singleLineText(`${topicId} ${loadedTopicName}`);

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

  container.appendChild(buildPopupProfile({ profileUrl, payer, payerInfo, username, click2link, donation: data, copyKind: 'polygon' }));

  // Content section
  const contentSection = document.createElement('div');
  contentSection.className = 'popup-body';
  contentSection.style.textAlign = 'center';

  // Navigation and title. Side inset matches the gear.
  const navSection = document.createElement('div');
  navSection.className = 'popup-nav';

  navSection.appendChild(popupNavArrow('prev', goPrevPolygon));

  const titleDiv = document.createElement('div');
  titleDiv.style.cssText = 'text-align: center; flex-grow: 1;';
  const titleStrong = document.createElement('strong');
  titleStrong.className = 'title_color popup-title-bubble';
  paintHashtags(titleStrong, singleLineText(String(title || '').slice(0, 20)));
  titleDiv.appendChild(titleStrong);
  navSection.appendChild(titleDiv);

  navSection.appendChild(popupNavArrow('next', goNextPolygon));
  container.appendChild(navSection);

  // Message text, then the picture, then a linked X post (as a marker).
  const msgDiv = document.createElement('div');
  const msgP = document.createElement('p');
  msgP.className = 'text_color popup-text-bubble';
  paintHashtags(msgP, Array.isArray(msg) ? msg[0] : msg);
  msgDiv.appendChild(msgP);
  contentSection.appendChild(msgDiv);
  watchPopupText(msgDiv, msgP, Array.isArray(msg) ? msg[0] : msg, title);

  // Image, a GIF loop, or a video. The field arrives as an ARRAY (["url"]).
  // The map cover stays the muted 30s loop.
  const popupImageUrl = postMediaUrl(image);
  if (isValidUrl(popupImageUrl)) {
    const imageDiv = document.createElement('div');
    imageDiv.className = 'popup-media-card'; // glass media card (style.css)
    fillPopupMedia(imageDiv, popupImageUrl, posterHintFor(data.payer, data.created, data.timestamp), ['p', topicId, data.payer, data.created, polygonnumber].join(':'), galleryImages(image));
    contentSection.appendChild(imageDiv);
  }
  // The X post's card, where the popup shows it (as a marker).
  paintPopupXEmbeds(msgP, msgDiv);

  container.appendChild(contentSection);
  const polygonGap = document.createElement('div');
  polygonGap.className = 'popup-gap';
  container.appendChild(polygonGap);

  // Row 6 — heart, comment, and share centered (topic id + timestamp live in row 7)
  const bottomRow = document.createElement('div');
  bottomRow.className = 'popup-dock';
  bottomRow.style.cssText = 'position: relative; height: calc(var(--u) * 6.2); line-height: 1; margin-top: calc(var(--u) * 0.4); overflow: visible;';

  // Timestamp (row 7, right side). Views use the shared feed-chip markup.
  const viewsDiv = viewsChip(0);
  viewsDiv.classList.add('popup-views');
  paintPopupView(viewsDiv, topicId, created, Number.isFinite(viewCount) ? viewCount : null);
  const timestampDiv = document.createElement('div');
  timestampDiv.className = 'popup-timestamp';
  timestampDiv.style.cssText = 'flex-shrink: 0;';
  timestampDiv.textContent = timestamp;
  if (data.edited) {
    const editedMark = document.createElement('span');
    editedMark.className = 'popup-edited-mark';
    editedMark.textContent = 'edited';
    timestampDiv.appendChild(editedMark);
  }

  const likeDislikeDiv = document.createElement('div');
  likeDislikeDiv.style.cssText = 'position: absolute; top: calc(var(--u) * 0.15); left: 50%; transform: translateX(-50%); display: flex; align-items: flex-start; gap: calc(var(--u) * 0.5);';
  const polygonComments = mountPostReactions(likeDislikeDiv, data, 'polygon');
  bottomRow.appendChild(likeDislikeDiv);

  // Settings (row 7)
  topHeader.appendChild(popupSettingsGear(data.walk));
  // Row 7 — topic id and name on the left, timestamp on the right.
  const bottomLeftRow = document.createElement('div');
  bottomLeftRow.className = 'popup-dock';
  bottomLeftRow.classList.add('popup-footer-row');
  bottomLeftRow.style.cssText = 'position: relative; display: flex; align-items: center; gap: calc(var(--u) * 0.7); height: calc(var(--u) * 4); margin-top: 0; margin-left: calc(var(--u) * -0.5); margin-right: calc(var(--u) * -0.5); margin-bottom: calc(var(--u) * -0.3);';
  const metaRight = document.createElement('div');
  metaRight.classList.add('popup-footer-meta');
  metaRight.style.cssText = 'margin-left: auto; display: flex; align-items: center; gap: calc(var(--u) * 0.45); flex-shrink: 0;';
  metaRight.append(viewsDiv, timestampDiv);
  bottomLeftRow.appendChild(topicSpan);
  bottomLeftRow.appendChild(metaRight);

  container.appendChild(bottomRow);
  container.appendChild(bottomLeftRow);

  // Comments (below the bottom row, hidden until 💬 is pressed)
  if (polygonComments) adoptComments(polygonComments, container);
  noteVisibleDonation(container);

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

const landscapeMQ = window.matchMedia('(orientation: landscape)');
let landscapeCommentsBound = false;
let popupSettingsOrientationBound = false;

// Landscape seats the pencil and trash on the card itself, so the right
// column can scroll without taking them along; portrait keeps them at the
// top of the side column.
function placePopupSettingsButtons() {
  const card = document.getElementById('popup-settings-card');
  const side = document.getElementById('popup-settings-side');
  const del = document.getElementById('popup-settings-delete');
  const edit = document.getElementById('popup-settings-edit');
  if (!card || !side) return;
  if (landscapeMQ.matches) {
    if (edit && edit.parentElement !== card) card.insertBefore(edit, side);
    if (del && del.parentElement !== card) card.insertBefore(del, side);
    return;
  }
  if (edit && edit.parentElement !== side) side.insertBefore(edit, side.firstChild);
  if (del && (del.parentElement !== side || side.firstElementChild !== del)) side.insertBefore(del, side.firstChild);
}

if (!popupSettingsOrientationBound) {
  popupSettingsOrientationBound = true;
  landscapeMQ.addEventListener('change', () => {
    placePopupSettingsButtons();
    syncSettingsOpen();
  });
  placePopupSettingsButtons();
}

function commentsAreOpen(node) {
  if (!node || !node.querySelectorAll) return false;
  // The open modal has moved the section out of the card (portrait) or
  // covered the card with it (landscape). Either way the thread is live.
  if (commentsModalSection) {
    const home = commentsModalSection._homeParent;
    if (home && (node === home || node.contains(home))) return true;
    if (node.contains(commentsModalSection)) return true;
  }
  const sections = node.querySelectorAll('[id^="marker-comments-"], [id^="polygon-comments-"]');
  for (const section of sections) {
    if (section.style.display !== 'none') return true;
    if (section.contains(document.activeElement)) return true;
    const textarea = commentField(section);
    if (textarea && textarea.value) return true;
  }
  return false;
}

function applyShareCard(properties, record) {
  properties._shareRecord = record;
  properties.media = mediaKind(record && record.image);
  properties.seconds = videoSeconds(record && record.image);
  const current = properties.message;
  // Leave the card alone while its comment thread is open on screen.
  // A closed popup is replaced so the next open shows the new counts.
  if (current && current.isConnected && commentsAreOpen(current)) return;
  bindWalk(record, properties.walkKey);
  if (current) forgetProfileTree(current);
  const fresh = popupHTML(record);
  if (current && current.parentNode) {
    current.replaceWith(fresh);
    properties.message = fresh;
    watchProfileTree(fresh);
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
  const defaultProfilePic = DEFAULT_AVATAR;
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
    consensusTimestamp: typeof live.consensusTimestamp === 'string' ? live.consensusTimestamp : (base.consensusTimestamp || ''),
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

// opts.token: the map load's draw token (beginMapDraw).
export async function processTopicMessages(topicId, opts = {}) {
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
const commentIndex = new Map();
const commentPending = new Map();
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

      // Comments, replies, and author edits/deletes. Same rules as the server.
      ingestParsedComments(parsedMessage, payerId, topicId, {
        commentsMapMarker,
        commentsMapPolygon,
        repliesMapMarker,
        repliesMapPolygon,
        likeCountMapMarker,
        dislikeCountMapMarker,
        likeCountMapPolygon,
        dislikeCountMapPolygon,
        payerActionsPerTimestamp,
        commentIndex,
        commentPending,
      });
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


              const defaultProfilePic = DEFAULT_AVATAR;
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
                rememberShapeEdit(message.payer, parsedMessage.marker.data, (message && message.created) || parsedMessage.created);
                rememberCommentPin(message.payer, parsedMessage.marker.data, (message && message.created) || parsedMessage.created);

                // A stored whole number keeps dedup. No number is a new post.
                // A delete matches the post's created time or timestamp.
                // A legacy number delete does not claim the slot.
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
                      commentPin: parsedMessage.marker.data.commentPin,
                      msg: editedMsg(parsedMessage.marker.data.msg, message.payer, messageCreated(postCreated), timestamp),
                      edited: hasShapeEdit(message.payer, messageCreated(postCreated), timestamp),
                      timestamp,
                      created: messageCreated(postCreated),
                      consensusTimestamp: consensusOf(message),
                      likeCountMarker: likeCountMapMarker.get(timestamp) || 0,
                      likedByMe: payerHasLike(payerActionsPerTimestamp, timestamp, 'likeMarker'),
                      comments: assembledComments(commentsMapMarker.get(timestamp), repliesMapMarker, likeCountMapMarker, dislikeCountMapMarker, payerActionsPerTimestamp, 'likeMarker'),
                      coords
                    });

                    topicGeojsonFeatures.push({
                      topicId: topicId,
                      created: postCreated,
                      msgNumber: markernumber,
                      type: "Feature",
                      payer: message.payer,
                      media: mediaKind(parsedMessage.marker.data.image),
                      seconds: videoSeconds(parsedMessage.marker.data.image),
                      properties: {
                        media: mediaKind(parsedMessage.marker.data.image),
                        seconds: videoSeconds(parsedMessage.marker.data.image),
                        popupData: markerPopupData,
                        imageUrl: coverImageUrl(parsedMessage.marker.data.coverimage, avatarSrc(profileUrl)),
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
                rememberShapeEdit(message.payer, parsedMessage.polygon.data, (message && message.created) || parsedMessage.created);
                rememberCommentPin(message.payer, parsedMessage.polygon.data, (message && message.created) || parsedMessage.created);

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
                        commentPin: parsedMessage.polygon.data.commentPin,
                        msg: editedMsg(parsedMessage.polygon.data.msg, message.payer, messageCreated(postCreated), timestamp),
                        edited: hasShapeEdit(message.payer, messageCreated(postCreated), timestamp),
                        timestamp,
                        created: messageCreated(postCreated),
                      consensusTimestamp: consensusOf(message),
                        likeCountPolygon: likeCountMapPolygon.get(timestamp) || 0,
                        likedByMe: payerHasLike(payerActionsPerTimestamp, timestamp, 'likePolygon'),
                        comments: assembledComments(commentsMapPolygon.get(timestamp), repliesMapPolygon, likeCountMapPolygon, dislikeCountMapPolygon, payerActionsPerTimestamp, 'likePolygon'),
                        coordinates
                      });

                      topicPolygons.push({
                        topicId: topicId,
                        created: postCreated,
                        msgNumber: polygonnumber,
                        id: `polygon-${message.payer}-${topicId}-${polygonnumber}`,
                        payer: message.payer,
                        media: mediaKind(parsedMessage.polygon.data.image),
                        seconds: videoSeconds(parsedMessage.polygon.data.image),
                        coordinates: [coordinates],
                        popupData: polygonPopupData,
                        title: String(parsedMessage.polygon.data.title || "").slice(0, 20),
                        imageUrl: coverImageUrl(parsedMessage.polygon.data.coverimage, profileUrl)
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

          rememberTopicAutoplay(topicId, currentAutoplayNft(messages, topicAdmin));
          await showDrawingsAsApproved({
            token: opts.token,
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
    image: firstMediaUrl(record.image),
    commentPin: record.commentPin,
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

// The Image field only. Cover image and the profile picture are not media.
// A share with an empty pointer uses the loaded original post's image.
export function postMedia(item) {
  if (!item) return 'none';
  const own = (item.properties && item.properties.media) || item.media;
  if (own === 'video' || own === 'picture') return own;
  const link = (item.properties && item.properties.shareOf) || item.shareOf;
  if (!link || !link.topic || !link.created) return 'none';
  const created = messageCreated(link.created);
  const topic = String(link.topic);
  if (!created) return 'none';
  const pools = postsFlat(storedMarkers).concat(postsFlat(storedPolygons));
  for (const post of pools) {
    if (post === item) continue;
    if (String(post.msgNumber || '').startsWith('share-')) continue;
    if (String(post.topicId) !== topic) continue;
    if (messageCreated(post.created) !== created) continue;
    const kind = (post.properties && post.properties.media) || post.media;
    if (kind === 'video' || kind === 'picture') return kind;
  }
  return 'none';
}

function mediaMatches(item, mode) {
  if (mode === 'all') return true;
  const kind = postMedia(item);
  if (mode === 'pictures') return kind === 'picture';
  if (mode === 'videos') return kind === 'video';
  return kind === 'picture' || kind === 'video';
}

function cleanSeconds(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

// Seconds live on the same object that decided the post is a video.
// A pointer share with no image of its own uses the loaded original.
function postSeconds(item) {
  if (!item || postMedia(item) !== 'video') return null;
  const props = item.properties;
  const own = (props && props.media) || item.media;
  if (own === 'video') {
    if (props && props.media === 'video') return cleanSeconds(props.seconds);
    return cleanSeconds(item.seconds);
  }
  const link = (props && props.shareOf) || item.shareOf;
  if (!link || !link.topic || !link.created) return null;
  const created = messageCreated(link.created);
  const topic = String(link.topic);
  if (!created) return null;
  const pools = postsFlat(storedMarkers).concat(postsFlat(storedPolygons));
  for (const post of pools) {
    if (post === item) continue;
    if (String(post.msgNumber || '').startsWith('share-')) continue;
    if (String(post.topicId) !== topic) continue;
    if (messageCreated(post.created) !== created) continue;
    const kind = (post.properties && post.properties.media) || post.media;
    if (kind !== 'video') continue;
    if (post.properties && post.properties.media === 'video') return cleanSeconds(post.properties.seconds);
    return cleanSeconds(post.seconds);
  }
  return null;
}

// Length only removes videos. Pictures and text stay with the Show choice.
// A video whose filename has no length is visible only on Any.
function lengthMatches(item, mode) {
  if (mode === 'any') return true;
  if (postMedia(item) !== 'video') return true;
  return secondsMatch(postSeconds(item), mode);
}

// Where a post is, for Distance: a marker's point, a shape's middle (the
// mean of its ring, the closing point not counted twice).
function postPoint(item) {
  const point = item && item.geometry && item.geometry.type === 'Point' ? item.geometry.coordinates : null;
  if (Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])) return point;
  const ring = item && Array.isArray(item.coordinates) ? item.coordinates[0] : null;
  if (!Array.isArray(ring) || !ring.length) return null;
  const pts = ring.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (!pts.length) return null;
  const last = pts[pts.length - 1];
  const closed = pts.length > 1 && last[0] === pts[0][0] && last[1] === pts[0][1];
  const use = closed ? pts.slice(0, -1) : pts;
  let lng = 0;
  let lat = 0;
  for (const p of use) {
    lng += p[0];
    lat += p[1];
  }
  return [lng / use.length, lat / use.length];
}

// Every arrow choice at once: Type, Video length, and Distance from the
// open post (origin; null when there is no open post to measure from).
function stepMatches(item, origin) {
  return mediaMatches(item, mediaMode()) && lengthMatches(item, lengthMode()) && withinRadius(origin, postPoint(item));
}

function arrowFiltersOff() {
  return mediaMode() === 'all' && lengthMode() === 'any' && radiusKm() == null;
}

// The open pin, found even when the arrow was the fallback with no walk.
// Same account can be standing on a share, whose author post is the start.
function openIndex(posts, payer, number, topicId, walk) {
  if (number != null && topicId) {
    const idx = findPin(posts, payer, number, topicId);
    if (idx !== -1) return idx;
  }
  if (pagerMode() === 'account' && walk) return findAuthorPost(posts, walk);
  return -1;
}

// One drawing is one created time, including the same post stored on
// several topics. An empty time falls back to the pin identity.
function createdKey(item) {
  const created = messageCreated(item && item.created);
  if (created) return created;
  return String(item && item.payer) + '\0' + String(item && item.topicId) + '\0' + String(item && item.msgNumber);
}

// Keep the copy that is the open pin, so the step still finds where it started.
function uniquePosts(posts, payer, number, topicId, walk) {
  const list = posts || [];
  const preferredAt = openIndex(list, payer, number, topicId, walk);
  const preferred = preferredAt === -1 ? null : list[preferredAt];
  const kept = new Map();
  const keys = [];
  for (const item of list) {
    const key = createdKey(item);
    if (!kept.has(key)) {
      kept.set(key, item);
      keys.push(key);
      continue;
    }
    if (preferred && item === preferred) kept.set(key, item);
  }
  return keys.map((key) => kept.get(key));
}

// The open post stays in the list even when it does not match, so the step
// can start there. Anything else has to match Type, Video length and
// Distance (measured from the open post).
function filterMedia(posts, payer, number, topicId, walk) {
  if (arrowFiltersOff()) return posts;
  const openIdx = openIndex(posts, payer, number, topicId, walk);
  const open = openIdx === -1 ? null : posts[openIdx];
  const origin = open ? postPoint(open) : null;
  const filtered = posts.filter((item) => stepMatches(item, origin));
  if (!open) return filtered;
  if (!filtered.includes(open)) filtered.push(open);
  return filtered;
}

// "No more videos", "No more posts within 10 km", …
function noMoreMediaLabel() {
  const mode = mediaMode();
  let base = 'No more posts';
  if (mode === 'pictures') base = 'No more pictures';
  else if (mode === 'videos') base = 'No more videos';
  else if (mode === 'both') base = 'No more pictures or videos';
  else if (lengthMode() !== 'any' && radiusKm() == null) base = 'No more posts of that length';
  const near = radiusLabel();
  return near ? `${base} ${near}` : base;
}

function noteNoMoreMedia(posts, payer, number, topicId, walk) {
  if (arrowFiltersOff() || !posts || !posts.length) return;
  const curIdx = openIndex(posts, payer, number, topicId, walk);
  if (curIdx === -1) return;
  const openKey = createdKey(posts[curIdx]);
  const origin = postPoint(posts[curIdx]);
  for (let i = 0; i < posts.length; i++) {
    if (i === curIdx || createdKey(posts[i]) === openKey) continue;
    if (stepMatches(posts[i], origin)) return;
  }
  toast.info(noMoreMediaLabel());
}

// Same account wraps inside that one account. By time is one timeline of
// every loaded post of this shape. Random picks another loaded post.
// One post, or a post that is not in the list, stays put.
export function listForStep(pinGroups, pinPayer, walk, payer, number, topicId) {
  const mode = pagerMode();
  let posts;
  if (mode === 'account') {
    const author = (walk && walk.author) || pinPayer;
    const groups = walk && walk.kind === 'polygon' ? storedPolygons : pinGroups;
    if (!author) return [];
    posts = postsFlat(groups).filter((item) => String(item.payer) === String(author));
  } else {
    posts = postsFlat(pinGroups);
  }
  const who = payer == null ? pinPayer : payer;
  return uniquePosts(filterMedia(posts, who, number, topicId, walk).sort(byTime), who, number, topicId, walk);
}

function takeStep(pinGroups, payer, number, topicId, direction, walk) {
  const posts = listForStep(pinGroups, pinPayerFrom(payer, walk), walk, payer, number, topicId);
  const next = stepPosts(posts, payer, number, topicId, direction, walk);
  if (!next) noteNoMoreMedia(posts, payer, number, topicId, walk);
  return next;
}

function pinPayerFrom(payer, walk) {
  return (walk && walk.payer) || payer;
}

export function stepPosts(posts, payer, number, topicId, direction, walk) {
  if (!posts || posts.length < 2) return null;
  const mode = pagerMode();
  // The open pin wins when it is already in this list (your own post, or
  // your own share). A share of someone else's post is not in their list,
  // so the step starts at the original instead. If that original is not
  // loaded either, the arrows stay put.
  const curIdx = openIndex(posts, payer, number, topicId, walk);
  if (curIdx === -1) return null;
  const open = posts[curIdx];
  const openKey = createdKey(open);
  const origin = postPoint(open);
  if (mode === 'random') {
    const choices = [];
    for (let i = 0; i < posts.length; i++) {
      if (i === curIdx || createdKey(posts[i]) === openKey) continue;
      if (!stepMatches(posts[i], origin)) continue;
      choices.push(posts[i]);
    }
    if (!choices.length) return null;
    return choices[Math.floor(Math.random() * choices.length)];
  }
  const dir = direction < 0 ? -1 : 1;
  let idx = curIdx;
  for (let n = 0; n < posts.length - 1; n++) {
    idx = (idx + dir + posts.length) % posts.length;
    const item = posts[idx];
    if (createdKey(item) === openKey) continue;
    if (!stepMatches(item, origin)) continue;
    return item;
  }
  return null;
}

function showPost(item) {
  if (!item) return null;
  if (item.geometry && item.geometry.type === 'Point') return showMarker(item);
  return showPolygon(item);
}

window.nextMsgFromPayerMarker = function(payer, markerNumber, topicId, walk) {
  if (!payer || markerNumber == null || !topicId) return null;
  const next = takeStep(storedMarkers, payer, markerNumber, topicId, 1, walk);
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
  const next = takeStep(storedPolygons, payer, polygonNumber, topicId, 1, walk);
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
  const prev = takeStep(storedMarkers, payer, markerNumber, topicId, -1, walk);
  return prev ? showPost(prev) : null;
};

window.prevMsgFromPayerPolygon = function(payer, polygonNumber, topicId, walk) {
  if (!payer || polygonNumber == null || !topicId) return null;
  const prev = takeStep(storedPolygons, payer, polygonNumber, topicId, -1, walk);
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

function assembledComments(list, repliesMap, likeMap, dislikeMap, actions, likeType) {
  const nested = (list || []).map((c) => ({
    ...c,
    likeCount: likeMap.get(c.created) || 0,
    dislikeCount: dislikeMap.get(c.created) || 0,
    likedByMe: payerHasLike(actions, c.created, likeType),
    replies: buildReplyTree(c, repliesMap, likeMap, dislikeMap, 0, actions, likeType),
  }));
  return sortCommentTree(filterCommentTree(nested), 'newest');
}

function assignCommentVerdict(node, verdict) {
  const created = node.created;
  node.text = verdict.text;
  node.image = verdict.image || '';
  node.edited = verdict.edited;
  node.deleted = verdict.deleted;
  node.mutationAt = verdict.mutationAt;
  node.created = created;
}

function takeStoredComment(bag, map, key, fields) {
  if (!fields.created) return null;
  const known = bag.commentIndex.get(fields.created);
  if (known) return known;
  const node = {
    payer: fields.payer,
    text: fields.text,
    image: commentImageValue(fields.image),
    created: fields.created,
    edited: false,
    deleted: false,
    mutationAt: '',
  };
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(node);
  bag.commentIndex.set(fields.created, node);
  const waiting = bag.commentPending.get(fields.created);
  if (waiting) {
    bag.commentPending.delete(fields.created);
    for (const event of waiting) applyBagMutation(bag, event);
  }
  return node;
}

function applyBagMutation(bag, event) {
  const node = bag.commentIndex.get(event.created);
  if (!node) {
    const list = bag.commentPending.get(event.created) || [];
    list.push(event);
    bag.commentPending.set(event.created, list);
    return;
  }
  const verdict = mutationVerdict(node, event);
  if (verdict) assignCommentVerdict(node, verdict);
}

function refreshBagSection(topicId, kind, stamp, bag) {
  if (!stamp || typeof document === 'undefined' || !document.getElementById) return;
  const section = document.getElementById(commentSectionId(kind, topicId, stamp));
  if (!section || typeof section._setComments !== 'function') return;
  const polygon = kind === 'polygon';
  const list = polygon ? bag.commentsMapPolygon : bag.commentsMapMarker;
  const replies = polygon ? bag.repliesMapPolygon : bag.repliesMapMarker;
  const likes = polygon ? bag.likeCountMapPolygon : bag.likeCountMapMarker;
  const dislikes = polygon ? bag.dislikeCountMapPolygon : bag.dislikeCountMapMarker;
  section._setComments(assembledComments(
    list.get(stamp) || [],
    replies,
    likes,
    dislikes,
    bag.payerActionsPerTimestamp,
    polygon ? 'likePolygon' : 'likeMarker',
  ));
}

function ingestParsedComments(parsedMessage, payerId, topicId, bag) {
  if (!parsedMessage || !payerId || !bag) return;
  const at = messageCreated(parsedMessage.created);
  const events = readCommentEvents(parsedMessage, payerId, at);
  let touched = null;
  for (const event of events) {
    if (event.type === 'comment' || event.type === 'reply') {
      const polygon = event.bucket === 'polygon';
      const map = event.type === 'comment'
        ? (polygon ? bag.commentsMapPolygon : bag.commentsMapMarker)
        : (polygon ? bag.repliesMapPolygon : bag.repliesMapMarker);
      const key = event.type === 'comment' ? event.stamp : event.parentId;
      takeStoredComment(bag, map, key, { payer: payerId, text: event.text, image: event.image, created: at });
      if (event.stamp) touched = { kind: event.bucket, stamp: event.stamp };
    } else {
      applyBagMutation(bag, event);
      if (event.stamp) touched = { kind: event.bucket, stamp: event.stamp };
    }
  }
  if (touched) refreshBagSection(topicId, touched.kind, touched.stamp, bag);
}

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

// A comment row's round picture, and yours in the composer: the payer's
// own, or the default one.
function commentFace(payer) {
  const payerImage = (payer && profilePictures[payer]?.url) || DEFAULT_AVATAR;
  const validPayerImage = isValidUrl(payerImage) ? payerImage : DEFAULT_AVATAR;
  return pictureElement(avatarSrc(validPayerImage), {
    alt: '',
    className: 'comment-avatar-img',
  });
}

// What a comment's stored media is, for the composer's chip on an edit.
function commentMediaUrlKind(value) {
  const raw = commentImageUrl(value);
  if (!raw) return '';
  if (isGifClipUrl(raw) || isGifUrl(raw)) return 'gif';
  return resolveMediaUrl(raw).kind === 'video' ? 'video' : 'still';
}

// A comment's one picture, GIF or short video, painted as the popup paints
// a post's (fillPopupMedia): a video loads nothing until it plays (preload
// "none", its poster first), a GIF clip loops muted while it shows, and a
// tap on a picture, a GIF or a clip opens it fullscreen. No ··· frame
// tools: the media is small in a comment. thumb: the composer chip's
// still preview, with no controls and no tap. false when nothing shows.
function paintCommentMedia(box, stored, { thumb = false } = {}) {
  // Only our own uploads, IPFS and Hashinals are drawn (commentops.js).
  const url = commentMediaShownUrl(stored);
  if (!url) return false;
  const raw = url.trim();
  const resolved = resolveMediaUrl(raw);
  const gifLike = isGifUrl(raw) || needsGifCheck(raw);
  if (!resolved.src && !gifLike) return false;
  if (resolved.kind === 'video') {
    const clip = isGifClipUrl(raw);
    const media = document.createElement('video');
    media.playsInline = true;
    media.setAttribute('playsinline', '');
    media.preload = 'none';
    media.dataset.src = resolved.src;
    if (clip || thumb) {
      media.muted = true;
      media.defaultMuted = true;
      media.setAttribute('muted', '');
    }
    if (clip) {
      media.dataset.gif = '1';
      media.loop = true;
      media.setAttribute('loop', '');
    }
    media.controls = !clip && !thumb;
    bindVideoPoster(media, raw, null);
    if (clip && !thumb && !feedMotionReduced()) watchLoop(media);
    box.classList.add(clip ? 'is-gif' : 'is-video');
    box.appendChild(media);
    if (clip && !thumb) {
      box.addEventListener('click', (event) => {
        event.stopPropagation();
        openPreview(raw, { video: true });
      });
    }
    return true;
  }
  const media = document.createElement('img');
  media.alt = '';
  media.decoding = 'async';
  media.loading = thumb ? 'eager' : 'lazy';
  box.appendChild(media);
  presentImage(media, raw, { play: !thumb });
  if (!thumb) {
    box.classList.add('is-picture');
    box.addEventListener('click', (event) => {
      event.stopPropagation();
      if (media.classList.contains('is-media-pending')) return;
      openPreview(raw);
    });
  }
  return true;
}

// The refusals uploadCommentMedia throws for a comment's own limits. Any
// other failure reads as the upload's own message (uploadmedia.js uploadFace).
const COMMENT_MEDIA_REFUSALS = new Set([
  COMMENT_MEDIA_TYPES_TEXT,
  COMMENT_STILL_TOO_BIG,
  COMMENT_STILL_STILL_BIG,
  COMMENT_VIDEO_TOO_BIG,
  COMMENT_VIDEO_TOO_LONG,
]);

// Dynamic, as the cover picker is: a static uploadmedia.js import reaches
// web3 while it is still initializing (see resolvePopupEditKey). The file
// picker has already opened in the tap by the time this runs.
async function uploadCommentFile(file, anchor) {
  const upload = await import('./uploadmedia.js');
  try {
    return await upload.uploadCommentMedia(file, anchor);
  } catch (error) {
    if (!error || !error.shown) {
      toast.error(error && COMMENT_MEDIA_REFUSALS.has(error.message) ? error.message : upload.uploadFace(error));
    }
    throw error;
  }
}

// The JSON the send helpers below hand the wallet for this composer state,
// measured the way they send it, for the approvals line (formatHcsUsage).
function commentOutgoingBytes(state, polygon, timestamp) {
  const text = clipCommentText(state && state.text);
  const image = commentImageValue(state && state.image);
  let field;
  let body;
  if (state && state.mode === 'edit' && state.edit) {
    const reply = !!state.edit.parent;
    field = reply
      ? (polygon ? 'editReplyPolygon' : 'editReplyMarker')
      : (polygon ? 'editCommentPolygon' : 'editCommentMarker');
    body = { created: state.edit.node.created, text, timestamp };
    if (reply) body.parentId = state.edit.parent.created;
    if (state.image !== undefined) body.image = image;
  } else if (state && state.mode === 'reply' && state.replyTo) {
    field = polygon ? 'replyPolygon' : 'replyMarker';
    body = { timestamp, parentId: state.replyTo.created, text };
    if (image) body.image = image;
  } else {
    field = polygon ? 'commentPolygon' : 'commentMarker';
    body = { timestamp, text };
    if (image) body.image = image;
  }
  return utf8ByteLength(JSON.stringify({ [field]: body }));
}

// The rule line above Top / Newest: whose comments show first (commentpin.js
// hands the text). section._paintPin({ tokens, names, text }) paints it;
// an empty text hides it.
function commentsPinLine(section) {
  const line = document.createElement('div');
  line.className = 'comments-pin';
  line.setAttribute('role', 'note');
  line.hidden = true;
  section._paintPin = (info) => {
    const text = info && typeof info.text === 'string' ? info.text : '';
    line.textContent = text;
    line.hidden = !text;
  };
  return line;
}

// Comment section for marker/polygon popups and feed posts, in the X /
// Instagram shape (commentsui.js): a Top / Newest switch, a row for every
// comment and reply, and the composer at the foot. Hidden until 💬 is
// pressed. postTimestamp is the post's own timestamp, which the edit and
// delete helpers name. The same section serves all three shells: the feed
// page, the landscape card and the popup card (showCommentsModal).
function readerFilterCtx() {
  return {
    me: connectedAccount || '',
    followSet: feedFollowSet(),
    isEarly: (payer) => earlyHashinalNumber(payer) > 0,
  };
}

function buildCommentsSection(id, comments, onSend, onReply, topicId, kind, syncKey, postTimestamp) {
  const pinPost = pendingCommentPinPost || {};
  pendingCommentPinPost = null;
  const section = document.createElement('div');
  section.id = id;
  section.classList.add('popup-comments');
  if (syncKey) section._commentSync = syncKey;
  section.style.cssText = 'display: none; margin-top: calc(var(--u) * 1); padding: calc(var(--u) * 1); border-radius: calc(var(--u) * 1.2); background: rgba(255, 255, 255, 0.10); border: calc(var(--u) * 0.05) solid rgba(255, 255, 255, 0.15); text-align: left;';
  const polygon = kind === 'polygon';

  // Top / Newest. A change re-sorts the tree this section already holds
  // and repaints it; nothing is fetched. The mode holds through live
  // updates and sends until the comments view closes.
  section._sortMode = DEFAULT_COMMENT_SORT;
  section._readerFilters = freshCommentFilters();
  section._pinPost = pinPost;
  const pinLine = commentsPinLine(section);
  const currentTokens = () => commentPinFor(
    section._pinPost.payer,
    section._pinPost.created,
    section._pinPost.stamp,
    section._pinPost.base,
  );
  let pinEpoch = 0;
  const sortBar = buildSortToggle({
    value: section._sortMode,
    onChange: (mode) => {
      section._sortMode = mode;
      if (section._readerFilters) section._readerFilters.sort = mode;
      if (typeof section._paintCommentSettings === 'function') section._paintCommentSettings();
      paintList(section._tree || []);
    },
  });

  const list = document.createElement('div');
  list.className = 'comments-scroll';
  list.style.cssText = 'margin-bottom: calc(var(--u) * 1);';

  // Reply threads the reader opened stay open through a repaint.
  const openThreads = new Set();
  let composer = null;

  const likeComment = (node, wantLike) => (polygon
    ? window.likePolygon(node.created, topicId, !wantLike)
    : window.likeMarker(node.created, topicId, !wantLike));

  const deleteComment = async (node, parent, row) => {
    if (!(await confirmInRow(row))) return;
    const ok = parent
      ? await (polygon ? window.sendDeletePolygonReply : window.sendDeleteMarkerReply)(
        postTimestamp, topicId, node.created, node.payer, parent.created)
      : await (polygon ? window.sendDeletePolygonComment : window.sendDeleteMarkerComment)(
        postTimestamp, topicId, node.created, node.payer);
    if (ok && composer) composer.forget(node.created);
  };

  // Read at every paint: the connected account decides where ⋯ shows.
  const rowOptions = () => ({
    me: connectedAccount || '',
    now: Date.now(),
    avatar: commentFace,
    openProfile: (payer) => loadBio4PIC(payer),
    watchFace: (el, payer) => watchFollowPrefetch(el, payer),
    username: (payer) => usernames[payer]?.username || '',
    usernameNode: (text, payer) => payerUsernameNode(text, click2url[payer]?.click2url),
    accountHref: (payer) => `https://explore.hashpack.app/${encodeURIComponent(payer)}`,
    textStyle: `font-size: calc(var(--u) * ${textFontSizeTopicChat}); color: ${textTopicChatColor};`,
    // A like on any node is a regular likeMarker/likePolygon with that
    // node's own created time, so the per-payer counting applies unchanged.
    heart: (node) => createHeartLike({
      count: node.likeCount,
      liked: node.likedByMe,
      mini: true,
      onToggle: (wantLike) => likeComment(node, wantLike),
    }),
    replyCount: (node, count, onToggle, open) => {
      const bubble = createCommentBubble({ count, mini: true, onToggle });
      const box = bubble.querySelector('input');
      if (open && box) box.checked = true;
      return bubble;
    },
    isOpen: (node) => openThreads.has(node.created),
    onThread: (node, open) => {
      if (open) openThreads.add(node.created);
      else openThreads.delete(node.created);
    },
    countAll: countAllMessages,
    media: (image, box) => paintCommentMedia(box, image),
    onReply: (node) => {
      if (composer) composer.reply(node);
    },
    onEdit: (node, parent) => {
      if (composer) composer.edit(node, parent);
    },
    onDelete: (node, parent, row) => {
      deleteComment(node, parent, row);
    },
  });

  const paintPinInfo = (tokens) => {
    if (tokens.length) section.dataset.commentPin = tokens.join(',');
    else delete section.dataset.commentPin;
    const names = collectionNames(tokens);
    const text = tokens.length ? commentPinText(tokens, names) : '';
    if (typeof section._paintPin === 'function') section._paintPin({ tokens, names, text });
    if (!tokens.length || typeof section._paintPin !== 'function') return;
    const snapshot = tokens.join(',');
    for (const token of tokens) {
      if (names[token]) continue;
      whenCollectionName(token).then((name) => {
        if (!name || !section.isConnected) return;
        if (currentTokens().join(',') !== snapshot) return;
        const nextNames = collectionNames(tokens);
        const nextText = commentPinText(tokens, nextNames);
        section._paintPin({ tokens, names: nextNames, text: nextText });
      }).catch(() => {});
    }
  };

  // Top-level payers pinned on this token list. A holder answer that does
  // not change this set leaves the rows where they are.
  const pinnedPayers = (rows, tokens) => {
    const out = new Set();
    for (const node of rows || []) {
      const payer = node && node.payer;
      if (payer && cachedPinned(payer, tokens) === true) out.add(payer);
    }
    return out;
  };

  const samePayers = (a, b) => {
    if (a.size !== b.size) return false;
    for (const payer of a) if (!b.has(payer)) return false;
    return true;
  };

  // The card list scrolls itself. On the feed the column above it does.
  const commentScroller = (node) => {
    for (let el = node; el && el.nodeType === 1; el = el.parentElement) {
      if (el === document.body || el === document.documentElement) break;
      const oy = getComputedStyle(el).overflowY;
      if (oy === 'auto' || oy === 'scroll') return el;
    }
    return null;
  };

  const paintList = (items, keepScroll) => {
    const scroller = keepScroll ? commentScroller(list) : null;
    const savedTop = scroller ? scroller.scrollTop : 0;
    list.replaceChildren();
    const cleared = filterCommentTree(items || []);
    const reader = filterCommentsForReader(cleared, section._readerFilters, readerFilterCtx());
    const sorted = sortCommentTree(reader, section._sortMode);
    const tokens = currentTokens();
    const view = tokens.length
      ? pinTopLevel(sorted, (payer) => cachedPinned(payer, tokens) === true)
      : sorted;
    if (view.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'comments-empty';
      empty.textContent = 'No comments yet';
      list.appendChild(empty);
    }
    const options = rowOptions();
    for (const comment of view) list.appendChild(buildCommentRow(comment, options));
    if (scroller) scroller.scrollTop = savedTop;
    sortBar.hidden = view.length === 0;
    section._view = view;
    if (section._commentSync) publishComment(section._commentSync, countAllMessages(view));
    paintPinInfo(tokens);
    if (!tokens.length) return;
    const epoch = ++pinEpoch;
    const snapshot = tokens.join(',');
    const pinned = pinnedPayers(sorted, tokens);
    lookupHolders(commentPinPayers(sorted, 30), tokens).then((changed) => {
      if (!changed || epoch !== pinEpoch) return;
      if (!section.isConnected) return;
      if (currentTokens().join(',') !== snapshot) return;
      if (samePayers(pinned, pinnedPayers(sorted, tokens))) return;
      paintList(section._tree || [], true);
    }).catch(() => {});
  };

  const overlayMatches = (tree, overlay) => {
    const node = findComment(tree, overlay.created);
    if (!node) return false;
    if (overlay.fields && overlay.fields.deleted) return !!node.deleted;
    if (overlay.fields && overlay.fields.edited) {
      if (node.text !== overlay.fields.text) return false;
      // An edit that set or cleared the media lands once that does too.
      return !('image' in overlay.fields) || (node.image || '') === overlay.fields.image;
    }
    return false;
  };

  const repaint = (next) => {
    const merged = reconcileCommentTree(section._base, next || [], section._pending);
    section._base = reconcileCommentTree(null, next || [], []).tree;
    section._pending = merged.pendings;
    const tree = merged.tree;
    const keep = [];
    for (const overlay of section._overlays) {
      if (overlayMatches(tree, overlay)) continue;
      const node = findComment(tree, overlay.created);
      if (!node) continue;
      const created = node.created;
      Object.assign(node, overlay.fields);
      node.created = created;
      keep.push(overlay);
    }
    section._overlays = keep;
    section._tree = tree;
    paintList(tree);
  };

  section._base = reconcileCommentTree(null, comments || [], []).tree;
  section._pending = [];
  section._overlays = [];
  section._setComments = (next) => repaint(next || []);
  section._insertPending = (node, parentId) => {
    section._pending.push({ parentId: parentId || null, node });
    repaint(section._base);
  };
  section._mutate = (created, fields) => {
    section._overlays = section._overlays.filter((item) => item.created !== created);
    section._overlays.push({ created, fields });
    repaint(section._base);
  };
  // Opened, or the wallet changed: your avatar, and ⋯ on your own rows.
  section._refresh = () => {
    if (composer) composer.refresh();
    if (typeof section._paintCommentSettings === 'function') section._paintCommentSettings();
    paintList(section._tree || []);
  };
  // The view closed: the next open starts at Newest with filters off.
  section._resetSort = () => {
    const dirty = section._sortMode !== DEFAULT_COMMENT_SORT || commentFiltersActive(section._readerFilters);
    section._readerFilters = freshCommentFilters();
    section._sortMode = DEFAULT_COMMENT_SORT;
    sortBar.setSortMode(DEFAULT_COMMENT_SORT);
    if (typeof section._closeCommentSettings === 'function') section._closeCommentSettings();
    if (typeof section._paintCommentSettings === 'function') section._paintCommentSettings();
    if (dirty) paintList(section._tree || []);
  };
  section._syncSortBar = (mode) => sortBar.setSortMode(mode);
  section._repaintComments = () => paintList(section._tree || []);
  section._applyPin = () => paintList(section._tree || []);
  repaint(section._base);
  section.appendChild(pinLine);
  section.appendChild(sortBar);
  section.appendChild(list);

  // The composer sits in one bar at the foot. The list above scrolls. The
  // comments sheet is pinned with the keyboard.
  const input = document.createElement('textarea');
  input.placeholder = COMMENT_PLACEHOLDER;
  input.maxLength = COMMENT_TEXT_MAX;
  input.rows = 1;
  input.addEventListener('input', () => {
    const soft = input.value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const next = clipMessage(soft, COMMENT_TEXT_MAX);
    if (next !== input.value) input.value = next;
    adjustTextareaHeight(input);
  });
  composer = buildCommentComposer({
    input,
    accept: COMMENT_MEDIA_ACCEPT,
    avatar: () => commentFace(connectedAccount),
    reject: commentMediaReject,
    kindOf: commentMediaKind,
    kindOfUrl: commentMediaUrlKind,
    upload: uploadCommentFile,
    paintThumb: (url, box) => paintCommentMedia(box, url, { thumb: true }),
    replyLabel: (node) => `↩ Replying to ${commentNameParts(node.payer, usernames[node.payer]?.username).name}`,
    bytes: (state) => commentOutgoingBytes(state, polygon, postTimestamp),
    afterText: (field) => {
      const open = fieldExpandOf(field);
      if (open) open.paint();
    },
    send: async (state) => {
      if (state.mode === 'edit' && state.edit) {
        const { node, parent } = state.edit;
        if (parent) {
          return (polygon ? window.sendEditPolygonReply : window.sendEditMarkerReply)(
            postTimestamp, topicId, node.created, state.text, node.payer, parent.created, state.media);
        }
        return (polygon ? window.sendEditPolygonComment : window.sendEditMarkerComment)(
          postTimestamp, topicId, node.created, state.text, node.payer, state.media);
      }
      if (state.mode === 'reply' && state.replyTo) {
        // The parent's thread opens, so the reply shows once it is sent.
        const parentId = state.replyTo.created;
        const wasOpen = openThreads.has(parentId);
        openThreads.add(parentId);
        const ok = await onReply(parentId, input, state.media);
        if (!ok && !wasOpen) openThreads.delete(parentId);
        return ok;
      }
      return onSend(input, state.media);
    },
    resize: adjustTextareaHeight,
    toast: (message) => toast.error(message),
  });
  input._commentSection = section;
  mountFieldExpand(input);
  section._composer = composer;
  section.appendChild(composer.el);

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

function closeCommentsForPage(container) {
  if (!commentsModal || !commentsModalSection || !container) return;
  const home = commentsModalSection._homeParent;
  const here = (home && container.contains(home)) || container.contains(commentsModal);
  if (!here) return;
  closeCommentsModal();
}

const FEED_FLIP_MS = 320;
const FEED_FLIP_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
let feedFlip = null;
let feedFlipSkip = false;

function feedMotionReduced() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function feedCommentCard(section) {
  const input = section && section._bubbleInput;
  const fromInput = input && input.closest ? input.closest('.feed-card') : null;
  if (fromInput && fromInput.isConnected) return fromInput;
  const home = section && section._homeParent;
  if (home && home.classList && home.classList.contains('feed-card') && home.isConnected) return home;
  return null;
}

// visual is where the card should appear; layout is its untransformed box.
function feedFlipDelta(visual, layout) {
  const sx = layout.width > 0 ? visual.width / layout.width : 1;
  const sy = layout.height > 0 ? visual.height / layout.height : 1;
  const dx = visual.left - layout.left;
  const dy = visual.top - layout.top;
  return `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
}

function clearFeedCardMotion(card) {
  if (!card) return;
  card.style.transition = '';
  card.style.transform = '';
  card.style.transformOrigin = '';
  card.style.margin = '';
  card.style.willChange = '';
}

function cancelFeedFlipTimer(flip) {
  if (!flip) return;
  flip.gen = (flip.gen || 0) + 1;
  flip.opening = false;
  flip.closing = false;
  if (flip.timer) {
    clearTimeout(flip.timer);
    flip.timer = 0;
  }
  if (flip.onEnd && flip.card) flip.card.removeEventListener('transitionend', flip.onEnd);
  flip.onEnd = null;
}

function rememberFeedFlip(card) {
  const scroller = document.getElementById('feed-scroll');
  const first = card.getBoundingClientRect();
  const parent = card.parentElement;
  const next = card.nextSibling;
  const hold = document.createElement('div');
  hold.className = 'feed-card-flip-hold';
  hold.setAttribute('aria-hidden', 'true');
  hold.style.height = card.offsetHeight + 'px';
  hold.style.margin = getComputedStyle(card).margin;
  parent.insertBefore(hold, card);
  return {
    card,
    hold,
    parent,
    next,
    scroller,
    scrollTop: scroller ? scroller.scrollTop : 0,
    first,
    restored: false,
    opening: false,
    closing: false,
    gen: 0,
    timer: 0,
    onEnd: null,
  };
}

function restoreFeedCard(flip) {
  if (!flip || flip.restored) return;
  flip.restored = true;
  cancelFeedFlipTimer(flip);
  const card = flip.card;
  if (card) clearFeedCardMotion(card);
  const hold = flip.hold;
  if (card && hold && hold.isConnected && hold.parentElement) {
    hold.parentElement.insertBefore(card, hold);
    hold.remove();
  } else if (card && flip.parent && flip.parent.isConnected) {
    const next = flip.next && flip.next.parentElement === flip.parent ? flip.next : null;
    flip.parent.insertBefore(card, next);
  } else if (card) {
    const column = document.getElementById('feed-column');
    if (column) column.appendChild(card);
  }
  flip.hold = null;
}

function restoreFeedScroll(flip) {
  const scroller = flip && (flip.scroller || document.getElementById('feed-scroll'));
  if (!scroller || !scroller.isConnected || !flip) return;
  if (Math.abs(scroller.scrollTop - flip.scrollTop) > 1) scroller.scrollTop = flip.scrollTop;
}

function armFeedFlip(card, transform, gen, done) {
  const flip = feedFlip;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (flip && flip.onEnd) {
      card.removeEventListener('transitionend', flip.onEnd);
      flip.onEnd = null;
    }
    if (flip && flip.timer) {
      clearTimeout(flip.timer);
      flip.timer = 0;
    }
    if (done) done();
  };
  const onEnd = (event) => {
    if (event.target !== card || event.propertyName !== 'transform') return;
    if (!flip || flip.gen !== gen) return;
    finish();
  };
  if (flip) {
    flip.onEnd = onEnd;
    flip.timer = setTimeout(() => {
      if (!flip || flip.gen !== gen) return;
      finish();
    }, FEED_FLIP_MS + 90);
  }
  card.addEventListener('transitionend', onEnd);
  card.style.willChange = 'transform';
  card.style.transition = `transform ${FEED_FLIP_MS}ms ${FEED_FLIP_EASE}`;
  card.style.transform = transform;
}

function startFeedFlipOpen(wrapper, flip) {
  const card = flip.card;
  if (!card || !card.isConnected) return;
  const gen = (flip.gen || 0) + 1;
  flip.gen = gen;
  const last = card.getBoundingClientRect();
  card.style.transformOrigin = 'top left';
  card.style.transition = 'none';
  card.style.willChange = 'transform';
  card.style.transform = feedFlipDelta(flip.first, last);
  flip.opening = true;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (flip.gen !== gen || !flip.opening || !card.isConnected) return;
      wrapper.classList.add('is-flip-show');
      armFeedFlip(card, 'none', gen, () => {
        if (flip.gen !== gen || !flip.opening) return;
        flip.opening = false;
        card.style.transition = '';
        card.style.transform = '';
        card.style.transformOrigin = '';
        card.style.willChange = '';
        wrapper.classList.remove('is-flip', 'is-flip-show');
        holdFeedCommentsTop(wrapper);
      });
    });
  });
}

function startFeedFlipClose(wrapper, flip, done) {
  const card = flip.card;
  cancelFeedFlipTimer(flip);
  const gen = flip.gen;
  flip.closing = true;
  wrapper.classList.remove('is-flip-show');
  wrapper.classList.add('is-flip-out');
  if (!card || !card.isConnected) {
    done();
    return;
  }
  const visual = card.getBoundingClientRect();
  card.style.transition = 'none';
  card.style.transform = 'none';
  card.style.transformOrigin = 'top left';
  const layout = card.getBoundingClientRect();
  card.style.transform = feedFlipDelta(visual, layout);
  restoreFeedScroll(flip);
  const hold = flip.hold;
  const dest = hold && hold.isConnected ? hold.getBoundingClientRect() : flip.first;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (flip.gen !== gen || !flip.closing || !card.isConnected) return;
      void card.offsetWidth;
      armFeedFlip(card, feedFlipDelta(dest, layout), gen, () => {
        if (flip.gen !== gen || !flip.closing) return;
        flip.closing = false;
        done();
      });
    });
  });
}

// The feed's Comments view opens at the comments: their top (the Top /
// Newest switch, or "No comments yet" when there are none) sits just under
// the bar, with the post scrolled up above it and its end showing in the
// small gap left by the list's scroll-margin-top (style.css
// --feed-comments-gap). Nothing
// moves when the post and its comments fit without scrolling. While the
// reader has not scrolled, the comments stay there as the post above
// changes height (an X post loading late). A wheel, a touch drag, a
// scroll key, a press anywhere in the column but the comment box, or any
// scroll this code did not make itself ends that. The list is held tall
// enough to reach the top even with few comments (.is-at-comments, with
// the comment box's and the switch's heights in --feed-comments-foot).
const FEED_COMMENTS_SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

function holdFeedCommentsTop(wrapper) {
  if (!wrapper || wrapper !== commentsModal || !wrapper.isConnected || wrapper._stopCommentsHold) return;
  const body = wrapper.querySelector('.feed-comments-body');
  const stage = body && body.querySelector('.feed-comments-stage');
  const list = body && body.querySelector('.comments-scroll');
  const compose = (body && body.querySelector('.comments-compose'))
    || (commentsModalSection && commentsModalSection._composer && commentsModalSection._composer.el);
  const sort = body && body.querySelector('.comments-sort');
  if (!body || !stage || !list) return;
  const shownSort = () => (sort && !sort.hidden ? sort : null);
  let held = true;
  // Set around this code's own scrollTop write: where it put the column.
  // The one scroll event that write causes finds the column still there
  // and is not taken for the reader's. The event can come a frame later
  // (a write from a transitionend handler), so it is matched by position,
  // not by time; a scroll anywhere else is someone else's.
  let ownTop = null;
  const writeFoot = () => {
    const below = parseFloat(getComputedStyle(list).marginBottom) || 0;
    const top = shownSort();
    const above = top
      ? top.getBoundingClientRect().height
        + (parseFloat(getComputedStyle(top).marginTop) || 0)
        + (parseFloat(getComputedStyle(top).marginBottom) || 0)
      : 0;
    const foot = (compose ? compose.getBoundingClientRect().height : 0) + below + above;
    body.style.setProperty('--feed-comments-foot', foot.toFixed(2) + 'px');
  };
  const place = () => {
    if (!body.classList.contains('is-at-comments')) {
      // It all fits: leave it where it is.
      if (body.scrollHeight <= body.clientHeight + 1) return;
      writeFoot();
      body.classList.add('is-at-comments');
    }
    const gap = parseFloat(getComputedStyle(list).scrollMarginTop) || 0;
    const anchor = shownSort() || list;
    const top = anchor.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - gap;
    const most = Math.max(0, body.scrollHeight - body.clientHeight);
    const next = Math.min(most, Math.max(0, Math.round(top)));
    if (Math.abs(body.scrollTop - next) < 1) return;
    ownTop = next;
    body.scrollTop = next;
  };
  const release = () => {
    held = false;
    ownTop = null;
    body.removeEventListener('wheel', release);
    body.removeEventListener('touchmove', release);
    body.removeEventListener('pointerdown', onPress);
    body.removeEventListener('scroll', onScroll);
    wrapper.removeEventListener('keydown', onKey, true);
  };
  // A press in the post or the comments is the reader's; one in the
  // comment box (typing, Send) is not.
  const onPress = (event) => {
    if (compose && event.target instanceof Node && compose.contains(event.target)) return;
    release();
  };
  const onScroll = () => {
    if (ownTop !== null && Math.abs(body.scrollTop - ownTop) < 1) {
      ownTop = null;
      return;
    }
    release();
  };
  const onKey = (event) => {
    if (!FEED_COMMENTS_SCROLL_KEYS.has(event.key)) return;
    const target = event.target;
    if (target && target.closest && target.closest('textarea, input, select, [contenteditable]')) return;
    release();
  };
  const watcher = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => {
      if (!body.isConnected) {
        stop();
        return;
      }
      if (body.classList.contains('is-at-comments')) writeFoot();
      if (held) place();
    })
    : null;
  const stop = () => {
    release();
    if (watcher) watcher.disconnect();
  };
  wrapper._stopCommentsHold = stop;
  body.addEventListener('wheel', release, { passive: true });
  body.addEventListener('touchmove', release, { passive: true });
  body.addEventListener('pointerdown', onPress, { passive: true });
  body.addEventListener('scroll', onScroll, { passive: true });
  wrapper.addEventListener('keydown', onKey, true);
  place();
  if (watcher) {
    watcher.observe(stage);
    if (compose) watcher.observe(compose);
  }
}

function stopFeedCommentsHold(wrapper) {
  if (wrapper && wrapper._stopCommentsHold) wrapper._stopCommentsHold();
}

function teardownCommentsModal() {
  collapseExpandedFields();
  if (!commentsModal && !commentsModalSection) {
    commentsClosing = false;
    feedFlip = null;
    return;
  }
  commentsClosing = true;
  try {
    if (feedFlip) restoreFeedCard(feedFlip);
    if (commentsModalSection) {
      const home = commentsModalSection._homeParent;
      const park = commentsModalSection._park;
      const opener = commentsModalSection._openerAnchor;
      const homePopup = home && home.closest ? home.closest('.maplibregl-popup') : null;
      const openerPopup = opener && opener.closest ? opener.closest('.maplibregl-popup') : null;
      if (homePopup) homePopup.classList.remove('comments-open');
      if (openerPopup) openerPopup.classList.remove('comments-open');
      const back = park && park.isConnected ? park : home;
      if (back && back.isConnected) {
        back.appendChild(commentsModalSection);
        watchProfileTree(back);
      }
      const saved = commentsModalSection._modalSaves;
      if (saved) {
        for (const [prop, val] of Object.entries(saved)) {
          commentsModalSection.style[prop] = val;
        }
        delete commentsModalSection._modalSaves;
      }
      // Sort and reader filters hold while the view is open; the next open is fresh.
      if (typeof commentsModalSection._resetSort === 'function') commentsModalSection._resetSort();
    }
    const input = commentBubbleInput;
    stopFeedCommentsHold(commentsModal);
    if (commentsModal) commentsModal.remove();
    commentsModal = null;
    commentsModalSection = null;
    paintUtilityPin();
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
    // Back/Forward: ‹, scrim, Escape and paging all end here.
    layerClosedByUI('comments');
  } finally {
    commentsClosing = false;
    feedFlip = null;
  }
}

function closeCommentsModal() {
  if (!commentsModal) return;
  if (commentsClosing && !feedFlipSkip) return;
  collapseExpandedFields();
  const modal = commentsModal;
  stopFeedCommentsHold(modal);
  const fromFeed = modal.classList.contains('comments-modal--feed');
  const flip = feedFlip;
  const animate = fromFeed && flip && flip.card && flip.card.isConnected && !flip.restored
    && !feedFlipSkip && !feedMotionReduced();
  if (animate) {
    commentsClosing = true;
    startFeedFlipClose(modal, flip, () => {
      teardownCommentsModal();
    });
    return;
  }
  if (flip) {
    cancelFeedFlipTimer(flip);
    restoreFeedCard(flip);
  }
  teardownCommentsModal();
}

// A map post in landscape hosts the same comments view over the right card.
// Every other case (portrait, draw column, settings) stays a fullscreen modal.
function commentsInCardHost(section) {
  const opener = section._openerAnchor;
  const anchor = opener && opener.isConnected
    ? opener
    : (section._homeParent && section._homeParent.isConnected ? section._homeParent : section);
  if (!anchor || !landscapeMQ.matches || typeof anchor.closest !== 'function') return null;
  if (!anchor.closest('.maplibregl-map')) return null;
  const popup = anchor.closest('.maplibregl-popup');
  if (!popup) return null;
  return popup.querySelector('.popup-sheet');
}

function paintCommentsSection(section) {
  if (!section._homeParent || !section._homeParent.isConnected) {
    if (section.parentElement) section._homeParent = section.parentElement;
  }
  if (!section._modalSaves) {
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
  }
  section.style.display = 'block';
  section.style.marginTop = '0';
  section.style.padding = '0';
  section.style.background = 'transparent';
  section.style.border = 'none';
  section.style.borderRadius = '0';
  section.style.backdropFilter = 'none';
  section.style.webkitBackdropFilter = 'none';
}

function commentsFromFeed(section) {
  const opener = section && section._openerAnchor;
  if (!opener || !opener.closest) return false;
  if (opener.closest('.maplibregl-map')) return false;
  return !!opener.closest('#feed-layout');
}

function feedCommentsBackIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of ['m12 19-7-7 7-7', 'M19 12H5']) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

function commentsBackChevron() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  // Ink sits on the viewBox centre. A text ‹ (U+2039) sits left of its em box.
  path.setAttribute('d', 'M14.7 5.7 8.5 12l6.2 6.3');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2.4');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  return svg;
}

function commentSettingsIcon(parts) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const [name, attrs] of parts) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    svg.appendChild(node);
  }
  return svg;
}

function commentFilterToggle(key, label, icon) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'feed-filter-toggle';
  btn.dataset.filter = key;
  btn.setAttribute('aria-pressed', 'false');
  const tile = document.createElement('span');
  tile.className = 'feed-filter-icon';
  tile.appendChild(commentSettingsIcon(icon));
  const name = document.createElement('span');
  name.className = 'feed-filter-name';
  name.textContent = label;
  const knob = document.createElement('span');
  knob.className = 'feed-filter-switch';
  knob.setAttribute('aria-hidden', 'true');
  btn.append(tile, name, knob);
  return btn;
}

function commentFilterSection(title, nodes, extraClass) {
  const section = document.createElement('div');
  section.className = 'feed-filter-section' + (extraClass ? ' ' + extraClass : '');
  const heading = document.createElement('h3');
  heading.className = 'feed-filter-section-title';
  heading.textContent = title;
  section.append(heading, ...nodes);
  return section;
}

function commentFilterField(labelText, control) {
  const row = document.createElement('label');
  row.className = 'feed-filter-row';
  const span = document.createElement('span');
  span.className = 'feed-filter-label';
  span.textContent = labelText;
  control.classList.add('feed-filter-field');
  row.append(span, control);
  return row;
}

const COMMENT_FILTER_ICONS = {
  hasImage: [
    ['rect', { x: '3', y: '3', width: '18', height: '18', rx: '2' }],
    ['circle', { cx: '9', cy: '9', r: '2' }],
    ['path', { d: 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21' }],
  ],
  textOnly: [
    ['path', { d: 'M4 7V4h16v3' }],
    ['path', { d: 'M9 20h6' }],
    ['path', { d: 'M12 4v16' }],
  ],
  mine: [
    ['path', { d: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2' }],
    ['circle', { cx: '12', cy: '7', r: '4' }],
  ],
  following: [
    ['path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }],
    ['circle', { cx: '9', cy: '7', r: '4' }],
    ['path', { d: 'M22 21v-2a4 4 0 0 0-3-3.87' }],
    ['path', { d: 'M16 3.13a4 4 0 0 1 0 7.75' }],
  ],
  earlyHashinal: [
    ['path', { d: 'M6 3h12l4 6-10 13L2 9Z' }],
    ['path', { d: 'M11 3 8 9l4 13 4-13-3-6' }],
    ['path', { d: 'M2 9h20' }],
  ],
};

function mountCommentSettings(section) {
  const previous = document.getElementById('comments-settings-panel');
  if (previous) previous.remove();
  const panel = document.createElement('div');
  panel.id = 'comments-settings-panel';
  panel.className = 'comments-settings-card';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Comment settings');
  const hasImage = commentFilterToggle('hasImage', 'Has image', COMMENT_FILTER_ICONS.hasImage);
  const textOnly = commentFilterToggle('textOnly', 'Text only', COMMENT_FILTER_ICONS.textOnly);
  const mine = commentFilterToggle('mine', 'Mine', COMMENT_FILTER_ICONS.mine);
  const following = commentFilterToggle('following', 'Following', COMMENT_FILTER_ICONS.following);
  const hint = document.createElement('p');
  hint.id = 'comments-filter-wallet-hint';
  hint.className = 'feed-filter-hint';
  hint.textContent = 'Connect your wallet to use Mine and Following';
  const early = commentFilterToggle('earlyHashinal', 'Early Hashinal holders', COMMENT_FILTER_ICONS.earlyHashinal);
  const pills = document.createElement('div');
  pills.className = 'feed-filter-pills';
  pills.setAttribute('role', 'group');
  pills.setAttribute('aria-label', 'Sort');
  for (const [value, label] of [['top', 'Top'], ['newest', 'Newest'], ['oldest', 'Oldest']]) {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'feed-filter-pill';
    pill.dataset.sort = value;
    pill.textContent = label;
    pills.appendChild(pill);
  }
  const from = document.createElement('input');
  from.type = 'date';
  from.setAttribute('aria-label', 'From');
  const to = document.createElement('input');
  to.type = 'date';
  to.setAttribute('aria-label', 'To');
  const dates = document.createElement('div');
  dates.className = 'feed-filter-dates';
  dates.append(commentFilterField('From', from), commentFilterField('To', to));
  const body = document.createElement('div');
  body.className = 'feed-filter-body';
  body.append(
    commentFilterSection('Filter', [hasImage, textOnly, mine, following, hint, early], 'is-toggles'),
    commentFilterSection('Sort', [pills]),
    commentFilterSection('Date', [dates]),
  );
  panel.appendChild(body);

  const rules = () => {
    if (!section._readerFilters) section._readerFilters = freshCommentFilters();
    return section._readerFilters;
  };
  const paintToggle = (btn, on) => {
    btn.classList.toggle('is-active', !!on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  };
  const paint = () => {
    const filters = rules();
    const wallet = !!connectedAccount;
    if (!wallet && (filters.mine || filters.following)) {
      filters.mine = false;
      filters.following = false;
    }
    paintToggle(hasImage, filters.hasImage);
    paintToggle(textOnly, filters.textOnly);
    paintToggle(mine, filters.mine);
    paintToggle(following, filters.following);
    paintToggle(early, filters.earlyHashinal);
    for (const btn of [mine, following]) {
      btn.setAttribute('aria-disabled', wallet ? 'false' : 'true');
      if (wallet) btn.removeAttribute('aria-describedby');
      else btn.setAttribute('aria-describedby', 'comments-filter-wallet-hint');
    }
    hint.hidden = wallet;
    const sort = filters.sort || section._sortMode || 'newest';
    for (const pill of pills.children) {
      const on = pill.dataset.sort === sort;
      pill.classList.toggle('is-active', on);
      pill.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    if (from.value !== (filters.dateFrom || '')) from.value = filters.dateFrom || '';
    if (to.value !== (filters.dateTo || '')) to.value = filters.dateTo || '';
  };
  const repaint = () => {
    paint();
    if (typeof section._repaintComments === 'function') section._repaintComments();
  };
  const flip = (key, other) => {
    const filters = rules();
    if (filters[key]) filters[key] = false;
    else {
      filters[key] = true;
      if (other) filters[other] = false;
    }
    repaint();
  };
  hasImage.addEventListener('click', (event) => {
    event.stopPropagation();
    flip('hasImage', 'textOnly');
  });
  textOnly.addEventListener('click', (event) => {
    event.stopPropagation();
    flip('textOnly', 'hasImage');
  });
  mine.addEventListener('click', (event) => {
    event.stopPropagation();
    if (mine.getAttribute('aria-disabled') === 'true') return;
    flip('mine');
  });
  following.addEventListener('click', (event) => {
    event.stopPropagation();
    if (following.getAttribute('aria-disabled') === 'true') return;
    const filters = rules();
    const turnOn = !filters.following;
    flip('following');
    if (!turnOn) return;
    import('./feedlayout.js').then((mod) => {
      if (typeof mod.ensureFeedFollowSet === 'function') return mod.ensureFeedFollowSet();
    }).then(() => {
      if (section._readerFilters && section._readerFilters.following && typeof section._repaintComments === 'function') {
        section._repaintComments();
      }
    }).catch(() => {});
  });
  early.addEventListener('click', (event) => {
    event.stopPropagation();
    flip('earlyHashinal');
  });
  pills.addEventListener('click', (event) => {
    const pill = event.target.closest('button');
    if (!pill || !pills.contains(pill)) return;
    event.stopPropagation();
    const value = pill.dataset.sort;
    if (!value || value === rules().sort) return;
    rules().sort = value;
    section._sortMode = value;
    if (typeof section._syncSortBar === 'function') section._syncSortBar(value);
    repaint();
  });
  from.addEventListener('change', () => {
    rules().dateFrom = from.value || '';
    repaint();
  });
  to.addEventListener('change', () => {
    rules().dateTo = to.value || '';
    repaint();
  });
  panel.addEventListener('click', (event) => event.stopPropagation());
  panel.addEventListener('pointerdown', (event) => event.stopPropagation());
  section._paintCommentSettings = paint;
  section._closeCommentSettings = () => {
    panel.hidden = true;
    const more = commentsModal && commentsModal.querySelector('.comments-more-button');
    if (more) more.setAttribute('aria-expanded', 'false');
  };
  paint();
  return panel;
}

function commentsMoreButton() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'comments-more-button';
  btn.setAttribute('aria-label', 'Comment settings');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', 'comments-settings-panel');
  btn.textContent = '\u22ef';
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    const panel = document.getElementById('comments-settings-panel');
    if (!panel) return;
    const open = panel.hidden;
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open && commentsModalSection && typeof commentsModalSection._paintCommentSettings === 'function') {
      commentsModalSection._paintCommentSettings();
    }
  });
  return btn;
}

function commentsCloseButton(section) {
  const closeBtn = document.createElement('button');
  closeBtn.className = 'maplibregl-popup-close-button comments-back-button';
  closeBtn.setAttribute('aria-label', 'Back');
  closeBtn.title = 'Back';
  const home = section && section._homeParent;
  const popup = home && home.closest ? home.closest('.maplibregl-popup') : null;
  if (popup && popup.classList.contains('early-holder-popup')) closeBtn.classList.add('is-early');
  closeBtn.appendChild(commentsBackChevron());
  closeBtn.onclick = (e) => {
    e.stopPropagation();
    closeCommentsModal();
  };
  return closeBtn;
}

function showCommentsModal(section) {
  // Your avatar and ⋯ follow the wallet connected now.
  if (section && typeof section._refresh === 'function') section._refresh();
  const homePopup = section && section._homeParent && section._homeParent.closest
    ? section._homeParent.closest('.maplibregl-popup')
    : null;
  if (homePopup) homePopup.classList.add('comments-open');
  const sheet = commentsInCardHost(section);
  const sheetPopup = sheet && sheet.closest ? sheet.closest('.maplibregl-popup') : null;
  if (sheetPopup) sheetPopup.classList.add('comments-open');
  const fromFeed = commentsFromFeed(section);
  const sourceCard = fromFeed ? feedCommentCard(section) : null;
  const flip = sourceCard ? rememberFeedFlip(sourceCard) : null;
  paintCommentsSection(section);
  const wrapper = document.createElement('div');
  let pendingFlip = null;
  if (fromFeed) {
    wrapper.className = 'comments-modal comments-modal--feed';
    // The post above the comments keeps the feed zoom (style.css
    // .feed-comments-stage); the card inherits it from the feed scroller.
    const zoom = sourceCard ? parseFloat(getComputedStyle(sourceCard).getPropertyValue('--feed-zoom')) : NaN;
    if (Number.isFinite(zoom) && zoom > 0) wrapper.style.setProperty('--post-zoom', String(zoom));
    const bar = document.createElement('div');
    bar.className = 'feed-comments-bar';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'feed-comments-back';
    back.setAttribute('aria-label', 'Back');
    back.appendChild(feedCommentsBackIcon());
    back.onclick = (e) => {
      e.stopPropagation();
      closeCommentsModal();
    };
    const title = document.createElement('div');
    title.className = 'feed-comments-title';
    title.textContent = 'Comments';
    bar.append(back, title, commentsMoreButton());
    const stage = document.createElement('div');
    stage.className = 'feed-comments-stage';
    // The post and its comments scroll as one column under the bar, with
    // the comment box held at its foot (style.css .feed-comments-body).
    const body = document.createElement('div');
    body.className = 'feed-comments-body';
    body.append(stage, section);
    const animateFlip = !!(flip && !feedMotionReduced());
    if (animateFlip) wrapper.classList.add('is-flip');
    wrapper.append(bar, mountCommentSettings(section), body);
    wrapper.addEventListener('click', (e) => e.stopPropagation());
    wrapper.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.body.appendChild(wrapper);
    if (flip) {
      flip.card.style.margin = '0';
      stage.appendChild(flip.card);
      feedFlip = flip;
      if (animateFlip) pendingFlip = { wrapper, flip };
    }
  } else if (sheet) {
    wrapper.className = 'comments-modal comments-modal--in-card';
    wrapper.appendChild(commentsCloseButton(section));
    wrapper.appendChild(commentsMoreButton());
    wrapper.appendChild(mountCommentSettings(section));
    wrapper.appendChild(section);
    if (section._homeParent) watchProfileTree(section._homeParent);
    wrapper.addEventListener('click', (e) => e.stopPropagation());
    wrapper.addEventListener('pointerdown', (e) => e.stopPropagation());
    sheet.appendChild(wrapper);
  } else {
    // Fullscreen wrapper above the post popup: the wrapper's own z-index (5000)
    // beats .maplibregl-popup's z-index:1000!important, so the modal stacks on
    // top even though the card itself reuses the popup classes
    wrapper.className = 'comments-modal';
    const overFeed = (section._openerAnchor && section._openerAnchor.closest && section._openerAnchor.closest('#feed-layout'))
      || (section._park && section._park.closest && section._park.closest('#feed-layout'))
      || (section.closest && section.closest('#feed-layout'));
    wrapper.style.cssText = `position: fixed; inset: 0; z-index: ${overFeed ? 8800 : 5000};`;

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
    cardContent.appendChild(commentsCloseButton(section));
    cardContent.appendChild(commentsMoreButton());
    cardContent.appendChild(mountCommentSettings(section));
    cardContent.appendChild(section);
    card.appendChild(cardContent);
    wrapper.appendChild(card);
    document.body.appendChild(wrapper);
    if (section._homeParent) watchProfileTree(section._homeParent);
  }

  commentsModal = wrapper;
  commentsModalSection = section;
  refitPopups();
  if (pendingFlip) startFeedFlipOpen(pendingFlip.wrapper, pendingFlip.flip);
  // No flip to wait for: open at the comments before the first paint.
  else if (fromFeed) requestAnimationFrame(() => holdFeedCommentsTop(wrapper));

  const input = commentField(section);
  if (input) setTimeout(() => input.focus(fromFeed ? { preventScroll: true } : undefined), 100);
  paintUtilityPin();
}

function retargetCommentsModal() {
  const section = commentsModalSection;
  if (!section || !commentsModal) return;
  const home = section._homeParent;
  const opener = section._openerAnchor;
  const anchor = opener && opener.isConnected ? opener : home;
  if (!anchor || !anchor.isConnected) {
    closeCommentsModal();
    return;
  }
  const wantInCard = !!(landscapeMQ.matches && anchor.closest && anchor.closest('.maplibregl-map'));
  const isInCard = commentsModal.classList.contains('comments-modal--in-card');
  if (wantInCard === isInCard) return;
  collapseExpandedFields();
  const saves = section._modalSaves;
  const bubble = section._bubbleInput;
  forgetProfileTree(section);
  section.remove();
  commentsModal.remove();
  commentsModal = null;
  section._homeParent = home;
  section._modalSaves = saves;
  section._bubbleInput = bubble;
  showCommentsModal(section);
}

if (!landscapeCommentsBound) {
  landscapeCommentsBound = true;
  landscapeMQ.addEventListener('change', () => {
    retargetCommentsModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !commentsModal) return;
    if (document.getElementById('media-fullscreen')) return;
    const panel = document.getElementById('comments-settings-panel');
    if (panel && commentsModal.contains(panel) && !panel.hidden) {
      event.preventDefault();
      event.stopImmediatePropagation();
      panel.hidden = true;
      const more = commentsModal.querySelector('.comments-more-button');
      if (more) more.setAttribute('aria-expanded', 'false');
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    closeCommentsModal();
  }, true);
  // A wallet connected or left while the comments are open: your avatar
  // and ⋯ on your own rows follow it.
  document.addEventListener('wallet-account-changed', () => {
    paintUtilityPin();
    if (commentsModalSection && typeof commentsModalSection._refresh === 'function') {
      commentsModalSection._refresh();
    }
  });
}

function openCommentsModal(sectionId) {
  if (commentsModal) {
    feedFlipSkip = true;
    try { closeCommentsModal(); }
    finally { feedFlipSkip = false; }
  }
  const section = document.getElementById(sectionId);
  if (!section) return;
  showCommentsModal(section);
  // Back/Forward: the comments view is a layer above the post popup.
  layerOpened('comments', { sectionId });
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

export function commentSectionId(kind, topicId, stamp) {
  return `${kind === 'polygon' ? 'polygon' : 'marker'}-comments-${topicId}-${stamp}`;
}

export function applyMountedCommentTree(topicId, kind, stamp, tree) {
  if (typeof document === 'undefined' || !document.getElementById) return false;
  const section = document.getElementById(commentSectionId(kind, topicId, stamp));
  if (!section || typeof section._setComments !== 'function') return false;
  section._setComments(tree);
  return true;
}

function authorOk(payer) {
  if (!connectedAccount || connectedAccount !== payer) {
    toast.error('Only the author can change this comment');
    return false;
  }
  return true;
}

function mountedCommentSection(kind, topicId, stamp) {
  if (typeof document === 'undefined' || !document.getElementById) return null;
  return document.getElementById(commentSectionId(kind, topicId, stamp));
}

async function submitCommentBody(topicId, body) {
  if (!signer) {
    toast.error('Connect wallet first');
    return false;
  }
  toast.info('Confirm in wallet 👛');
  try {
    await sendMessage(topicId, JSON.stringify(body));
  } catch (error) {
    console.error('comment send failed', error);
    toast.error('Comment was not saved');
    return false;
  }
  return true;
}

function clearCommentInput(input) {
  if (!input) return;
  input.value = '';
  adjustTextareaHeight(input);
}

function commentField(section) {
  const owned = section && section._composer && section._composer.input;
  if (owned) return owned;
  return section && section.querySelector ? section.querySelector('textarea') : null;
}

function rememberSentComment(input, text, parentId, image) {
  const section = (input && input._commentSection)
    || (input && input.closest ? input.closest('.popup-comments') : null);
  if (!section || typeof section._insertPending !== 'function' || !connectedAccount) return;
  section._insertPending({
    payer: connectedAccount,
    text,
    image: image || '',
    created: new Date().toISOString(),
    pending: true,
    likeCount: 0,
    edited: false,
    deleted: false,
    replies: [],
  }, parentId || null);
}

function patchMountedComment(kind, topicId, stamp, created, fields) {
  const section = mountedCommentSection(kind, topicId, stamp);
  if (!section || typeof section._mutate !== 'function') return;
  section._mutate(created, fields);
}

// The optional last argument of the send helpers: the uploaded media's URL
// (uploadmedia.js uploadCommentMedia), as a string or { image }. Only an
// address commentImageValue accepts is sent.
function sentCommentImage(media) {
  if (typeof media === 'string') return commentImageValue(media);
  return commentImageValue(media && media.image);
}

// On an edit, media is optional too: a string or { image } replaces it,
// "" or null (or { image: "" }) clears it, nothing keeps it.
function editedCommentImage(media) {
  if (media === undefined) return { set: false, image: '' };
  if (media === null || typeof media === 'string') return { set: true, image: commentImageValue(media) };
  if (media && Object.prototype.hasOwnProperty.call(media, 'image')) {
    return { set: true, image: commentImageValue(media.image) };
  }
  return { set: false, image: '' };
}

// One comment or reply: text, media, or both. The text keeps its 1000
// cap; the media is its own field, never part of the text. true once the
// wallet sent it: the box is cleared and the row shows in the open thread.
async function sendCommentOrReply(field, base, topicId, input, parentId, media) {
  const text = clipCommentText(input && input.value);
  const image = sentCommentImage(media);
  if (!text && !image) {
    toast.error('Comment is empty');
    return false;
  }
  const body = { ...base, text };
  if (image) body.image = image;
  const ok = await submitCommentBody(topicId, { [field]: body });
  if (!ok) return false;
  clearCommentInput(input);
  rememberSentComment(input, text, parentId, image);
  return true;
}

window.sendMarkerComment = function(timestamp, topicId, input, media) {
  return sendCommentOrReply('commentMarker', { timestamp }, topicId, input, null, media);
};

window.sendPolygonComment = function(timestamp, topicId, input, media) {
  return sendCommentOrReply('commentPolygon', { timestamp }, topicId, input, null, media);
};

window.sendMarkerReply = function(postTimestamp, parentId, topicId, input, media) {
  return sendCommentOrReply('replyMarker', { timestamp: postTimestamp, parentId }, topicId, input, parentId, media);
};

window.sendPolygonReply = function(postTimestamp, parentId, topicId, input, media) {
  return sendCommentOrReply('replyPolygon', { timestamp: postTimestamp, parentId }, topicId, input, parentId, media);
};

async function sendCommentEdit(kind, field, timestamp, topicId, created, text, payer, parentId, media) {
  if (!authorOk(payer)) return false;
  const section = mountedCommentSection(kind, topicId, timestamp);
  const current = section && findComment(section._tree || [], created);
  if (current && current.deleted) {
    toast.error('Comment was deleted');
    return false;
  }
  const clipped = clipCommentText(text);
  const edit = editedCommentImage(media);
  // What the comment will show: the edit's media, or the media it has.
  const image = edit.set ? edit.image : commentImageValue(current && current.image);
  if (!clipped && !image) {
    toast.error('Comment is empty');
    return false;
  }
  const payload = { created, text: clipped, timestamp };
  if (parentId) payload.parentId = parentId;
  if (edit.set) payload.image = edit.image;
  const ok = await submitCommentBody(topicId, { [field]: payload });
  if (!ok) return false;
  const fields = { text: clipped, edited: true };
  if (edit.set) fields.image = edit.image;
  patchMountedComment(kind, topicId, timestamp, created, fields);
  return true;
}

async function sendCommentDelete(kind, field, timestamp, topicId, created, payer, parentId) {
  if (!authorOk(payer)) return false;
  if (!created) return false;
  const payload = { created, timestamp };
  if (parentId) payload.parentId = parentId;
  const ok = await submitCommentBody(topicId, { [field]: payload });
  if (!ok) return false;
  patchMountedComment(kind, topicId, timestamp, created, { text: '', image: '', deleted: true });
  return true;
}

// media (last, optional): see editedCommentImage.
window.sendEditMarkerComment = (timestamp, topicId, created, text, payer, media) => (
  sendCommentEdit('marker', 'editCommentMarker', timestamp, topicId, created, text, payer, undefined, media)
);
window.sendEditPolygonComment = (timestamp, topicId, created, text, payer, media) => (
  sendCommentEdit('polygon', 'editCommentPolygon', timestamp, topicId, created, text, payer, undefined, media)
);
window.sendEditMarkerReply = (timestamp, topicId, created, text, payer, parentId, media) => (
  sendCommentEdit('marker', 'editReplyMarker', timestamp, topicId, created, text, payer, parentId, media)
);
window.sendEditPolygonReply = (timestamp, topicId, created, text, payer, parentId, media) => (
  sendCommentEdit('polygon', 'editReplyPolygon', timestamp, topicId, created, text, payer, parentId, media)
);
window.sendDeleteMarkerComment = (timestamp, topicId, created, payer) => (
  sendCommentDelete('marker', 'deleteCommentMarker', timestamp, topicId, created, payer)
);
window.sendDeletePolygonComment = (timestamp, topicId, created, payer) => (
  sendCommentDelete('polygon', 'deleteCommentPolygon', timestamp, topicId, created, payer)
);
window.sendDeleteMarkerReply = (timestamp, topicId, created, payer, parentId) => (
  sendCommentDelete('marker', 'deleteReplyMarker', timestamp, topicId, created, payer, parentId)
);
window.sendDeletePolygonReply = (timestamp, topicId, created, payer, parentId) => (
  sendCommentDelete('polygon', 'deleteReplyPolygon', timestamp, topicId, created, payer, parentId)
);

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
      const commentIndex = new Map();
      const commentPending = new Map();
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

      // Comments, replies, and author edits/deletes. Same rules as the server.
      ingestParsedComments(parsedMessage, payerId, topicId, {
        commentsMapMarker,
        commentsMapPolygon,
        repliesMapMarker,
        repliesMapPolygon,
        likeCountMapMarker,
        dislikeCountMapMarker,
        likeCountMapPolygon,
        dislikeCountMapPolygon,
        payerActionsPerTimestamp,
        commentIndex,
        commentPending,
      });
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


              const defaultProfilePic = DEFAULT_AVATAR;
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
                rememberShapeEdit(message.payer, parsedMessage.marker.data, (message && message.created) || parsedMessage.created);
                rememberCommentPin(message.payer, parsedMessage.marker.data, (message && message.created) || parsedMessage.created);

                // A stored whole number keeps dedup. No number is a new post.
                // A delete matches the post's created time or timestamp.
                // A legacy number delete does not claim the slot.
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
                      commentPin: parsedMessage.marker.data.commentPin,
                      msg: editedMsg(parsedMessage.marker.data.msg, message.payer, messageCreated(postCreated), timestamp),
                      edited: hasShapeEdit(message.payer, messageCreated(postCreated), timestamp),
                      timestamp,
                      created: messageCreated(postCreated),
                      consensusTimestamp: consensusOf(message),
                      likeCountMarker: likeCountMapMarker.get(timestamp) || 0,
                      likedByMe: payerHasLike(payerActionsPerTimestamp, timestamp, 'likeMarker'),
                      comments: assembledComments(commentsMapMarker.get(timestamp), repliesMapMarker, likeCountMapMarker, dislikeCountMapMarker, payerActionsPerTimestamp, 'likeMarker'),
                      coords
                    });

                    topicGeojsonFeatures.push({
                      topicId: topicId,
                      created: postCreated,
                      msgNumber: markernumber,
                      type: "Feature",
                      payer: message.payer,
                      media: mediaKind(parsedMessage.marker.data.image),
                      seconds: videoSeconds(parsedMessage.marker.data.image),
                      properties: {
                        media: mediaKind(parsedMessage.marker.data.image),
                        seconds: videoSeconds(parsedMessage.marker.data.image),
                        popupData: markerPopupData,
                        imageUrl: coverImageUrl(parsedMessage.marker.data.coverimage, avatarSrc(profileUrl)),
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
                rememberShapeEdit(message.payer, parsedMessage.polygon.data, (message && message.created) || parsedMessage.created);
                rememberCommentPin(message.payer, parsedMessage.polygon.data, (message && message.created) || parsedMessage.created);

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
                        commentPin: parsedMessage.polygon.data.commentPin,
                        msg: editedMsg(parsedMessage.polygon.data.msg, message.payer, messageCreated(postCreated), timestamp),
                        edited: hasShapeEdit(message.payer, messageCreated(postCreated), timestamp),
                        timestamp,
                        created: messageCreated(postCreated),
                      consensusTimestamp: consensusOf(message),
                        likeCountPolygon: likeCountMapPolygon.get(timestamp) || 0,
                        likedByMe: payerHasLike(payerActionsPerTimestamp, timestamp, 'likePolygon'),
                        comments: assembledComments(commentsMapPolygon.get(timestamp), repliesMapPolygon, likeCountMapPolygon, dislikeCountMapPolygon, payerActionsPerTimestamp, 'likePolygon'),
                        coordinates
                      });

                      topicPolygons.push({
                        topicId: topicId,
                        created: postCreated,
                        msgNumber: polygonnumber,
                        id: `polygon-${message.payer}-${topicId}-${polygonnumber}`,
                        payer: message.payer,
                        media: mediaKind(parsedMessage.polygon.data.image),
                        seconds: videoSeconds(parsedMessage.polygon.data.image),
                        coordinates: [coordinates],
                        popupData: polygonPopupData,
                        title: String(parsedMessage.polygon.data.title || "").slice(0, 20),
                        imageUrl: coverImageUrl(parsedMessage.polygon.data.coverimage, profileUrl)
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

          rememberTopicAutoplay(topicId, currentAutoplayNft(messages, topicAdmin));
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
      const commentIndex = new Map();
      const commentPending = new Map();
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

      // Comments, replies, and author edits/deletes. Same rules as the server.
      ingestParsedComments(parsedMessage, payerId, topicId, {
        commentsMapMarker,
        commentsMapPolygon,
        repliesMapMarker,
        repliesMapPolygon,
        likeCountMapMarker,
        dislikeCountMapMarker,
        likeCountMapPolygon,
        dislikeCountMapPolygon,
        payerActionsPerTimestamp,
        commentIndex,
        commentPending,
      });
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


              const defaultProfilePic = DEFAULT_AVATAR;
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
                rememberShapeEdit(message.payer, parsedMessage.marker.data, (message && message.created) || parsedMessage.created);
                rememberCommentPin(message.payer, parsedMessage.marker.data, (message && message.created) || parsedMessage.created);

                // A stored whole number keeps dedup. No number is a new post.
                // A delete matches the post's created time or timestamp.
                // A legacy number delete does not claim the slot.
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
                      commentPin: parsedMessage.marker.data.commentPin,
                      msg: editedMsg(parsedMessage.marker.data.msg, message.payer, messageCreated(postCreated), timestamp),
                      edited: hasShapeEdit(message.payer, messageCreated(postCreated), timestamp),
                      timestamp,
                      created: messageCreated(postCreated),
                      consensusTimestamp: consensusOf(message),
                      likeCountMarker: likeCountMapMarker.get(timestamp) || 0,
                      likedByMe: payerHasLike(payerActionsPerTimestamp, timestamp, 'likeMarker'),
                      comments: assembledComments(commentsMapMarker.get(timestamp), repliesMapMarker, likeCountMapMarker, dislikeCountMapMarker, payerActionsPerTimestamp, 'likeMarker'),
                      coords
                    });

                    if (message.ciphertext){

                    topicGeojsonFeatures.push({
                      topicId: topicId,
                      created: postCreated,
                      msgNumber: markernumber,
                      type: "Feature",
                      payer: message.payer,
                      media: mediaKind(parsedMessage.marker.data.image),
                      seconds: videoSeconds(parsedMessage.marker.data.image),
                      properties: {
                        media: mediaKind(parsedMessage.marker.data.image),
                        seconds: videoSeconds(parsedMessage.marker.data.image),
                        popupData: markerPopupData,
                        imageUrl: coverImageUrl(parsedMessage.marker.data.coverimage, avatarSrc(profileUrl)),
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
                rememberShapeEdit(message.payer, parsedMessage.polygon.data, (message && message.created) || parsedMessage.created);
                rememberCommentPin(message.payer, parsedMessage.polygon.data, (message && message.created) || parsedMessage.created);

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
                        commentPin: parsedMessage.polygon.data.commentPin,
                        msg: editedMsg(parsedMessage.polygon.data.msg, message.payer, messageCreated(postCreated), timestamp),
                        edited: hasShapeEdit(message.payer, messageCreated(postCreated), timestamp),
                        timestamp,
                        created: messageCreated(postCreated),
                      consensusTimestamp: consensusOf(message),
                        likeCountPolygon: likeCountMapPolygon.get(timestamp) || 0,
                        likedByMe: payerHasLike(payerActionsPerTimestamp, timestamp, 'likePolygon'),
                        comments: assembledComments(commentsMapPolygon.get(timestamp), repliesMapPolygon, likeCountMapPolygon, dislikeCountMapPolygon, payerActionsPerTimestamp, 'likePolygon'),
                        coordinates
                      });


                      if(message.ciphertext){

                      topicPolygons.push({
                        topicId: topicId,
                        created: postCreated,
                        msgNumber: polygonnumber,
                        id: `polygon-${message.payer}-${topicId}-${polygonnumber}`,
                        payer: message.payer,
                        media: mediaKind(parsedMessage.polygon.data.image),
                        seconds: videoSeconds(parsedMessage.polygon.data.image),
                        coordinates: [coordinates],
                        popupData: polygonPopupData,
                        title: String(parsedMessage.polygon.data.title || "").slice(0, 20),
                        imageUrl: coverImageUrl(parsedMessage.polygon.data.coverimage, profileUrl)
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

          rememberTopicAutoplay(topicId, currentAutoplayNft(messages, topicAdmin));
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