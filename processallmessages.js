import {getTopicInfo} from './hedera'
import { prepareHoldings, fetchAccountTokens } from './nftcache.js'
import {sendMessage} from './msgbackend'
import {getTopicData as getMessages} from './topicdata'
import { adjustTextareaHeight } from './adjusttextarea';
import { activePolygonPopups, newActivePolygonPopups, addPolygonWithImageFill} from './polygons';
import { activeMarkerPopups, newActiveMarkerPopups, updateClusters, index } from './marker';
import { removeUfoModel, changePopupState, closeTransientMapUI} from './cssLogic'
import { polygons, geojson, storedMarkers, storedPolygons, currentUfoModelInGLTF,  newExistingMarkers,  existingMarkers, newStoredMarkers, newStoredPolygons,
  accidTopicChatColor, usernameTopicChatColor, textTopicChatColor, innerContainerTopicChatColor, topicChatHeaderColor,
  textFontSizeTopicChat, timestampFontSizeTopicChat, headerFontSizeTopicChat } from './letall';
import {updateRulesForModelNFTState} from './confirmnft'
import { animateMapTo, cancelAnimateMapTo } from './animatemapto';
import { ringCenter, zoomForPolygon } from './polygonframe.js';
import { profilePictures, usernames, click2url} from './loadalladata'
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
    const markerOk = marker && Number.isInteger(Number(marker.numberOfMarker)) && markerCoordinates(marker.cord);
    const polygonOk = polygon && Number.isInteger(Number(polygon.numberOfPolygon)) && polygonCoordinates(polygon.cord);
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

function publishApprovedDrawings(features, polys, state, sync) {
  const markers = features.slice(state.markers);
  const nextPolys = polys.slice(state.polys);
  state.markers = features.length;
  state.polys = polys.length;
  if (markers.length > 0) geojson.features.push(...markers);
  if (nextPolys.length > 0) {
    polygons.push(...nextPolys);
    for (const polygon of nextPolys) addPolygonWithImageFill(map, polygon);
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
  if (markers.length === 0) return;
  if (clusterTimer) return;
  clusterTimer = setTimeout(flush, 150);
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
  const payerRank = newestPayerOrder(ctx.messages);
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

window.openPopupSettings = function() {
  requestAnimationFrame(() => {
    // The settings live in one centered card over a dark backdrop; the
    // backdrop hides the map popup underneath and closes on tap.
    const backdrop = document.getElementById("popup-settings-backdrop");
    const card = document.getElementById("popup-settings-card");
    if (backdrop.style.display === "block") {
      backdrop.style.display = "none";
      card.style.display = "none";
      document.getElementById("popup-column-container-3").style.display = "none";
    } else {
      backdrop.style.display = "block";
      card.style.display = "block";
      document.getElementById("popup-column-container-3").style.display = "block";
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

function createHeartLike({ count, liked, mini, onToggle }) {
  const total = Number(count) || 0;
  const base = liked ? Math.max(0, total - 1) : total;
  const root = document.createElement('div');
  root.className = mini ? 'heart-like heart-like-mini' : 'heart-like';
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

function isValidUrl(url) {
  try {
      new URL(url);
      return true;
  } catch {
      return false;
  }
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
    // Optional (live-marker view): walk a custom list instead of the topic
    onPrev,
    onNext
  } = data;

  const container = document.createElement('div');

  // Swipe left = next message, swipe right = previous. Only clearly
  // horizontal drags trigger it (vertical scroll, taps and video drags
  // are ignored).
  let swipeX = null, swipeY = null;
  container.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.popup-media-card')) return;
    swipeX = e.clientX;
    swipeY = e.clientY;
  });
  container.addEventListener('pointerup', (e) => {
    if (swipeX === null) return;
    const dx = e.clientX - swipeX;
    const dy = e.clientY - swipeY;
    swipeX = swipeY = null;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) {
      onNext ? onNext() : window.nextMsgFromPayerMarker(payer, markernumber, topicId);
    } else {
      onPrev ? onPrev() : window.prevMsgFromPayerMarker(payer, markernumber, topicId);
    }
  });

  // Top row: × on the left, number in the middle, settings on the right.
  const topHeader = document.createElement('div');
  topHeader.className = 'popup-top-row';

  const numberDiv = document.createElement('div');
  numberDiv.className = 'number popup-top-id';
  numberDiv.style.cssText = 'cursor: pointer;';
  numberDiv.textContent = markernumber;
  // Tap the number → zoom to 19 centered on this marker. coords arrives as
  // [lng, lat] from the topic pipeline, "lng,lat" from the live-marker view.
  numberDiv.addEventListener('click', (e) => {
    e.stopPropagation();
    let c = null;
    if (Array.isArray(coords) && coords.length === 2) {
      c = [Number(coords[0]), Number(coords[1])];
    } else if (typeof coords === 'string') {
      const [a, b] = coords.split(',').map(Number);
      if (Number.isFinite(a) && Number.isFinite(b)) c = [a, b];
    }
    if (c) {
      cancelAnimateMapTo(); // stop the popup-open loop, or it kills this flyTo
      map.flyTo({ center: c, zoom: 19, essentialOnly: true });
    }
  });
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

  topHeader.appendChild(numberDiv);
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
  const trimmedClick2link = click2link.trim();

  if (trimmedClick2link) {
    const usernameLink = document.createElement('a');
    try {
      new URL(trimmedClick2link);
      usernameLink.href = trimmedClick2link;
    } catch (e) {}
    usernameLink.target = '_blank';
    usernameLink.rel = 'noopener noreferrer';
    usernameLink.className = 'username';
    usernameLink.style.textDecoration = 'none';
    usernameLink.textContent = trimmedUsername;
    h2.appendChild(usernameLink);
  } else if (trimmedUsername) {
    const usernameText = document.createTextNode(trimmedUsername);
    h2.appendChild(usernameText);
  }

  headerDiv.appendChild(h2);
  profileSection.appendChild(headerDiv);
  container.appendChild(profileSection);

  // Content section
  const contentSection = document.createElement('div');
  contentSection.style.textAlign = 'center';

  // Navigation and title
  const navSection = document.createElement('div');
  navSection.style.cssText = 'display: flex; align-items: center; justify-content: space-between; position: relative; margin-bottom: calc(var(--u) * 0.25);';

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

  contentSection.appendChild(navSection);

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

  container.appendChild(contentSection);

  // Row 6 — heart + comment centered (topic id + timestamp live in row 7)
  const bottomRow = document.createElement('div');
  bottomRow.style.cssText = 'position: relative; height: calc(var(--u) * 6.2); line-height: 1; margin-top: calc(var(--u) * 0.4); overflow: visible;';

  // Timestamp (row 7, right side)
  const timestampDiv = document.createElement('div');
  timestampDiv.className = 'popup-timestamp';
  timestampDiv.style.cssText = 'margin-left: auto; margin-right: calc(var(--u) * -0.5); flex-shrink: 0;';
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
    count: countAllMessages(comments),
    onToggle: (open) => toggleCommentsBubble(open, markerCommentsId),
  }));

  bottomRow.appendChild(likeDislikeDiv);

  // Settings (row 7)
  const settingsSpan = document.createElement('span');
  settingsSpan.className = 'popup-icon-chip';
  settingsSpan.textContent = '⚙️';
  settingsSpan.onclick = () => window.openPopupSettings();
  topHeader.appendChild(settingsSpan);
  // Row 7 — topic id and name on the left, timestamp on the right.
  const bottomLeftRow = document.createElement('div');
  bottomLeftRow.style.cssText = 'position: relative; display: flex; align-items: center; gap: calc(var(--u) * 0.7); height: calc(var(--u) * 4); margin-top: 0; margin-left: calc(var(--u) * -0.5); margin-bottom: calc(var(--u) * -0.3);';
  bottomLeftRow.appendChild(topicSpan);
  bottomLeftRow.appendChild(timestampDiv);

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
    coordinates
  } = data;

  const container = document.createElement('div');

  // Swipe left = next message, swipe right = previous. Only clearly
  // horizontal drags trigger it (vertical scroll, taps and video drags
  // are ignored).
  let swipeX = null, swipeY = null;
  container.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.popup-media-card')) return;
    swipeX = e.clientX;
    swipeY = e.clientY;
  });
  container.addEventListener('pointerup', (e) => {
    if (swipeX === null) return;
    const dx = e.clientX - swipeX;
    const dy = e.clientY - swipeY;
    swipeX = swipeY = null;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) window.nextMsgFromPayerPolygon(payer, polygonnumber, topicId);
    else window.prevMsgFromPayerPolygon(payer, polygonnumber, topicId);
  });

  // Top row: × on the left, number in the middle, settings on the right.
  const topHeader = document.createElement('div');
  topHeader.className = 'popup-top-row';

  const numberDiv = document.createElement('div');
  numberDiv.className = 'number popup-top-id';
  numberDiv.style.cssText = 'cursor: pointer;';
  numberDiv.textContent = polygonnumber;
  // Tap the number → same frame Open on the map uses for this polygon.
  numberDiv.addEventListener('click', (e) => {
    e.stopPropagation();
    const polygon = { coordinates: [coordinates] };
    const center = ringCenter(polygon);
    if (!center) return;
    animateMapTo(map, center, zoomForPolygon(polygon));
  });
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

  topHeader.appendChild(numberDiv);
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
  const trimmedClick2link = click2link.trim();

  if (trimmedClick2link) {
    const usernameLink = document.createElement('a');
    try {
      new URL(trimmedClick2link);
      usernameLink.href = trimmedClick2link;
    } catch (e) {}
    usernameLink.target = '_blank';
    usernameLink.rel = 'noopener noreferrer';
    usernameLink.className = 'username';
    usernameLink.style.textDecoration = 'none';
    usernameLink.textContent = trimmedUsername;
    h2.appendChild(usernameLink);
  } else if (trimmedUsername) {
    const usernameText = document.createTextNode(trimmedUsername);
    h2.appendChild(usernameText);
  }

  headerDiv.appendChild(h2);
  profileSection.appendChild(headerDiv);
  container.appendChild(profileSection);

  // Content section
  const contentSection = document.createElement('div');
  contentSection.style.textAlign = 'center';

  // Navigation and title
  const navSection = document.createElement('div');
  navSection.style.cssText = 'display: flex; align-items: center; justify-content: space-between; position: relative; margin-bottom: calc(var(--u) * 0.25);';

  const prevSpan = document.createElement('span');
  prevSpan.className = 'popup-icon-chip';
  prevSpan.textContent = '←';
  prevSpan.onclick = () => window.prevMsgFromPayerPolygon(payer, polygonnumber, topicId);
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
  nextSpan.onclick = () => window.nextMsgFromPayerPolygon(payer, polygonnumber, topicId);
  navSection.appendChild(nextSpan);

  contentSection.appendChild(navSection);

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

  // Row 6 — heart + comment centered (topic id + timestamp live in row 7)
  const bottomRow = document.createElement('div');
  bottomRow.style.cssText = 'position: relative; height: calc(var(--u) * 6.2); line-height: 1; margin-top: calc(var(--u) * 0.4); overflow: visible;';

  // Timestamp (row 7, right side)
  const timestampDiv = document.createElement('div');
  timestampDiv.className = 'popup-timestamp';
  timestampDiv.style.cssText = 'margin-left: auto; margin-right: calc(var(--u) * -0.5); flex-shrink: 0;';
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
    count: countAllMessages(comments),
    onToggle: (open) => toggleCommentsBubble(open, polygonCommentsId),
  }));

  bottomRow.appendChild(likeDislikeDiv);

  // Settings (row 7)
  const settingsSpan = document.createElement('span');
  settingsSpan.className = 'popup-icon-chip';
  settingsSpan.textContent = '⚙️';
  settingsSpan.onclick = () => window.openPopupSettings();
  topHeader.appendChild(settingsSpan);
  // Row 7 — topic id and name on the left, timestamp on the right.
  const bottomLeftRow = document.createElement('div');
  bottomLeftRow.style.cssText = 'position: relative; display: flex; align-items: center; gap: calc(var(--u) * 0.7); height: calc(var(--u) * 4); margin-top: 0; margin-left: calc(var(--u) * -0.5); margin-bottom: calc(var(--u) * -0.3);';
  bottomLeftRow.appendChild(topicSpan);
  bottomLeftRow.appendChild(timestampDiv);

  container.appendChild(bottomRow);
  container.appendChild(bottomLeftRow);

  // Comments (below the bottom row, hidden until 💬 is pressed)
  const polygonComments = buildCommentsSection(polygonCommentsId, comments, (input) => window.sendPolygonComment(timestamp, topicId, input), (parentId, input) => window.sendPolygonReply(timestamp, parentId, topicId, input), topicId, 'polygon');
  polygonComments._bubbleInput = likeDislikeDiv.querySelector('.comment-bubble input');
  container.appendChild(polygonComments);

  return container;
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

          for (let index = messages.length - 1; index >= 0; index--) {
            const message = messages[index];
            try {
              let parsedMessage = message;
              if (typeof message === 'string') {
                parsedMessage = JSON.parse(message);
              }
              // Check if changeName exists and either topicAdmin is empty or includes the payer
              if (parsedMessage.changeName && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
                loadedTopicName = parsedMessage.changeName;
                break; // Stop after finding the first valid message
              }
            } catch (messageError) {
              console.error(`Error processing message ${index}:`, messageError);
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
          const messagesByPayer = new Map();
          for (const message of newestMessages) {
            const payerId = message && message.payer;
            if (!payerId) continue;
            let bucket = messagesByPayer.get(payerId);
            if (!bucket) {
              bucket = [];
              messagesByPayer.set(payerId, bucket);
            }
            bucket.push(message);
          }
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

              if (parsedMessage.marker && parsedMessage.marker.data) {
                const markernumber = parsedMessage.marker.data.numberOfMarker;
                const markerOwner = markerOwnershipArray.find(owner => owner.payerId === message.payer);
                if (!markerOwner) {
                  continue;
                }

                if (parsedMessage.marker.data.deleteMarkerNumber) {
                  const deleteMarkerNumber = parsedMessage.marker.data.deleteMarkerNumber;
                  markerOwner.numberOfMarker.push(deleteMarkerNumber);
                }

                const markerCoords = (markernumber === undefined || markernumber === null || !Number.isInteger(Number(markernumber)))
                  ? null
                  : markerCoordinates(parsedMessage.marker.data.cord);

                if (markerCoords && !markerOwner.numberOfMarker.includes(markernumber)) {
                if (!hasRulesForMarker || markerOwner.numberOfMessages > 0) {
                  markerOwner.numberOfMarker.push(markernumber);
                  if (hasRulesForMarker) {
                    markerOwner.numberOfMessages -= 1;
                  }

                  const coords = markerCoords;
                  {
                    const likeCountMarker = likeCountMapMarker.get(timestamp) || 0;

                    // Create marker popup HTML using DOM helper
                    const markerPopupHTML = createMarkerPopupHTML({
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
                      msg: parsedMessage.marker.data.msg,
                      timestamp,
                      likeCountMarker,
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
                      created: parsedMessage.created,
                      msgNumber: parsedMessage.marker.data.numberOfMarker,
                      type: "Feature",
                      payer: message.payer,
                      properties: {
                        message: markerPopupHTML,
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
                const polygonnumber = parsedMessage.polygon.data.numberOfPolygon;

                if (parsedMessage.polygon.data.deletePolygonNumber) {
                  const deletePolygonNumber = parsedMessage.polygon.data.deletePolygonNumber;
                  polygonOwner.numberOfPolygon.push(deletePolygonNumber);
                }

                const polygonRing = (polygonnumber === undefined || polygonnumber === null || !Number.isInteger(Number(polygonnumber)))
                  ? null
                  : polygonCoordinates(parsedMessage.polygon.data.cord);

                if (polygonRing && !polygonOwner.numberOfPolygon.includes(polygonnumber)) {
                if (!hasRulesForPolygon || polygonOwner.numberOfMessages > 0) {
                  polygonOwner.numberOfPolygon.push(polygonnumber);
                  if (hasRulesForPolygon) {
                    polygonOwner.numberOfMessages -= 1;
                  }

                  {
                    const coordinates = polygonRing;
                    if (Array.isArray(coordinates) && coordinates.length > 2) {
                      const polygonSize = hasRulesForPolygon ? smallestPolygonSize(loadedTopicRulesForPolygon) : 1;

                      const likeCountPolygon = likeCountMapPolygon.get(timestamp) || 0;

                      // Create polygon popup HTML using DOM helper
                      const polygonPopupHTML = createPolygonPopupHTML({
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
                        msg: parsedMessage.polygon.data.msg,
                        timestamp,
                        likeCountPolygon,
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
                        created: parsedMessage.created,
                        msgNumber: parsedMessage.polygon.data.numberOfPolygon,
                        id: `polygon-${message.payer}-${topicId}-${parsedMessage.polygon.data.numberOfPolygon}`,
                        payer: message.payer,
                        coordinates: [coordinates],
                        description: polygonPopupHTML,
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

window.nextMsgFromPayerMarker = function(payer, markerNumber, topicId) {
    if (!storedMarkers || !payer || markerNumber == null || !topicId) {
        console.error('Invalid input or missing storedMarkers');
        return null;
    }

    // --------------------------------------------------------------
    // 1. Flatten + sort all markers chronologically
    // --------------------------------------------------------------
    const markers = storedMarkers
        .flat()
        .sort((a, b) => new Date(a.msgNumber) - new Date(b.msgNumber));

    // --------------------------------------------------------------
    // 2. Locate the current marker
    // --------------------------------------------------------------
    let curIdx = -1;
    for (let i = 0; i < markers.length; i++) {
        if (markers[i].payer === payer &&
            markers[i].msgNumber === String(markerNumber) &&
            markers[i].topicId === topicId) {
            curIdx = i;
            break;
        }
    }
    if (curIdx === -1) return null;

    // --------------------------------------------------------------
    // 3. Next marker in the SAME topic
    // --------------------------------------------------------------
    for (let i = curIdx + 1; i < markers.length; i++) {
        if (markers[i].payer === payer && markers[i].topicId === topicId) {
            return showMarker(markers[i]);
        }
    }

    // --------------------------------------------------------------
    // 4. No more in this topic → next topic (or wrap to first)
    // --------------------------------------------------------------
    const firstSeen = new Map();               // topicId → earliest msgNumber
    for (const m of markers) {
        if (m.payer !== payer) continue;
        if (!firstSeen.has(m.topicId)) {
            firstSeen.set(m.topicId, m.msgNumber);
        }
    }

    const orderedTopics = Array.from(firstSeen.entries())
        .sort(([, a], [, b]) => new Date(a) - new Date(b))
        .map(([t]) => t);

    const curTopicPos = orderedTopics.indexOf(topicId);
    let nextTopicPos = curTopicPos + 1;

    // LOOP to first topic if we are at the end
    if (nextTopicPos >= orderedTopics.length) nextTopicPos = 0;

    const nextTopicId = orderedTopics[nextTopicPos];

    // --------------------------------------------------------------
    // 5. Return FIRST marker of that next topic
    // --------------------------------------------------------------
    for (const m of markers) {
        if (m.payer === payer && m.topicId === nextTopicId) {
            return showMarker(m);
        }
    }

    return null;   // should never hit
};

function showMarker(m) {
    closeTransientMapUI(); // a popup replaces any open pin (📍/🔷 or 🗺/📡) and any other popup
    activeMarkerPopups.forEach(p => p.remove());
    newActiveMarkerPopups([]);
    const popup = new maplibregl.Popup()
        .setLngLat(m.geometry.coordinates)
        .setDOMContent(m.properties.message)
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

window.nextMsgFromPayerPolygon = function(payer, polygonNumber, topicId) {
    if (!storedPolygons || !payer || polygonNumber == null || !topicId) {
        console.error('Invalid input or missing storedPolygons');
        return null;
    }

    // 1. Flatten & sort all polygons by time
    const polygons = storedPolygons
        .flat()
        .sort((a, b) => new Date(a.msgNumber) - new Date(b.msgNumber));

    // 2. Find current polygon index
    let currentIdx = -1;
    for (let i = 0; i < polygons.length; i++) {
        if (polygons[i].payer === payer &&
            polygons[i].msgNumber === String(polygonNumber) &&
            polygons[i].topicId === topicId) {
            currentIdx = i;
            break;
        }
    }
    if (currentIdx === -1) {
        console.log('Current polygon not found');
        return null;
    }

    // 3. Try next polygon in SAME topic
    for (let i = currentIdx + 1; i < polygons.length; i++) {
        if (polygons[i].payer === payer && polygons[i].topicId === topicId) {
            return showPolygon(polygons[i]);
        }
    }

    // 4. No more in this topic → find next topic (or loop to first)
    const firstSeen = new Map(); // topicId → earliest msgNumber
    for (const p of polygons) {
        if (p.payer !== payer) continue;
        if (!firstSeen.has(p.topicId)) {
            firstSeen.set(p.topicId, p.msgNumber);
        }
    }

    const orderedTopics = Array.from(firstSeen.entries())
        .sort(([, a], [, b]) => new Date(a) - new Date(b))
        .map(([t]) => t);

    const currentTopicIdx = orderedTopics.indexOf(topicId);
    let nextTopicIdx = currentTopicIdx + 1;

    // LOOP: if at last topic → go to first
    if (nextTopicIdx >= orderedTopics.length) {
        nextTopicIdx = 0; // wrap around
    }

    const nextTopicId = orderedTopics[nextTopicIdx];

    // 5. Return FIRST polygon of the next topic
    for (const p of polygons) {
        if (p.payer === payer && p.topicId === nextTopicId) {
            return showPolygon(p);
        }
    }

    return null; // fallback
};

function showPolygon(p) {
    closeTransientMapUI(); // a popup replaces any open pin (📍/🔷 or 🗺/📡) and any other popup
    activePolygonPopups.forEach(popup => popup.remove());
    newActivePolygonPopups([]);

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

    const popup = new maplibregl.Popup()
        .setLngLat(targetLngLat)
        .setDOMContent(p.description)
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

window.prevMsgFromPayerMarker = function(payer, markerNumber, topicId) {
  if (!storedMarkers || !payer || markerNumber == null || !topicId) {
        console.error('Invalid input or missing storedMarkers');
        return null;
    }

    // --------------------------------------------------------------
    // 1. Flatten + sort all markers chronologically
    // --------------------------------------------------------------
    const markers = storedMarkers
        .flat()
        .sort((a, b) => new Date(a.msgNumber) - new Date(b.msgNumber));

    // --------------------------------------------------------------
    // 2. Locate the current marker
    // --------------------------------------------------------------
    let curIdx = -1;
    for (let i = 0; i < markers.length; i++) {
        if (markers[i].payer === payer &&
            markers[i].msgNumber === String(markerNumber) &&
            markers[i].topicId === topicId) {
            curIdx = i;
            break;
        }
    }
    if (curIdx === -1) return null;

    // 1. previous in SAME topic
    for (let i = curIdx - 1; i >= 0; i--) {
        if (markers[i].payer === payer && markers[i].topicId === topicId) {
            return showMarker(markers[i]);
        }
    }

    // 2. previous topic (wrap to last if first)
    const lastSeen = new Map();   // topicId → latest msgNumber
    for (const m of markers) {
        if (m.payer !== payer) continue;
        if (!lastSeen.has(m.topicId) ||
            new Date(m.msgNumber) > new Date(lastSeen.get(m.topicId))) {
            lastSeen.set(m.topicId, m.msgNumber);
        }
    }

    const orderedTopics = Array.from(lastSeen.entries())
        .sort(([, a], [, b]) => new Date(a) - new Date(b))
        .map(([t]) => t);

    const curPos = orderedTopics.indexOf(topicId);
    let prevPos = curPos - 1;
    if (prevPos < 0) prevPos = orderedTopics.length - 1;

    const prevTopicId = orderedTopics[prevPos];

    // 3. LAST marker of previous topic
    for (let i = markers.length - 1; i >= 0; i--) {
        if (markers[i].payer === payer && markers[i].topicId === prevTopicId) {
            return showMarker(markers[i]);
        }
    }

    return null;
};

window.prevMsgFromPayerPolygon = function(payer, polygonNumber, topicId) {
    if (!storedPolygons || !payer || polygonNumber == null || !topicId) {
        console.error('Invalid input or missing storedPolygons');
        return null;
    }

    // 1. Flatten & sort chronologically
    const polygons = storedPolygons
        .flat()
        .sort((a, b) => new Date(a.msgNumber) - new Date(b.msgNumber));

    // 2. Find current polygon index
    let currentIdx = -1;
    for (let i = 0; i < polygons.length; i++) {
        if (polygons[i].payer === payer &&
            polygons[i].msgNumber === String(polygonNumber) &&
            polygons[i].topicId === topicId) {
            currentIdx = i;
            break;
        }
    }
    if (currentIdx === -1) {
        console.log('Current polygon not found');
        return null;
    }

    // 3. Try previous polygon in SAME topic
    for (let i = currentIdx - 1; i >= 0; i--) {
        if (polygons[i].payer === payer && polygons[i].topicId === topicId) {
            return showPolygon(polygons[i]);
        }
    }

    // 4. No previous in this topic → go to PREVIOUS topic (or wrap to last)
    const lastSeen = new Map(); // topicId → latest msgNumber
    for (const p of polygons) {
        if (p.payer !== payer) continue;
        if (!lastSeen.has(p.topicId) || new Date(p.msgNumber) > new Date(lastSeen.get(p.topicId))) {
            lastSeen.set(p.topicId, p.msgNumber);
        }
    }

    const orderedTopics = Array.from(lastSeen.entries())
        .sort(([, a], [, b]) => new Date(a) - new Date(b))
        .map(([t]) => t);

    const currentTopicIdx = orderedTopics.indexOf(topicId);
    let prevTopicIdx = currentTopicIdx - 1;

    // LOOP: if at first topic → go to last topic
    if (prevTopicIdx < 0) {
        prevTopicIdx = orderedTopics.length - 1;
    }

    const prevTopicId = orderedTopics[prevTopicIdx];

    // 5. Return LAST polygon of the previous topic
    for (let i = polygons.length - 1; i >= 0; i--) {
        if (polygons[i].payer === payer && polygons[i].topicId === prevTopicId) {
            return showPolygon(polygons[i]);
        }
    }

    return null;
};

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
// Glass card: rounded corners, blur, thin white border (app-wide glass look).
function buildCommentsSection(id, comments, onSend, onReply, topicId, kind) {
  const section = document.createElement('div');
  section.id = id;
  section.style.cssText = 'display: none; margin-top: calc(var(--u) * 1); padding: calc(var(--u) * 1); border-radius: calc(var(--u) * 1.2); background: rgba(255, 255, 255, 0.06); backdrop-filter: blur(calc(var(--u) * 1)); -webkit-backdrop-filter: blur(calc(var(--u) * 1)); border: calc(var(--u) * 0.05) solid rgba(255, 255, 255, 0.15); text-align: left;';

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
    if (click2link.trim()) {
      const usernameLink = document.createElement('a');
      usernameLink.href = click2link.trim();
      usernameLink.target = '_blank';
      usernameLink.rel = 'noopener noreferrer';
      usernameLink.style.cssText = `color: ${usernameTopicChatColor}; text-decoration: none;`;
      usernameLink.textContent = username.trim();
      header.appendChild(usernameLink);
    } else if (username.trim()) {
      const usernameSpan = document.createElement('span');
      usernameSpan.style.cssText = `color: ${usernameTopicChatColor};`;
      usernameSpan.textContent = username.trim();
      header.appendChild(usernameSpan);
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
      if (uname && replyClick2) {
        const usernameLink = document.createElement('a');
        usernameLink.href = replyClick2;
        usernameLink.target = '_blank';
        usernameLink.rel = 'noopener noreferrer';
        usernameLink.style.cssText = `color: ${usernameTopicChatColor}; text-decoration: none;`;
        usernameLink.textContent = uname;
        whoRow.appendChild(usernameLink);
      } else if (uname) {
        const usernameSpan = document.createElement('span');
        usernameSpan.style.cssText = `color: ${usernameTopicChatColor};`;
        usernameSpan.textContent = uname;
        whoRow.appendChild(usernameSpan);
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
  scrim.style.cssText = 'position: absolute; inset: 0; background: rgba(0, 0, 0, 0.45); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);';
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

          for (let index = messages.length - 1; index >= 0; index--) {
            const message = messages[index];
            try {
              let parsedMessage = message;
              if (typeof message === 'string') {
                parsedMessage = JSON.parse(message);
              }
              // Check if changeName exists and either topicAdmin is empty or includes the payer
              if (parsedMessage.changeName && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
                loadedTopicName = parsedMessage.changeName;
                break; // Stop after finding the first valid message
              }
            } catch (messageError) {
              console.error(`Error processing message ${index}:`, messageError);
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
          const messagesByPayer = new Map();
          for (const message of newestMessages) {
            const payerId = message && message.payer;
            if (!payerId) continue;
            let bucket = messagesByPayer.get(payerId);
            if (!bucket) {
              bucket = [];
              messagesByPayer.set(payerId, bucket);
            }
            bucket.push(message);
          }
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

              if (parsedMessage.marker && parsedMessage.marker.data) {
                const markernumber = parsedMessage.marker.data.numberOfMarker;
                const markerOwner = markerOwnershipArray.find(owner => owner.payerId === message.payer);
                if (!markerOwner) {
                  continue;
                }

                if (parsedMessage.marker.data.deleteMarkerNumber) {
                  const deleteMarkerNumber = parsedMessage.marker.data.deleteMarkerNumber;
                  markerOwner.numberOfMarker.push(deleteMarkerNumber);
                }

                const markerCoords = (markernumber === undefined || markernumber === null || !Number.isInteger(Number(markernumber)))
                  ? null
                  : markerCoordinates(parsedMessage.marker.data.cord);

                if (markerCoords && !markerOwner.numberOfMarker.includes(markernumber)) {
                if (!hasRulesForMarker || markerOwner.numberOfMessages > 0) {
                  markerOwner.numberOfMarker.push(markernumber);
                  if (hasRulesForMarker) {
                    markerOwner.numberOfMessages -= 1;
                  }

                  const coords = markerCoords;
                  {
                    const likeCountMarker = likeCountMapMarker.get(timestamp) || 0;

                    // Create marker popup HTML using DOM helper
                    const markerPopupHTML = createMarkerPopupHTML({
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
                      msg: parsedMessage.marker.data.msg,
                      timestamp,
                      likeCountMarker,
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
                      created: parsedMessage.created,
                      msgNumber: parsedMessage.marker.data.numberOfMarker,
                      type: "Feature",
                      payer: message.payer,
                      properties: {
                        message: markerPopupHTML,
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
                const polygonnumber = parsedMessage.polygon.data.numberOfPolygon;

                if (parsedMessage.polygon.data.deletePolygonNumber) {
                  const deletePolygonNumber = parsedMessage.polygon.data.deletePolygonNumber;
                  polygonOwner.numberOfPolygon.push(deletePolygonNumber);
                }

                const polygonRing = (polygonnumber === undefined || polygonnumber === null || !Number.isInteger(Number(polygonnumber)))
                  ? null
                  : polygonCoordinates(parsedMessage.polygon.data.cord);

                if (polygonRing && !polygonOwner.numberOfPolygon.includes(polygonnumber)) {
                if (!hasRulesForPolygon || polygonOwner.numberOfMessages > 0) {
                  polygonOwner.numberOfPolygon.push(polygonnumber);
                  if (hasRulesForPolygon) {
                    polygonOwner.numberOfMessages -= 1;
                  }

                  {
                    const coordinates = polygonRing;
                    if (Array.isArray(coordinates) && coordinates.length > 2) {
                      const polygonSize = hasRulesForPolygon ? smallestPolygonSize(loadedTopicRulesForPolygon) : 1;

                      const likeCountPolygon = likeCountMapPolygon.get(timestamp) || 0;

                      // Create polygon popup HTML using DOM helper
                      const polygonPopupHTML = createPolygonPopupHTML({
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
                        msg: parsedMessage.polygon.data.msg,
                        timestamp,
                        likeCountPolygon,
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
                        created: parsedMessage.created,
                        msgNumber: parsedMessage.polygon.data.numberOfPolygon,
                        id: `polygon-${message.payer}-${topicId}-${parsedMessage.polygon.data.numberOfPolygon}`,
                        payer: message.payer,
                        coordinates: [coordinates],
                        description: polygonPopupHTML,
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

          for (let index = messages.length - 1; index >= 0; index--) {
            const message = messages[index];
            try {
              let parsedMessage = message;
              if (typeof message === 'string') {
                parsedMessage = JSON.parse(message);
              }
              // Check if changeName exists and either topicAdmin is empty or includes the payer
              if (parsedMessage.changeName && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
                loadedTopicName = parsedMessage.changeName;
                break; // Stop after finding the first valid message
              }
            } catch (messageError) {
              console.error(`Error processing message ${index}:`, messageError);
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
          const messagesByPayer = new Map();
          for (const message of newestMessages) {
            const payerId = message && message.payer;
            if (!payerId) continue;
            let bucket = messagesByPayer.get(payerId);
            if (!bucket) {
              bucket = [];
              messagesByPayer.set(payerId, bucket);
            }
            bucket.push(message);
          }
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

              if (parsedMessage.marker && parsedMessage.marker.data) {
                const markernumber = parsedMessage.marker.data.numberOfMarker;
                const markerOwner = markerOwnershipArray.find(owner => owner.payerId === message.payer);
                if (!markerOwner) {
                  continue;
                }

                if (parsedMessage.marker.data.deleteMarkerNumber) {
                  const deleteMarkerNumber = parsedMessage.marker.data.deleteMarkerNumber;
                  markerOwner.numberOfMarker.push(deleteMarkerNumber);
                }

                const markerCoords = (markernumber === undefined || markernumber === null || !Number.isInteger(Number(markernumber)))
                  ? null
                  : markerCoordinates(parsedMessage.marker.data.cord);

                if (markerCoords && !markerOwner.numberOfMarker.includes(markernumber)) {
                if (!hasRulesForMarker || markerOwner.numberOfMessages > 0) {
                  markerOwner.numberOfMarker.push(markernumber);
                  if (hasRulesForMarker) {
                    markerOwner.numberOfMessages -= 1;
                  }

                  const coords = markerCoords;
                  {
                    const likeCountMarker = likeCountMapMarker.get(timestamp) || 0;

                    // Create marker popup HTML using DOM helper
                    const markerPopupHTML = createMarkerPopupHTML({
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
                      msg: parsedMessage.marker.data.msg,
                      timestamp,
                      likeCountMarker,
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
                      created: parsedMessage.created,
                      msgNumber: parsedMessage.marker.data.numberOfMarker,
                      type: "Feature",
                      payer: message.payer,
                      properties: {
                        message: markerPopupHTML,
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
                const polygonnumber = parsedMessage.polygon.data.numberOfPolygon;

                if (parsedMessage.polygon.data.deletePolygonNumber) {
                  const deletePolygonNumber = parsedMessage.polygon.data.deletePolygonNumber;
                  polygonOwner.numberOfPolygon.push(deletePolygonNumber);
                }

                const polygonRing = (polygonnumber === undefined || polygonnumber === null || !Number.isInteger(Number(polygonnumber)))
                  ? null
                  : polygonCoordinates(parsedMessage.polygon.data.cord);

                if (polygonRing && !polygonOwner.numberOfPolygon.includes(polygonnumber)) {
                if (!hasRulesForPolygon || polygonOwner.numberOfMessages > 0) {
                  polygonOwner.numberOfPolygon.push(polygonnumber);
                  if (hasRulesForPolygon) {
                    polygonOwner.numberOfMessages -= 1;
                  }

                  {
                    const coordinates = polygonRing;
                    if (Array.isArray(coordinates) && coordinates.length > 2) {
                      const polygonSize = hasRulesForPolygon ? smallestPolygonSize(loadedTopicRulesForPolygon) : 1;

                      const likeCountPolygon = likeCountMapPolygon.get(timestamp) || 0;

                      // Create polygon popup HTML using DOM helper
                      const polygonPopupHTML = createPolygonPopupHTML({
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
                        msg: parsedMessage.polygon.data.msg,
                        timestamp,
                        likeCountPolygon,
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
                        created: parsedMessage.created,
                        msgNumber: parsedMessage.polygon.data.numberOfPolygon,
                        id: `polygon-${message.payer}-${topicId}-${parsedMessage.polygon.data.numberOfPolygon}`,
                        payer: message.payer,
                        coordinates: [coordinates],
                        description: polygonPopupHTML,
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