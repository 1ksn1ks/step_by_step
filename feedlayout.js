// Optional feed column for the topic already loaded on the globe.
// Map mode is the default and does not push a history entry.

import maplibregl from 'maplibre-gl';
import { map } from './map.js';
import { currentUfoModelInGLTF, globalLoadedTopicIdsWithNames } from './letall.js';
import { markerPopupNode, polygonPopupNode, mountPostReactions, buildPopupProfile, rememberShapeEdit, shapeEditFor, viewsChip as sharedViewsChip, setViewsCount, popupGearIcon, bindPressFeedback } from './processallmessages.js';
import { BACKEND_URL, fetchMessagesBackend, streamOnTopic, messageSig, fetchFollowing } from './msgbackend.js';
import { createChunkAssembler, ingestMirrorRows } from './hcschunks.js';
import { initialTopicId } from './extracttopic.js';
import { connectedAccount, updateUI } from './web3.js';
import { toast } from './toast.js';
import { handleAllMessages } from './handleallmessages.js';
import { activeMarkerPopups } from './marker.js';
import { activePolygonPopups } from './polygons.js';
import { animateMapTo, cancelAnimateMapTo } from './animatemapto.js';
import { MARKER_ZOOM } from './openplace.js';
import { ringCenter, zoomForPolygon } from './polygonframe.js';
import { CloseALL, changePopupState, popIsOpen, expandTopicChat, expandEncryptedChat, withE2eeWebNotice, prepareLoadColumnForFeed } from './cssLogic.js';
import { closeDrawAnchor, openDrawColumn } from './drawhere.js';
import { closePressAnchor } from './poiinfo.js';
import { applyAllStyles, paintEarlyProfile } from './loadprofilepopup.js';
import { scene } from './threejs.js';
import { profilePictures, usernames, click2url, loadTopicBio, profileTopics } from './loadalladata.js';
import { paintHashtags, singleLineText } from './hashtag.js';
import { openPopupText } from './popuptext.js';
import { consensusOf } from './donationmath.js';
import { noteVisibleDonation } from './donations.js';
import { paintProfileStats } from './profilestats.js';
import { earlyHashinalNumber, earlyHashinalReady, onOwnersChange, paintProfileAvatar } from './earlyhashinal.js';
import { followPersonControls } from './followtopic.js';
import { fillTopicIds, useTopicId } from './topicidintext.js';
import { payerUsernameNode } from './payerlink.js';
import { EARLY_POPUP_CLASS } from './earlypopup.js';
import { openPreview } from './fullscreenmedia.js';
import { collapseComposers } from './chatcomposer.js';
import { formatSliderValue, applySliderValueWidth } from './slidervalue.js';
import { clearQuery, getQuery, isActive, matches, onChange, registerFilter, registerSort, setFilter, setSort, setText, sortCmp } from './feedsearch.js';
import { VIEW_SORT_BATCH, keepScroll, rankedPaintHold, rankedWindowReady, retryAfterMs, zeroViewCounts } from './viewsort.js';
import { FILL_PASSES, planFillDown } from './scrollfill.js';
import { FEED_VIDEO_MIN, FEED_VIDEO_RELEASE_MS, FEED_VIDEO_THRESHOLDS, connectionIsConstrained, feedAutoplayAllowed, feedVideoHeld, feedVideoPreloadOnPause, feedVideoShouldRelease, feedVideoStartDelay, feedVideosToMeasure, pickFeedVideo } from './feedvideo.js';
import { isGifClipUrl, isGifUrl, needsGifCheck, readGifCache, resolveMediaUrl } from './mediaurl.js';
import { bindVideoPoster } from './videoposter.js';
import { mountPicture, pictureElement, presentImage } from './loopmedia.js';

const LAYOUT_KEY = 'layoutMode';
const FEED_SETTING = {
  tab: 'feed-setting-tab',
  autoplay: 'feed-setting-autoplay',
  data: 'feed-setting-data',
  zoom: 'feed-setting-zoom',
  picturesWide: 'feed-setting-pictures-wide',
};
const FEED_ZOOM_MIN = 0.5;
const FEED_ZOOM_MAX = 1.5;
const feedPrefs = {
  tab: 'all',
  autoplay: true,
  dataSaver: false,
  zoom: 1,
  // Pictures and GIFs start full width, as the ··· size button makes them.
  picturesWide: false,
};
let settingsOpen = false;

function readFeedPrefs() {
  try {
    const tab = localStorage.getItem(FEED_SETTING.tab);
    if (tab === 'all' || tab === 'following') feedPrefs.tab = tab;
    feedPrefs.autoplay = localStorage.getItem(FEED_SETTING.autoplay) !== 'off';
    feedPrefs.dataSaver = localStorage.getItem(FEED_SETTING.data) === 'on';
    // 'feed-setting-full-tap' was a first try at this switch (a tap opened
    // the viewer): an "on" there means full size was wanted.
    const oldFull = localStorage.getItem('feed-setting-full-tap');
    if (oldFull != null) {
      if (localStorage.getItem(FEED_SETTING.picturesWide) == null) {
        localStorage.setItem(FEED_SETTING.picturesWide, oldFull === 'on' ? 'on' : 'off');
      }
      localStorage.removeItem('feed-setting-full-tap');
    }
    feedPrefs.picturesWide = localStorage.getItem(FEED_SETTING.picturesWide) === 'on';
    const zoom = localStorage.getItem(FEED_SETTING.zoom);
    if (zoom != null) feedPrefs.zoom = clampFeedZoom(zoom);
    localStorage.removeItem('feed-setting-density');
    localStorage.removeItem('feed-setting-fresh');
    localStorage.removeItem('feed-setting-location');
  } catch {
    /* private mode */
  }
}

function clampFeedZoom(value) {
  const n = Math.round(Number(value) * 100) / 100;
  if (!Number.isFinite(n)) return 1;
  if (n < FEED_ZOOM_MIN) return FEED_ZOOM_MIN;
  if (n > FEED_ZOOM_MAX) return FEED_ZOOM_MAX;
  return n;
}

function writeFeedSetting(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

readFeedPrefs();
const PAGE = 2030;
// Oldest, liked, and viewed rank only the posts already paged in. Pages
// still arrive newest-first, PAGE messages at a time. While one of those
// sorts is active, loadOlder keeps going until the topic is exhausted, the
// dateFrom floor is reached, or this many pages have been pulled for the
// query. The spinner stays up through that window. The ranked list is
// painted once when it settles, so a later page does not jump the scroll.
// Hitting the cap before exhaustion labels the row "sorted among loaded
// posts" so a short window is not shown as a complete ranking.
const SORT_PAGE_CAP = 4;
const CARD_CAP = 200;
const RENDER_CHUNK = 30;
const SCROLL_IDLE_MS = 250;
const VIEW_DWELL_MS = 1000;
const VIEW_FLUSH_MS = 10000;
const VIEW_POST_BATCH = 50;
const VIEW_GET_BATCH = 40;
const VIEWER_KEY = 'feedViewerId';
const MIRROR = 'https://mainnet.mirrornode.hedera.com';
const DEFAULT_PIC = 'https://kiloscribe.com/api/inscription-cdn/0.0.4819119';
const SVG_NS = 'http://www.w3.org/2000/svg';

const root = document.createElement('div');
root.id = 'feed-layout';
root.style.display = 'none';
const dim = document.createElement('div');
dim.className = 'feed-dim';
const scroller = document.createElement('div');
scroller.id = 'feed-scroll';
const column = document.createElement('div');
column.id = 'feed-column';
const pageStatus = document.createElement('div');
pageStatus.id = 'feed-page-status';
pageStatus.hidden = true;
pageStatus.setAttribute('role', 'status');
pageStatus.setAttribute('aria-label', 'Loading posts');
const pageSpin = document.createElement('span');
pageSpin.className = 'feed-page-spin';
pageSpin.setAttribute('aria-hidden', 'true');
pageStatus.appendChild(pageSpin);
scroller.append(column, pageStatus);

const tabs = document.createElement('div');
tabs.id = 'feed-tabs';
tabs.setAttribute('role', 'tablist');
const allTab = document.createElement('button');
allTab.type = 'button';
allTab.className = 'feed-tab';
allTab.id = 'feed-tab-all';
allTab.setAttribute('role', 'tab');
const allLabel = document.createElement('span');
allLabel.className = 'feed-tab-label';
allLabel.textContent = 'All';
allTab.appendChild(allLabel);
const followTab = document.createElement('button');
followTab.type = 'button';
followTab.className = 'feed-tab';
followTab.id = 'feed-tab-following';
followTab.setAttribute('role', 'tab');
const followLabel = document.createElement('span');
followLabel.className = 'feed-tab-label';
followLabel.textContent = 'Following';
followTab.appendChild(followLabel);
const tabSlide = document.createElement('div');
tabSlide.className = 'feed-tabs-slide';
tabSlide.append(allTab, followTab);
tabs.append(tabSlide);
const tabRuler = document.createElement('div');
tabRuler.id = 'feed-tab-ruler';
tabRuler.setAttribute('aria-hidden', 'true');

const newPill = document.createElement('button');
newPill.id = 'feed-new-posts';
newPill.type = 'button';
newPill.hidden = true;
newPill.setAttribute('aria-label', 'New posts');
const newFaces = document.createElement('span');
newFaces.className = 'feed-new-faces';
newFaces.hidden = true;
newFaces.setAttribute('aria-hidden', 'true');
const newLabel = document.createElement('span');
newLabel.className = 'feed-new-label';
newPill.append(newFaces, newLabel);

const toolbar = document.createElement('div');
toolbar.id = 'feed-toolbar';
const menuAnchor = document.createElement('div');
menuAnchor.className = 'feed-menu-anchor';
const menuBtn = document.createElement('button');
menuBtn.id = 'feed-back-btn';
menuBtn.className = 'feed-chat-back';
menuBtn.type = 'button';
menuBtn.setAttribute('aria-label', 'Menu');
menuBtn.setAttribute('aria-haspopup', 'menu');
menuBtn.setAttribute('aria-expanded', 'false');
menuBtn.setAttribute('aria-controls', 'feed-menu');
menuBtn.title = 'Menu';
menuBtn.appendChild(svgIcon([
  ['line', { x1: '4', x2: '20', y1: '12', y2: '12' }],
  ['line', { x1: '4', x2: '20', y1: '6', y2: '6' }],
  ['line', { x1: '4', x2: '20', y1: '18', y2: '18' }],
]));
const menu = document.createElement('ul');
menu.id = 'feed-menu';
menu.hidden = true;
menu.setAttribute('role', 'menu');
const menuDim = document.createElement('button');
menuDim.type = 'button';
menuDim.className = 'feed-menu-dim';
menuDim.hidden = true;
menuDim.setAttribute('aria-label', 'Close menu');
menuAnchor.append(menuBtn);
const topicBtn = document.createElement('button');
topicBtn.id = 'feed-topic-btn';
topicBtn.type = 'button';
const topicCopy = document.createElement('span');
topicCopy.className = 'feed-topic-copy';
const topicText = document.createElement('span');
topicText.className = 'feed-topic-label';
const topicIdLine = document.createElement('span');
topicIdLine.className = 'feed-topic-id';
topicIdLine.hidden = true;
topicCopy.append(topicText, topicIdLine);
topicBtn.append(topicCopy, svgIcon([
  ['path', { d: 'm6 9 6 6 6-6' }],
]));
const tools = document.createElement('div');
tools.className = 'feed-toolbar-slot';
tools.append(topicBtn);
const searchBtnFeed = document.createElement('button');
searchBtnFeed.id = 'feed-search-btn';
searchBtnFeed.type = 'button';
searchBtnFeed.setAttribute('aria-label', 'Search');
searchBtnFeed.setAttribute('aria-expanded', 'false');
searchBtnFeed.title = 'Search';
searchBtnFeed.appendChild(svgIcon([
  ['circle', { cx: '11', cy: '11', r: '8' }],
  ['path', { d: 'm21 21-4.3-4.3' }],
]));
const postBtn = document.createElement('button');
postBtn.id = 'feed-post-btn';
postBtn.type = 'button';
postBtn.setAttribute('aria-label', 'New post');
postBtn.title = 'New post';
postBtn.appendChild(svgIcon([
  ['path', { d: 'M5 12h14' }],
  ['path', { d: 'M12 5v14' }],
]));
toolbar.append(menuAnchor, tools, searchBtnFeed, postBtn);
const profileBanner = document.createElement('button');
profileBanner.id = 'feed-profile-banner';
profileBanner.type = 'button';
profileBanner.hidden = true;
profileBanner.setAttribute('aria-label', 'Back to profile');
const bannerBack = document.createElement('span');
bannerBack.className = 'feed-profile-banner-back';
bannerBack.appendChild(svgIcon([
  ['path', { d: 'm15 18-6-6 6-6' }],
]));
const bannerPic = document.createElement('img');
bannerPic.className = 'feed-profile-banner-pic';
bannerPic.alt = '';
const bannerCopy = document.createElement('span');
bannerCopy.className = 'feed-profile-banner-copy';
const bannerName = document.createElement('span');
bannerName.className = 'feed-profile-banner-name';
const bannerHandle = document.createElement('span');
bannerHandle.className = 'feed-profile-banner-handle';
const bannerBio = document.createElement('span');
bannerBio.className = 'feed-profile-banner-bio';
bannerCopy.append(bannerName, bannerHandle, bannerBio);
profileBanner.append(bannerBack, bannerPic, bannerCopy);
const frame = document.createElement('div');
frame.id = 'feed-frame';
frame.append(tabRuler, profileBanner, newPill, scroller, menuDim, menu);
root.append(dim, frame, toolbar, tabs);

const btn = document.createElement('button');
btn.id = 'layout-mode-btn';
btn.type = 'button';
btn.setAttribute('aria-pressed', 'false');

const ROWS_ICON = [
  ['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2' }],
  ['path', { d: 'M21 9H3' }],
  ['path', { d: 'M21 15H3' }],
];
const rowsIcon = svgIcon(ROWS_ICON);
const GLOBE_ICON = [
  ['circle', { cx: '12', cy: '12', r: '10' }],
  ['path', { d: 'M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20' }],
  ['path', { d: 'M2 12h20' }],
];
const globeIcon = svgIcon(GLOBE_ICON);
const pinIcon = () => svgIcon([
  ['path', { d: 'M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0' }],
  ['circle', { cx: '12', cy: '10', r: '3' }],
]);
btn.append(rowsIcon, globeIcon);

const searchBtn = document.getElementById('search-toggle-btn');
if (searchBtn && searchBtn.parentNode) {
  const row = document.createElement('div');
  row.id = 'map-corner-buttons';
  searchBtn.parentNode.insertBefore(row, searchBtn);
  row.append(btn, searchBtn);
} else document.body.appendChild(btn);
document.body.appendChild(root);

// One map row: menu, clock, coordinates. Search, locate and
// the compass stay in the page so the drawer can run the same clicks.
const mapBar = document.createElement('div');
mapBar.id = 'map-topbar';
const mapMenuBtn = document.createElement('button');
mapMenuBtn.id = 'map-menu-btn';
mapMenuBtn.type = 'button';
mapMenuBtn.setAttribute('aria-label', 'Menu');
mapMenuBtn.setAttribute('aria-haspopup', 'menu');
mapMenuBtn.setAttribute('aria-expanded', 'false');
mapMenuBtn.setAttribute('aria-controls', 'feed-menu');
mapMenuBtn.title = 'Menu';
mapMenuBtn.appendChild(svgIcon([
  ['line', { x1: '4', x2: '20', y1: '12', y2: '12' }],
  ['line', { x1: '4', x2: '20', y1: '6', y2: '6' }],
  ['line', { x1: '4', x2: '20', y1: '18', y2: '18' }],
]));
const mapPills = document.createElement('div');
mapPills.id = 'map-top-pills';
const mapClock = document.getElementById('local-clock');
const mapCoords = document.getElementById('coordinates-display');
const mapCopy = document.getElementById('copy-coordinates');
const mapCoordWrap = document.createElement('div');
mapCoordWrap.id = 'map-coord-wrap';
if (mapCoords) mapCoordWrap.appendChild(mapCoords);
if (mapCopy) mapCoordWrap.appendChild(mapCopy);
if (mapClock) mapPills.appendChild(mapClock);
mapPills.appendChild(mapCoordWrap);
mapBar.append(mapMenuBtn, mapPills);
document.body.appendChild(mapBar);

const profilePage = document.createElement('div');
profilePage.id = 'feed-profile';
profilePage.hidden = true;
profilePage.setAttribute('role', 'dialog');
profilePage.setAttribute('aria-modal', 'true');
profilePage.setAttribute('aria-label', 'Profile');
const profileBar = document.createElement('div');
profileBar.className = 'feed-chat-bar';
const profileBack = document.createElement('button');
profileBack.type = 'button';
profileBack.className = 'feed-chat-back';
profileBack.setAttribute('aria-label', 'Back');
profileBack.appendChild(svgIcon([
  ['path', { d: 'm12 19-7-7 7-7' }],
  ['path', { d: 'M19 12H5' }],
]));
const profileTitle = document.createElement('h2');
profileTitle.className = 'feed-chat-title';
profileTitle.textContent = 'Profile';
const profileActions = document.createElement('div');
profileActions.className = 'feed-chat-actions';
const profileEdit = document.createElement('button');
profileEdit.type = 'button';
profileEdit.id = 'feed-profile-edit';
profileEdit.className = 'feed-chat-icon';
profileEdit.hidden = true;
profileEdit.setAttribute('aria-label', 'Edit profile');
profileEdit.title = 'Edit profile';
profileEdit.appendChild(svgIcon([
  ['path', { d: 'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z' }],
  ['path', { d: 'm15 5 4 4' }],
]));
profileEdit.querySelector('svg').classList.add('feed-chat-glyph');
profileActions.appendChild(profileEdit);
profileBar.append(profileBack, profileTitle, profileActions);
const profileBody = document.createElement('div');
profileBody.className = 'feed-profile-body';
const profileIdentity = document.createElement('div');
profileIdentity.className = 'feed-profile-identity';
const profilePicSlot = document.createElement('div');
profilePicSlot.className = 'feed-profile-pic-slot';
const profileNames = document.createElement('div');
profileNames.className = 'feed-profile-names';
const profileName = document.createElement('div');
profileName.className = 'feed-profile-name-slot';
const profileHandle = document.createElement('a');
profileHandle.className = 'feed-profile-handle';
profileHandle.target = '_blank';
profileHandle.rel = 'noopener noreferrer';
const profileStatsEl = document.createElement('div');
profileNames.append(profileName, profileHandle, profileStatsEl);
const profileFollow = document.createElement('div');
profileFollow.className = 'feed-profile-follow';
const profileBio = document.createElement('div');
profileBio.className = 'feed-profile-bio';
profileIdentity.append(profilePicSlot, profileNames, profileFollow, profileBio);
const profileSections = document.createElement('div');
profileSections.className = 'feed-profile-sections';
const profileLoad = document.createElement('button');
profileLoad.type = 'button';
profileLoad.id = 'feed-profile-load';
profileLoad.textContent = 'Load posts';
profileBody.append(profileIdentity, profileSections, profileLoad);
profilePage.append(profileBar, profileBody);
profilePage.addEventListener('click', (event) => event.stopPropagation());
profilePage.addEventListener('pointerdown', (event) => event.stopPropagation());
root.appendChild(profilePage);

const searchPage = document.createElement('div');
searchPage.id = 'feed-search-page';
searchPage.hidden = true;
searchPage.setAttribute('role', 'dialog');
searchPage.setAttribute('aria-modal', 'true');
searchPage.setAttribute('aria-label', 'Search');
const searchBar = document.createElement('div');
searchBar.className = 'feed-chat-bar';
const searchBack = document.createElement('button');
searchBack.type = 'button';
searchBack.className = 'feed-chat-back';
searchBack.setAttribute('aria-label', 'Back');
searchBack.appendChild(svgIcon([
  ['path', { d: 'm12 19-7-7 7-7' }],
  ['path', { d: 'M19 12H5' }],
]));
const searchTitle = document.createElement('h2');
searchTitle.className = 'feed-chat-title';
searchTitle.textContent = 'SEARCH';
const searchGear = document.createElement('button');
searchGear.type = 'button';
searchGear.id = 'feed-search-gear';
searchGear.className = 'popup-icon-chip popup-settings-gear';
searchGear.setAttribute('aria-label', 'Filters');
searchGear.setAttribute('aria-expanded', 'false');
searchGear.appendChild(popupGearIcon());
bindPressFeedback(searchGear);
// Gear stays in the fixed bar so Filters stay reachable while the pill hides.
searchBar.append(searchBack, searchTitle, searchGear);
const searchBody = document.createElement('div');
searchBody.className = 'feed-search-body';
const searchHead = document.createElement('div');
searchHead.className = 'feed-search-head';
const searchField = document.createElement('div');
searchField.className = 'feed-search-field';
const searchInput = document.createElement('input');
searchInput.id = 'feed-search-input';
searchInput.type = 'text';
searchInput.setAttribute('aria-label', 'Search posts');
searchInput.placeholder = 'Search';
searchInput.autocomplete = 'off';
searchInput.autocapitalize = 'off';
searchInput.spellcheck = false;
searchInput.enterKeyHint = 'search';
const searchClear = document.createElement('button');
searchClear.id = 'feed-search-clear';
searchClear.type = 'button';
searchClear.hidden = true;
searchClear.setAttribute('aria-label', 'Clear search');
searchClear.appendChild(svgIcon([
  ['path', { d: 'M18 6 6 18' }],
  ['path', { d: 'm6 6 12 12' }],
]));
searchField.append(searchInput, searchClear);
const searchFilters = document.createElement('div');
searchFilters.id = 'feed-search-filters';
searchFilters.hidden = true;
const searchResults = document.createElement('div');
searchResults.id = 'feed-search-results';
searchHead.append(searchField, searchFilters);
searchBody.append(searchHead, searchResults);
const filterBackdrop = document.createElement('div');
filterBackdrop.id = 'feed-filter-backdrop';
// display is the open/close switch. Placement and glass live in CSS.
filterBackdrop.style.display = 'none';
const filterCard = document.createElement('div');
filterCard.id = 'feed-filter-card';
filterCard.setAttribute('role', 'dialog');
filterCard.setAttribute('aria-label', 'Filters');
filterCard.style.display = 'none';
const filterClose = document.createElement('button');
filterClose.type = 'button';
filterClose.className = 'panel-close-btn';
filterClose.setAttribute('aria-label', 'Close');
filterClose.textContent = '\u00d7';
const filterHead = document.createElement('div');
filterHead.className = 'feed-filter-head';
const filterTitle = document.createElement('h2');
filterTitle.className = 'feed-filter-title';
filterTitle.textContent = 'Filters';
filterHead.append(filterTitle, filterClose);
// A row: icon tile, label, switch. The label alone names the button.
function filterToggle(key, label, icon) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'feed-filter-toggle';
  btn.dataset.filter = key;
  btn.setAttribute('aria-pressed', 'false');
  const tile = document.createElement('span');
  tile.className = 'feed-filter-icon';
  tile.appendChild(svgIcon(icon));
  const name = document.createElement('span');
  name.className = 'feed-filter-name';
  name.textContent = label;
  const knob = document.createElement('span');
  knob.className = 'feed-filter-switch';
  knob.setAttribute('aria-hidden', 'true');
  btn.append(tile, name, knob);
  return btn;
}
function filterSection(title, nodes, extraClass) {
  const section = document.createElement('div');
  section.className = 'feed-filter-section' + (extraClass ? ' ' + extraClass : '');
  const heading = document.createElement('h3');
  heading.className = 'feed-filter-section-title';
  heading.textContent = title;
  section.append(heading, ...nodes);
  return section;
}
const filterHasImage = filterToggle('hasImage', 'Has image', [
  ['rect', { x: '3', y: '3', width: '18', height: '18', rx: '2' }],
  ['circle', { cx: '9', cy: '9', r: '2' }],
  ['path', { d: 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21' }],
]);
const filterOnlyText = filterToggle('onlyText', 'Text only', [
  ['path', { d: 'M4 7V4h16v3' }],
  ['path', { d: 'M9 20h6' }],
  ['path', { d: 'M12 4v16' }],
]);
const filterMine = filterToggle('mine', 'Mine', [
  ['path', { d: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2' }],
  ['circle', { cx: '12', cy: '7', r: '4' }],
]);
const filterFollowing = filterToggle('following', 'Following', [
  ['path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }],
  ['circle', { cx: '9', cy: '7', r: '4' }],
  ['path', { d: 'M22 21v-2a4 4 0 0 0-3-3.87' }],
  ['path', { d: 'M16 3.13a4 4 0 0 1 0 7.75' }],
]);
const filterWalletHint = document.createElement('p');
filterWalletHint.id = 'feed-filter-wallet-hint';
filterWalletHint.className = 'feed-filter-hint';
filterWalletHint.hidden = true;
filterWalletHint.textContent = 'Connect your wallet to use Mine and Following';
const filterHashinal = filterToggle('hashinal', 'Early Hashinal holders', [
  ['path', { d: 'M6 3h12l4 6-10 13L2 9Z' }],
  ['path', { d: 'M11 3 8 9l4 13 4-13-3-6' }],
  ['path', { d: 'M2 9h20' }],
]);
const filterComments = filterToggle('hasComments', 'Has comments', [
  ['path', { d: 'M7.9 20A9 9 0 1 0 4 16.1L2 22Z' }],
]);
const filterSort = document.createElement('select');
filterSort.id = 'feed-filter-sort';
filterSort.className = 'feed-filter-native';
filterSort.tabIndex = -1;
filterSort.setAttribute('aria-hidden', 'true');
const filterSortPills = document.createElement('div');
filterSortPills.className = 'feed-filter-pills';
filterSortPills.setAttribute('role', 'group');
filterSortPills.setAttribute('aria-label', 'Sort');
for (const [value, label] of [['newest', 'Newest'], ['oldest', 'Oldest'], ['liked', 'Liked'], ['viewed', 'Viewed']]) {
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = label;
  filterSort.appendChild(opt);
  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'feed-filter-pill' + (value === 'newest' ? ' is-active' : '');
  pill.dataset.sort = value;
  pill.textContent = label;
  pill.setAttribute('aria-pressed', value === 'newest' ? 'true' : 'false');
  filterSortPills.appendChild(pill);
}
const filterFrom = document.createElement('input');
filterFrom.id = 'feed-filter-from';
filterFrom.type = 'date';
filterFrom.setAttribute('aria-label', 'From');
const filterTo = document.createElement('input');
filterTo.id = 'feed-filter-to';
filterTo.type = 'date';
filterTo.setAttribute('aria-label', 'To');
// Country: a field you type in, with the matching countries listed under
// it. The hidden select stays the value the filter code reads and writes
// (as the sort select does under its pills).
const filterCountry = document.createElement('select');
filterCountry.id = 'feed-filter-country';
filterCountry.className = 'feed-filter-native';
filterCountry.tabIndex = -1;
filterCountry.setAttribute('aria-hidden', 'true');
const countryBox = document.createElement('div');
countryBox.className = 'feed-country';
const countryInput = document.createElement('input');
countryInput.id = 'feed-filter-country-input';
countryInput.type = 'text';
countryInput.className = 'feed-filter-field';
countryInput.placeholder = 'Any country';
countryInput.autocomplete = 'off';
countryInput.spellcheck = false;
countryInput.setAttribute('autocapitalize', 'off');
countryInput.setAttribute('autocorrect', 'off');
countryInput.setAttribute('enterkeyhint', 'done');
countryInput.setAttribute('role', 'combobox');
countryInput.setAttribute('aria-label', 'Country');
countryInput.setAttribute('aria-autocomplete', 'list');
countryInput.setAttribute('aria-expanded', 'false');
countryInput.setAttribute('aria-controls', 'feed-country-list');
const countryClear = document.createElement('button');
countryClear.type = 'button';
countryClear.className = 'feed-country-clear';
countryClear.setAttribute('aria-label', 'Any country');
countryClear.hidden = true;
countryClear.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
const countryList = document.createElement('div');
countryList.id = 'feed-country-list';
countryList.className = 'feed-country-list';
countryList.setAttribute('role', 'listbox');
countryList.setAttribute('aria-label', 'Countries');
countryList.hidden = true;
const countryEmpty = document.createElement('div');
countryEmpty.className = 'feed-country-empty';
countryEmpty.textContent = 'No country matches';
countryEmpty.hidden = true;
countryBox.append(countryInput, countryClear, countryList, countryEmpty);
function filterField(labelText, control) {
  const row = document.createElement('label');
  row.className = 'feed-filter-row';
  const span = document.createElement('span');
  span.className = 'feed-filter-label';
  span.textContent = labelText;
  control.classList.add('feed-filter-field');
  row.append(span, control);
  return row;
}
const filterBody = document.createElement('div');
filterBody.className = 'feed-filter-body';
const filterDates = document.createElement('div');
filterDates.className = 'feed-filter-dates';
filterDates.append(filterField('From', filterFrom), filterField('To', filterTo));
filterBody.append(
  filterSection('Show', [filterHasImage, filterOnlyText, filterMine, filterFollowing, filterWalletHint, filterHashinal, filterComments], 'is-toggles'),
  filterSection('Sort by', [filterSortPills, filterSort]),
  filterSection('Date', [filterDates]),
  filterSection('Country', [countryBox, filterCountry]),
);
filterCard.append(filterHead, filterBody);
searchPage.append(searchBar, searchBody, filterBackdrop, filterCard);
searchPage.addEventListener('click', (event) => event.stopPropagation());
searchPage.addEventListener('pointerdown', (event) => event.stopPropagation());
root.appendChild(searchPage);
// Header drop/lift (playSearchMotion). Declared here, before any code
// that can open or close the page, so the timer is never read too early.
let searchMotionTimer = 0;
searchPage.addEventListener('animationend', (event) => {
  if (event.target !== searchBar) return;
  if (event.animationName === 'feedSearchDrop' || event.animationName === 'feedSearchLift') endSearchMotion();
});
// Filters sheet close motion (concealFilterCard). Opening needs no class:
// the rise plays whenever the sheet's display turns on.
let filterMotionTimer = 0;
filterCard.addEventListener('animationend', (event) => {
  if (event.target !== filterCard) return;
  if (event.animationName === 'feedFilterDown' || event.animationName === 'feedFilterShrink') endFilterMotion();
});

let posts = [];
let shown = [];
let found = [];
let searchTimer = 0;
let searchMute = false;
let restoreOnClear = false;
let searchPinned = false;
let pinScroll = 0;
let pinStart = 0;
let pinEnd = 0;
let feedTab = 'all';
let tabToken = 0;
let followState = 'idle';
let followSet = null;
let followPromise = null;
let rangeStart = 0;
let rangeEnd = 0;
const held = { all: [], following: [] };
const tabScroll = { all: 0, following: 0 };
const tabRange = {
  all: { start: 0, end: 0 },
  following: { start: 0, end: 0 },
};
let loadedTopic = '';
let cursor = null;
let exhausted = false;
let paging = false;
let searchFloor = false;
let sortPages = 0;
let sortHold = false;
let sortFetchPause = false;
let viewSortWait = 0;
let viewSortGen = 0;
let viewSortTimer = 0;
let viewSortSettle = 0;
let viewSortFlight = false;
let viewSortRetryAt = 0;
let sortPaintDirty = false;
const viewSortQueued = [];
const viewSortInflight = new Set();
let generation = 0;
let highSeq = 0;
let streamOff = null;
let assembler = null;
const seenSeq = new Set();
const seenSig = new Set();
const seenPost = new Set();
const actions = new Map();
// Post keys whose picture or video the user made full width, or small
// again (mountMediaTools). Cards are rebuilt as they scroll back in, so
// the choice lives here. A post's own choice beats Show pictures full size.
const wideMedia = new Set();
const narrowMedia = new Set();

function pictureStartsWide(key) {
  if (key && wideMedia.has(key)) return true;
  if (key && narrowMedia.has(key)) return false;
  return feedPrefs.picturesWide;
}
const likeCounts = new Map();
const markerComments = new Map();
const polygonComments = new Map();
const markerReplies = new Map();
const polygonReplies = new Map();
const deletedCreated = new Set();
const deletedStamp = new Set();
const droppedShares = new Set();
let savedScroll = 0;
let tabLastY = 0;
let tabOffset = 0;
let tabHidePx = 0;
let searchHidePx = 0;
let tabPending = 0;
let profilePayer = '';
let profileFilter = '';
let profileEpoch = 0;
let profileView = null;
let profileShift = { all: 0, following: 0 };
// Set only while the profile pencil is showing Edit profile. Toolbar → Edit
// profile leaves this false, so closing that page does not repaint the profile.
let profileEditCover = false;
let profileEditScroll = 0;
let profileEditZHeld = false;
let bannerOffset = 0;
let bannerHidePx = 0;
let tabTrackHold = false;
let tabFollowQueued = false;
let tabEndTimer = 0;
let peek = false;
// Set for the popup that openOnMap is about to add. Map opens leave it false.
let feedPopupHandoff = false;
let placing = false;
let drawWasOpen = false;
let placeToken = 0;
let placeBusy = false;
let revealToken = 0;
let scrollIdle = 0;
let viewObserver = null;
let scrollFrameQueued = false;
// Follow-up frames when one sample cannot prove the column is full.
// A finger scroll resets it. Script scrolls do not, so the cap holds.
let fillAgain = 0;
const viewIntersecting = new Set();
let viewFlushTimer = 0;
let viewCountTimer = 0;
let looseViewer = '';
const viewTimers = new Map();
const viewPending = [];
const viewHold = new Set();
const viewSent = new Set();
const viewTotals = new Map();
const viewCountWanted = [];

function svgIcon(parts) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('overflow', 'visible');
  svg.setAttribute('aria-hidden', 'true');
  for (const [name, attrs] of parts) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    svg.appendChild(node);
  }
  return svg;
}

function savedMode() {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'feed' ? 'feed' : 'map';
  } catch {
    return 'map';
  }
}

function writeMode(mode) {
  try {
    localStorage.setItem(LAYOUT_KEY, mode);
  } catch {
    /* private mode */
  }
}

function paintToggle(feed) {
  btn.classList.toggle('is-feed', feed);
  btn.setAttribute('aria-pressed', feed ? 'true' : 'false');
  btn.setAttribute('aria-label', feed ? 'Feed' : 'Map');
  btn.title = feed ? 'Feed' : 'Map';
  rowsIcon.hidden = !feed;
  globeIcon.hidden = feed;
}

// Same hold and pop as the follow button.
function bindPress(button) {
  let holdTimer = 0;
  const clearHold = () => {
    clearTimeout(holdTimer);
    button.classList.remove('is-hold');
  };
  button.addEventListener('pointerdown', () => {
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => button.classList.add('is-hold'), 450);
  });
  button.addEventListener('pointerup', clearHold);
  button.addEventListener('pointerleave', clearHold);
  button.addEventListener('pointercancel', clearHold);
  button.addEventListener('click', () => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    button.classList.remove('is-pop');
    void button.offsetWidth;
    button.classList.add('is-pop');
  });
  button.addEventListener('animationend', () => button.classList.remove('is-pop'));
}

// Bare map after feed peek : show the usual #layout-mode-btn again
// (it stays .is-feed / rows icon; CSS only unhides it).
function mapPopupOpen() {
  const map = document.querySelector('.maplibregl-map');
  if (!map) return false;
  return [...map.querySelectorAll('.maplibregl-popup')].some((el) => {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
}

function feedMapIsBare() {
  if (!feedOn() || !root.classList.contains('is-peek')) return false;
  if (placing || (window.layerIsOpen && window.layerIsOpen('feedplace'))) return false;
  if (window.layerIsOpen && window.layerIsOpen('markerpopup')) return false;
  if (mapPopupOpen()) return false;
  return true;
}

function syncFeedMapBack() {
  btn.classList.toggle('is-peek-return', feedMapIsBare());
}

function syncFeedMapBackSoon() {
  syncFeedMapBack();
  requestAnimationFrame(() => {
    syncFeedMapBack();
    setTimeout(syncFeedMapBack, 0);
  });
}

function finite(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

function asPoint(lng, lat) {
  const x = finite(lng);
  const y = finite(lat);
  if (x == null || y == null) return null;
  if (Math.abs(x) > 180 || Math.abs(y) > 90) return null;
  return [x, y];
}

function pointFrom(value) {
  if (Array.isArray(value) && value.length >= 2) return asPoint(value[0], value[1]);
  if (typeof value === 'string') {
    const parts = value.split(',');
    if (parts.length >= 2) return asPoint(parts[0], parts[1]);
  }
  if (value && typeof value === 'object') {
    const named = asPoint(
      value.lng ?? value.lon ?? value.longitude,
      value.lat ?? value.latitude,
    );
    if (named) return named;
    if (value.coords) return pointFrom(value.coords);
    if (value.cord) return pointFrom(value.cord);
  }
  return null;
}

function placeName(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const name = value.name || value.place || value.label;
  return typeof name === 'string' ? name.trim() : '';
}

function stamp(value) {
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : 0;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 1e12) return numeric;
  if (Number.isFinite(numeric) && numeric > 1e9) return numeric * 1000;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

function clock(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return (
    pad(date.getDate()) + '/' + pad(date.getMonth() + 1) + '/' + String(date.getFullYear()).slice(-2) +
    ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
  );
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortClock(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()) {
    return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
  }
  return date.getDate() + ' ' + SHORT_MONTHS[date.getMonth()];
}

function textOf(msg) {
  if (Array.isArray(msg)) return msg[0] == null ? '' : String(msg[0]);
  return msg == null ? '' : String(msg);
}

function mediaOf(image) {
  const url = Array.isArray(image) ? image[0] : image;
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return '';
  return url;
}

// 1dvmin. clientX is CSS pixels, and 1dvmin is 1% of the shorter viewport side.
function feedDragLimit() {
  return Math.min(window.innerWidth, window.innerHeight) * 0.01;
}

function feedSelectionEmpty() {
  const sel = window.getSelection && window.getSelection();
  return !sel || !String(sel).length;
}

let feedPress = null;
column.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  feedPress = { x: event.clientX, y: event.clientY };
});

function feedActIdle(event) {
  if (!feedSelectionEmpty()) return false;
  if (!feedPress) return true;
  const dx = event.clientX - feedPress.x;
  const dy = event.clientY - feedPress.y;
  return Math.hypot(dx, dy) < feedDragLimit();
}

// Sits over a photo, or over a video above the native control strip.
// Move and wheel listeners stay off this node so a drag still scrolls the feed.
// A finger that stays inside 1dvmin plays or pauses.
function coverFeedPlayer(media, onTap) {
  const hit = document.createElement('div');
  hit.className = 'feed-media-hit';
  if (media.querySelector('video:not(.loop-face)')) hit.classList.add('is-video');
  let start = null;
  hit.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    start = { x: event.clientX, y: event.clientY, id: event.pointerId };
  });
  hit.addEventListener('pointerup', (event) => {
    const from = start;
    start = null;
    if (!from || from.id !== event.pointerId) return;
    const dx = event.clientX - from.x;
    const dy = event.clientY - from.y;
    if (Math.hypot(dx, dy) >= feedDragLimit() || !feedSelectionEmpty()) return;
    onTap(event);
  });
  hit.addEventListener('pointercancel', () => {
    start = null;
  });
  media.appendChild(hit);
}

// Every feed picture and video starts at one compact size (style.css
// .popup-media-card). A round ··· on its top right (shown by a tap, see
// mountMediaTools) slides out two more: one makes the media full width
// and back, one opens it fullscreen. They sit above the tap layer, so a
// tap on them never plays or pauses the video.
const MEDIA_MORE_ICON = [
  ['circle', { cx: '5', cy: '12', r: '1' }],
  ['circle', { cx: '12', cy: '12', r: '1' }],
  ['circle', { cx: '19', cy: '12', r: '1' }],
];
const MEDIA_CLOSE_ICON = [
  ['path', { d: 'M18 6 6 18' }],
  ['path', { d: 'm6 6 12 12' }],
];
const MEDIA_GROW_ICON = [
  ['path', { d: 'M15 3h6v6' }],
  ['path', { d: 'M9 21H3v-6' }],
  ['path', { d: 'm21 3-7 7' }],
  ['path', { d: 'm3 21 7-7' }],
];
const MEDIA_SHRINK_ICON = [
  ['path', { d: 'M4 14h6v6' }],
  ['path', { d: 'M20 10h-6V4' }],
  ['path', { d: 'm14 10 7-7' }],
  ['path', { d: 'm3 21 7-7' }],
];
const MEDIA_FULL_ICON = [
  ['path', { d: 'M8 3H5a2 2 0 0 0-2 2v3' }],
  ['path', { d: 'M21 8V5a2 2 0 0 0-2-2h-3' }],
  ['path', { d: 'M3 16v3a2 2 0 0 0 2 2h3' }],
  ['path', { d: 'M16 21h3a2 2 0 0 0 2-2v-3' }],
];

// Longest side of a GIF's still fill. The fill is blurred and dimmed, so a
// small copy looks the same as a full one.
const BACKDROP_PX = 96;

// Blur fill, as most feeds do it: the picture is fitted whole in the
// compact frame and a blurred copy of it fills the rest (style.css
// .feed-media-backdrop). It goes after the media, so a lookup of the
// card's first img still finds the picture.
//   Picture: an img with the same address. The browser decodes it off the
//   main thread (the file is already cached) and draws the blur once with
//   the card, so a scroll only moves it. It follows the picture's src, so
//   a gateway retry carries over.
//   GIF: it plays in the feed, and an img copy would decode it a second
//   time and blur every frame. Its fill is one still frame on a small
//   canvas instead, drawn when the page is idle after the GIF has loaded.
//   An address with no picture extension (IPFS) that is not yet known to
//   be a still is treated as a GIF: the feed paints it without checking,
//   and a gateway retry changes the address the check was saved under.
//   Video: an img that follows the poster, so a late poster carries over.
function backdropImg() {
  const back = document.createElement('img');
  back.className = 'feed-media-backdrop';
  back.alt = '';
  back.setAttribute('aria-hidden', 'true');
  back.draggable = false;
  back.decoding = 'async';
  back.loading = 'lazy';
  back.hidden = true;
  back.addEventListener('error', () => {
    back.hidden = true;
  });
  return back;
}

function mountMediaBackdrop(media, source) {
  if (source.tagName !== 'VIDEO') {
    mountPictureBackdrop(source);
    return;
  }
  const back = backdropImg();
  const sync = () => {
    const url = source.getAttribute('poster') || '';
    if (!url) {
      back.hidden = true;
      back.removeAttribute('src');
      return;
    }
    if (back.getAttribute('src') !== url) back.src = url;
    back.hidden = false;
  };
  new MutationObserver(sync).observe(source, { attributes: true, attributeFilter: ['poster'] });
  source.after(back);
  sync();
}

// A GIF by its address, or an extensionless file not already checked as a
// still. Only a known still gets the img copy.
function gifBackdropSource(url) {
  if (isGifUrl(url) || /^data:image\/gif/i.test(url)) return true;
  return needsGifCheck(url) && readGifCache(url) !== false;
}

function mountPictureBackdrop(source) {
  const back = backdropImg();
  let still = null;
  let seq = 0;
  const hideStill = () => {
    if (still) still.hidden = true;
  };
  const dropImg = () => {
    back.hidden = true;
    if (back.hasAttribute('src')) back.removeAttribute('src');
  };
  const paintStill = (run) => {
    const w = source.naturalWidth;
    const h = source.naturalHeight;
    if (run !== seq || !w || !h || !source.getAttribute('src')) return;
    if (!still) {
      still = document.createElement('canvas');
      still.className = 'feed-media-backdrop';
      still.setAttribute('aria-hidden', 'true');
      still.hidden = true;
      back.after(still);
    }
    const scale = Math.min(1, BACKDROP_PX / Math.max(w, h));
    try {
      still.width = Math.max(1, Math.round(w * scale));
      still.height = Math.max(1, Math.round(h * scale));
      // A cross-origin GIF taints the canvas, which only stops reading it
      // back. A canvas draw of an animated image takes one frame.
      still.getContext('2d').drawImage(source, 0, 0, still.width, still.height);
      still.hidden = false;
    } catch {
      still.hidden = true;
    }
  };
  const sync = () => {
    const run = ++seq;
    const url = source.getAttribute('src') || '';
    if (!url) {
      dropImg();
      hideStill();
      return;
    }
    if (!gifBackdropSource(url)) {
      hideStill();
      if (back.getAttribute('src') !== url) back.src = url;
      back.hidden = false;
      return;
    }
    dropImg();
    hideStill();
    const loaded = () => {
      if (run !== seq) return;
      const idle = typeof requestIdleCallback === 'function'
        ? (fn) => requestIdleCallback(fn, { timeout: 1500 })
        : (fn) => setTimeout(fn, 200);
      // decode() finishes off the main thread, so the draw reads a frame
      // that is already decoded.
      const ready = typeof source.decode === 'function' ? source.decode().catch(() => {}) : Promise.resolve();
      ready.then(() => idle(() => paintStill(run)));
    };
    if (source.complete && source.naturalWidth) loaded();
    else source.addEventListener('load', loaded, { once: true });
  };
  source.addEventListener('error', () => {
    seq++;
    dropImg();
    hideStill();
  });
  new MutationObserver(sync).observe(source, { attributes: true, attributeFilter: ['src'] });
  source.after(back);
  sync();
}

// How long the ··· stays after the last touch or mouse move. Chrome's own
// video control bar hides after the same 2.5 s, so on a video the two
// come and go together, and a picture keeps the same rhythm.
const MEDIA_TOOLS_IDLE_MS = 2500;

// The ··· is hidden at rest (.is-tools-shown on the media shows it).
//   Picture: a tap shows it (a second tap hides it); a mouse shows it while
//     it moves over the picture. It hides 2.5 s after the last of those.
//   Video: it follows the native control bar. It shows while that bar is
//     on and the video is paused, or for 2.5 s after a touch or mouse move
//     while it plays. A tap still plays or pauses.
//   Open (the ··· turned ×): it stays until × or Escape, then hides after
//     the same 2.5 s. Make bigger keeps it open.
// Returns tap(event) for the picture's tap layer.
// picture: a photo or GIF, which Settings > Show pictures full size starts
// full width (pictureStartsWide).
function mountMediaTools(media, key, onFull, video = null, picture = false) {
  const tools = document.createElement('div');
  tools.className = 'feed-media-tools';
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'feed-media-tool feed-media-more';
  more.setAttribute('aria-haspopup', 'true');
  const size = document.createElement('button');
  size.type = 'button';
  size.className = 'feed-media-tool feed-media-size';
  const full = document.createElement('button');
  full.type = 'button';
  full.className = 'feed-media-tool feed-media-full';
  full.setAttribute('aria-label', 'Fullscreen');
  full.title = 'Fullscreen';
  full.appendChild(svgIcon(MEDIA_FULL_ICON));
  const paint = () => {
    const wide = media.classList.contains('is-wide');
    const label = wide ? 'Make smaller' : 'Make bigger';
    size.setAttribute('aria-pressed', wide ? 'true' : 'false');
    size.setAttribute('aria-label', label);
    size.title = label;
    size.replaceChildren(svgIcon(wide ? MEDIA_SHRINK_ICON : MEDIA_GROW_ICON));
  };
  if (picture) {
    media.dataset.picture = '1';
    if (key) media.dataset.mediaKey = key;
    media._paintSize = paint;
  }
  if (picture ? pictureStartsWide(key) : !!(key && wideMedia.has(key))) media.classList.add('is-wide');
  paint();
  tools.append(size, full, more);

  let recent = false;
  let idleTimer = 0;
  const isOpen = () => tools.classList.contains('is-open');
  const paintShown = () => {
    let shown = recent;
    if (isOpen()) shown = true;
    else if (video) shown = !!video.controls && (video.paused || recent);
    media.classList.toggle('is-tools-shown', shown);
  };
  // Shown now, hidden MEDIA_TOOLS_IDLE_MS after the last call.
  const wake = () => {
    recent = true;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = 0;
      recent = false;
      paintShown();
    }, MEDIA_TOOLS_IDLE_MS);
    paintShown();
  };
  const sleepNow = () => {
    clearTimeout(idleTimer);
    idleTimer = 0;
    recent = false;
    paintShown();
  };
  const setOpen = (open) => {
    tools.classList.toggle('is-open', open);
    more.setAttribute('aria-expanded', open ? 'true' : 'false');
    more.setAttribute('aria-label', open ? 'Hide media options' : 'Media options');
    more.title = open ? 'Hide' : 'Media options';
    more.replaceChildren(svgIcon(open ? MEDIA_CLOSE_ICON : MEDIA_MORE_ICON));
    // Closing starts the countdown; open keeps it in view.
    if (open) paintShown();
    else wake();
  };
  setOpen(false);
  sleepNow();

  // A keyboard click has detail 0 and no pointer, so only a tap is checked
  // for a drag.
  more.addEventListener('click', (event) => {
    event.stopPropagation();
    if (event.detail > 0 && !feedActIdle(event)) return;
    setOpen(!isOpen());
  });
  size.addEventListener('click', (event) => {
    event.stopPropagation();
    if (event.detail > 0 && !feedActIdle(event)) return;
    const wide = !media.classList.contains('is-wide');
    media.classList.toggle('is-wide', wide);
    if (key) {
      if (wide) {
        wideMedia.add(key);
        narrowMedia.delete(key);
      } else {
        wideMedia.delete(key);
        narrowMedia.add(key);
      }
    }
    paint();
  });
  full.addEventListener('click', (event) => {
    event.stopPropagation();
    if (event.detail > 0 && !feedActIdle(event)) return;
    setOpen(false);
    onFull();
  });
  tools.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !isOpen()) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    more.focus();
  });
  // A mouse shows it while it moves over the media and drops it on leave,
  // as the native video bar does.
  media.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'mouse') wake();
  });
  media.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'mouse') sleepNow();
  });
  if (video) {
    // Any touch on a video (the tap layer or the native bar) counts as use.
    media.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'mouse') wake();
    });
    video.addEventListener('play', paintShown);
    video.addEventListener('pause', paintShown);
    // The poster face turns the native bar off until the first play.
    new MutationObserver(paintShown).observe(video, { attributes: true, attributeFilter: ['controls'] });
  }
  media.appendChild(tools);
  paintShown();
  return {
    // The picture's tap: show or hide the ···; a click only shows it.
    tap(event) {
      if (isOpen()) return;
      if (event && event.pointerType === 'mouse') {
        wake();
        return;
      }
      if (recent) sleepNow();
      else wake();
    },
  };
}

function coordLabel(lngLat) {
  const lat = Number(lngLat[1]);
  const lng = Number(lngLat[0]);
  const n = (v) => {
    const a = Math.abs(v);
    const digits = a >= 100 ? 2 : a >= 10 ? 3 : 4;
    return v.toFixed(digits);
  };
  return `${n(lat)}, ${n(lng)}`;
}

// Feed place cell. Finer than the live-marker GEO_GRID (0.1 deg).
// Key: "f" + Math.round(lng / 0.05) + ":" + Math.round(lat / 0.05)
// Example: longitude 13.4, latitude 52.5 is "f268:1050".
// server/feedplace.js and place-pack.json use the same string.
// 0.05 deg is about 5.5 km. The old 0.5° cache (feed-places-v1) is ignored.
const PLACE_GRID = 0.05;
const PLACE_PACK_KEY = 'place-pack-v1';
const PLACE_PACK_V = 1;

let packCountries = null;
let packRows = null;
let placePackReady = false;
let placePackStarted = false;
let placePackFailed = false;
const placePackListeners = new Set();
const OCEAN_PACK_KEY = 'oceans-pack-v1';
let oceanFeatures = null;
let oceanPackReady = false;
let oceanPackStarted = false;

function pointInOceanRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-300) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function adoptOceanPack(data) {
  if (!data || data.v !== 1 || !Array.isArray(data.features)) return false;
  const list = [];
  for (const feature of data.features) {
    const name = String(feature && feature.name || '').trim();
    const rings = feature && feature.rings;
    if (!name || !Array.isArray(rings) || !rings.length) continue;
    const clean = [];
    for (const ring of rings) {
      if (!Array.isArray(ring) || ring.length < 4) continue;
      clean.push(ring);
    }
    if (clean.length) list.push({ name, rings: clean });
  }
  if (!list.length) return false;
  oceanFeatures = list;
  oceanPackReady = true;
  return true;
}

function oceanNameFromKey(key) {
  if (!oceanFeatures) return '';
  const match = /^f(-?\d+):(-?\d+)$/.exec(key);
  if (!match) return '';
  const lng = Number(match[1]) * PLACE_GRID;
  const lat = Number(match[2]) * PLACE_GRID;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return '';
  for (const feature of oceanFeatures) {
    for (const ring of feature.rings) {
      if (pointInOceanRing(lng, lat, ring)) return feature.name;
    }
  }
  return '';
}

function rememberOceanPack(text) {
  try { localStorage.setItem(OCEAN_PACK_KEY, text); } catch { /* quota */ }
}

async function fetchOceanPack() {
  try {
    const res = await fetch('/oceans.json');
    if (!res.ok) return;
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { return; }
    if (!adoptOceanPack(data)) return;
    rememberOceanPack(text);
    refreshPlaceCards();
  } catch {
    /* offline */
  }
}

function ensureOceanPack() {
  if (oceanPackReady || oceanPackStarted) return;
  oceanPackStarted = true;
  let cached = '';
  try { cached = localStorage.getItem(OCEAN_PACK_KEY) || ''; } catch { cached = ''; }
  setTimeout(() => {
    if (cached) {
      try {
        if (adoptOceanPack(JSON.parse(cached))) {
          refreshPlaceCards();
          return;
        }
      } catch { /* bad cache */ }
      try { localStorage.removeItem(OCEAN_PACK_KEY); } catch { /* ignore */ }
    }
    fetchOceanPack();
  }, 0);
}

function placeKey(lngLat) {
  const lng = Number(lngLat && lngLat[0]);
  const lat = Number(lngLat && lngLat[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return '';
  return 'f' + Math.round(lng / PLACE_GRID) + ':' + Math.round(lat / PLACE_GRID);
}

function adoptPlacePack(text) {
  let data;
  try { data = JSON.parse(text); } catch { return false; }
  if (!data || data.v !== PLACE_PACK_V || data.grid !== PLACE_GRID) return false;
  if (!data.countries || typeof data.countries !== 'object' || !Array.isArray(data.rows)) return false;
  const countries = {};
  for (const [code, name] of Object.entries(data.countries)) {
    const label = String(name || '').trim();
    if (!/^[A-Z]{2}$/.test(code) || !label) continue;
    countries[code] = label;
  }
  const rows = new Map();
  for (const row of data.rows) {
    if (!Array.isArray(row) || row.length < 4) continue;
    rows.set(row[0], row);
  }
  packCountries = countries;
  packRows = rows;
  placePackReady = true;
  placePackFailed = false;
  queueMicrotask(() => {
    for (const fn of placePackListeners) fn(true);
  });
  return true;
}

function packCountry(key) {
  if (!packRows) return null;
  const match = /^f(-?\d+):(-?\d+)$/.exec(key);
  if (!match) return null;
  const lng = Number(match[1]);
  const lat = Number(match[2]);
  const row = packRows.get(lat);
  if (!row) return null;
  for (let i = 1; i < row.length; i += 3) {
    const start = row[i];
    if (lng < start) return null;
    if (lng < start + row[i + 1]) {
      const country = packCountries[row[i + 2]];
      if (!country) return null;
      return { code: row[i + 2], country };
    }
  }
  return null;
}

function rememberPlacePack(text) {
  try {
    localStorage.setItem(PLACE_PACK_KEY, text);
    return;
  } catch {
    /* quota — the IndexedDB copy is the fallback */
  }
  try {
    const open = indexedDB.open('place-pack', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('pack');
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('pack', 'readwrite');
      tx.objectStore('pack').put(text, PLACE_PACK_KEY);
      tx.oncomplete = () => db.close();
      tx.onerror = () => db.close();
    };
  } catch {
    /* private mode */
  }
}

function readPlacePackIdb() {
  return new Promise((resolve) => {
    let open;
    try { open = indexedDB.open('place-pack', 1); } catch { resolve(''); return; }
    open.onupgradeneeded = () => open.result.createObjectStore('pack');
    open.onerror = () => resolve('');
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('pack')) { db.close(); resolve(''); return; }
      const tx = db.transaction('pack', 'readonly');
      const req = tx.objectStore('pack').get(PLACE_PACK_KEY);
      req.onsuccess = () => { db.close(); resolve(typeof req.result === 'string' ? req.result : ''); };
      req.onerror = () => { db.close(); resolve(''); };
    };
  });
}

function refreshPlaceCards() {
  column.querySelectorAll('.feed-loc-coords').forEach((coords) => {
    if (coords.dataset.place === 'ready') return;
    const card = coords.closest('.feed-card');
    if (card) wantPlace(card);
  });
}

function placePackGaveUp() {
  if (placePackReady) return;
  placePackFailed = true;
  for (const fn of placePackListeners) fn(false);
}

async function fetchPlacePack() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/place-pack`);
    if (!res.ok) {
      placePackGaveUp();
      return;
    }
    const text = await res.text();
    if (!adoptPlacePack(text)) {
      placePackGaveUp();
      return;
    }
    rememberPlacePack(text);
    refreshPlaceCards();
  } catch {
    placePackGaveUp();
  }
}

function ensurePlacePack() {
  ensureOceanPack();
  if (placePackReady || placePackStarted) return;
  placePackStarted = true;
  let cached = '';
  try { cached = localStorage.getItem(PLACE_PACK_KEY) || ''; } catch { cached = ''; }
  setTimeout(() => {
    if (cached && adoptPlacePack(cached)) {
      refreshPlaceCards();
      return;
    }
    if (cached) {
      try { localStorage.removeItem(PLACE_PACK_KEY); } catch { /* ignore */ }
    }
    readPlacePackIdb().then((text) => {
      if (text && adoptPlacePack(text)) {
        refreshPlaceCards();
        return;
      }
      fetchPlacePack();
    });
  }, 0);
}

function flagImg(code) {
  if (!/^[A-Z]{2}$/.test(code)) return null;
  const img = document.createElement('img');
  img.className = 'feed-loc-flag';
  img.src = `/flags/w20/${code.toLowerCase()}.png`;
  img.alt = '';
  img.setAttribute('aria-hidden', 'true');
  img.loading = 'lazy';
  img.decoding = 'async';
  img.onerror = () => { img.hidden = true; };
  return img;
}

function normPlaceName(value) {
  return String(value || '').toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
}

// code + names. The first name is the label. A cached row may still store a long country.
const COUNTRY_ALIASES = `
AD Andorra
AE United Arab Emirates|UAE
AF Afghanistan
AG Antigua and Barbuda
AI Anguilla
AL Albania
AM Armenia
AN Netherlands Antilles
AO Angola
AQ Antarctica
AR Argentina
AS American Samoa
AT Austria
AU Australia
AW Aruba
AX Aland Islands
AZ Azerbaijan
BA Bosnia and Herzegovina
BB Barbados
BD Bangladesh
BE Belgium
BF Burkina Faso
BG Bulgaria
BH Bahrain
BI Burundi
BJ Benin
BL Saint Barthelemy
BM Bermuda
BN Brunei
BO Bolivia|Plurinational State of Bolivia
BQ Bonaire, Saint Eustatius and Saba
BR Brazil
BS Bahamas
BT Bhutan
BV Bouvet Island
BW Botswana
BY Belarus
BZ Belize
CA Canada
CC Cocos Islands
CD Democratic Republic of the Congo|DR Congo|DRC|Democratic Republic of Congo
CF Central African Republic
CG Republic of the Congo|Congo-Brazzaville
CH Switzerland
CI Ivory Coast|Cote d'Ivoire
CK Cook Islands
CL Chile
CM Cameroon
CN China
CO Colombia
CR Costa Rica
CS Serbia and Montenegro
CU Cuba
CV Cabo Verde|Cape Verde
CW Curacao
CX Christmas Island
CY Cyprus
CZ Czechia|Czech Republic
DE Germany
DJ Djibouti
DK Denmark
DM Dominica
DO Dominican Republic
DZ Algeria
EC Ecuador
EE Estonia
EG Egypt
EH Western Sahara
ER Eritrea
ES Spain
ET Ethiopia
FI Finland
FJ Fiji
FK Falkland Islands
FM Micronesia
FO Faroe Islands
FR France
GA Gabon
GB United Kingdom|United Kingdom of Great Britain and Northern Ireland|Great Britain|UK
GD Grenada
GE Georgia
GF French Guiana
GG Guernsey
GH Ghana
GI Gibraltar
GL Greenland
GM Gambia
GN Guinea
GP Guadeloupe
GQ Equatorial Guinea
GR Greece
GS South Georgia and the South Sandwich Islands
GT Guatemala
GU Guam
GW Guinea-Bissau
GY Guyana
HK Hong Kong
HM Heard Island and McDonald Islands
HN Honduras
HR Croatia
HT Haiti
HU Hungary
ID Indonesia
IE Ireland
IL Israel
IM Isle of Man
IN India
IO British Indian Ocean Territory
IQ Iraq
IR Iran|Islamic Republic of Iran
IS Iceland
IT Italy
JE Jersey
JM Jamaica
JO Jordan
JP Japan
KE Kenya
KG Kyrgyzstan
KH Cambodia
KI Kiribati
KM Comoros
KN Saint Kitts and Nevis
KP North Korea|Democratic People's Republic of Korea
KR South Korea|Republic of Korea|Korea, Republic of
KW Kuwait
KY Cayman Islands
KZ Kazakhstan
LA Laos|Lao People's Democratic Republic
LB Lebanon
LC Saint Lucia
LI Liechtenstein
LK Sri Lanka
LR Liberia
LS Lesotho
LT Lithuania
LU Luxembourg
LV Latvia
LY Libya
MA Morocco
MC Monaco
MD Moldova
ME Montenegro
MF Saint Martin
MG Madagascar
MH Marshall Islands
MK North Macedonia|Macedonia
ML Mali
MM Myanmar|Burma
MN Mongolia
MO Macao
MP Northern Mariana Islands
MQ Martinique
MR Mauritania
MS Montserrat
MT Malta
MU Mauritius
MV Maldives
MW Malawi
MX Mexico
MY Malaysia
MZ Mozambique
NA Namibia
NC New Caledonia
NE Niger
NF Norfolk Island
NG Nigeria
NI Nicaragua
NL The Netherlands|Netherlands
NO Norway
NP Nepal
NR Nauru
NU Niue
NZ New Zealand
OM Oman
PA Panama
PE Peru
PF French Polynesia
PG Papua New Guinea
PH Philippines
PK Pakistan
PL Poland
PM Saint Pierre and Miquelon
PN Pitcairn
PR Puerto Rico
PS Palestinian Territory|Palestine
PT Portugal
PW Palau
PY Paraguay
QA Qatar
RE Reunion
RO Romania
RS Serbia
RU Russia|Russian Federation
RW Rwanda
SA Saudi Arabia
SB Solomon Islands
SC Seychelles
SD Sudan
SE Sweden
SG Singapore
SH Saint Helena
SI Slovenia
SJ Svalbard and Jan Mayen
SK Slovakia
SL Sierra Leone
SM San Marino
SN Senegal
SO Somalia
SR Suriname
SS South Sudan
ST Sao Tome and Principe
SV El Salvador
SX Sint Maarten
SY Syria|Syrian Arab Republic
SZ Eswatini|Swaziland
TC Turks and Caicos Islands
TD Chad
TF French Southern Territories
TG Togo
TH Thailand
TJ Tajikistan
TK Tokelau
TL Timor Leste|East Timor
TM Turkmenistan
TN Tunisia
TO Tonga
TR Turkey
TT Trinidad and Tobago
TV Tuvalu
TW Taiwan
TZ Tanzania|United Republic of Tanzania
UA Ukraine
UG Uganda
UM United States Minor Outlying Islands
US United States|United States of America|USA
UY Uruguay
UZ Uzbekistan
VA Vatican|Vatican City
VC Saint Vincent and the Grenadines
VE Venezuela|Bolivarian Republic of Venezuela
VG British Virgin Islands
VI U.S. Virgin Islands
VN Vietnam
VU Vanuatu
WF Wallis and Futuna
WS Samoa
XK Kosovo
YE Yemen
YT Mayotte
ZA South Africa
ZM Zambia
ZW Zimbabwe
`;
const countryCodeByName = new Map();
const countryNameByCode = new Map();
for (const line of COUNTRY_ALIASES.trim().split('\n')) {
  const code = line.slice(0, 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) continue;
  const names = line.slice(3).split('|');
  const label = names[0] ? names[0].trim() : '';
  if (label) countryNameByCode.set(code, label);
  for (const name of names) {
    const key = normPlaceName(name);
    if (key) countryCodeByName.set(key, code);
  }
}

function placeCountryCode(hit) {
  const raw = String(hit && hit.code || '').trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(raw)) return raw;
  return countryCodeByName.get(normPlaceName(hit && hit.country)) || '';
}

// Chat posts and ocean cells have no country, so a country filter skips them.
function countryOf(post) {
  if (!post || post.kind === 'chat' || !post.lngLat || !placePackReady) return '';
  const key = placeKey(post.lngLat);
  if (!key) return '';
  return placeCountryCode(packCountry(key) || {});
}

function placePart(className, mark, name) {
  const el = document.createElement('span');
  el.className = className;
  if (mark instanceof HTMLElement) {
    el.appendChild(mark);
  } else if (mark) {
    const emoji = document.createElement('span');
    emoji.className = 'feed-loc-emoji';
    emoji.setAttribute('aria-hidden', 'true');
    emoji.textContent = mark;
    el.appendChild(emoji);
  }
  const text = document.createElement('span');
  text.className = 'feed-loc-name';
  text.textContent = name;
  el.appendChild(text);
  return el;
}

function showPlace(coords, hit) {
  const label = coords.parentElement;
  if (!label) return;
  const code = placeCountryCode(hit);
  const name = code ? (countryNameByCode.get(code) || String(hit.country || '').trim()) : '';
  if (!name) {
    coords.hidden = false;
    coords.classList.add('is-fallback');
    coords.dataset.place = 'fail';
    const stale = label.querySelector('.feed-loc-where');
    if (stale) stale.remove();
    return;
  }
  let where = label.querySelector('.feed-loc-where');
  if (!where) {
    where = document.createElement('span');
    where.className = 'feed-loc-where';
    coords.before(where);
  }
  where.replaceChildren();
  where.appendChild(placePart('feed-loc-country', flagImg(code), name));
  coords.hidden = true;
  coords.dataset.place = 'ready';
}

function showOcean(coords, name) {
  const label = coords.parentElement;
  if (!label || !name) return;
  let where = label.querySelector('.feed-loc-where');
  if (!where) {
    where = document.createElement('span');
    where.className = 'feed-loc-where';
    coords.before(where);
  }
  where.replaceChildren();
  where.appendChild(placePart('feed-loc-country', '🌊', name));
  coords.hidden = true;
  coords.dataset.place = 'ready';
}

function wantPlace(card) {
  if (!card || !card.querySelector) return;
  const coords = card.querySelector('.feed-loc-coords');
  if (!coords || !coords.dataset.geokey) return;
  if (coords.dataset.place === 'ready' || coords.dataset.place === 'fail') return;
  if (!placePackReady) return;
  const hit = packCountry(coords.dataset.geokey);
  if (hit) {
    showPlace(coords, hit);
    return;
  }
  // Pack miss is land-or-ocean. Only name water from the ocean polys.
  if (!oceanPackReady) {
    ensureOceanPack();
    return;
  }
  const ocean = oceanNameFromKey(coords.dataset.geokey);
  if (ocean) {
    showOcean(coords, ocean);
    return;
  }
  coords.hidden = false;
  coords.classList.add('is-fallback');
  coords.dataset.place = 'fail';
}

const ringCenters = new Map();

function centerOf(polygon) {
  if (ringCenters.has(polygon)) return ringCenters.get(polygon);
  const lngLat = ringCenter(polygon);
  ringCenters.set(polygon, lngLat);
  return lngLat;
}

function readRecord(data) {
  if (typeof data === 'function') {
    try { return data(); } catch { return null; }
  }
  return data && typeof data === 'object' ? data : null;
}

function markerRecord(feature) {
  return readRecord(feature && feature.properties && feature.properties.popupData);
}

function polygonRecord(polygon) {
  return readRecord(polygon && polygon.popupData);
}

function chatRecord(post) {
  const message = post.message || {};
  const payer = message.payer || '';
  const pic = payer && profilePictures[payer] && profilePictures[payer].url;
  const name = payer && usernames[payer] && usernames[payer].username;
  const link = payer && click2url[payer] && click2url[payer].click2url;
  return {
    profileUrl: typeof pic === 'string' && pic ? pic : DEFAULT_PIC,
    payer,
    payerInfo: payer || 'Anonymous',
    username: name ? ` ${name}` : '',
    click2link: link ? ` ${link}` : '',
    image: message.image,
    msg: message.userMessage,
    timestamp: clock(message.created),
  };
}

function recordFor(post) {
  if (post.kind === 'marker') return markerRecord(post.feature);
  if (post.kind === 'polygon') return polygonRecord(post.polygon);
  return chatRecord(post);
}

function isViewerUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function anonViewer() {
  try {
    let id = localStorage.getItem(VIEWER_KEY);
    if (!isViewerUuid(id)) {
      id = crypto.randomUUID();
      localStorage.setItem(VIEWER_KEY, id);
    }
    return id;
  } catch {
    if (!isViewerUuid(looseViewer)) {
      try { looseViewer = crypto.randomUUID(); } catch { looseViewer = ''; }
    }
    return looseViewer;
  }
}

// The id is read when the view joins the batch, so a wallet connect while
// that batch is waiting does not rewrite rows already queued.
function viewerNow() {
  const account = typeof connectedAccount === 'string' ? connectedAccount.trim() : '';
  if (/^\d+\.\d+\.\d+$/.test(account) && account.length <= 40) return account;
  return anonViewer();
}

// Shared with the map popup (processallmessages.viewsChip) so the chip and
// its update path stay one markup.
function viewChip(key) {
  const known = viewTotals.get(key);
  return sharedViewsChip(known == null ? 0 : known);
}

// The comment count hangs to the right of the icon. This spacer is the same
// text, so share stays one gap past the count and the icon stays centred.
function commentCountSpace(comment) {
  const space = document.createElement('span');
  space.className = 'feed-comment-count-space';
  space.setAttribute('aria-hidden', 'true');
  const label = comment.querySelector('label');
  const input = comment.querySelector('input');
  const paint = () => {
    if (!label) return;
    const shown = input && input.checked ? label.dataset.next : label.dataset.count;
    space.textContent = shown || '0';
  };
  paint();
  if (label) {
    new MutationObserver(paint).observe(label, {
      attributes: true,
      attributeFilter: ['data-count', 'data-next'],
    });
  }
  if (input) input.addEventListener('change', paint);
  return space;
}

function paintCardCount(card) {
  const num = viewTotals.get(card.dataset.key);
  if (num == null) return;
  const node = card.querySelector('.feed-view-count');
  if (!node) return;
  setViewsCount(node.parentElement, num);
}

function paintCounts(counts) {
  if (!counts || typeof counts !== 'object') return;
  for (const [id, raw] of Object.entries(counts)) {
    const num = Number(raw);
    if (!Number.isFinite(num) || num < 0) continue;
    viewTotals.set(id, num);
  }
  for (const card of column.children) {
    if (card.classList && card.classList.contains('feed-card')) paintCardCount(card);
  }
}

function wantCount(key) {
  if (!key || viewTotals.has(key)) return;
  viewCountWanted.push(key);
  if (!viewCountTimer) viewCountTimer = setTimeout(pullCounts, 60);
}

async function pullCounts() {
  viewCountTimer = 0;
  const ids = [];
  const seen = new Set();
  while (viewCountWanted.length && ids.length < VIEW_GET_BATCH) {
    const id = viewCountWanted.shift();
    if (!id || seen.has(id) || viewTotals.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  if (viewCountWanted.length && !viewCountTimer) viewCountTimer = setTimeout(pullCounts, 60);
  if (!ids.length) return;
  try {
    const res = await fetch(`${BACKEND_URL}/api/views?ids=${ids.map(encodeURIComponent).join(',')}`);
    if (!res.ok) return;
    const data = await res.json();
    paintCounts(data && data.counts);
  } catch {
    /* the next cards ask again */
  }
}

// Half the card inside the scroller. The observer's rootMargin is wider
// than this, so a view still waits until the card is actually on screen.
function cardInView(card) {
  const root = scroller.getBoundingClientRect();
  const box = card.getBoundingClientRect();
  const height = Math.max(0, Math.min(root.bottom, box.bottom) - Math.max(root.top, box.top));
  const width = Math.max(0, Math.min(root.right, box.right) - Math.max(root.left, box.left));
  const area = box.height * box.width;
  return area > 0 && (height * width) / area >= 0.5;
}

function syncCardView(card) {
  if (cardInView(card)) armView(card);
  else disarmView(card);
}

function linkInfo() {
  return navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
}

// null means the browser has no Network Information API.
function connectionConstrained() {
  return connectionIsConstrained(linkInfo());
}

let autoplayLogged = '';

function autoplayOnMobile() {
  const net = linkInfo();
  if (net && (net.type === 'cellular' || net.type === 'unknown')) return true;
  try {
    if (/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || '')) return true;
  } catch {
    /* no user agent */
  }
  try {
    if (window.matchMedia('(pointer: coarse)').matches) return true;
  } catch {
    /* no matchMedia */
  }
  return false;
}

function autoplayAllowed() {
  const net = linkInfo();
  const constrained = connectionConstrained();
  let reducedMotion = false;
  try {
    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    reducedMotion = false;
  }
  const flags = {
    autoplay: feedPrefs.autoplay,
    reducedMotion,
    saveData: !!(net && net.saveData),
    dataSaver: feedPrefs.dataSaver,
    connectionKnown: constrained != null,
    constrained: constrained === true,
  };
  if (autoplayOnMobile()) {
    const line = JSON.stringify(flags);
    if (line !== autoplayLogged) {
      autoplayLogged = line;
      console.info('feedAutoplayAllowed', flags, {
        effectiveType: net && net.effectiveType || '',
        type: net && net.type || '',
      });
    }
  }
  return feedAutoplayAllowed(flags);
}

function gifMotionOk() {
  try {
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return true;
  }
}

// One observer for every feed-card video. The root is the scroller node, so
// parking that node inside #feed-search-results keeps the same root.
const feedVideoRatio = new Map();
let feedVideoObserver = null;
let activeFeedVideo = null;
let preferredFeedVideo = null;
let feedVideoFrame = 0;
let feedVideoLock = 0;
let feedVideoDwellId = null;
let feedVideoDwellTimer = 0;
const feedVideoZeroSince = new Map();
const feedVideoReleaseTimers = new Map();

function feedVideoBlocked() {
  if (document.visibilityState === 'hidden') return true;
  if (!feedOn() || root.classList.contains('is-peek')) return true;
  if (!profilePage.hidden || profilePage.classList.contains('nav-cover')) return true;
  if (!settings.hidden || settingsOpen || settings.classList.contains('nav-cover')) return true;
  if (!feedChat.hidden || feedChat.classList.contains('nav-cover')) return true;
  if (!menu.hidden) return true;
  if (filterCard.style.display === 'block') return true;
  if (document.querySelector('.comments-modal')) return true;
  if (document.getElementById('media-fullscreen')) return true;
  return false;
}

function ensureFeedVideoSrc(video) {
  if (!video.getAttribute('src')) {
    const src = video.dataset.src;
    if (!src) return;
    video.src = src;
  }
  video.preload = 'auto';
}

function startFeedVideo(video, fromUser) {
  if (!video || video.dataset.feedHold === '1') return;
  feedVideoLock += 1;
  try {
    ensureFeedVideoSrc(video);
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.loop = true;
    if (!fromUser && video.dataset.feedSound !== '1') {
      video.muted = true;
      video.defaultMuted = true;
      video.setAttribute('muted', '');
    }
    video.dataset.feedAuto = fromUser ? 'user' : '1';
    if (!video.paused) return;
    const started = video.play();
    if (started && typeof started.catch === 'function') {
      started.catch(() => {
        if (video.dataset.feedSound === '1') return;
        video.muted = true;
        video.play().catch(() => {});
      });
    }
  } finally {
    feedVideoLock -= 1;
  }
}

function pauseFeedVideo(video) {
  if (!video || video.paused) return;
  feedVideoLock += 1;
  try {
    video.pause();
  } finally {
    feedVideoLock -= 1;
  }
}

function cancelFeedVideoDwell() {
  if (feedVideoDwellTimer) clearTimeout(feedVideoDwellTimer);
  feedVideoDwellTimer = 0;
  feedVideoDwellId = null;
}

function cancelFeedVideoRelease(video) {
  feedVideoZeroSince.delete(video);
  const timer = feedVideoReleaseTimers.get(video);
  if (timer) clearTimeout(timer);
  feedVideoReleaseTimers.delete(video);
}

function scheduleFeedVideoRelease(video) {
  if (!feedVideoZeroSince.has(video)) feedVideoZeroSince.set(video, Date.now());
  if (feedVideoReleaseTimers.has(video)) return;
  const timer = setTimeout(() => {
    feedVideoReleaseTimers.delete(video);
    const ratio = feedVideoRatio.has(video) ? feedVideoRatio.get(video) : 0;
    if (!feedVideoShouldRelease({
      ratio,
      zeroSince: feedVideoZeroSince.get(video),
      user: video === preferredFeedVideo || video.dataset.feedSound === '1',
      held: video.dataset.feedHold === '1',
    }, Date.now())) return;
    unloadFeedVideoSrc(video);
  }, FEED_VIDEO_RELEASE_MS);
  feedVideoReleaseTimers.set(video, timer);
}

// Pause from the autoplay picker. A user video stays untouched until none
// of it is on screen. Fully off screen, the file is dropped after the wait.
function retireFeedVideo(video) {
  const ratio = feedVideoRatio.get(video) || 0;
  const user = video === preferredFeedVideo || video.dataset.feedSound === '1';
  if (feedVideoHeld({ ratio, user, held: video.dataset.feedHold === '1' })) {
    cancelFeedVideoRelease(video);
    return;
  }
  pauseFeedVideo(video);
  const preload = feedVideoPreloadOnPause({ ratio, user, hasSrc: !!video.getAttribute('src') });
  if (preload) video.preload = preload;
  if (ratio <= 0) scheduleFeedVideoRelease(video);
  else cancelFeedVideoRelease(video);
}

function unloadFeedVideoSrc(video) {
  if (!video.getAttribute('src')) return;
  const poster = video.getAttribute('poster');
  const src = video.dataset.src || '';
  feedVideoLock += 1;
  try {
    video.removeAttribute('src');
    video.preload = 'none';
    video.load();
  } finally {
    feedVideoLock -= 1;
  }
  if (src) video.dataset.src = src;
  if (poster) video.setAttribute('poster', poster);
}

function armFeedVideoStart(video, fromUser) {
  const delay = feedVideoStartDelay({
    id: video,
    user: fromUser,
    playing: video === activeFeedVideo && !video.paused,
  });
  if (!delay) {
    cancelFeedVideoDwell();
    startFeedVideo(video, fromUser);
    return;
  }
  if (feedVideoDwellId === video) return;
  cancelFeedVideoDwell();
  feedVideoDwellId = video;
  feedVideoDwellTimer = setTimeout(() => {
    feedVideoDwellTimer = 0;
    if (feedVideoDwellId !== video) return;
    feedVideoDwellId = null;
    if (!video.isConnected || feedVideoBlocked()) return;
    const ratio = feedVideoVisibleRatio(video);
    feedVideoRatio.set(video, ratio);
    if (ratio < FEED_VIDEO_MIN && video !== preferredFeedVideo) return;
    activeFeedVideo = video;
    startFeedVideo(video, false);
  }, delay);
}

function releaseFeedVideo(video) {
  cancelFeedVideoRelease(video);
  if (feedVideoDwellId === video) cancelFeedVideoDwell();
  if (feedVideoObserver) feedVideoObserver.unobserve(video);
  feedVideoRatio.delete(video);
  if (activeFeedVideo === video) activeFeedVideo = null;
  if (preferredFeedVideo === video) preferredFeedVideo = null;
  pauseFeedVideo(video);
}

// A removed card does not reliably notify the intersection observer, and the
// column is no longer watched. Drop tracked videos while their card is still
// in the tree, before a trim or a column replace detaches them.
function releaseFeedVideosIn(root) {
  if (!root || !root.contains) return;
  for (const video of [...feedVideoRatio.keys()]) {
    if (root.contains(video)) releaseFeedVideo(video);
  }
}

function settleFeedVideos() {
  for (const video of [...feedVideoRatio.keys()]) {
    if (!video.isConnected) releaseFeedVideo(video);
  }
  if (preferredFeedVideo && !feedVideoRatio.has(preferredFeedVideo)) preferredFeedVideo = null;
  if (feedVideoBlocked()) {
    cancelFeedVideoDwell();
    activeFeedVideo = null;
    for (const video of feedVideoRatio.keys()) {
      retireFeedVideo(video);
      pauseFeedVideo(video);
    }
    return;
  }
  const allow = autoplayAllowed();
  const candidates = [];
  for (const [video, ratio] of feedVideoRatio) {
    if (!video.closest('#feed-column')) {
      retireFeedVideo(video);
      continue;
    }
    if (video.dataset.feedHold === '1' && video !== preferredFeedVideo) continue;
    candidates.push({ id: video, ratio });
  }
  let next = null;
  if (allow || preferredFeedVideo) {
    next = pickFeedVideo(candidates, {
      preferred: preferredFeedVideo,
      current: activeFeedVideo,
    });
  }
  if (!allow && !(preferredFeedVideo && next === preferredFeedVideo)) {
    next = null;
    if (gifMotionOk()) {
      const gifs = [];
      for (const item of candidates) {
        if (item.id && item.id.dataset && item.id.dataset.gif === '1') gifs.push(item);
      }
      next = pickFeedVideo(gifs, { preferred: null, current: activeFeedVideo });
    }
  }
  if (preferredFeedVideo && next !== preferredFeedVideo) {
    const ratio = feedVideoRatio.get(preferredFeedVideo) || 0;
    if (!(ratio > 0)) preferredFeedVideo = null;
  }
  for (const video of feedVideoRatio.keys()) {
    if (video !== next) retireFeedVideo(video);
  }
  if (next) cancelFeedVideoRelease(next);
  activeFeedVideo = next;
  if (next) armFeedVideoStart(next, next === preferredFeedVideo);
  else cancelFeedVideoDwell();
}

function syncFeedVideos() {
  if (feedVideoFrame) {
    cancelAnimationFrame(feedVideoFrame);
    feedVideoFrame = 0;
  }
  settleFeedVideos();
}

function queueFeedVideos() {
  if (feedVideoFrame) return;
  feedVideoFrame = requestAnimationFrame(() => {
    feedVideoFrame = 0;
    settleFeedVideos();
  });
}

// The intersection callback lags a fast flick. Measure against the scroller
// immediately so a dwell cannot start a video that has already left.
function feedVideoVisibleRatio(video, scrollerRect) {
  if (!video || !video.isConnected) return 0;
  const vr = video.getBoundingClientRect();
  const sr = scrollerRect || scroller.getBoundingClientRect();
  const height = Math.max(0, Math.min(vr.bottom, sr.bottom) - Math.max(vr.top, sr.top));
  const width = Math.max(0, Math.min(vr.right, sr.right) - Math.max(vr.left, sr.left));
  const area = vr.width * vr.height;
  if (!area) return 0;
  return (width * height) / area;
}

// One scroller box for the frame. Off-screen videos stay at 0 until the
// observer reports them again.
function refreshFeedVideoRatios(scrollerRect) {
  const sr = scrollerRect || scroller.getBoundingClientRect();
  for (const video of feedVideosToMeasure(feedVideoRatio, activeFeedVideo, preferredFeedVideo)) {
    if (!feedVideoRatio.has(video)) continue;
    feedVideoRatio.set(video, feedVideoVisibleRatio(video, sr));
  }
}

function ensureFeedVideoObserver() {
  if (feedVideoObserver) return feedVideoObserver;
  feedVideoObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      feedVideoRatio.set(entry.target, entry.isIntersecting ? entry.intersectionRatio : 0);
    }
    queueFeedVideos();
  }, { root: scroller, threshold: FEED_VIDEO_THRESHOLDS.slice() });
  return feedVideoObserver;
}

function preferFeedVideo(video) {
  preferredFeedVideo = video;
  delete video.dataset.feedHold;
  if (!video.muted) video.dataset.feedSound = '1';
  syncFeedVideos();
}

function bindFeedVideo(video) {
  if (!video || video.dataset.feedBound === '1') return;
  if (video.closest('.comments-modal, #feed-chat, .feed-comments-stage')) return;
  video.dataset.feedBound = '1';
  video.controls = video.dataset.gif === '1' ? false : true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.loop = true;
  video.preload = video.getAttribute('src') ? video.preload : 'none';
  if (video.dataset.feedSound !== '1') video.muted = true;
  video.addEventListener('play', () => {
    if (feedVideoLock || video === activeFeedVideo) return;
    preferFeedVideo(video);
  });
  video.addEventListener('volumechange', () => {
    if (video.muted) {
      delete video.dataset.feedSound;
      return;
    }
    video.dataset.feedSound = '1';
    if (feedVideoLock) return;
    preferFeedVideo(video);
  });
  video.addEventListener('pause', () => {
    if (feedVideoLock || feedVideoBlocked()) return;
    if (video !== activeFeedVideo && video !== preferredFeedVideo) return;
    video.dataset.feedHold = '1';
    if (preferredFeedVideo === video) preferredFeedVideo = null;
    if (activeFeedVideo === video) activeFeedVideo = null;
    queueFeedVideos();
  });
  ensureFeedVideoObserver().observe(video);
  if (!feedVideoRatio.has(video)) feedVideoRatio.set(video, 0);
}

function syncVisibleViews() {
  if (!viewObserver) return;
  for (const card of viewIntersecting) {
    if (!card.isConnected) {
      viewIntersecting.delete(card);
      continue;
    }
    syncCardView(card);
  }
}

function scheduleScrollFrame() {
  if (scrollFrameQueued) return;
  scrollFrameQueued = true;
  requestAnimationFrame(runScrollFrame);
}

// Card pitch for the fill estimate, from the first cards of the column.
function cardDrop(el) {
  const next = el.nextElementSibling;
  if (next && next.classList.contains('feed-card')) return next.offsetTop - el.offsetTop;
  return el.offsetHeight;
}

function readScrollGeometry(scrollerRect) {
  const top = scroller.scrollTop;
  const height = scroller.scrollHeight;
  const view = scroller.clientHeight;
  const far = (scrollerRect || scroller.getBoundingClientRect()).top - view;
  const sample = [];
  let el = column.firstElementChild;
  while (el && el.classList.contains('feed-card') && sample.length < 8) {
    const drop = cardDrop(el);
    if (drop > 0) sample.push(drop);
    const next = el.nextElementSibling;
    if (!next || !next.classList.contains('feed-card')) break;
    el = next;
  }
  let sum = 0;
  for (const drop of sample) sum += drop;
  return { top, height, view, far, avg: sample.length ? sum / sample.length : 0 };
}

// The leading cards more than a screen above the viewport, for a cap trim.
// Every one costs a layout read, and a scroll deep into the feed has
// hundreds, so runScrollFrame asks only in a frame that can trim (the
// column would pass CARD_CAP), still before it writes the column.
function readFarBoxes(far) {
  const boxes = [];
  const cap = CARD_CAP + FILL_PASSES * RENDER_CHUNK;
  let el = column.firstElementChild;
  while (el && el.classList.contains('feed-card') && boxes.length < cap) {
    if (el.getBoundingClientRect().bottom > far) break;
    boxes.push({ el, drop: cardDrop(el) });
    const next = el.nextElementSibling;
    if (!next || !next.classList.contains('feed-card')) break;
    el = next;
  }
  return boxes;
}

function noteFillAgain() {
  if (fillAgain >= FILL_PASSES) {
    fillAgain = 0;
    return;
  }
  fillAgain += 1;
  scheduleScrollFrame();
}

// Prepend one chunk, then one scrollHeight read. Container-query card
// heights are not known until the cards are in the column. The boxes for
// a cap trim are taken from that same layout, before the scroll write.
function frameFillUp(top, height, view, far) {
  if (paging || top > view || rangeStart <= laneFloor()) return { top, height, again: false };
  const add = Math.min(RENDER_CHUNK, rangeStart - laneFloor());
  if (add <= 0) return { top, height, again: false };
  const list = lane();
  const frag = document.createDocumentFragment();
  const cards = [];
  for (let i = rangeStart - add; i < rangeStart; i++) {
    const card = buildCard(list[i]);
    cards.push(card);
    frag.appendChild(card);
  }
  column.prepend(frag);
  rangeStart -= add;
  const nextHeight = scroller.scrollHeight;
  const delta = nextHeight - height;
  let drop = 0;
  if (rangeEnd - rangeStart > CARD_CAP) {
    const boxes = [];
    let el = column.firstElementChild;
    for (let i = 0; i < add && el && el.classList.contains('feed-card'); i++) {
      const next = el.nextElementSibling;
      const cardDropPx = next && next.classList.contains('feed-card') ? next.offsetTop - el.offsetTop : el.offsetHeight;
      boxes.push({ el, bottom: el.getBoundingClientRect().bottom, drop: cardDropPx });
      el = next;
    }
    for (const box of boxes) {
      if (rangeEnd - rangeStart <= CARD_CAP) break;
      if (box.bottom - delta > far) break;
      if (column.firstElementChild !== box.el) break;
      forgetCard(box.el);
      box.el.remove();
      rangeStart += 1;
      drop += box.drop;
    }
  }
  const nextTop = Math.max(0, top + delta - drop);
  if (nextTop !== top) setFeedScroll(nextTop);
  for (const card of cards) {
    if (card.isConnected) watchCard(card);
  }
  requestAnimationFrame(clampPending);
  return {
    top: nextTop,
    height: nextHeight - drop,
    again: nextTop !== top && nextTop <= view && rangeStart > laneFloor(),
  };
}

function applyFarTrim(boxes, top) {
  if (!boxes || !boxes.length) return top;
  let drop = 0;
  for (const box of boxes) {
    if (rangeEnd - rangeStart <= CARD_CAP) break;
    if (!box.el.isConnected || column.firstElementChild !== box.el) break;
    forgetCard(box.el);
    box.el.remove();
    rangeStart += 1;
    drop += box.drop;
  }
  if (!(drop > 0)) return top;
  const next = Math.max(0, top - drop);
  if (next !== top) setFeedScroll(next);
  return next;
}

// Parked posts land at the top. The final scroll is 0, so the prepend
// does not read scrollHeight the way a mid-list insert does.
function frameReveal(top) {
  if (profileFilter || feedFiltering() || root.classList.contains('is-peek')) return;
  const tab = feedTab;
  const n = held[tab].length;
  if (!n || top >= 2 || rangeStart !== n) return;
  held[tab] = [];
  const list = lane();
  const count = Math.min(n, rangeStart, list.length);
  if (count > 0) {
    const note = column.querySelector('.feed-empty');
    if (note) note.remove();
    const frag = document.createDocumentFragment();
    const cards = [];
    for (let i = 0; i < count; i++) {
      const card = buildCard(list[i]);
      cards.push(card);
      frag.appendChild(card);
    }
    column.prepend(frag);
    rangeStart -= count;
    for (const card of cards) watchCard(card);
    requestAnimationFrame(clampPending);
  }
  setFeedScroll(0);
  savedScroll = 0;
  tabScroll[tab] = 0;
  tabRange[tab] = { start: 0, end: rangeEnd };
  paintNewPill();
}

// Fills once per frame. Geometry is read before the column is written.
// A sorted rebuild throws that snapshot away and fills on the next frame.
function runScrollFrame() {
  scrollFrameQueued = false;
  const scrollerRect = scroller.getBoundingClientRect();
  refreshFeedVideoRatios(scrollerRect);
  queueFeedVideos();
  if (root.classList.contains('is-peek')) {
    syncVisibleViews();
    return;
  }
  const top0 = scroller.scrollTop;
  if (sortPaintDirty && !sortHold && !keepScroll(top0)) {
    paintSorted();
    fillAgain = 0;
    scheduleScrollFrame();
    syncVisibleViews();
    return;
  }
  const geo = readScrollGeometry(scrollerRect);
  const startBefore = rangeStart;
  const placed = frameFillUp(geo.top, geo.height, geo.view, geo.far);
  let top = placed.top;
  let again = placed.again;
  if (!sortHold && feedOn() && !paging) {
    if (followBlocked()) {
      if (feedFiltering()) paintEmpty();
    } else {
      const list = lane();
      const plan = planFillDown({
        top,
        height: placed.height,
        view: geo.view,
        rangeEnd,
        listLen: list.length,
        avg: geo.avg > 0 ? geo.avg * 0.85 : 0,
        canPage: searchCanPage(),
        ranked: rankedSort(),
        chunk: RENDER_CHUNK,
        cap: FILL_PASSES,
      });
      const end = plan.chunks > 0 && rangeEnd < list.length
        ? Math.min(list.length, rangeEnd + plan.chunks * RENDER_CHUNK)
        : rangeEnd;
      // A prepend above (frameFillUp) moved the first card, which ends a
      // trim at once, so that frame does not read the far cards either.
      const farBoxes = end - rangeStart > CARD_CAP && rangeStart === startBefore ? readFarBoxes(geo.far) : null;
      if (end > rangeEnd) renderThrough(end);
      top = applyFarTrim(farBoxes, top);
      if (plan.page) loadOlder();
      else if (plan.empty) paintEmpty();
      if (plan.again || (plan.chunks > 0 && rangeEnd < lane().length)) again = true;
    }
  }
  frameReveal(top);
  if (again) noteFillAgain();
  else fillAgain = 0;
  syncVisibleViews();
}

function viewObserverOptions() {
  const options = { root: scroller, rootMargin: '100dvh', threshold: 0 };
  try {
    const probe = new IntersectionObserver(() => {}, options);
    probe.disconnect();
    return options;
  } catch {
    options.rootMargin = Math.round(window.innerHeight) + 'px';
    return options;
  }
}

function ensureViewObserver() {
  if (viewObserver) return viewObserver;
  viewObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        viewIntersecting.add(entry.target);
        wantPlace(entry.target);
        noteVisibleDonation(entry.target);
      } else {
        viewIntersecting.delete(entry.target);
      }
      syncCardView(entry.target);
    }
  }, viewObserverOptions());
  return viewObserver;
}

function armView(card) {
  const key = card.dataset.key;
  if (!key || viewSent.has(key) || viewHold.has(key) || viewTimers.has(card)) return;
  const timer = setTimeout(() => {
    viewTimers.delete(card);
    if (!card.isConnected) return;
    enqueueView(key, viewerNow());
  }, VIEW_DWELL_MS);
  viewTimers.set(card, timer);
}

function disarmView(card) {
  const timer = viewTimers.get(card);
  if (!timer) return;
  clearTimeout(timer);
  viewTimers.delete(card);
}

function enqueueView(key, viewer) {
  if (!key || !viewer || viewSent.has(key) || viewHold.has(key)) return;
  viewHold.add(key);
  viewPending.push({ id: key, viewer });
  armViewFlush();
}

function armViewFlush() {
  if (viewFlushTimer) return;
  viewFlushTimer = setTimeout(() => {
    viewFlushTimer = 0;
    flushViews(false);
  }, VIEW_FLUSH_MS);
}

function flushViewsNow() {
  if (viewFlushTimer) {
    clearTimeout(viewFlushTimer);
    viewFlushTimer = 0;
  }
  flushViews(true);
}

function flushViews(keepalive) {
  if (!viewPending.length) return;
  const take = keepalive ? viewPending.length : VIEW_POST_BATCH;
  const batch = viewPending.splice(0, take);
  const groups = new Map();
  for (const item of batch) {
    let list = groups.get(item.viewer);
    if (!list) groups.set(item.viewer, list = []);
    if (!list.includes(item.id)) list.push(item.id);
  }
  for (const [viewer, ids] of groups) {
    for (let i = 0; i < ids.length; i += VIEW_POST_BATCH) postViews(viewer, ids.slice(i, i + VIEW_POST_BATCH), keepalive);
  }
  if (!keepalive && viewPending.length) armViewFlush();
}

async function postViews(viewer, ids, keepalive) {
  let ok = false;
  let drop = false;
  try {
    const res = await fetch(`${BACKEND_URL}/api/views`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ viewer, posts: ids }),
      keepalive: !!keepalive,
    });
    if (res.status === 400) {
      drop = true;
    } else if (res.ok) {
      const data = await res.json();
      for (const id of ids) {
        viewHold.delete(id);
        viewSent.add(id);
      }
      paintCounts(data && data.counts);
      ok = true;
    }
  } catch {
    ok = false;
  }
  if (drop) {
    for (const id of ids) viewHold.delete(id);
    return;
  }
  if (ok) return;
  let back = false;
  for (const id of ids) {
    if (viewSent.has(id) || viewPending.some((item) => item.id === id)) continue;
    viewPending.push({ id, viewer });
    back = true;
  }
  if (back) armViewFlush();
}

function watchCard(card) {
  const key = card.dataset.key;
  if (!key) return;
  ensureViewObserver().observe(card);
  if (viewTotals.has(key)) paintCardCount(card);
  else wantCount(key);
}

function forgetCard(card) {
  if (viewObserver) viewObserver.unobserve(card);
  viewIntersecting.delete(card);
  disarmView(card);
  releaseFeedVideosIn(card);
}

function clearViewWatch() {
  if (viewObserver) viewObserver.disconnect();
  viewIntersecting.clear();
  for (const timer of viewTimers.values()) clearTimeout(timer);
  viewTimers.clear();
  releaseFeedVideosIn(column);
}

function paintFeedHashinal(card) {
  const payer = card && card.dataset ? card.dataset.payer || '' : '';
  card.classList.toggle(EARLY_POPUP_CLASS, earlyHashinalNumber(payer) > 0);
}

document.addEventListener('early-hashinals', () => {
  for (const card of column.children) {
    if (card.classList && card.classList.contains('feed-card')) paintFeedHashinal(card);
  }
  paintOpenProfileChrome();
});

function feedTitle(record) {
  const raw = singleLineText(String(record && record.title || '').slice(0, 20));
  if (!raw.trim()) return null;
  const title = document.createElement('strong');
  title.className = 'title_color popup-title-bubble';
  paintHashtags(title, raw);
  const picker = document.getElementById('color-picker-popup-titles');
  if (picker && picker.value) title.style.color = picker.value;
  return title;
}

function buildCard(post) {
  const record = recordFor(post) || {};
  const card = document.createElement('article');
  card.className = 'feed-card';
  card.dataset.key = post.key;

  const payer = record.payer || '';
  card.dataset.payer = payer;
  const profile = buildPopupProfile({
    profileUrl: record.profileUrl || DEFAULT_PIC,
    payer,
    payerInfo: record.payerInfo || 'Anonymous',
    username: record.username || '',
    click2link: record.click2link || '',
    donation: record,
    copyKind: post.kind,
  });
  card.appendChild(profile);
  paintFeedHashinal(card);
  const title = feedTitle(record);
  if (title) card.appendChild(title);
  if (payer) {
    // The shared popup photo opens the map bio panel. This card uses the
    // feed account page instead, so that handler does not stay on it.
    const profilePhoto = profile.querySelector('img, video.loop-face');
    if (profilePhoto) profilePhoto.onclick = null;
    // Capture runs before the Hashpack and click2url anchors. preventDefault
    // keeps those links from navigating. stopPropagation keeps this tap from
    // reaching the document click that closes every panel.
    profile.addEventListener('click', (event) => {
      if (event.target && event.target.closest && event.target.closest('.clan-tag')) return;
      const hit = event.target && event.target.closest && event.target.closest('img, video.loop-face, h2');
      if (!hit || !profile.contains(hit)) return;
      event.preventDefault();
      event.stopPropagation();
      if (!feedActIdle(event)) return;
      holdScroll();
      openFeedProfile(payer);
    }, true);
  }

  let media = null;
  const src = mediaOf(record.image);
  // A GIF, including an extensionless IPFS file, is a still until a tap
  // plays it in memory. The card keeps its skeleton while the check runs.
  const gifLike = !!(src && (isGifUrl(src) || needsGifCheck(src)));
  if (src && (gifLike || resolveMediaUrl(src).src)) {
    const resolved = resolveMediaUrl(src);
    media = document.createElement('div');
    media.className = 'popup-media-card';
    const video = resolved.kind === 'video';
    const node = video ? document.createElement('video') : document.createElement('img');
    if (video) {
      const clip = isGifClipUrl(src);
      if (clip) node.dataset.gif = '1';
      node.controls = !clip;
      node.playsInline = true;
      node.setAttribute('playsinline', '');
      node.loop = true;
      node.muted = true;
      node.preload = 'none';
      node.dataset.src = resolved.src;
      bindVideoPoster(node, src, {
        posterOff: !!record.posterOff,
        posterV: record.posterV || 0,
        armPlay: false,
      });
      media.appendChild(node);
      mountMediaBackdrop(media, node);
      bindFeedVideo(node);
      coverFeedPlayer(media, () => {
        if (node.paused) {
          preferFeedVideo(node);
          return;
        }
        node.dataset.feedHold = '1';
        if (preferredFeedVideo === node) preferredFeedVideo = null;
        if (activeFeedVideo === node) activeFeedVideo = null;
        pauseFeedVideo(node);
        queueFeedVideos();
      });
      mountMediaTools(media, post.key, () => {
        holdScroll();
        openPreview(src, {
          video: true,
          posterOff: !!record.posterOff,
          posterV: record.posterV || 0,
          time: node.currentTime || 0,
        });
      }, node, clip);
    } else {
      node.alt = '';
      node.draggable = false;
      node.loading = 'lazy';
      node.decoding = 'async';
      media.appendChild(node);
      presentImage(node, src, { play: true });
      mountMediaBackdrop(media, node);
      // A GIF animates here as a normal picture (a still with reduced
      // motion). A tap shows the ··· (mountMediaTools); its fullscreen
      // button opens the viewer, except while the picture is still pending.
      const openFull = () => {
        if (node.classList.contains('is-media-pending')) return;
        holdScroll();
        openPreview(resolved.src || src);
      };
      const mediaTools = mountMediaTools(media, post.key, openFull, null, true);
      coverFeedPlayer(media, (event) => mediaTools.tap(event));
    }
  }

  let text = null;
  const body = textOf(record.msg);
  if (body) {
    text = document.createElement('p');
    text.className = 'text_color popup-text-bubble';
    paintHashtags(text, body);
    text.dataset.clamp = '1';
  }

  if (media && text) {
    const sheet = document.createElement('div');
    sheet.className = 'popup-sheet';
    const section = document.createElement('div');
    section.className = 'popup-body';
    const msgDiv = document.createElement('div');
    msgDiv.appendChild(text);
    section.append(msgDiv, media);
    sheet.appendChild(section);
    card.appendChild(sheet);
  } else if (media) {
    card.appendChild(media);
  } else if (text) {
    card.appendChild(text);
  }

  const actions = document.createElement('div');
  actions.className = 'feed-actions';
  const actionLeft = document.createElement('div');
  actionLeft.className = 'feed-actions-left';
  const actionMid = document.createElement('div');
  actionMid.className = 'feed-actions-mid';
  const actionRight = document.createElement('div');
  actionRight.className = 'feed-actions-right';
  const meta = document.createElement('div');
  meta.className = 'feed-meta';
  const left = document.createElement('div');
  left.className = 'feed-meta-left';
  const right = document.createElement('div');
  right.className = 'feed-meta-right';
  const loc = document.createElement('button');
  loc.type = 'button';
  loc.className = 'feed-loc';
  loc.appendChild(pinIcon());
  const whereText = document.createElement('span');
  whereText.className = 'feed-loc-label';
  if (post.place) {
    const place = document.createElement('span');
    place.className = 'feed-loc-place';
    place.textContent = post.place;
    const sep = document.createElement('span');
    sep.className = 'feed-loc-sep';
    sep.textContent = ' · ';
    whereText.append(place, sep);
  }
  const coords = document.createElement('span');
  coords.className = 'feed-loc-coords is-fallback';
  coords.dataset.geokey = placeKey(post.lngLat);
  coords.textContent = coordLabel(post.lngLat);
  whereText.appendChild(coords);
  loc.appendChild(whereText);
  loc.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!feedActIdle(event)) return;
    openOnMap(post);
  });
  left.appendChild(loc);
  if ((post.kind === 'marker' || post.kind === 'polygon') && record.topicId && record.timestamp) {
    const cluster = document.createElement('div');
    mountPostReactions(cluster, record, post.kind, card);
    const heart = cluster.querySelector('.heart-like:not(.comment-bubble):not(.share-bubble)');
    const comment = cluster.querySelector('.comment-bubble');
    const share = cluster.querySelector('.share-bubble');
    // Heart on the left, comment in the middle, share on the right.
    if (heart) actionLeft.appendChild(heart);
    if (comment) {
      actionMid.appendChild(comment);
      actionRight.appendChild(commentCountSpace(comment));
    }
    if (share) actionRight.appendChild(share);
  }
  actions.append(actionLeft, actionMid, actionRight);
  const time = document.createElement('div');
  time.className = 'popup-timestamp';
  const fullTime = document.createElement('span');
  fullTime.className = 'feed-time-full';
  fullTime.textContent = record.timestamp || clock(post.time);
  const briefTime = document.createElement('span');
  briefTime.className = 'feed-time-short';
  briefTime.textContent = shortClock(post.time) || fullTime.textContent;
  time.append(fullTime, briefTime);
  if (record.edited) {
    const editedMark = document.createElement('span');
    editedMark.className = 'feed-edited-mark';
    editedMark.textContent = 'edited';
    fullTime.after(editedMark);
  }
  // Views sit next to the timestamp, popup order: views, then time.
  right.append(viewChip(post.key), time);
  meta.append(left, right);
  const foot = document.createElement('div');
  foot.className = 'feed-foot';
  foot.append(actions, meta);
  card.appendChild(foot);
  return card;
}

// One class write, one overflow read, then the buttons. A height read
// between the two class changes lays out every caption twice. Show more
// opens the whole text on its own full-screen page, the same page as the
// map popup's Show more (popuptext.js); the card stays clamped under it.
// The text is read off the caption when tapped, so an edit is followed.
function clampPending() {
  const pending = [...column.querySelectorAll('.popup-text-bubble[data-clamp="1"]')];
  for (const text of pending) {
    delete text.dataset.clamp;
    text.classList.add('is-clamped');
  }
  const keep = [];
  for (const text of pending) keep.push(text.scrollHeight > text.clientHeight + 1);
  for (let i = 0; i < pending.length; i++) {
    const text = pending[i];
    if (!keep[i]) {
      text.classList.remove('is-clamped');
      continue;
    }
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'feed-more';
    more.textContent = 'Show more';
    more.setAttribute('aria-haspopup', 'dialog');
    more.addEventListener('click', (event) => {
      event.stopPropagation();
      holdScroll();
      const card = text.closest('.feed-card');
      const title = card && card.querySelector('.popup-title-bubble');
      openPopupText({ text: text.textContent, title: title ? title.textContent : '', from: text, opener: more });
    });
    text.after(more);
  }
}

function topicNow() {
  const input = document.getElementById('input-field');
  const value = input && input.value.trim();
  if (value && /^\d+\.\d+\.\d+$/.test(value)) return value;
  return /^\d+\.\d+\.\d+$/.test(initialTopicId) ? initialTopicId : '';
}

function cmpTs(a, b) {
  const left = String(a || '').split('.');
  const right = String(b || '').split('.');
  const as = left[0].padStart(12, '0') + (left[1] || '').padEnd(9, '0');
  const bs = right[0].padStart(12, '0') + (right[1] || '').padEnd(9, '0');
  if (as === bs) return 0;
  return as < bs ? -1 : 1;
}

function cmpMessage(a, b) {
  const ts = cmpTs(a && a.consensus_timestamp, b && b.consensus_timestamp);
  if (ts) return ts;
  return (Number(a && a.sequence_number) || 0) - (Number(b && b.sequence_number) || 0);
}

function createdIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

function profileOf(payer) {
  const pic = payer && profilePictures[payer] && profilePictures[payer].url;
  const name = payer && usernames[payer] && usernames[payer].username;
  const link = payer && click2url[payer] && click2url[payer].click2url;
  return {
    profileUrl: typeof pic === 'string' && pic ? pic : DEFAULT_PIC,
    payer: payer || '',
    payerInfo: payer || 'Anonymous',
    username: name ? ` ${name}` : '',
    click2link: link ? ` ${link}` : '',
  };
}

function shapeNumber(value, created) {
  if (value == null || String(value).trim() === '') return created || '';
  if (!Number.isInteger(Number(value))) return null;
  return value;
}

function ringFrom(cord) {
  if (Array.isArray(cord) && cord.length > 2 && Array.isArray(cord[0])) return cord;
  if (typeof cord !== 'string') return null;
  if (!/^\[-?\d+\.?\d*,\s*-?\d+\.?\d*\](,\s*\[-?\d+\.?\d*,\s*-?\d+\.?\d*\])*$/.test(cord)) return null;
  try {
    const ring = JSON.parse(`[${cord}]`);
    return Array.isArray(ring) && ring.length > 2 ? ring : null;
  } catch {
    return null;
  }
}

function paintSpinner(on) {
  pageStatus.hidden = !on;
}

function clearMaps() {
  seenSeq.clear();
  seenSig.clear();
  seenPost.clear();
  actions.clear();
  likeCounts.clear();
  markerComments.clear();
  polygonComments.clear();
  markerReplies.clear();
  polygonReplies.clear();
  deletedCreated.clear();
  deletedStamp.clear();
  droppedShares.clear();
  ringCenters.clear();
}

function resetFeed(topic) {
  generation += 1;
  loadedTopic = topic;
  posts = [];
  shown = [];
  found = [];
  searchPinned = false;
  pinScroll = 0;
  pinStart = 0;
  pinEnd = 0;
  rangeStart = 0;
  rangeEnd = 0;
  cursor = null;
  exhausted = false;
  paging = false;
  sortPages = 0;
  sortHold = false;
  sortFetchPause = false;
  highSeq = 0;
  assembler = createChunkAssembler();
  clearMaps();
  clearViewWatch();
  column.replaceChildren();
  paintSpinner(false);
  savedScroll = 0;
  setFeedScroll(0);
  resetQueues();
}

function actionKey(bucket, stamp) {
  return `${bucket}|${stamp}`;
}

function setAction(bucket, stamp, payer, type, at) {
  const key = actionKey(bucket, stamp);
  if (!actions.has(key)) actions.set(key, new Map());
  const row = actions.get(key);
  const prev = row.get(payer);
  if (prev && cmpTs(prev.at, at) > 0) return;
  if (prev && prev.type === 'like') likeCounts.set(key, (likeCounts.get(key) || 0) - 1);
  row.set(payer, { type, at });
  if (type === 'like') likeCounts.set(key, (likeCounts.get(key) || 0) + 1);
}

function pushList(map, key, item) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(item);
}

function noteDelete(payer, data) {
  if (!payer || !data) return;
  // Number deletes are legacy noise. Only created + timestamp name a post.
  const created = createdIso(data.deleteMarkerCreated || data.deletePolygonCreated);
  const stampLabel = data.deleteMarkerTimestamp || data.deletePolygonTimestamp;
  if (created) deletedCreated.add(`${payer}|${created}`);
  if (stampLabel != null && String(stampLabel).trim() !== '') deletedStamp.add(`${payer}|${stampLabel}`);
}

// An edit names the post the same way a delete does and carries the new
// body text. Remembering it also rewrites the open map popups; the feed
// cards for the post are patched here.
function noteEdit(payer, data, created) {
  if (!payer || !data) return;
  const namesPost = data.editMarkerCreated || data.editMarkerTimestamp
    || data.editPolygonCreated || data.editPolygonTimestamp;
  if (!namesPost) return;
  const hit = rememberShapeEdit(payer, data, created);
  if (!hit) return;
  const iso = createdIso(data.editMarkerCreated || data.editPolygonCreated);
  patchFeedCardsForEdit(payer, iso, hit.msg);
}

// The record builders read the edit map lazily, so a card rebuilt after an
// edit shows the new text on its own. This rewrites the cards on screen.
function patchFeedCardsForEdit(payer, iso, msg) {
  if (!iso) return;
  const keys = new Set();
  for (const post of posts) {
    if (post.payer !== payer) continue;
    const created = post.kind === 'marker'
      ? post.feature && post.feature.created
      : post.polygon && post.polygon.created;
    if (createdIso(created) !== iso) continue;
    keys.add(post.key);
  }
  if (!keys.size) return;
  for (const card of column.querySelectorAll('.feed-card')) {
    if (!keys.has(card.dataset.key)) continue;
    const text = card.querySelector('p.popup-text-bubble');
    if (text) paintHashtags(text, msg);
    const full = card.querySelector('.feed-time-full');
    if (full && !full.parentElement.querySelector('.feed-edited-mark')) {
      const mark = document.createElement('span');
      mark.className = 'feed-edited-mark';
      mark.textContent = 'edited';
      full.after(mark);
    }
  }
}

function noteMessage(message) {
  const payer = message.payer || '';
  const at = String(message.consensus_timestamp || message.created || '');
  noteDelete(payer, message.marker && message.marker.data);
  noteDelete(payer, message.polygon && message.polygon.data);
  noteEdit(payer, message.marker && message.marker.data, message.created);
  noteEdit(payer, message.polygon && message.polygon.data, message.created);
  const fields = [
    ['likeMarker', 'marker', 'like'],
    ['dislikeMarker', 'marker', 'dislike'],
    ['likePolygon', 'polygon', 'like'],
    ['dislikePolygon', 'polygon', 'dislike'],
    ['unlikeMarker', 'marker', 'unlike'],
    ['unlikePolygon', 'polygon', 'unlike'],
  ];
  for (const [field, bucket, type] of fields) {
    const body = message[field];
    if (!body || !body.timestamp || !payer) continue;
    setAction(bucket, String(body.timestamp), payer, type, at);
  }
  const created = createdIso(message.created);
  if (message.commentMarker && message.commentMarker.timestamp && payer) {
    pushList(markerComments, String(message.commentMarker.timestamp), {
      payer,
      text: String(message.commentMarker.text || '').slice(0, 300),
      created,
    });
  }
  if (message.commentPolygon && message.commentPolygon.timestamp && payer) {
    pushList(polygonComments, String(message.commentPolygon.timestamp), {
      payer,
      text: String(message.commentPolygon.text || '').slice(0, 300),
      created,
    });
  }
  if (message.replyMarker && message.replyMarker.parentId && payer) {
    pushList(markerReplies, String(message.replyMarker.parentId), {
      payer,
      text: String(message.replyMarker.text || '').slice(0, 300),
      created,
    });
  }
  if (message.replyPolygon && message.replyPolygon.parentId && payer) {
    pushList(polygonReplies, String(message.replyPolygon.parentId), {
      payer,
      text: String(message.replyPolygon.text || '').slice(0, 300),
      created,
    });
  }
  const unshare = message.unshare;
  if (unshare && typeof unshare === 'object') {
    const topic = typeof unshare.topic === 'string' ? unshare.topic.trim() : '';
    const when = createdIso(unshare.created);
    if (payer && /^\d+\.\d+\.\d+$/.test(topic) && when) droppedShares.add(`${payer}|${topic}|${when}`);
  }
}

function commentsFor(bucket, stamp) {
  const list = bucket === 'polygon' ? polygonComments : markerComments;
  const replies = bucket === 'polygon' ? polygonReplies : markerReplies;
  return (list.get(stamp) || []).map((comment) => ({
    ...comment,
    replies: (replies.get(comment.created) || []).slice(),
  }));
}

function liked(bucket, stamp) {
  const row = actions.get(actionKey(bucket, stamp));
  const mine = row && connectedAccount && row.get(connectedAccount);
  return !!(mine && mine.type === 'like');
}

function likeTotal(bucket, stamp) {
  return likeCounts.get(actionKey(bucket, stamp)) || 0;
}

function gone(payer, number, created, stampLabel) {
  if (created && deletedCreated.has(`${payer}|${created}`)) return true;
  if (stampLabel && deletedStamp.has(`${payer}|${stampLabel}`)) return true;
  return false;
}

function keepPost(post) {
  if (!post || !post.key || seenPost.has(post.key) || !post.lngLat) return null;
  seenPost.add(post.key);
  return post;
}

function markerPost(message, data) {
  const payer = message.payer || '';
  const created = createdIso(message.created);
  const number = shapeNumber(data.numberOfMarker, created);
  const lngLat = number == null ? null : pointFrom(data.cord);
  const stampLabel = clock(message.created);
  if (!lngLat || gone(payer, number, created, stampLabel)) return null;
  const record = () => {
    const edit = shapeEditFor(payer, created, stampLabel);
    return {
      markernumber: number,
      topicId: loadedTopic,
      ...profileOf(payer),
      title: data.title,
      image: data.image,
      coverimage: data.coverimage,
      msg: edit ? edit.msg : data.msg,
      edited: !!edit,
      posterOff: !!(edit && edit.posterOff),
      posterV: edit && edit.posterV || 0,
      timestamp: stampLabel,
      created,
      consensusTimestamp: consensusOf(message),
      likeCountMarker: likeTotal('marker', stampLabel),
      likedByMe: liked('marker', stampLabel),
      comments: commentsFor('marker', stampLabel),
      coords: lngLat,
    };
  };
  return keepPost({
    key: `m:${loadedTopic}:${payer}:${created}:${number}`,
    payer,
    kind: 'marker',
    seq: Number(message.sequence_number) || 0,
    ts: String(message.consensus_timestamp || ''),
    lngLat,
    time: stamp(message.created),
    feature: {
      topicId: loadedTopic,
      created: message.created,
      msgNumber: number,
      type: 'Feature',
      payer,
      properties: { popupData: record },
      geometry: { type: 'Point', coordinates: lngLat },
    },
  });
}

function polygonPost(message, data) {
  const payer = message.payer || '';
  const created = createdIso(message.created);
  const number = shapeNumber(data.numberOfPolygon, created);
  const ring = number == null ? null : ringFrom(data.cord);
  const stampLabel = clock(message.created);
  if (!ring || gone(payer, number, created, stampLabel)) return null;
  const polygon = {
    topicId: loadedTopic,
    created: message.created,
    msgNumber: number,
    payer,
    coordinates: [ring],
  };
  const lngLat = centerOf(polygon);
  if (!lngLat) return null;
  polygon.popupData = () => {
    const edit = shapeEditFor(payer, created, stampLabel);
    return {
      polygonnumber: number,
      topicId: loadedTopic,
      ...profileOf(payer),
      title: data.title,
      image: data.image,
      coverimage: data.coverimage,
      msg: edit ? edit.msg : data.msg,
      edited: !!edit,
      posterOff: !!(edit && edit.posterOff),
      posterV: edit && edit.posterV || 0,
      timestamp: stampLabel,
      created,
      consensusTimestamp: consensusOf(message),
      likeCountPolygon: likeTotal('polygon', stampLabel),
      likedByMe: liked('polygon', stampLabel),
      comments: commentsFor('polygon', stampLabel),
      coordinates: ring,
    };
  };
  return keepPost({
    key: `p:${loadedTopic}:${payer}:${created}:${number}`,
    payer,
    kind: 'polygon',
    seq: Number(message.sequence_number) || 0,
    ts: String(message.consensus_timestamp || ''),
    polygon,
    lngLat,
    time: stamp(message.created),
  });
}

function sharePost(message) {
  const share = message.share;
  if (!share || typeof share !== 'object') return null;
  const payer = message.payer || '';
  const original = typeof share.topic === 'string' ? share.topic.trim() : '';
  const created = createdIso(share.created);
  const lngLat = pointFrom(share.pin || share.coords);
  if (!payer || !/^\d+\.\d+\.\d+$/.test(original) || !created || !lngLat) return null;
  if (droppedShares.has(`${payer}|${original}|${created}`)) return null;
  const author = typeof share.payer === 'string' ? share.payer : '';
  const stampLabel = clock(created);
  const number = share.number == null ? '' : share.number;
  const record = () => ({
    markernumber: number,
    polygonnumber: number,
    topicId: original,
    ...profileOf(author),
    title: share.title,
    image: share.image,
    coverimage: share.cover,
    msg: share.msg,
    timestamp: stampLabel,
    created,
    likeCountMarker: likeTotal('marker', stampLabel),
    likeCountPolygon: likeTotal('polygon', stampLabel),
    likedByMe: false,
    comments: [],
    coords: lngLat,
    coordinates: lngLat,
    share: { sharer: payer, home: loadedTopic },
  });
  return keepPost({
    key: `s:${payer}:${original}:${created}`,
    payer,
    kind: 'marker',
    seq: Number(message.sequence_number) || 0,
    ts: String(message.consensus_timestamp || ''),
    lngLat,
    time: stamp(message.created),
    feature: {
      topicId: loadedTopic,
      created,
      msgNumber: `share-${created}-${payer}`,
      type: 'Feature',
      payer,
      properties: { popupData: record },
      geometry: { type: 'Point', coordinates: lngLat },
    },
  });
}

function chatPost(message) {
  if (message.marker || message.polygon || message.share) return null;
  if (!message.userMessage && !message.image) return null;
  const bag = message.location || message.place || message;
  const lngLat = pointFrom(message.location) || pointFrom(message.place) || pointFrom(message.coords) || pointFrom(message.cord)
    || asPoint(message.lng ?? message.lon ?? message.longitude, message.lat ?? message.latitude);
  if (!lngLat) return null;
  const place = placeName(message.location) || placeName(message.place) || placeName(bag);
  return keepPost({
    key: `c:${loadedTopic}:${message.payer}:${message.sequence_number}:${message.created}`,
    payer: message.payer || '',
    kind: 'chat',
    seq: Number(message.sequence_number) || 0,
    ts: String(message.consensus_timestamp || ''),
    message,
    topicId: loadedTopic,
    lngLat,
    place,
    time: stamp(message.created),
  });
}

function postsFrom(message) {
  const out = [];
  const marker = message.marker && message.marker.data;
  const polygon = message.polygon && message.polygon.data;
  if (marker) {
    const post = markerPost(message, marker);
    if (post) out.push(post);
  }
  if (polygon) {
    const post = polygonPost(message, polygon);
    if (post) out.push(post);
  }
  const shared = sharePost(message);
  if (shared) out.push(shared);
  const chat = chatPost(message);
  if (chat) out.push(chat);
  return out;
}

function accept(message) {
  if (!message || typeof message !== 'object') return false;
  const seq = Number(message.sequence_number);
  if (seq > 0 && seenSeq.has(seq)) return false;
  const signature = messageSig(message);
  if (seenSig.has(signature)) {
    if (seq > 0) seenSeq.add(seq);
    if (seq > highSeq) highSeq = seq;
    return false;
  }
  if (seq > 0) {
    seenSeq.add(seq);
    if (seq > highSeq) highSeq = seq;
  }
  seenSig.add(signature);
  return true;
}

function ingest(messages) {
  const fresh = [];
  for (const message of messages || []) {
    if (accept(message)) fresh.push(message);
  }
  fresh.sort(cmpMessage);
  for (const message of fresh) noteMessage(message);
  const made = [];
  for (let i = fresh.length - 1; i >= 0; i--) made.push(...postsFrom(fresh[i]));
  return made;
}

async function fetchBackend(topic, before) {
  const out = [];
  const seen = new Set();
  let beforeSeq = before && before.seq ? before.seq : 0;
  let short = false;
  while (out.length < PAGE) {
    const ask = Math.min(1000, PAGE - out.length);
    const page = await fetchMessagesBackend(topic, ask, 0, beforeSeq);
    if (!page.ready) return null;
    const confirmed = (page.messages || []).filter((message) => Number(message.sequence_number) > 0);
    if (!confirmed.length) {
      short = true;
      break;
    }
    confirmed.sort(cmpMessage);
    for (let i = confirmed.length - 1; i >= 0 && out.length < PAGE; i--) {
      const seq = Number(confirmed[i].sequence_number);
      if (seen.has(seq)) continue;
      seen.add(seq);
      out.push(confirmed[i]);
    }
    if (confirmed.length < ask) {
      short = true;
      break;
    }
    const oldestSeq = Number(confirmed[0].sequence_number);
    if (!oldestSeq || (beforeSeq && oldestSeq >= beforeSeq)) {
      short = true;
      break;
    }
    beforeSeq = oldestSeq;
  }
  out.sort((a, b) => cmpMessage(b, a));
  return { messages: out, done: short || out.length < PAGE };
}

async function fetchMirror(topic, before) {
  const out = [];
  const seen = new Set();
  let beforeTs = before && before.ts ? String(before.ts) : '';
  let short = false;
  for (let guard = 0; guard < 40 && out.length < PAGE; guard++) {
    const ask = Math.min(100, PAGE - out.length);
    let url = `${MIRROR}/api/v1/topics/${topic}/messages?limit=${ask}&order=desc`;
    if (beforeTs) url += `&timestamp=lt:${encodeURIComponent(beforeTs)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`mirror HTTP ${response.status}`);
    const data = await response.json();
    const raw = data.messages || [];
    if (!raw.length) {
      short = true;
      break;
    }
    const parsed = ingestMirrorRows(assembler, topic, raw).map((item) => ({
      ...item.parsed,
      payer: item.payer,
      created: new Date(Number(item.consensus_timestamp) * 1000).toISOString(),
      consensus_timestamp: String(item.consensus_timestamp),
      sequence_number: item.sequence_number,
    }));
    parsed.sort((a, b) => cmpMessage(b, a));
    for (const message of parsed) {
      if (out.length >= PAGE) break;
      const seq = Number(message.sequence_number);
      if (seq > 0 && seen.has(seq)) continue;
      if (before && before.ts && cmpTs(message.consensus_timestamp, before.ts) >= 0) continue;
      if (seq > 0) seen.add(seq);
      out.push(message);
    }
    const oldestRaw = String(raw[raw.length - 1].consensus_timestamp || '');
    if (!oldestRaw || (beforeTs && cmpTs(oldestRaw, beforeTs) >= 0)) {
      short = true;
      break;
    }
    beforeTs = oldestRaw;
    if (raw.length < ask) {
      short = true;
      break;
    }
  }
  out.sort((a, b) => cmpMessage(b, a));
  return { messages: out, done: short || out.length < PAGE };
}

async function fetchPage(topic, before) {
  const cached = await fetchBackend(topic, before);
  if (cached) return cached;
  return fetchMirror(topic, before);
}

async function fetchNewer(topic, after) {
  const page = await fetchMessagesBackend(topic, 100, after, 0);
  if (page.ready) return (page.messages || []).filter((message) => Number(message.sequence_number) > after);
  const response = await fetch(`${MIRROR}/api/v1/topics/${topic}/messages?limit=100&order=asc&sequencenumber=gt:${after}`);
  if (!response.ok) return [];
  const data = await response.json();
  return ingestMirrorRows(assembler, topic, data.messages || []).map((item) => ({
    ...item.parsed,
    payer: item.payer,
    created: new Date(Number(item.consensus_timestamp) * 1000).toISOString(),
    consensus_timestamp: String(item.consensus_timestamp),
    sequence_number: item.sequence_number,
  }));
}

function walletNow() {
  const account = typeof connectedAccount === 'string' ? connectedAccount.trim() : '';
  if (/^\d+\.\d+\.\d+$/.test(account) && account.length <= 40) return account;
  return '';
}

function postBy(post, payer) {
  if (!post || !payer) return false;
  const number = post.feature && post.feature.msgNumber;
  if (typeof number === 'string' && number.startsWith('share-')) {
    const record = recordFor(post);
    return !!(record && record.payer === payer);
  }
  return post.payer === payer;
}

function profileLane(list) {
  if (!profileFilter) return list;
  const out = [];
  for (const post of list) {
    if (postBy(post, profileFilter)) out.push(post);
  }
  return out;
}

function feedFiltering() {
  if (isActive()) return true;
  return sortCmp() != null;
}

function lane() {
  if (feedFiltering()) return found;
  return profileLane(feedTab === 'following' ? shown : posts);
}

function tabPosts() {
  return feedTab === 'following' ? shown : posts;
}

function hitQuery(post) {
  if (!post || !feedFiltering()) return false;
  // Sort is not a predicate. matches() is false when text and filters are
  // both empty, so a sort-only query keeps every loaded post and orders it.
  if (!isActive()) return true;
  return matches(post, recordFor(post) || {});
}

function localDaySeconds(iso, end) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!match) return null;
  const date = end
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 23, 59, 59, 999)
    : new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0);
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms / 1000 : null;
}

function postSeconds(post, record) {
  const raw = Number(post && post.ts);
  if (Number.isFinite(raw) && raw > 1e8) return raw;
  const created = record && record.created;
  if (created) {
    const ms = new Date(created).getTime();
    if (Number.isFinite(ms)) return ms / 1000;
  }
  return null;
}

function dateFromStart() {
  return localDaySeconds(getQuery().filters && getQuery().filters.dateFrom, false);
}

function noteSearchFloor() {
  const start = dateFromStart();
  if (start == null || !cursor || cursor.ts == null || cursor.ts === '') {
    searchFloor = false;
    return;
  }
  const oldest = Number(cursor.ts);
  searchFloor = Number.isFinite(oldest) && oldest < start;
}

function rankedSort() {
  const sort = getQuery().sort;
  return sort === 'oldest' || sort === 'liked' || sort === 'viewed';
}

function orderFound() {
  const cmp = sortCmp();
  if (!cmp || found.length < 2) return false;
  const before = found.map((post) => post && post.key).join('\n');
  found.sort(cmp);
  return found.map((post) => post && post.key).join('\n') !== before;
}

function refreshViewSortWait() {
  let missing = 0;
  if (getQuery().sort === 'viewed') {
    for (const post of found) {
      if (post && post.key && !viewTotals.has(post.key)) missing += 1;
    }
  }
  viewSortWait = missing;
}

function resetViewSort() {
  viewSortGen += 1;
  viewSortQueued.length = 0;
  viewSortInflight.clear();
  viewSortWait = 0;
  viewSortRetryAt = 0;
  sortPaintDirty = false;
  if (viewSortTimer) {
    clearTimeout(viewSortTimer);
    viewSortTimer = 0;
  }
  if (viewSortSettle) {
    clearTimeout(viewSortSettle);
    viewSortSettle = 0;
  }
}

function armViewSort() {
  if (viewSortTimer || viewSortFlight) return;
  const wait = Math.max(0, viewSortRetryAt - Date.now());
  viewSortTimer = setTimeout(pullViewSort, wait);
}

function viewSortBusy() {
  return viewSortQueued.length > 0 || viewSortFlight || viewSortInflight.size > 0;
}

function scheduleViewSortPaint() {
  const gen = viewSortGen;
  if (viewSortSettle) clearTimeout(viewSortSettle);
  viewSortSettle = setTimeout(() => {
    viewSortSettle = 0;
    if (gen !== viewSortGen) return;
    if (getQuery().sort !== 'viewed' || !feedFiltering()) return;
    if (viewSortBusy()) return;
    // Pages are still arriving behind the spinner. The drain paints once.
    if (sortHold || !rankedWindowReady(sortPages, SORT_PAGE_CAP, exhausted, searchFloor)) return;
    paintSorted();
  }, 200);
}

function requeueViewSort(ids) {
  const have = new Set(viewSortQueued);
  for (let i = ids.length - 1; i >= 0; i--) {
    const id = ids[i];
    if (!id || viewTotals.has(id) || have.has(id) || viewSortInflight.has(id)) continue;
    viewSortQueued.unshift(id);
    have.add(id);
  }
}

// One bulk POST per VIEW_SORT_BATCH ids. The queue is not marked asked
// until the counts land, so a 429 puts the same ids back after Retry-After.
// A 400 stores 0 for that batch so viewSortWait can reach 0.
async function pullViewSort() {
  viewSortTimer = 0;
  if (viewSortFlight) return;
  const gen = viewSortGen;
  if (getQuery().sort !== 'viewed') return;
  const ids = [];
  while (viewSortQueued.length && ids.length < VIEW_SORT_BATCH) {
    const id = viewSortQueued.shift();
    if (!id || viewTotals.has(id) || viewSortInflight.has(id)) continue;
    viewSortInflight.add(id);
    ids.push(id);
  }
  if (!ids.length) {
    refreshViewSortWait();
    if (!viewSortInflight.size) scheduleViewSortPaint();
    return;
  }
  viewSortFlight = true;
  let requeue = false;
  let again = 0;
  try {
    const res = await fetch(`${BACKEND_URL}/api/views/counts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (res.status === 429) {
      requeue = true;
      again = retryAfterMs(res.headers.get('Retry-After'));
    } else if (res.ok) {
      const data = await res.json();
      paintCounts(data && data.counts);
    } else if (res.status === 400) {
      paintCounts(zeroViewCounts(ids));
    } else {
      requeue = true;
      again = retryAfterMs(null);
    }
  } catch {
    requeue = true;
    again = retryAfterMs(null);
  } finally {
    viewSortFlight = false;
    for (const id of ids) viewSortInflight.delete(id);
  }
  if (gen !== viewSortGen || getQuery().sort !== 'viewed') {
    if (viewSortQueued.length && getQuery().sort === 'viewed') armViewSort();
    return;
  }
  if (requeue) {
    requeueViewSort(ids);
    viewSortRetryAt = Date.now() + again;
  } else {
    viewSortRetryAt = 0;
  }
  refreshViewSortWait();
  if (viewSortQueued.length) armViewSort();
  else scheduleViewSortPaint();
}

function queueViewSort() {
  if (getQuery().sort !== 'viewed') {
    viewSortQueued.length = 0;
    viewSortWait = 0;
    viewSortRetryAt = 0;
    if (viewSortTimer) {
      clearTimeout(viewSortTimer);
      viewSortTimer = 0;
    }
    if (viewSortSettle) {
      clearTimeout(viewSortSettle);
      viewSortSettle = 0;
    }
    return;
  }
  const queued = new Set(viewSortQueued);
  for (const post of found) {
    if (!post || !post.key || viewTotals.has(post.key) || queued.has(post.key) || viewSortInflight.has(post.key)) continue;
    viewSortQueued.push(post.key);
    queued.add(post.key);
  }
  refreshViewSortWait();
  if (viewSortQueued.length) armViewSort();
}

function searchDataPending() {
  const filters = getQuery().filters || {};
  if (filters.following === true && followState !== 'ready' && followState !== 'empty' && followState !== 'offline' && followState !== 'nowallet') return true;
  if (filters.hashinal === true && !earlyHashinalReady()) return true;
  if (filters.country && !placePackReady && !placePackFailed) return true;
  if (getQuery().sort === 'viewed' && viewSortWait > 0 && found.length === 0) return true;
  return false;
}

function syncFound() {
  found = [];
  noteSearchFloor();
  if (!feedFiltering()) return;
  for (const post of profileLane(tabPosts())) {
    if (hitQuery(post)) found.push(post);
  }
  orderFound();
  queueViewSort();
  if (getQuery().filters.country && !placePackReady && !placePackFailed) ensurePlacePack();
  if (getQuery().filters.following === true && followState !== 'ready' && followState !== 'empty' && followState !== 'offline' && followState !== 'nowallet') {
    ensureFollowSet().then(() => {
      if (getQuery().filters.following !== true) return;
      if (followState === 'loading') return;
      showQueryResults();
    });
  }
}

function shiftPin(count) {
  if (!searchPinned || !count) return;
  pinStart += count;
  pinEnd += count;
}

function takeFollowed(list) {
  if (!followSet) return [];
  const out = [];
  for (const post of list) {
    if (post && followSet.has(post.payer)) out.push(post);
  }
  return out;
}

function followBlocked() {
  return feedTab === 'following' && followState !== 'ready';
}

function paintTabs() {
  const all = feedTab !== 'following';
  allTab.setAttribute('aria-selected', all ? 'true' : 'false');
  followTab.setAttribute('aria-selected', all ? 'false' : 'true');
  allTab.tabIndex = all ? 0 : -1;
  followTab.tabIndex = all ? -1 : 0;
}

function searchMiss() {
  if (!feedFiltering() || paging) return false;
  if (searchDataPending()) return false;
  if (feedTab === 'following' && followState === 'loading') return false;
  if (followBlocked()) return true;
  if (searchFloor || exhausted) return true;
  if (rankedSort() && sortPages >= SORT_PAGE_CAP) return true;
  return false;
}

function sortWindowPartial() {
  return rankedSort() && found.length > 0 && sortPages >= SORT_PAGE_CAP && !exhausted && !searchFloor && !paging;
}

function paintSortNote() {
  const old = document.getElementById('feed-sort-note');
  if (!sortWindowPartial()) {
    if (old) old.remove();
    return;
  }
  const note = old || document.createElement('p');
  note.id = 'feed-sort-note';
  note.className = 'feed-empty';
  note.textContent = 'sorted among loaded posts';
  if (!old) column.appendChild(note);
}

function paintSorted() {
  if (sortHold) return;
  if (rankedPaintHold(!!column.querySelector('.feed-card'), scroller.scrollTop)) {
    sortPaintDirty = true;
    return;
  }
  if (!orderFound() && !sortPaintDirty) return;
  sortPaintDirty = false;
  rangeStart = 0;
  rangeEnd = 0;
  clearViewWatch();
  column.replaceChildren();
  const list = found;
  if (list.length) renderThrough(Math.min(list.length, RENDER_CHUNK));
  paintEmpty();
  paintSortNote();
  setFeedScroll(0);
}

function paintEmpty() {
  const old = column.querySelector('.feed-empty');
  if (old && old.id !== 'feed-sort-note') old.remove();
  let text = '';
  if (feedFiltering() && found.length === 0 && searchMiss()) text = 'No posts found';
  else if (!feedFiltering() && feedTab === 'following' && followState === 'nowallet') text = 'Connect your wallet to see who you follow';
  else if (!feedFiltering() && feedTab === 'following' && followState === 'empty') text = "You're not following anyone yet";
  else if (!feedFiltering() && profileFilter && lane().length === 0 && exhausted && !paging && !followBlocked()) text = 'No posts yet';
  if (text) {
    const note = document.createElement('p');
    note.className = 'feed-empty';
    note.textContent = text;
    column.appendChild(note);
  }
  paintSortNote();
}

function rerenderLane(opts) {
  if (!profileFilter && (!opts || !opts.keepHeld)) {
    held[feedTab] = [];
    tabScroll[feedTab] = 0;
    tabRange[feedTab] = { start: 0, end: 0 };
  }
  if (feedFiltering()) syncFound();
  rangeStart = 0;
  rangeEnd = 0;
  savedScroll = 0;
  setFeedScroll(0);
  if (profileFilter || bannerTracks()) {
    showFeedTabs();
    writeBannerOffset(0);
  }
  clearViewWatch();
  column.replaceChildren();
  paintEmpty();
  if (!followBlocked()) fillDown();
  else paintEmpty();
  paintNewPill();
}

async function selectTab(next) {
  if (next !== 'all' && next !== 'following') return;
  if (next === feedTab) return;
  if (!profileFilter) {
    if (feedFiltering() && searchPinned) {
      tabScroll[feedTab] = pinScroll;
      tabRange[feedTab] = { start: pinStart, end: pinEnd };
    } else saveTabView();
    if (feedFiltering()) {
      searchPinned = true;
      pinScroll = 0;
      pinStart = 0;
      pinEnd = 0;
    }
  }
  const token = ++tabToken;
  feedTab = next;
  paintTabs();
  showFeedTabs();
  if (profileFilter || bannerTracks()) writeBannerOffset(0);
  if (next === 'all') {
    if (feedFiltering() || profileFilter) rerenderLane({ keepHeld: true });
    else restoreTabView();
    return;
  }
  if (!walletNow()) {
    followState = 'nowallet';
    followSet = null;
    shown = [];
    rerenderLane();
    return;
  }
  if (!(followState === 'ready' && followSet)) {
    followState = 'loading';
    clearViewWatch();
    column.replaceChildren();
    rangeStart = 0;
    rangeEnd = 0;
    if (!feedFiltering()) {
      setFeedScroll(0);
      savedScroll = 0;
    }
    paintEmpty();
    paintNewPill();
  }
  const state = await ensureFollowSet(true);
  if (token !== tabToken || feedTab !== 'following') return;
  if (state === 'offline') {
    shown = [];
    paintEmpty();
    paintNewPill();
    return;
  }
  if (state !== 'ready' || !followSet) {
    shown = [];
    rerenderLane();
    return;
  }
  shown = posts.filter((post) => followSet.has(post.payer));
  alignHeld('following');
  if (feedFiltering() || profileFilter) rerenderLane({ keepHeld: true });
  else restoreTabView();
}

function ensureFollowSet(force) {
  const account = walletNow();
  if (!account) {
    followState = 'nowallet';
    followSet = null;
    return Promise.resolve('nowallet');
  }
  if (!force && followState === 'ready' && followSet) return Promise.resolve('ready');
  if (!force && followState === 'empty') return Promise.resolve('empty');
  if (followPromise) return followPromise;
  followState = 'loading';
  const asked = account;
  followPromise = fetchFollowing(asked).then((data) => {
    followPromise = null;
    if (walletNow() !== asked) return ensureFollowSet(force);
    if (!data) {
      followState = 'offline';
      followSet = null;
      return 'offline';
    }
    const ids = [];
    const accounts = Array.isArray(data.accounts) ? data.accounts : [];
    for (const entry of accounts) {
      const raw = typeof entry === 'string' ? entry : entry && entry.id;
      const id = typeof raw === 'string' ? raw.trim() : '';
      if (/^\d+\.\d+\.\d+$/.test(id)) ids.push(id);
    }
    if (!ids.length) {
      followState = 'empty';
      followSet = null;
      return 'empty';
    }
    followSet = new Set(ids);
    followState = 'ready';
    return 'ready';
  }).catch(() => {
    followPromise = null;
    followState = 'offline';
    followSet = null;
    return 'offline';
  });
  return followPromise;
}

function renderThrough(end) {
  if (end <= rangeEnd) return;
  const note = column.querySelector('.feed-empty');
  if (note && note.id !== 'feed-sort-note') note.remove();
  const list = lane();
  const frag = document.createDocumentFragment();
  const cards = [];
  for (let i = rangeEnd; i < end; i++) {
    const card = buildCard(list[i]);
    cards.push(card);
    frag.appendChild(card);
  }
  column.appendChild(frag);
  rangeEnd = end;
  for (const card of cards) watchCard(card);
  requestAnimationFrame(clampPending);
}

function trimAbove() {
  const viewTop = scroller.getBoundingClientRect().top;
  const far = viewTop - scroller.clientHeight;
  while (rangeEnd - rangeStart > CARD_CAP) {
    const first = column.firstElementChild;
    if (!first || !first.classList.contains('feed-card')) break;
    const rect = first.getBoundingClientRect();
    if (rect.bottom > far) break;
    const next = first.nextElementSibling;
    const drop = next && next.classList.contains('feed-card') ? next.offsetTop - first.offsetTop : first.offsetHeight;
    forgetCard(first);
    first.remove();
    rangeStart += 1;
    setFeedScroll(Math.max(0, scroller.scrollTop - drop));
  }
}

function fillUp() {
  if (paging || scroller.scrollTop > scroller.clientHeight || rangeStart <= laneFloor()) return;
  const add = Math.min(RENDER_CHUNK, rangeStart - laneFloor());
  const prevTop = scroller.scrollTop;
  const prevHeight = scroller.scrollHeight;
  const frag = document.createDocumentFragment();
  const cards = [];
  const list = lane();
  for (let i = rangeStart - add; i < rangeStart; i++) {
    const card = buildCard(list[i]);
    cards.push(card);
    frag.appendChild(card);
  }
  column.prepend(frag);
  rangeStart -= add;
  setFeedScroll(prevTop + (scroller.scrollHeight - prevHeight));
  for (const card of cards) watchCard(card);
  requestAnimationFrame(clampPending);
}

function fillDown() {
  if (sortHold || !feedOn() || root.classList.contains('is-peek') || paging) return;
  if (followBlocked()) {
    if (feedFiltering()) paintEmpty();
    return;
  }
  const list = lane();
  if (scroller.clientHeight < 1) {
    if (rangeEnd < list.length) renderThrough(Math.min(list.length, rangeEnd + RENDER_CHUNK));
    else if (searchCanPage()) loadOlder();
    return;
  }
  let guard = 0;
  while (guard < 12) {
    guard += 1;
    const room = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    const short = scroller.scrollHeight <= scroller.clientHeight + 4;
    if (!short && room >= scroller.clientHeight * 2) {
      if (rankedSort() && searchCanPage()) loadOlder();
      else paintEmpty();
      return;
    }
    if (rangeEnd < list.length) {
      renderThrough(Math.min(list.length, rangeEnd + RENDER_CHUNK));
      trimAbove();
      continue;
    }
    if (searchCanPage()) loadOlder();
    else paintEmpty();
    return;
  }
}

function searchCanPage() {
  if (sortFetchPause || exhausted || searchFloor || paging) return false;
  if (rankedSort() && sortPages >= SORT_PAGE_CAP) return false;
  return true;
}

// Pull the capped window before the first ranked paint. A page that arrives
// after the reader has scrolled does not rebuild the cards on screen.
function finishRanked(opts) {
  const retry = !opts || opts.retry !== false;
  if (!feedFiltering() || !rankedSort()) {
    sortHold = false;
    paintSpinner(false);
    return;
  }
  if (retry && loadedTopic && !rankedWindowReady(sortPages, SORT_PAGE_CAP, exhausted, searchFloor)) {
    sortHold = true;
    paintSpinner(true);
    loadOlder();
    return;
  }
  sortHold = false;
  paintSpinner(false);
  sortPaintDirty = true;
  paintSorted();
  fillDown();
}

function laneFloor() {
  if (profileFilter) return 0;
  return feedFiltering() ? 0 : held[feedTab].length;
}

function tabIsAtTop(tab) {
  if (profileFilter && profileView) {
    if (tab !== feedTab) {
      if (held[tab].length) return false;
      return tabRange[tab].start === 0 && tabScroll[tab] < 2;
    }
    return profileView.start === 0 && profileView.scroll < 2;
  }
  if (held[tab].length) return false;
  if (tab === feedTab && feedFiltering()) {
    const start = searchPinned ? pinStart : 0;
    const scroll = searchPinned ? pinScroll : 0;
    return start === 0 && scroll < 2;
  }
  if (tab === feedTab) return rangeStart === 0 && scroller.scrollTop < 2;
  return tabRange[tab].start === 0 && tabScroll[tab] < 2;
}

function saveTabView() {
  if (feedFiltering()) return;
  tabScroll[feedTab] = scroller.scrollTop;
  tabRange[feedTab] = { start: rangeStart, end: rangeEnd };
}

function resetQueues() {
  held.all = [];
  held.following = [];
  tabScroll.all = 0;
  tabScroll.following = 0;
  tabRange.all = { start: 0, end: 0 };
  tabRange.following = { start: 0, end: 0 };
  paintNewPill();
}

function newPostLabel(count) {
  return count === 1 ? '1 new post' : count + ' new posts';
}

// held[tab] is newest first. The pill takes the first three distinct authors.
function pendingAuthors(list) {
  const rows = [];
  const seen = new Set();
  for (const post of list) {
    const id = post && typeof post.payer === 'string' ? post.payer.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    rows.push({ id, post });
    if (rows.length === 3) break;
  }
  return rows;
}

function authorPicture(id, post) {
  const cached = httpUrl(profilePictures[id] && profilePictures[id].url);
  if (cached && cached !== DEFAULT_PIC) return cached;
  const record = post ? recordFor(post) : null;
  const fromPost = record && httpUrl(record.profileUrl);
  if (fromPost && fromPost !== DEFAULT_PIC) return fromPost;
  return '';
}

function authorLetter(id) {
  const name = textOf(usernames[id] && usernames[id].username).trim();
  const source = name || id;
  const ch = String(source || '').trim().charAt(0).toLocaleUpperCase();
  return ch || '';
}

function letterFace(id) {
  const letter = authorLetter(id);
  if (!letter) return null;
  const mark = document.createElement('span');
  mark.className = 'feed-new-face feed-new-letter';
  mark.textContent = letter;
  mark.setAttribute('aria-hidden', 'true');
  return mark;
}

function swapAuthorFace(face, id) {
  const mark = letterFace(id);
  const host = (face.closest && face.closest('.early-hashinal')) || face;
  if (mark) host.replaceWith(mark);
  else host.remove();
  if (!newFaces.childElementCount) newFaces.hidden = true;
}

function paintNewFaces(list) {
  newFaces.replaceChildren();
  for (const row of pendingAuthors(list)) {
    const url = authorPicture(row.id, row.post);
    if (!url) {
      const mark = letterFace(row.id);
      if (mark) newFaces.appendChild(mark);
      continue;
    }
    const face = pictureElement(url, { className: 'feed-new-face', alt: '' });
    let broken = false;
    face.addEventListener('error', () => {
      broken = true;
      swapAuthorFace(face, row.id);
    }, { once: true });
    newFaces.appendChild(face);
    paintProfileAvatar(face, row.id);
    if (broken || (face.tagName === 'IMG' && face.complete && face.naturalWidth === 0 && face.getAttribute('src'))) {
      swapAuthorFace(face, row.id);
    }
  }
  newFaces.hidden = newFaces.childElementCount === 0;
}

function paintNewPill() {
  const count = held[feedTab].length;
  const show = feedOn() && !profileFilter && !root.classList.contains('is-peek') && !feedFiltering() && count > 0;
  if (!show) {
    newPill.hidden = true;
    newPill.classList.remove('is-in', 'is-pop');
    return;
  }
  paintNewFaces(held[feedTab]);
  const label = newPostLabel(count);
  newLabel.textContent = label;
  newPill.setAttribute('aria-label', label);
  const fresh = newPill.hidden;
  newPill.hidden = false;
  if (!fresh) return;
  newPill.classList.remove('is-in', 'is-pop');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!newPill.hidden) newPill.classList.add('is-in');
    });
  });
}

// Posts that arrive below the top stay out of that tab's window. held[tab]
// is the newest prefix of that tab's lane, in the same order as the lane.
function noteHeld(tab, batch) {
  if (!batch.length || tabIsAtTop(tab)) return false;
  held[tab].unshift(...batch);
  tabRange[tab].start += batch.length;
  tabRange[tab].end += batch.length;
  if (tab === feedTab && !feedFiltering() && !profileFilter) {
    rangeStart += batch.length;
    rangeEnd += batch.length;
  }
  return true;
}

function alignHeld(tab) {
  const list = tab === 'following' ? shown : posts;
  const next = [];
  for (let i = 0; i < held[tab].length && i < list.length; i++) {
    if (list[i] !== held[tab][i]) break;
    next.push(list[i]);
  }
  held[tab] = next;
}

function mountIncoming(incoming, searchLane) {
  if (!incoming.length) return;
  const atTop = scroller.scrollTop < 2;
  const showingTop = rangeStart === 0;
  const prevTop = scroller.scrollTop;
  const prevHeight = scroller.scrollHeight;
  rangeStart += incoming.length;
  rangeEnd += incoming.length;
  if (!showingTop) return;
  const frag = document.createDocumentFragment();
  const cards = [];
  const note = column.querySelector('.feed-empty');
  if (note) note.remove();
  for (const post of incoming) {
    const card = buildCard(post);
    cards.push(card);
    frag.appendChild(card);
  }
  column.prepend(frag);
  rangeStart = searchLane ? 0 : rangeStart - incoming.length;
  const delta = scroller.scrollHeight - prevHeight;
  setFeedScroll(atTop ? 0 : prevTop + delta);
  for (const card of cards) watchCard(card);
  requestAnimationFrame(clampPending);
  trimAbove();
}

function prependPosts(list) {
  if (!list.length) return;
  const followed = takeFollowed(list);
  posts.unshift(...list);
  if (followSet) shown.unshift(...followed);
  if (profileFilter) {
    profileShift.all += list.length;
    profileShift.following += followed.length;
  }
  const tabBatch = feedTab === 'following' ? followed : list;
  const visible = profileFilter ? profileLane(tabBatch) : tabBatch;
  if (!profileFilter) shiftPin(tabBatch.length);
  let searchIncoming = [];
  if (feedFiltering()) {
    for (const post of visible) if (hitQuery(post)) searchIncoming.push(post);
    if (searchIncoming.length) found.unshift(...searchIncoming);
  }
  const heldAll = noteHeld('all', list);
  const heldFollow = followSet ? noteHeld('following', followed) : false;
  const holdRank = sortHold && feedFiltering() && !column.querySelector('.feed-card');
  if (profileFilter) {
    if (feedFiltering()) {
      if (!holdRank) mountIncoming(searchIncoming, true);
    } else mountIncoming(visible, false);
    paintNewPill();
    return;
  }
  if (feedFiltering()) {
    if (!holdRank) mountIncoming(searchIncoming, true);
  }
  else if (feedTab === 'following') {
    if (!heldFollow) mountIncoming(followed, false);
  } else if (!heldAll) mountIncoming(list, false);
  paintNewPill();
}

function scrollMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

function prependAbove(count) {
  const n = Math.min(count, rangeStart, lane().length);
  if (n <= 0) return;
  const list = lane();
  const prevTop = scroller.scrollTop;
  const prevHeight = scroller.scrollHeight;
  const frag = document.createDocumentFragment();
  const cards = [];
  const note = column.querySelector('.feed-empty');
  if (note) note.remove();
  for (let i = 0; i < n; i++) {
    const card = buildCard(list[i]);
    cards.push(card);
    frag.appendChild(card);
  }
  column.prepend(frag);
  rangeStart -= n;
  setFeedScroll(prevTop + (scroller.scrollHeight - prevHeight));
  for (const card of cards) watchCard(card);
  requestAnimationFrame(clampPending);
}

function revealParked() {
  if (profileFilter || feedFiltering() || root.classList.contains('is-peek')) return;
  const tab = feedTab;
  const n = held[tab].length;
  if (!n || scroller.scrollTop >= 2 || rangeStart !== n) return;
  held[tab] = [];
  prependAbove(n);
  setFeedScroll(0);
  savedScroll = 0;
  tabScroll[tab] = 0;
  tabRange[tab] = { start: 0, end: rangeEnd };
  paintNewPill();
}

function goToFreshPosts() {
  if (profileFilter) return;
  const tab = feedTab;
  if (!held[tab].length && scroller.scrollTop < 2) {
    paintNewPill();
    return;
  }
  held[tab] = [];
  paintNewPill();
  if (feedFiltering()) {
    feedScrollTo({ top: 0, behavior: scrollMotion() });
    return;
  }
  if (rangeStart > 0 && rangeStart <= 60) prependAbove(rangeStart);
  else if (rangeStart > 60) {
    clearViewWatch();
    column.replaceChildren();
    rangeStart = 0;
    rangeEnd = 0;
    const end = Math.min(lane().length, RENDER_CHUNK);
    if (end) renderThrough(end);
    paintEmpty();
    setFeedScroll(Math.min(scroller.clientHeight * 0.65, scroller.scrollHeight));
  }
  tabScroll[tab] = 0;
  tabRange[tab] = { start: rangeStart, end: rangeEnd };
  savedScroll = 0;
  feedScrollTo({ top: 0, behavior: scrollMotion() });
}

function restoreTabView() {
  const tab = feedTab;
  alignHeld(tab);
  const list = lane();
  let start = tabRange[tab].start;
  const floor = held[tab].length;
  if (start < floor) start = floor;
  if (start > list.length) start = list.length;
  let end = tabRange[tab].end;
  if (end < start) end = start;
  if (end > list.length) end = list.length;
  if (end === start) end = Math.min(list.length, start + RENDER_CHUNK);
  rangeStart = start;
  rangeEnd = start;
  clearViewWatch();
  column.replaceChildren();
  if (end > start) renderThrough(end);
  paintEmpty();
  setFeedScroll(tabScroll[tab]);
  savedScroll = scroller.scrollTop;
  tabRange[tab] = { start: rangeStart, end: rangeEnd };
  paintNewPill();
  if (!followBlocked()) {
    fillDown();
    fillUp();
  }
  revealParked();
}

async function loadOlder() {
  if (paging || exhausted || searchFloor) return;
  if (rankedSort() && sortPages >= SORT_PAGE_CAP) return;
  const topic = loadedTopic;
  if (!topic) return;
  const gen = generation;
  paging = true;
  paintSpinner(true);
  let ok = false;
  try {
    const page = await fetchPage(topic, cursor);
    if (gen !== generation) return;
    const messages = page.messages || [];
    if (!messages.length) {
      exhausted = true;
      ok = true;
    } else {
      const oldest = messages[messages.length - 1];
      const nextTs = String(oldest.consensus_timestamp || '');
      const nextSeq = Number(oldest.sequence_number) || 0;
      if (cursor && nextTs === String(cursor.ts)) {
        exhausted = true;
        ok = true;
      } else {
        cursor = { ts: nextTs, seq: nextSeq };
        if (page.done) exhausted = true;
        noteSearchFloor();
        const made = ingest(messages);
        posts.push(...made);
        const added = feedTab === 'following' ? takeFollowed(made) : made;
        if (feedTab === 'following') shown.push(...added);
        if (feedFiltering()) {
          for (const post of added) if (hitQuery(post)) found.push(post);
          if (rankedSort()) {
            sortPages += 1;
            queueViewSort();
          }
        }
        ok = true;
      }
    }
  } catch (error) {
    console.warn('feed page failed', error);
  } finally {
    if (gen === generation) paging = false;
  }
  if (gen !== generation) return;
  if (!ok) {
    sortHold = false;
    paintSpinner(false);
    if (rankedSort() && feedFiltering()) {
      sortPaintDirty = true;
      sortFetchPause = true;
      try {
        paintSorted();
        fillDown();
      } finally {
        sortFetchPause = false;
      }
    }
    return;
  }
  if (rankedSort() && feedFiltering()) finishRanked();
  else {
    sortHold = false;
    paintSpinner(false);
    fillDown();
  }
}

async function catchUp() {
  if (!loadedTopic || !highSeq || paging) return;
  const topic = loadedTopic;
  const gen = generation;
  const after = highSeq;
  paging = true;
  try {
    const rows = await fetchNewer(topic, after);
    if (gen !== generation) return;
    const made = ingest(rows);
    if (made.length) prependPosts(made);
  } catch (error) {
    console.warn('feed catch-up failed', error);
  } finally {
    if (gen === generation) paging = false;
  }
  if (gen === generation && sortHold && rankedSort() && feedFiltering()) finishRanked();
}

function onStream(event) {
  if (!feedOn() || !event || event.topic !== loadedTopic) return;
  if (event.type !== 'message' && event.type !== 'pending') return;
  if (!event.message) return;
  const made = ingest([event.message]);
  if (made.length) prependPosts(made);
  if (placing && made.some(ownPlace)) returnToFeed(true);
}

function bindStream(topic) {
  if (streamOff) streamOff();
  streamOff = streamOnTopic(topic, onStream);
}

function topicName(topicId) {
  const prefix = `${topicId} - `;
  for (const entry of globalLoadedTopicIdsWithNames) {
    const row = String(entry || '');
    if (!row.startsWith(prefix)) continue;
    const name = row.slice(prefix.length).trim();
    if (name && name !== topicId) return name;
  }
  return '';
}

function paintTopicTitle() {
  const topic = topicNow();
  const name = topicName(topic);
  const label = name || topic || '';
  const showId = !!(name && topic);
  const idText = showId ? topic : '';
  const spoken = showId ? `${name}, ${topic}` : label;
  const aria = spoken ? `Load ${spoken}` : 'Load topic';
  if (
    topicText.textContent === label
    && topicIdLine.hidden === !showId
    && topicIdLine.textContent === idText
    && topicBtn.title === spoken
    && topicBtn.getAttribute('aria-label') === aria
  ) return;
  topicText.textContent = label;
  topicIdLine.hidden = !showId;
  topicIdLine.textContent = idText;
  topicBtn.title = spoken;
  topicBtn.setAttribute('aria-label', aria);
}

function ensureTopic(opening) {
  const topic = topicNow();
  paintTopicTitle();
  if (!topic) return;
  if (topic !== loadedTopic) {
    if (streamOff) {
      streamOff();
      streamOff = null;
    }
    resetFeed(topic);
    bindStream(topic);
    if (followBlocked()) paintEmpty();
    else loadOlder();
    return;
  }
  if (opening) catchUp();
  if (!followBlocked() && !paging && !posts.length && !exhausted) loadOlder();
}

function feedOn() {
  return root.style.display !== 'none';
}

// Opaque feed is its own screen. The class tells the globe loop to skip
// frames. Peek and map mode clear it so the map chrome comes back.
function feedCovers() {
  return root.style.display !== 'none' && !root.classList.contains('is-peek');
}

function syncCover() {
  const covers = feedCovers();
  const was = document.documentElement.classList.contains('feed-app');
  document.documentElement.classList.toggle('feed-app', covers);
  // The bot and daynight layers go idle while the feed covers the map
  // (their render gates in loadP2PModels.js). One frame restarts their
  // repaint loop the moment the map comes back.
  if (!covers && was) map.triggerRepaint();
  syncFeedVideos();
}

// Opening the feed rises it in over the map; closing drops it away to the
// map. root.style.display stays the state (feedOn, the 'feed' history
// watcher) and flips at once. .is-leaving only keeps the screen painted
// while it goes, and html.feed-app stays on until then, so the header keeps
// its feed sizes as it fades. Durations live in style.css (feedScreenIn /
// feedScreenOut); the timer is a fallback. No motion for the startup
// restore (before the first frame) or with reduced motion.
let feedMotionReady = false;
requestAnimationFrame(() => { feedMotionReady = true; });
let feedMotionTimer = 0;

function endFeedMotion() {
  clearTimeout(feedMotionTimer);
  feedMotionTimer = 0;
  const leaving = root.classList.contains('is-leaving');
  root.classList.remove('is-entering', 'is-leaving');
  if (leaving) syncCover();
}

function playFeedMotion(kind) {
  endFeedMotion();
  if (!feedMotionReady || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  root.classList.add(kind === 'in' ? 'is-entering' : 'is-leaving');
  feedMotionTimer = setTimeout(endFeedMotion, 900);
  return true;
}

root.addEventListener('animationend', (event) => {
  if (event.target !== root) return;
  if (event.animationName === 'feedScreenIn' || event.animationName === 'feedScreenOut') endFeedMotion();
});

function openLoadFromFeed() {
  openFeedChat('load');
}

// Toolbar → Load, only while the drawer is open. Startup never calls this.
// A profile tap passes true: same Load shell, no feedchat history entry.
// That tap keeps the userbio layer so Back returns to the popup or drawer.
function openLoadPage(fromProfile) {
  if (fromProfile === true) {
    paintFeedChat('load');
    return feedChatKind === 'load' && !feedChat.hidden;
  }
  const drawerOpen = !menu.hidden && menu.classList.contains('is-open') && drawerStack.length > 0;
  if (!drawerOpen || navBusy()) return false;
  openFeedChat('load', 'drawer');
  return feedChatKind === 'load' && !feedChat.hidden;
}
window.openLoadPage = openLoadPage;

// savedScroll stays live. History is updated once the feed sits still,
// and again right before the map opens or the feed closes.
function writeScroll() {
  if (root.classList.contains('is-peek')) return;
  if (!window.layerIsOpen || !window.layerIsOpen('feed')) return;
  if (window.layerIsOpen('markerpopup') || window.layerIsOpen('feedfly')) return;
  // A layer opened on top of the feed in the idle window. Pushing feed
  // again would sit above that layer, so Back would close the feed first.
  if (!window.layerIsTop || !window.layerIsTop('feed')) return;
  window.layerOpened('feed', { scroll: savedScroll });
}

// The next card action opens another layer. Keep the scroll the feed is
// on, and drop the pending idle write so it cannot land above that layer.
function holdScroll() {
  savedScroll = scroller.scrollTop;
  if (scrollIdle) {
    clearTimeout(scrollIdle);
    scrollIdle = 0;
  }
}

window.holdFeedScroll = holdScroll;

window.openFeedProfile = (payer) => openFeedProfile(payer);

window.openProfileFromPopup = (payer) => {
  // Peek and map mode are not covering, so this profile sits over a popup.
  const coverPopup = !feedCovers();
  if (feedOn() && root.classList.contains('is-peek')) {
    if (window.layerClosedByUI && window.layerIsOpen && window.layerIsOpen('feedfly')) {
      window.layerClosedByUI('feedfly');
    }
    reveal();
  }
  const id = String(payer || '').trim();
  if (!/^\d+\.\d+\.\d+$/.test(id)) return false;
  window.__profileCoversPopup = coverPopup;
  openFeedProfile(id);
  return true;
};

function rememberScroll() {
  if (scrollIdle) {
    clearTimeout(scrollIdle);
    scrollIdle = 0;
  }
  if (root.classList.contains('is-peek')) return;
  savedScroll = scroller.scrollTop;
  writeScroll();
}

function scheduleScrollWrite() {
  if (scrollIdle) clearTimeout(scrollIdle);
  scrollIdle = setTimeout(() => {
    scrollIdle = 0;
    writeScroll();
  }, SCROLL_IDLE_MS);
}

function reveal() {
  peek = false;
  root.classList.remove('is-peek');
  // A profile opened over the peek sits on the body. The feed is covering
  // again, so the same page goes back into the column.
  if (!profilePage.hidden) placeProfileForMap(false);
  syncCover();
  syncFeedMapBack();
  const y = savedScroll;
  requestAnimationFrame(() => { setFeedScroll(y); });
  paintNewPill();
}

function revealSoon() {
  const token = ++revealToken;
  let tries = 0;
  const tick = () => {
    if (token !== revealToken) return;
    tries += 1;
    if (window.layerIsOpen && (window.layerIsOpen('markerpopup') || window.layerIsOpen('feedfly'))) {
      if (tries < 12) setTimeout(tick, 40);
      return;
    }
    if (peek && window.layerIsOpen && window.layerIsOpen('feed')) reveal();
  };
  setTimeout(tick, 0);
}

function hideModel() {
  const crosshair = document.getElementById('crosshair');
  if (currentUfoModelInGLTF) {
    scene.remove(currentUfoModelInGLTF);
    if (crosshair) crosshair.style.display = 'none';
  }
}

function showModel() {
  const crosshair = document.getElementById('crosshair');
  if (currentUfoModelInGLTF && crosshair) {
    scene.add(currentUfoModelInGLTF);
    crosshair.style.display = 'block';
  }
}

function openMarkerFeature(feature) {
  const node = markerPopupNode(feature.properties, feature);
  const lngLat = feature.geometry && feature.geometry.coordinates;
  if (!node || !lngLat) return false;
  holdScroll();
  activePolygonPopups.forEach((popup) => popup.remove());
  activeMarkerPopups.forEach((popup) => popup.remove());
  CloseALL();
  closeDrawAnchor();
  closePressAnchor();
  const popup = new maplibregl.Popup({ focusAfterOpen: false });
  popup.on('close', () => {
    changePopupState(false);
    showModel();
  });
  activeMarkerPopups.push(popup);
  popup.setLngLat(lngLat).addTo(map).setDOMContent(node);
  cancelAnimateMapTo();
  animateMapTo(map, lngLat, MARKER_ZOOM);
  applyAllStyles();
  changePopupState(true);
  hideModel();
  return true;
}

function openPolygonFeature(polygon) {
  const node = polygonPopupNode(polygon);
  const lngLat = centerOf(polygon);
  if (!node || !lngLat) return false;
  holdScroll();
  activePolygonPopups.forEach((popup) => popup.remove());
  activeMarkerPopups.forEach((popup) => popup.remove());
  CloseALL();
  closeDrawAnchor();
  closePressAnchor();
  const popup = new maplibregl.Popup({ focusAfterOpen: false });
  popup.on('close', () => {
    changePopupState(false);
    showModel();
  });
  activePolygonPopups.push(popup);
  popup.setLngLat(lngLat).setDOMContent(node).addTo(map);
  cancelAnimateMapTo();
  animateMapTo(map, lngLat, zoomForPolygon(polygon));
  applyAllStyles();
  changePopupState(true);
  hideModel();
  return true;
}

function flyZoom(post) {
  const polygon = post && post.kind === 'polygon' ? post.polygon : null;
  const ring = polygon && Array.isArray(polygon.coordinates) ? polygon.coordinates[0] : null;
  if (Array.isArray(ring) && ring.length >= 2) return zoomForPolygon(polygon);
  return MARKER_ZOOM;
}

function flyOnly(lngLat, zoom = MARKER_ZOOM) {
  if (window.layerOpened) {
    window.layerOpened('feedfly', {
      lng: lngLat[0],
      lat: lngLat[1],
      zoom,
      scroll: savedScroll,
    });
  }
  cancelAnimateMapTo();
  animateMapTo(map, lngLat, zoom);
  syncFeedMapBackSoon();
}

function mountFeedMapBack(popup) {
  const el = popup && typeof popup.getElement === 'function' ? popup.getElement() : null;
  const content = el && el.querySelector('.maplibregl-popup-content');
  if (!content || content.querySelector('.feed-map-back')) return;
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'maplibregl-popup-close-button feed-map-back';
  back.setAttribute('aria-label', 'Back');
  back.title = 'Back';
  back.appendChild(svgIcon([
    ['path', { d: 'm12 19-7-7 7-7' }],
    ['path', { d: 'M19 12H5' }],
  ]));
  back.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    popup.returnToFeed = true;
    popup.remove();
  });
  const close = content.querySelector('.maplibregl-popup-close-button:not(.feed-map-back)');
  if (close) content.insertBefore(back, close);
  else content.appendChild(back);
}

function openOnMap(post) {
  rememberScroll();
  peek = true;
  root.classList.add('is-peek');
  syncCover();
  if (post.kind === 'marker' && post.feature) {
    feedPopupHandoff = true;
    if (openMarkerFeature(post.feature)) return;
    feedPopupHandoff = false;
  }
  if (post.kind === 'polygon' && post.polygon) {
    feedPopupHandoff = true;
    if (openPolygonFeature(post.polygon)) return;
    feedPopupHandoff = false;
  }
  flyOnly(post.lngLat, flyZoom(post));
}

function chipText(key, value) {
  if (key === 'hasImage') return 'Has image';
  if (key === 'onlyText') return 'Text only';
  if (key === 'mine') return 'Mine';
  if (key === 'following') return 'Following';
  if (key === 'hashinal') return 'Early Hashinal holders';
  if (key === 'hasComments') return 'Has comments';
  if (key === 'dateFrom') return 'From ' + value;
  if (key === 'dateTo') return 'To ' + value;
  if (key === 'country') return countryNameByCode.get(value) || String(value);
  if (key === 'sort') {
    if (value === 'oldest') return 'Oldest';
    if (value === 'liked') return 'Liked';
    if (value === 'viewed') return 'Viewed';
  }
  return String(value);
}

function rebuildChips() {
  const query = getQuery();
  const chips = [];
  for (const key of Object.keys(query.filters)) {
    const value = query.filters[key];
    if (value == null || value === '' || value === false) continue;
    chips.push({ key, label: chipText(key, value), sort: false });
  }
  if (query.sort && query.sort !== 'newest') chips.push({ key: 'sort', label: chipText('sort', query.sort), sort: true });
  searchFilters.replaceChildren();
  if (!chips.length) {
    searchFilters.hidden = true;
    return;
  }
  searchFilters.hidden = false;
  for (const chip of chips) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'is-active';
    const chipLabel = document.createElement('span');
    chipLabel.textContent = chip.label;
    const chipX = document.createElement('span');
    chipX.className = 'feed-filter-chip-x';
    chipX.setAttribute('aria-hidden', 'true');
    chipX.textContent = '\u00d7';
    btn.append(chipLabel, chipX);
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      if (chip.sort) setSort('newest');
      else setFilter(chip.key, '');
    });
    searchFilters.appendChild(btn);
  }
}

function paintFilterToggle(btn, on) {
  btn.classList.toggle('is-active', !!on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}

function paintWalletToggle(btn, on, open) {
  paintFilterToggle(btn, on);
  btn.setAttribute('aria-disabled', open ? 'false' : 'true');
  if (open) btn.removeAttribute('aria-describedby');
  else btn.setAttribute('aria-describedby', 'feed-filter-wallet-hint');
}

function syncFilterControls() {
  const query = getQuery();
  const filters = query.filters || {};
  paintFilterToggle(filterHasImage, filters.hasImage === true);
  paintFilterToggle(filterOnlyText, filters.onlyText === true);
  const wallet = !!walletNow();
  paintWalletToggle(filterMine, filters.mine === true, wallet);
  paintWalletToggle(filterFollowing, filters.following === true, wallet);
  filterWalletHint.hidden = wallet;
  paintFilterToggle(filterHashinal, filters.hashinal === true);
  paintFilterToggle(filterComments, filters.hasComments === true);
  const sort = query.sort || 'newest';
  if (filterSort.value !== sort) filterSort.value = sort;
  let sortIndex = 0;
  [...filterSortPills.children].forEach((pill, index) => {
    const on = pill.dataset.sort === sort;
    if (on) sortIndex = index;
    pill.classList.toggle('is-active', on);
    pill.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  // The cyan block under the pills slides to this slot (style.css).
  filterSortPills.style.setProperty('--sort-i', String(sortIndex));
  const from = typeof filters.dateFrom === 'string' ? filters.dateFrom : '';
  const to = typeof filters.dateTo === 'string' ? filters.dateTo : '';
  if (filterFrom.value !== from) filterFrom.value = from;
  if (filterTo.value !== to) filterTo.value = to;
  const country = typeof filters.country === 'string' ? filters.country : '';
  if (filterCountry.value !== country) filterCountry.value = country;
  paintCountryField();
}

function syncSearchChrome() {
  const pageOpen = !searchPage.hidden;
  const filtered = feedFiltering() && !pageOpen;
  toolbar.classList.toggle('has-search-query', filtered);
  searchBtnFeed.setAttribute('aria-expanded', pageOpen ? 'true' : 'false');
  searchBtnFeed.setAttribute('aria-label', filtered ? 'Search, filtered' : 'Search');
  const query = getQuery();
  const text = query.text;
  if (searchInput.value !== text) searchInput.value = text;
  searchClear.hidden = searchInput.value.length === 0;
  let filterOn = false;
  const filters = query.filters || {};
  for (const key of Object.keys(filters)) {
    const value = filters[key];
    if (value == null || value === '' || value === false) continue;
    filterOn = true;
    break;
  }
  searchGear.classList.toggle('is-active', filterOn || (query.sort || 'newest') !== 'newest');
  searchGear.setAttribute('aria-expanded', filterCard.style.display === 'block' ? 'true' : 'false');
  rebuildChips();
  syncFilterControls();
  if (!searchPage.hidden) revealSearchHead();
}

function reobserveFeedVideos() {
  if (!feedVideoObserver) return;
  for (const video of [...feedVideoRatio.keys()]) {
    feedVideoObserver.unobserve(video);
    if (video.isConnected) feedVideoObserver.observe(video);
  }
  queueFeedVideos();
}

function parkScroller() {
  if (scroller.parentNode === searchResults) return;
  const y = scroller.scrollTop;
  tabTrackHold = true;
  searchResults.appendChild(scroller);
  setFeedScroll(y);
  reobserveFeedVideos();
}

function unparkScroller() {
  if (scroller.parentNode === frame) return;
  const y = scroller.scrollTop;
  tabTrackHold = true;
  frame.insertBefore(scroller, menuDim);
  setFeedScroll(y);
  reobserveFeedVideos();
}

function pinWindow() {
  if (searchPinned) return;
  searchPinned = true;
  pinScroll = scroller.scrollTop;
  pinStart = rangeStart;
  pinEnd = rangeEnd;
}

function showQueryResults() {
  sortPages = 0;
  sortHold = false;
  resetViewSort();
  syncFound();
  rangeStart = 0;
  rangeEnd = 0;
  clearViewWatch();
  column.replaceChildren();
  setFeedScroll(0);
  if (rankedSort()) {
    finishRanked();
    return;
  }
  paintSpinner(false);
  paintEmpty();
  if (!followBlocked()) fillDown();
  else paintEmpty();
}

function restorePin() {
  if (profileFilter) {
    searchPinned = false;
    pinStart = 0;
    pinEnd = 0;
    pinScroll = 0;
    rerenderLane({ keepHeld: true });
    return;
  }
  const start = Math.min(pinStart, tabPosts().length);
  const end = Math.min(Math.max(pinEnd, start), tabPosts().length);
  const y = pinScroll;
  searchPinned = false;
  pinStart = 0;
  pinEnd = 0;
  pinScroll = 0;
  clearViewWatch();
  column.replaceChildren();
  rangeStart = start;
  rangeEnd = start;
  if (end > start) renderThrough(end);
  paintEmpty();
  setFeedScroll(y);
  savedScroll = y;
  if (!followBlocked()) fillDown();
  setFeedScroll(y);
  savedScroll = y;
  paintNewPill();
  revealParked();
}

function onFeedSearchChange() {
  if (searchMute) return;
  syncSearchChrome();
  if (restoreOnClear) {
    restoreOnClear = false;
    if (feedFiltering()) {
      pinWindow();
      showQueryResults();
      paintNewPill();
      return;
    }
    found = [];
    if (searchPinned) restorePin();
    else paintEmpty();
    return;
  }
  if (!feedFiltering()) {
    found = [];
    showQueryResults();
    paintNewPill();
    return;
  }
  pinWindow();
  showQueryResults();
  paintNewPill();
}

function applyQuery(raw) {
  setText(raw == null ? '' : String(raw));
}

function flushSearchInput() {
  if (!searchTimer) return;
  clearTimeout(searchTimer);
  searchTimer = 0;
  setText(searchInput.value);
}

// Leaving the feed drops the query so the next open is not still filtered.
function hideSearch() {
  const wasOpen = !searchPage.hidden;
  if (searchTimer) {
    clearTimeout(searchTimer);
    searchTimer = 0;
  }
  searchMute = true;
  try {
    clearQuery();
  } finally {
    searchMute = false;
  }
  concealFilterCard(false);
  if (window.layerClosedByUI && window.layerIsOpen && window.layerIsOpen('feedfilters')) {
    window.layerClosedByUI('feedfilters');
  }
  found = [];
  sortHold = false;
  searchPinned = false;
  pinScroll = 0;
  pinStart = 0;
  pinEnd = 0;
  restoreOnClear = false;
  searchInput.value = '';
  searchClear.hidden = true;
  if (wasOpen) searchPage.hidden = true;
  // Leaving the feed hides the whole screen, so no lift is played.
  endSearchMotion();
  unparkScroller();
  if (wasOpen) resetScrollChrome();
  syncSearchChrome();
  searchOpenedByPointer = false;
  searchArmPointer = false;
  clearSearchBtnPress();
}

// Filters sheet motion. display stays the open/closed state and flips at
// once; .is-leaving only keeps the sheet and its backdrop painted while
// they slide and fade out (style.css feedFilterDown / feedFilterShrink).
// The timer is a fallback for a missed animationend.
function endFilterMotion() {
  clearTimeout(filterMotionTimer);
  filterMotionTimer = 0;
  filterCard.classList.remove('is-leaving');
  filterBackdrop.classList.remove('is-leaving');
}

// Back, Escape, and browser Back close the page and keep the query.
// animate is false when the whole search page goes away with the sheet.
function concealFilterCard(animate = true) {
  const wasShown = filterCard.style.display === 'block';
  filterBackdrop.style.display = 'none';
  filterCard.style.display = 'none';
  searchGear.setAttribute('aria-expanded', 'false');
  endFilterMotion();
  if (!animate || !wasShown || searchPage.hidden) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  filterCard.classList.add('is-leaving');
  filterBackdrop.classList.add('is-leaving');
  filterMotionTimer = setTimeout(endFilterMotion, 600);
}

function showFilterCard() {
  endFilterMotion();
  syncFilterControls();
  filterBackdrop.style.display = 'block';
  filterCard.style.display = 'block';
  searchGear.setAttribute('aria-expanded', 'true');
}

function closeFilterCard() {
  if (filterCard.style.display !== 'block' && filterBackdrop.style.display !== 'block') return;
  concealFilterCard();
  if (window.layerClosedByUI && window.layerIsOpen && window.layerIsOpen('feedfilters')) {
    window.layerClosedByUI('feedfilters');
  }
  if (!searchPage.hidden) revealSearchHead();
}

function openFilterCard() {
  if (filterCard.style.display === 'block') return;
  if (searchPage.hidden) return;
  showFilterCard();
  if (window.layerOpened) window.layerOpened('feedfilters');
}

// Set from the opening click and consumed by openSearch. A tap must not
// restore a visible ring; a keyboard open still does.
let searchArmPointer = false;
let searchOpenedByPointer = false;

function clearSearchBtnPress() {
  searchBtnFeed.classList.remove('is-active', 'is-open', 'is-hold');
}

// The header (bar + field row) drops in from above on open and lifts back
// up on close. searchPage.hidden still flips at once, so every check of it
// stays true to the state; .is-leaving only keeps the page painted while
// the header leaves. The posts do not move: they are the feed scroller,
// parked in and out of the page. Durations live in style.css
// (feedSearchDrop / feedSearchLift); the timer is only a fallback.
// searchMotionTimer and the animationend hook sit beside searchPage.
function endSearchMotion() {
  clearTimeout(searchMotionTimer);
  searchMotionTimer = 0;
  searchPage.classList.remove('is-entering', 'is-leaving');
}

function playSearchMotion(kind) {
  endSearchMotion();
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  searchPage.classList.add(kind === 'in' ? 'is-entering' : 'is-leaving');
  searchMotionTimer = setTimeout(endSearchMotion, 900);
}

function closeSearchPage() {
  if (filterCard.style.display === 'block' || filterBackdrop.style.display === 'block') closeFilterCard();
  if (searchPage.hidden) {
    clearSearchBtnPress();
    return;
  }
  flushSearchInput();
  searchPage.hidden = true;
  playSearchMotion('out');
  unparkScroller();
  resetScrollChrome();
  syncSearchChrome();
  if (window.layerClosedByUI && window.layerIsOpen && window.layerIsOpen('feedsearch')) {
    window.layerClosedByUI('feedsearch');
  }
  const fromPointer = searchOpenedByPointer;
  searchOpenedByPointer = false;
  searchArmPointer = false;
  clearSearchBtnPress();
  searchBtnFeed.focus(fromPointer
    ? { preventScroll: true, focusVisible: false }
    : { preventScroll: true, focusVisible: true });
}

// The pill focuses itself when it is tapped. Opening the page must not
// focus the field, or the phone keyboard covers the results.
function focusSearchPage() {
  searchBack.focus({ preventScroll: true, focusVisible: false });
}

function openSearch() {
  const fromPointer = searchArmPointer;
  searchArmPointer = false;
  if (!searchPage.hidden) return;
  if (!feedOn() || root.classList.contains('is-peek')) return;
  if (window.layerIsTop && !window.layerIsTop('feed')) return;
  searchOpenedByPointer = fromPointer;
  holdScroll();
  searchPage.hidden = false;
  playSearchMotion('in');
  parkScroller();
  syncSearchChrome();
  if (window.layerOpened) window.layerOpened('feedsearch');
  focusSearchPage();
  requestAnimationFrame(() => revealSearchHead());
}

function ownPlace(post) {
  const me = walletNow();
  if (!me || !post || post.payer !== me) return false;
  if (post.kind === 'polygon') return true;
  if (post.kind !== 'marker' || !post.feature) return false;
  const number = post.feature.msgNumber;
  return typeof number !== 'string' || !number.startsWith('share-');
}

function walletOverlay() {
  const host = document.querySelector('wcm-modal');
  const rootNode = host && host.shadowRoot;
  if (!rootNode) return null;
  return rootNode.querySelector('.wcm-overlay');
}

function walletModalOpen() {
  const overlay = walletOverlay();
  if (!overlay || !overlay.classList.contains('wcm-active')) return false;
  const box = overlay.getBoundingClientRect();
  return box.width > 0 && box.height > 0;
}

// web3.js writes "Connecting..." before openModal. That label, or the sheet,
// means the connect flow is still starting and must not be treated as a miss.
function connectPending() {
  const connect = document.getElementById('connect-wallet-btn');
  return !!(connect && /connecting/i.test(connect.textContent || ''));
}

// 'ok' continues into placing. 'cancel' stays on the feed with no toast.
// 'fail' is a real miss and the caller says why.
// "Connecting..." stays pending, but a sheet that has been closed for ~1.5s
// is a cancel even if that label is still showing. The whole wait fails at ~90s.
function ensureWallet() {
  if (walletNow()) return Promise.resolve('ok');
  const connect = document.getElementById('connect-wallet-btn');
  if (!connect) return Promise.resolve('fail');
  if (!walletModalOpen() && !connectPending()) {
    // This click is mid-place. Explicit Connect buttons close overlays;
    // this one must not.
    connect.skipOverlayClose = true;
    try { connect.click(); } catch (err) { return Promise.resolve('fail'); }
    finally { connect.skipOverlayClose = false; }
  }
  const started = Date.now();
  let sawSheet = walletModalOpen();
  let closedAt = 0;
  return new Promise((resolve) => {
    const tick = () => {
      if (walletNow()) {
        resolve('ok');
        return;
      }
      const open = walletModalOpen();
      const connecting = connectPending();
      if (open) {
        sawSheet = true;
        closedAt = 0;
      } else if (sawSheet && !closedAt) {
        closedAt = Date.now();
      }
      // The overlay can drop while openModal is still resolving. Stay pending
      // until the label clears so a late account still resolves 'ok'.
      if (sawSheet && !open && !connecting) {
        resolve('cancel');
        return;
      }
      // The label can stay "Connecting..." after the sheet has gone.
      if (sawSheet && !open && closedAt && Date.now() - closedAt >= 1500) {
        resolve('cancel');
        return;
      }
      if (!sawSheet && !open && !connecting && Date.now() - started >= 4000) {
        resolve('fail');
        return;
      }
      if (Date.now() - started >= 90000) {
        resolve('fail');
        return;
      }
      setTimeout(tick, 200);
    };
    setTimeout(tick, 200);
  });
}

function restoreMapChrome() {
  const main = document.getElementById('main-toggle-btn');
  const toolbarBtn = document.getElementById('toggle-toolbar-btn-btn');
  const fovBtn = document.getElementById('toggle-your-fov-btn-btn');
  if (main) main.style.display = 'block';
  if (toolbarBtn) toolbarBtn.style.display = 'none';
  if (fovBtn) fovBtn.style.display = 'none';
  const crosshair = document.getElementById('crosshair');
  if (!popIsOpen && currentUfoModelInGLTF && crosshair) {
    scene.add(currentUfoModelInGLTF);
    crosshair.style.display = 'block';
  }
}

// Peek keeps the feedplace entry and leaves layoutMode as feed, so Back
// can close Draw and return to this scroll spot. The caller opens Draw.
function beginPlace() {
  if (!window.layerOpened) return false;
  placing = true;
  drawWasOpen = false;
  holdScroll();
  peek = true;
  root.classList.add('is-peek');
  syncCover();
  try {
    window.layerOpened('feedplace');
  } catch (err) {
    placing = false;
    placeBusy = false;
    peek = false;
    root.classList.remove('is-peek');
    syncCover();
    throw err;
  }
  return root.classList.contains('is-peek');
}

// Hides a form this session opened, then drops feedplace. Callers reveal
// the feed themselves: a skipped popstate never runs the layer close.
function leavePlace() {
  placeToken += 1;
  placeBusy = false;
  const active = placing || (window.layerIsOpen && window.layerIsOpen('feedplace'));
  if (!active) return;
  const openedForm = drawWasOpen;
  placing = false;
  drawWasOpen = false;
  if (openedForm) {
    const col = document.getElementById('draw-column');
    if (col && col.style.display !== 'none') {
      col.style.display = 'none';
      if (window.layerClosedByUI && window.layerIsOpen && window.layerIsOpen('draw-column')) {
        window.layerClosedByUI('draw-column');
      }
    }
    restoreMapChrome();
  }
  closeDrawAnchor();
  if (window.layerClosedByUI && window.layerIsOpen && window.layerIsOpen('feedplace')) {
    window.layerClosedByUI('feedplace');
  }
}

function returnToFeed(sent) {
  if (!placing && !(window.layerIsOpen && window.layerIsOpen('feedplace'))) return;
  leavePlace();
  if (!feedOn()) return;
  if (sent) {
    if (feedTab === 'following' && !(followSet && followSet.has(walletNow()))) {
      feedTab = 'all';
      paintTabs();
    }
    savedScroll = 0;
    peek = false;
    root.classList.remove('is-peek');
    syncCover();
    syncFeedMapBack();
    held.all = [];
    held.following = [];
    rerenderLane();
    return;
  }
  reveal();
}

function closePlaceBlockers() {
  // Posting closes the page and keeps a query the user already left in place.
  if (!searchPage.hidden || (window.layerIsOpen && window.layerIsOpen('feedsearch'))) closeSearchPage();
  if (!menu.hidden || (window.layerIsTop && window.layerIsTop('feedmenu'))) closeMenu();
}

function placeSurfaceOpen() {
  return root.classList.contains('is-peek') || walletModalOpen();
}

async function startPost() {
  if (placing || placeBusy) {
    if (placeSurfaceOpen()) {
      toast.info(root.classList.contains('is-peek') ? 'Already placing a post' : 'Finish connecting first');
      return;
    }
    leavePlace();
  }
  if (!feedOn()) {
    toast.info('Feed is closed');
    return;
  }
  if (root.classList.contains('is-peek')) {
    toast.info('Already placing a post');
    return;
  }
  closePlaceBlockers();
  if (window.layerIsTop && !window.layerIsTop('feed')) {
    toast.info('Close this panel first');
    return;
  }
  const token = ++placeToken;
  placeBusy = true;
  let status = 'fail';
  try {
    // One note as the sheet opens. Success and cancel stay quiet.
    if (!walletNow() && !walletModalOpen() && !connectPending()) toast.info('Connect wallet');
    status = await ensureWallet();
  } catch (err) {
    status = 'fail';
  } finally {
    if (token === placeToken) placeBusy = false;
  }
  if (token !== placeToken) return;
  if (status === 'cancel') {
    placeBusy = false;
    return;
  }
  if (status !== 'ok') {
    placing = false;
    placeBusy = false;
    toast.info("Couldn't open the wallet");
    return;
  }
  if (!feedOn()) {
    toast.info('Feed is closed');
    return;
  }
  if (root.classList.contains('is-peek') || placing) return;
  if (window.layerIsTop && !window.layerIsTop('feed')) {
    toast.info('Close this panel first');
    return;
  }
  try {
    if (!beginPlace()) {
      placing = false;
      placeBusy = false;
      toast.info("Couldn't open the map");
      return;
    }
    // Same panel as the toolbar Draw button. The pin path passes true.
    if (!openDrawColumn(false)) {
      leavePlace();
      if (feedOn()) reveal();
      toast.info("Couldn't open Draw");
    }
  } catch (err) {
    if (placing || (window.layerIsOpen && window.layerIsOpen('feedplace'))) {
      leavePlace();
      if (feedOn()) reveal();
    } else {
      placing = false;
      placeBusy = false;
      if (root.classList.contains('is-peek')) {
        root.classList.remove('is-peek');
        syncCover();
      }
    }
    toast.info("Couldn't open Draw");
  }
}

function applyFeed(on) {
  // Only a feed that was on screen plays the close (a peeked one is hidden).
  const wasCovering = feedCovers();
  paintToggle(on);
  writeMode(on ? 'feed' : 'map');
  if (!on) {
    suppressDrawerRestore = true;
    try {
      paintMenu(false);
      dropOptions();
      leavePlace();
      const dropSearch = window.layerIsOpen && window.layerIsOpen('feedsearch');
      hideSearch();
      if (dropSearch && window.layerClosedByUI) window.layerClosedByUI('feedsearch');
      if (settingsOpen || (window.layerIsOpen && window.layerIsOpen('feedsettings'))) closeFeedSettings();
      if (feedChatKind || (window.layerIsOpen && window.layerIsOpen('feedchat'))) closeFeedChat();
      dismissFeedProfile();
      if (drawerItem && window.layerIsOpen && window.layerIsOpen('feedmenu')) closeMenu();
    } finally {
      suppressDrawerRestore = false;
    }
  }
  if (on) {
    // Map and peek host the profile on the body. Close it before the feed
    // column shows, so the page is not left fixed over the feed.
    const profileOverMap = !profilePage.hidden && (profilePage.classList.contains('is-map-profile') || !feedOn());
    const profileLayerOverMap = !feedOn() && window.layerIsOpen && window.layerIsOpen('feedprofile');
    if (profileOverMap || profileLayerOverMap) dismissFeedProfile();
    placeMenuForMap(false);
    const opening = !feedOn();
    peek = false;
    root.classList.remove('is-peek');
    root.style.display = 'block';
    if (opening) playFeedMotion('in');
    else endFeedMotion();
    ensurePlacePack();
    showFeedTabs();
    measureTabHide();
    syncCover();
    applyFeedChrome();
    ensureTopic(true);
    if (opening) {
      const want = feedPrefs.tab === 'following' ? 'following' : 'all';
      if (feedTab !== want) selectTab(want);
    }
    syncFeedMapBack();
    return;
  }
  peek = false;
  revealToken += 1;
  root.classList.remove('is-peek');
  rememberScroll();
  resetQueues();
  root.style.display = 'none';
  // While it drops away, html.feed-app stays; endFeedMotion runs syncCover.
  if (!(wasCovering && playFeedMotion('out'))) syncCover();
  if (streamOff) {
    streamOff();
    streamOff = null;
  }
  syncFeedMapBack();
}

if (window.defineLayer) {
  window.defineLayer('feedfly', {
    parent: 'feed',
    open: (state) => {
      peek = true;
      root.classList.add('is-peek');
      syncCover();
      const y = Number(state && state.scroll);
      if (Number.isFinite(y)) savedScroll = y;
      if (state && state.lng != null && state.lat != null) {
        cancelAnimateMapTo();
        const zoom = Number(state.zoom);
        animateMapTo(map, [Number(state.lng), Number(state.lat)], Number.isFinite(zoom) ? zoom : MARKER_ZOOM);
      }
      syncFeedMapBackSoon();
    },
    close: () => {
      if (root.style.display === 'none') return;
      reveal();
    },
  });
}

if (window.watchDisplayLayer) {
  window.watchDisplayLayer('feed', root, {
    open: (state) => {
      const beforeTab = feedTab;
      const wasOff = !feedOn();
      applyFeed(true);
      if (wasOff && beforeTab !== feedTab) return;
      const y = Number(state && state.scroll);
      if (Number.isFinite(y)) {
        savedScroll = y;
        requestAnimationFrame(() => { setFeedScroll(y); });
      }
    },
    close: () => applyFeed(false),
  });
}

if (window.layerPopupOpened) {
  const opened = window.layerPopupOpened;
  window.layerPopupOpened = function (popup, data) {
    if (feedPopupHandoff && popup) {
      popup.openedFromFeed = true;
      feedPopupHandoff = false;
    }
    if (feedOn() && window.layerIsOpen && window.layerIsOpen('feed')) {
      peek = true;
      root.classList.add('is-peek');
      revealToken += 1;
      syncCover();
    }
    const result = opened(popup, data);
    if (popup && popup.openedFromFeed) mountFeedMapBack(popup);
    syncFeedMapBackSoon();
    return result;
  };
}

if (window.layerPopupClosed) {
  const closed = window.layerPopupClosed;
  window.layerPopupClosed = function (popup) {
    // × stays on the map in peek. The popup's own Back sets returnToFeed.
    // History Back marks _hlClosed before remove; the × only gets that
    // flag afterwards, when the history entry is consumed.
    const fromFeed = !!(popup && popup.openedFromFeed);
    const explicitBack = !!(popup && popup.returnToFeed);
    if (fromFeed && popup && !explicitBack && !popup._hlClosed) popup._feedX = true;
    const historyBack = !!(popup && popup._hlClosed && !popup._feedX);
    const backToFeed = fromFeed && (explicitBack || historyBack);
    const result = closed(popup);
    if (backToFeed) revealSoon();
    else syncFeedMapBackSoon();
    return result;
  };
}

btn.addEventListener('click', () => {
  if (feedOn() && root.classList.contains('is-peek')) {
    if (window.layerClosedByUI && window.layerIsOpen && window.layerIsOpen('feedfly')) {
      window.layerClosedByUI('feedfly');
    }
    reveal();
    return;
  }
  applyFeed(!feedOn());
});

const USER_ICON = [
  ['path', { d: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2' }],
  ['circle', { cx: '12', cy: '7', r: '4' }],
];
const CHAT_ICON = [
  ['path', { d: 'M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719' }],
];
const LOCK_ICON = [
  ['rect', { width: '18', height: '11', x: '3', y: '11', rx: '2', ry: '2' }],
  ['path', { d: 'M7 11V7a5 5 0 0 1 10 0v4' }],
];
const SETTINGS_ICON = [
  ['path', { d: 'M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915' }],
  ['circle', { cx: '12', cy: '12', r: '3' }],
];
const LOGOUT_ICON = [
  ['path', { d: 'm16 17 5-5-5-5' }],
  ['path', { d: 'M21 12H9' }],
  ['path', { d: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4' }],
];
const WALLET_ICON = [
  ['path', { d: 'M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 0 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1' }],
  ['path', { d: 'M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4' }],
];
const SEARCH_ICON = [
  ['circle', { cx: '11', cy: '11', r: '8' }],
  ['path', { d: 'm21 21-4.3-4.3' }],
];
const LOCATE_ICON = [
  ['line', { x1: '2', x2: '5', y1: '12', y2: '12' }],
  ['line', { x1: '19', x2: '22', y1: '12', y2: '12' }],
  ['line', { x1: '12', x2: '12', y1: '2', y2: '5' }],
  ['line', { x1: '12', x2: '12', y1: '19', y2: '22' }],
  ['circle', { cx: '12', cy: '12', r: '7' }],
];
// Same up/down needle the compass button draws.
const NORTH_ICON = [
  ['path', { d: 'M12 3 17.5 12H6.5Z', fill: 'currentColor', stroke: 'none' }],
  ['path', { d: 'M12 21 6.5 12h11Z', fill: 'currentColor', stroke: 'none', opacity: '0.45' }],
];
const EYE_ICON = [
  ['path', { d: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z' }],
  ['circle', { cx: '12', cy: '12', r: '3' }],
];
const TOOLS_ICON = [
  ['rect', { x: '3', y: '3', width: '7', height: '7', rx: '1' }],
  ['rect', { x: '14', y: '3', width: '7', height: '7', rx: '1' }],
  ['rect', { x: '14', y: '14', width: '7', height: '7', rx: '1' }],
  ['rect', { x: '3', y: '14', width: '7', height: '7', rx: '1' }],
];

// Panels Options can open. They are painted under the feed, so a drawer
// open lifts them while that Options session is up.
const OPTION_PANELS = [
  'menu-buttons-group',
  'toolbar',
  'visibility-controls',
  'rotation-controls',
  'Edit_Profile-column',
  'load-column',
  'create-column',
  'draw-column',
  'utility-column',
  'memo-column',
  'domain-column',
  'stack-topic-ids',
  'initial-xyz-column',
  'model-column',
  'model-column-save',
  'crosshair-column',
  'crosshair-column-save',
  'popup-settings-backdrop',
  'popup-settings-card',
  'marker-options-column',
  'marker-column-save',
  'topic-chat-column',
  'topic-chat-save',
  'popup-options-column',
  'popup-options-save',
  'edit-profile-help-overlay',
  'load-options-help-overlay',
  'create-topic-help-overlay',
  'map-draw-help-overlay',
  'model-sharing-rules-help-overlay',
  'edit-topic-rules-help-overlay',
  'domain-help-overlay',
  'stack-topic-ids-help-overlay',
  'topic-chat-help-overlay',
  'e2ee-chat-help-overlay',
  'change-model-help-overlay',
  'crosshair-settings-help-overlay',
  'marker-size-help-overlay',
  'chat-style-help-overlay',
  'popup-style-help-overlay',
  'visibility-help-overlay',
];
let optionsOverFeed = false;
const optionLifted = new Map();

function liftOptionEl(el) {
  if (!el || el.classList.contains('in-drawer')) return;
  if (!optionLifted.has(el)) optionLifted.set(el, el.style.zIndex);
  if (el.style.zIndex !== '8800') el.style.zIndex = '8800';
}

function liftOptions() {
  if (!optionsOverFeed || !feedCovers()) return;
  for (const id of OPTION_PANELS) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (id !== 'menu-buttons-group' && el.style.display === 'none') continue;
    liftOptionEl(el);
  }
}

function dropOptions() {
  optionsOverFeed = false;
  for (const [el, prev] of optionLifted) {
    if (prev) el.style.zIndex = prev;
    else el.style.removeProperty('z-index');
  }
  optionLifted.clear();
}

function clickId(id) {
  const el = document.getElementById(id);
  if (el) el.click();
}

// A visible drawer is replaced, so one Back returns to the feed.
// A drawer kept under one of its pages stays put.
function openOverFeed(run) {
  holdScroll();
  closeReplacedMenu();
  run();
}

function openOwnProfile() {
  if (navBusy()) return;
  const account = walletNow();
  if (!account) return;
  openFeedProfile(account, 'drawer');
}

function httpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.href;
  } catch {
    return '';
  }
}

function profilePicUrl(payer) {
  const raw = profilePictures[payer] && profilePictures[payer].url;
  return httpUrl(raw) || DEFAULT_PIC;
}

function profileDisplayName(payer) {
  const name = textOf(usernames[payer] && usernames[payer].username).trim();
  return name || 'Anonymous';
}

function profileBioText(row) {
  const bio = textOf(row && row.topic_bio).trim();
  return bio;
}

function syncProfileOwn() {
  profileEdit.hidden = !profilePayer || profilePage.hidden || walletNow() !== profilePayer;
}

// The profile page lives in the feed column. On the map the column is
// hidden, so the same page is fixed on the body, the way the chat page is.
let profileParkGen = 0;

function placeProfileForMap(on) {
  if (!on) {
    profilePage.classList.remove('is-map-profile');
    if (profilePage.parentNode !== root) root.appendChild(profilePage);
    return;
  }
  if (profilePage.parentNode !== document.body) document.body.appendChild(profilePage);
  profilePage.classList.add('is-map-profile');
}

function showProfilePage() {
  profileParkGen += 1;
  placeProfileForMap(!feedCovers());
  if (!beginFeedCover(profilePage)) {
    delete profilePage.dataset.navLeaving;
    profilePage.classList.remove('nav-off', 'nav-prep', 'nav-cover');
    profilePage.hidden = false;
  }
  syncProfileOwn();
}

function hideProfilePage() {
  profileEdit.hidden = true;
  const gen = ++profileParkGen;
  const mapCover = profilePage.classList.contains('is-map-profile') && profilePage.classList.contains('nav-cover');
  concealCover(profilePage);
  const park = () => {
    if (gen !== profileParkGen) return;
    placeProfileForMap(false);
  };
  // A map slide has to finish on the body. Parking early would hide it
  // inside the feed column. A later show bumps the generation and cancels this.
  if (!mapCover) park();
  else afterNav(profilePage, park);
}

function hideProfileBanner() {
  profileBanner.hidden = true;
  bannerHidePx = 0;
  bannerOffset = 0;
  profileBanner.style.removeProperty('pointer-events');
}

function showProfileBanner() {
  profileBanner.hidden = false;
  refreshBannerHeight();
  writeBannerOffset(0);
  requestAnimationFrame(refreshBannerHeight);
}

function paintProfileBanner(payer) {
  const name = profileDisplayName(payer);
  const handle = payer;
  const banner = mountPicture(profileBanner.querySelector('.feed-profile-banner-pic'), profilePicUrl(payer), {
    className: 'feed-profile-banner-pic',
    fallback: DEFAULT_PIC,
  });
  paintProfileAvatar(banner, payer);
  bannerName.textContent = name;
  bannerHandle.textContent = handle;
  const bioEl = profileBio.textContent || '';
  const bio = bioEl === 'No bio yet' ? '' : bioEl;
  bannerBio.hidden = !bio;
  bannerBio.textContent = bio;
  profileBanner.setAttribute('aria-label', 'Back to profile, ' + name);
}

function mountProfilePic(payer) {
  profilePicSlot.replaceChildren();
  const img = pictureElement(profilePicUrl(payer), {
    className: 'feed-profile-pic',
    alt: '',
    fallback: DEFAULT_PIC,
  });
  profilePicSlot.appendChild(img);
  paintProfileAvatar(img, payer);
  paintProfileHolder(payer);
}

function paintProfileHolder(payer) {
  paintEarlyProfile(profileIdentity, payer);
  paintEarlyProfile(profilePage, payer);
}

function paintOpenProfileChrome() {
  if (!profilePayer || profilePage.hidden) return;
  const img = profilePicSlot.querySelector('img, video.loop-face');
  if (img) paintProfileAvatar(img, profilePayer);
  paintProfileHolder(profilePayer);
}

function paintProfileBio(bio) {
  const text = String(bio || '').trim();
  profileBio.classList.toggle('is-empty', !text);
  if (!text) {
    profileBio.textContent = 'No bio yet';
  } else {
    fillTopicIds(profileBio, text, 'feed-profile-topic');
  }
  if (profileFilter && profileFilter === profilePayer) paintProfileBanner(profilePayer);
}

function profileField(kicker, valueNode) {
  const row = document.createElement('div');
  row.className = 'feed-profile-row';
  const label = document.createElement('span');
  label.className = 'feed-profile-kicker';
  label.textContent = kicker;
  row.append(label, valueNode);
  return row;
}

function fillProfileSections(payer) {
  profileSections.replaceChildren();
  const account = document.createElement('a');
  account.className = 'feed-profile-value';
  account.href = 'https://explore.hashpack.app/' + encodeURIComponent(payer);
  account.target = '_blank';
  account.rel = 'noopener noreferrer';
  account.textContent = payer;
  account.addEventListener('click', (event) => event.stopPropagation());
  profileSections.appendChild(profileField('Account', account));
  const link = textOf(click2url[payer] && click2url[payer].click2url).trim();
  const href = httpUrl(link);
  if (href) {
    const anchor = document.createElement('a');
    anchor.className = 'feed-profile-value';
    anchor.href = href;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.textContent = href;
    anchor.addEventListener('click', (event) => event.stopPropagation());
    profileSections.appendChild(profileField('Link', anchor));
  }
  const home = profileTopics[payer];
  if (home) {
    const topic = document.createElement('button');
    topic.type = 'button';
    topic.className = 'feed-profile-value feed-profile-topic';
    topic.textContent = String(home);
    topic.addEventListener('click', (event) => {
      event.stopPropagation();
      useTopicId(String(home));
    });
    profileSections.appendChild(profileField('Topic', topic));
  }
}

function paintFeedProfile(payer) {
  const id = String(payer || '').trim();
  if (!/^\d+\.\d+\.\d+$/.test(id)) return;
  const epoch = ++profileEpoch;
  profilePayer = id;
  showProfilePage();
  const name = profileDisplayName(id);
  const link = textOf(click2url[id] && click2url[id].click2url).trim();
  profileName.replaceChildren(payerUsernameNode(name, link, { className: 'feed-profile-name' }));
  profileHandle.href = 'https://explore.hashpack.app/' + encodeURIComponent(id);
  profileHandle.textContent = id;
  paintProfileStats(profileStatsEl, id);
  mountProfilePic(id);
  profileFollow.replaceChildren(followPersonControls(id, { buttonOnly: true }));
  paintProfileBio('');
  fillProfileSections(id);
  profileBody.scrollTop = 0;
  profileBack.focus({ preventScroll: true, focusVisible: false });
  loadTopicBio().then((all) => {
    if (epoch !== profileEpoch || profilePayer !== id) return;
    paintProfileBio(profileBioText(all && all[id]));
    fillProfileSections(id);
  }).catch(() => {});
}

function openFeedProfile(payer, source) {
  const id = String(payer || '').trim();
  if (!/^\d+\.\d+\.\d+$/.test(id)) return;
  // Map, peek, and feed all open this page. The drawer shift is the same
  // so Back highlights My profile. showProfilePage hosts it on the body
  // when the feed column is hidden.
  const fromDrawer = source === 'drawer' && coverFromDrawer('My profile');
  if (!fromDrawer) {
    holdScroll();
    closeReplacedMenu();
  }
  if (profileFilter || bannerTracks()) clearProfileFilter();
  paintFeedProfile(id);
  const data = (fromDrawer || carryingDrawer()) ? drawerState({ payer: id }) : { payer: id };
  if (window.__profileCoversPopup) data.coverPopup = true;
  if (window.layerOpened) window.layerOpened('feedprofile', data);
}

// The photo tap hid the popup instead of closing it. Back shows that same
// popup. In the feed, the profile had stepped out of the peek to use the
// column, so the peek returns with the popup.
function uncoverPopupUnderProfile() {
  const backToPeek = window.__profileCoversPopup === true && feedOn();
  window.__profileCoversPopup = false;
  const restored = typeof window.restorePopupsForPage === 'function'
    && window.restorePopupsForPage() === true;
  if (!backToPeek || !restored) return;
  peek = true;
  root.classList.add('is-peek');
  revealToken += 1;
  syncCover();
  syncFeedMapBack();
}

function refreshBannerHeight() {
  if (profileBanner.hidden) {
    bannerHidePx = 0;
    return;
  }
  const h = profileBanner.getBoundingClientRect().height;
  if (h > 1) bannerHidePx = h;
  writeBannerOffset(bannerOffset);
}

function bannerTracks() {
  return !profileBanner.hidden;
}

function writeBannerOffset(y) {
  const limit = bannerHidePx > 1 ? bannerHidePx : 0;
  const next = limit > 1 ? Math.max(-limit, Math.min(0, y)) : 0;
  bannerOffset = next;
  profileBanner.style.setProperty('--feed-banner-y', next.toFixed(2) + 'px');
  if (profileBanner.hidden) return;
  if (next <= -limit + 0.5 && limit > 1) profileBanner.style.pointerEvents = 'none';
  else profileBanner.style.removeProperty('pointer-events');
}

function enterProfileFilter(payer) {
  if (profileFilter === payer) {
    frame.classList.add('is-profile-feed');
    paintProfileBanner(payer);
    showProfileBanner();
    return;
  }
  profileShift = { all: 0, following: 0 };
  profileView = {
    scroll: scroller.scrollTop,
    start: rangeStart,
    end: rangeEnd,
    pinned: searchPinned,
    pinScroll,
    pinStart,
    pinEnd,
  };
  profileFilter = payer;
  frame.classList.add('is-profile-feed');
  paintProfileBanner(payer);
  showProfileBanner();
  rerenderLane({ keepHeld: true });
  writeBannerOffset(0);
  showFeedTabs();
}

function clearProfileFilter() {
  if (!profileFilter && !profileView) {
    frame.classList.remove('is-profile-feed');
    hideProfileBanner();
    writeBannerOffset(0);
    return;
  }
  const saved = profileView;
  const shift = saved ? (feedTab === 'following' ? profileShift.following : profileShift.all) : 0;
  profileFilter = '';
  profileView = null;
  profileShift = { all: 0, following: 0 };
  frame.classList.remove('is-profile-feed');
  hideProfileBanner();
  writeBannerOffset(0);
  if (!saved) {
    if (feedFiltering()) syncFound();
    return;
  }
  if (searchPinned && !(saved.pinStart === 0 && saved.pinScroll < 2)) {
    pinStart += shift;
    pinEnd += shift;
  }
  if (feedFiltering()) {
    syncFound();
    showQueryResults();
    showFeedTabs();
    return;
  }
  const list = lane();
  const wasTop = saved.start === 0 && saved.scroll < 2;
  const start = wasTop ? 0 : Math.min(list.length, saved.start + shift);
  let end = wasTop ? Math.min(list.length, RENDER_CHUNK) : Math.min(list.length, Math.max(saved.end + shift, start));
  if (end < start) end = start;
  rangeStart = start;
  rangeEnd = start;
  clearViewWatch();
  column.replaceChildren();
  if (end > start) renderThrough(end);
  paintEmpty();
  setFeedScroll(wasTop ? 0 : saved.scroll);
  savedScroll = scroller.scrollTop;
  showFeedTabs();
  if (!followBlocked()) {
    fillDown();
    fillUp();
  }
  paintNewPill();
}

function backToProfileAccount() {
  if (!profilePayer) {
    hideProfilePage();
    clearProfileFilter();
    return;
  }
  showProfilePage();
  clearProfileFilter();
  profileBack.focus({ preventScroll: true, focusVisible: false });
}

let profileLoadBusy = false;

function connectedTopic(payer) {
  const topic = String(profileTopics[payer] || '').trim();
  return /^\d+\.\d+\.\d+$/.test(topic) ? topic : '';
}

function showLoadedProfileFeed(payer) {
  frame.classList.add('is-profile-feed');
  paintProfileBanner(payer);
  showProfileBanner();
  setFeedScroll(0);
  showFeedTabs();
  writeBannerOffset(0);
}

// Same Load as the toolbar button: handleAllMessages reads #input-field
// and fetches the topic. The feed then reads that field. No second loader.
async function loadProfilePosts() {
  const payer = profilePayer;
  if (!payer || profileLoadBusy) return;
  const topic = connectedTopic(payer);
  if (!topic) {
    toast.error('No topic connected');
    return;
  }
  const field = document.getElementById('input-field');
  if (!field) return;
  const epoch = profileEpoch;
  profileLoadBusy = true;
  profileLoad.disabled = true;
  profileLoad.textContent = 'Loading…';
  field.value = topic;
  let loaded = null;
  try {
    loaded = await handleAllMessages();
  } catch (error) {
    console.warn('profile topic load failed', error);
  } finally {
    profileLoadBusy = false;
    profileLoad.disabled = false;
    profileLoad.textContent = 'Load posts';
  }
  if (epoch !== profileEpoch || profilePayer !== payer) return;
  if (!loaded) {
    toast.error('Could not load topic');
    return;
  }
  // handleAllMessages already drew this topic on the map. Close the page
  // and stay there. The feed still switches into that topic's posts.
  if (!feedOn()) {
    // The loaded topic is the map. Drop the popup this profile was covering.
    // closeFeedProfile alone slides the drawer back; overlays also close
    // that drawer and its feedmenu history, so Back stays on the map.
    if (window.dismissBioPopups) window.dismissBioPopups();
    closeFeedOverlays();
    return;
  }
  // Peek opened this profile over a hidden map popup. Drop that popup and
  // the profile history entry. Back then leaves this topic's feed and does
  // not bring the popup or the peek back. A feed-card profile never set
  // the flag, so this block does not run for it.
  if (window.__profileCoversPopup) {
    if (window.dismissBioPopups) window.dismissBioPopups();
    window.__profileCoversPopup = false;
    if (window.layerClosedByUI && window.layerIsOpen && window.layerIsOpen('feedprofile')) {
      window.layerClosedByUI('feedprofile');
    }
  }
  ensureTopic(false);
  hideProfilePage();
  // My profile from the drawer keeps that menu underneath. Close the
  // profile entry first so the menu is the top history step, then the menu.
  if (drawerItem === 'My profile' || menu.dataset.cover === '1') {
    if (window.layerClosedByUI && window.layerIsOpen && window.layerIsOpen('feedprofile')) {
      window.layerClosedByUI('feedprofile');
    }
    closeMenu();
  }
  showLoadedProfileFeed(payer);
}

function closeFeedProfile() {
  dismissProfileEditCover();
  uncoverPopupUnderProfile();
  hideProfilePage();
  profilePayer = '';
  profileEpoch += 1;
  clearProfileFilter();
  if (window.layerClosedByUI && window.layerIsOpen && window.layerIsOpen('feedprofile')) {
    window.layerClosedByUI('feedprofile');
  }
  restoreDrawer();
}

function dismissFeedProfile() {
  dismissProfileEditCover();
  if (profilePage.hidden && !profileFilter && !bannerTracks() && !(window.layerIsOpen && window.layerIsOpen('feedprofile'))) return;
  uncoverPopupUnderProfile();
  hideProfilePage();
  profilePayer = '';
  profileEpoch += 1;
  clearProfileFilter();
  if (window.layerClosedByUI && window.layerIsOpen && window.layerIsOpen('feedprofile')) {
    window.layerClosedByUI('feedprofile');
  }
}

function openProfileEdit() {
  // Same shell as Toolbar → Edit profile (pushDrawer → hostDrawer). No row
  // click: that CloseALL would hide the profile and open the raw column.
  if (navBusy() || profilePage.hidden || !profilePayer) return;
  if (drawerStack.length) return;
  const column = document.getElementById('Edit_Profile-column');
  if (!column) return;
  const box = document.getElementById('Edit_Profile-column-container');
  if (box && box.style.display === 'none') box.style.display = 'block';
  profileEditScroll = profileBody.scrollTop;
  profileEditCover = true;
  pushDrawer('Edit_Profile-column');
  if (drawerStack[drawerStack.length - 1] !== 'Edit_Profile-column') profileEditCover = false;
}

bindPress(profileBack);
profileBack.addEventListener('click', (event) => {
  event.stopPropagation();
  closeFeedProfile();
});
bindPress(profileEdit);
profileEdit.addEventListener('click', (event) => {
  event.stopPropagation();
  openProfileEdit();
});
bindPress(profileLoad);
profileLoad.addEventListener('click', (event) => {
  event.stopPropagation();
  loadProfilePosts();
});
profileBanner.addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  backToProfileAccount();
});


function openTopicChat() {
  if (navBusy()) return;
  openFeedChat('topic', 'drawer');
}

function openE2ee() {
  // Unlock/read is local. Wallet only needed later to send / change wrap.
  // The chat entry sits on the drawer. The notice is not its own step.
  if (navBusy()) return;
  const fromDrawer = !!(window.layerIsTop && window.layerIsTop('feedmenu'));
  if (!fromDrawer) closeReplacedMenu();
  const open = () => openFeedChat('e2ee', fromDrawer ? 'drawer' : undefined);
  if (fromDrawer) {
    open();
    withE2eeWebNotice(() => {});
    return;
  }
  withE2eeWebNotice(open);
}

let zoomRange = null;
let zoomLevel = null;

function paintFeedZoom() {
  if (!zoomRange || !zoomLevel) return;
  const pct = Math.round(feedPrefs.zoom * 100);
  const fill = ((feedPrefs.zoom - FEED_ZOOM_MIN) / (FEED_ZOOM_MAX - FEED_ZOOM_MIN)) * 100;
  zoomRange.value = String(pct);
  if (!/\d/.test(zoomLevel.textContent || '')) zoomLevel.textContent = pct + '%';
  zoomLevel.textContent = formatSliderValue(zoomRange, pct);
  applySliderValueWidth(zoomRange, zoomLevel);
  zoomRange.setAttribute('aria-valuetext', pct + '%');
  zoomRange.style.setProperty('--feed-zoom-fill', fill.toFixed(2) + '%');
}

function applyFeedZoom() {
  const value = feedPrefs.zoom.toFixed(2);
  scroller.style.setProperty('--feed-zoom', value);
  root.style.removeProperty('--feed-zoom');
  document.documentElement.style.removeProperty('--feed-zoom');
  paintFeedZoom();
}

function setFeedZoom(next) {
  const zoom = clampFeedZoom(next);
  if (zoom === feedPrefs.zoom) return;
  feedPrefs.zoom = zoom;
  applyFeedZoom();
  measureTabHide();
}

// A drag emits many input events in one frame. Keep the latest percent
// and write --feed-zoom once on the next frame. localStorage waits for
// the range change event, which fires when the pointer is released.
let zoomFrame = 0;
let zoomHeld = null;

function flushFeedZoom() {
  zoomFrame = 0;
  const next = zoomHeld;
  zoomHeld = null;
  if (next == null) return;
  setFeedZoom(next);
}

function queueFeedZoom(next) {
  zoomHeld = next;
  if (zoomFrame) return;
  zoomFrame = requestAnimationFrame(flushFeedZoom);
}

function storeFeedZoom() {
  if (zoomFrame) {
    cancelAnimationFrame(zoomFrame);
    zoomFrame = 0;
  }
  if (zoomHeld != null) {
    const next = zoomHeld;
    zoomHeld = null;
    setFeedZoom(next);
  }
  writeFeedSetting(FEED_SETTING.zoom, feedPrefs.zoom.toFixed(2));
}

function applyFeedChrome() {
  applyFeedZoom();
  root.classList.remove('is-compact', 'is-loc-off');
  for (const card of viewIntersecting) wantPlace(card);
  paintNewPill();
  syncFeedVideos();
}

const settingsPaints = [];
const settings = document.createElement('div');
settings.id = 'feed-settings';
settings.hidden = true;
settings.setAttribute('role', 'dialog');
settings.setAttribute('aria-modal', 'true');
settings.setAttribute('aria-label', 'Settings');
const settingsBar = document.createElement('div');
settingsBar.className = 'feed-settings-bar';
const settingsBack = document.createElement('button');
settingsBack.type = 'button';
settingsBack.className = 'feed-settings-back';
settingsBack.setAttribute('aria-label', 'Back');
settingsBack.appendChild(svgIcon([
  ['path', { d: 'm12 19-7-7 7-7' }],
  ['path', { d: 'M19 12H5' }],
]));
const settingsTitle = document.createElement('h2');
settingsTitle.className = 'feed-settings-title';
settingsTitle.textContent = 'Settings';
settingsBar.append(settingsBack, settingsTitle);
const settingsBody = document.createElement('div');
settingsBody.className = 'feed-settings-body';

function settingsSection(title) {
  const section = document.createElement('section');
  section.className = 'feed-settings-section';
  const label = document.createElement('h3');
  label.className = 'feed-settings-label';
  label.textContent = title;
  section.appendChild(label);
  return section;
}

function settingsRadios(name, options, get, set) {
  const group = document.createElement('div');
  group.className = 'feed-settings-radios';
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', name);
  const buttons = [];
  const paint = () => {
    const value = get();
    for (const button of buttons) {
      const on = button.dataset.value === value;
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-checked', on ? 'true' : 'false');
    }
  };
  for (const option of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'feed-settings-choice';
    button.dataset.value = option.value;
    button.setAttribute('role', 'radio');
    button.textContent = option.label;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      if (get() === option.value) return;
      set(option.value);
      paint();
    });
    bindPress(button);
    buttons.push(button);
    group.appendChild(button);
  }
  paint();
  settingsPaints.push(paint);
  return group;
}

function settingsSwitch(label, get, set) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'feed-settings-switch';
  button.setAttribute('role', 'switch');
  const text = document.createElement('span');
  text.textContent = label;
  const ui = document.createElement('span');
  ui.className = 'feed-settings-switch-ui';
  ui.setAttribute('aria-hidden', 'true');
  button.append(text, ui);
  const paint = () => {
    const on = !!get();
    button.classList.toggle('is-on', on);
    button.setAttribute('aria-checked', on ? 'true' : 'false');
  };
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    set(!get());
    paint();
  });
  bindPress(button);
  paint();
  settingsPaints.push(paint);
  return button;
}

function settingsZoom() {
  const row = document.createElement('div');
  row.className = 'feed-settings-zoom';
  zoomRange = document.createElement('input');
  zoomRange.type = 'range';
  zoomRange.className = 'feed-settings-zoom-range';
  zoomRange.min = '50';
  zoomRange.max = '150';
  zoomRange.step = '1';
  zoomRange.value = String(Math.round(feedPrefs.zoom * 100));
  zoomRange.setAttribute('aria-label', 'Zoom');
  zoomLevel = document.createElement('span');
  zoomLevel.className = 'feed-settings-zoom-level';
  row.append(zoomRange, zoomLevel);
  zoomRange.addEventListener('input', () => {
    queueFeedZoom(Number(zoomRange.value) / 100);
  });
  zoomRange.addEventListener('change', storeFeedZoom);
  settingsPaints.push(paintFeedZoom);
  paintFeedZoom();
  return row;
}

const tabSection = settingsSection('Default tab');
tabSection.appendChild(settingsRadios('Default tab', [
  { value: 'all', label: 'All' },
  { value: 'following', label: 'Following' },
], () => feedPrefs.tab, (value) => {
  feedPrefs.tab = value;
  writeFeedSetting(FEED_SETTING.tab, value);
}));
const mediaSection = settingsSection('Media');
mediaSection.append(
  settingsSwitch('Autoplay videos', () => feedPrefs.autoplay, (on) => {
    feedPrefs.autoplay = on;
    writeFeedSetting(FEED_SETTING.autoplay, on ? 'on' : 'off');
    syncFeedVideos();
  }),
  settingsSwitch('Data saver', () => feedPrefs.dataSaver, (on) => {
    feedPrefs.dataSaver = on;
    writeFeedSetting(FEED_SETTING.data, on ? 'on' : 'off');
    syncFeedVideos();
  }),
  settingsSwitch('Show pictures full size', () => feedPrefs.picturesWide, (on) => {
    feedPrefs.picturesWide = on;
    writeFeedSetting(FEED_SETTING.picturesWide, on ? 'on' : 'off');
    resizeFeedPictures();
  }),
);

// Cards already built follow the switch; the card at the top of the feed
// stays where it is on screen while the ones around it change height.
function resizeFeedPictures() {
  const view = scroller.getBoundingClientRect();
  let anchor = null;
  if (view.height > 0) {
    for (const card of column.children) {
      const box = card.getBoundingClientRect();
      if (box.height > 0 && box.bottom > view.top + 1) {
        anchor = { card, top: box.top };
        break;
      }
    }
  }
  for (const media of root.querySelectorAll('.popup-media-card[data-picture]')) {
    const wide = pictureStartsWide(media.dataset.mediaKey || '');
    if (media.classList.contains('is-wide') === wide) continue;
    media.classList.toggle('is-wide', wide);
    if (typeof media._paintSize === 'function') media._paintSize();
  }
  if (anchor && anchor.card.isConnected) {
    const moved = anchor.card.getBoundingClientRect().top - anchor.top;
    if (Math.abs(moved) >= 1) setFeedScroll(scroller.scrollTop + moved);
  }
}
const zoomSection = settingsSection('Zoom');
zoomSection.appendChild(settingsZoom());
settingsBody.append(tabSection, mediaSection, zoomSection);
settings.append(settingsBar, settingsBody);
root.appendChild(settings);

const FEED_CHATS = {
  topic: {
    id: 'topic-chat-container',
    title: 'Topic chat',
    expand: expandTopicChat,
  },
  e2ee: {
    id: 'encrypted-chat-container',
    title: 'E2EE chat',
    expand: expandEncryptedChat,
  },
  load: {
    id: 'load-column',
    title: 'Load',
    expand: prepareLoadColumnForFeed,
  },
  draw: {
    id: 'draw-column',
    title: 'Draw',
    expand() {},
  },
};
// Chat Options (sliders), two rows. Drawn on the 24-unit grid's middle
// (rows at 8 and 16, knobs 6-10 and 14-18), like the search and key
// beside it; the old rows at 4 and 12 sat 4 units high.
const OPTIONS_ICON = [
  ['line', { x1: '21', x2: '14', y1: '8', y2: '8' }],
  ['line', { x1: '10', x2: '3', y1: '8', y2: '8' }],
  ['line', { x1: '21', x2: '12', y1: '16', y2: '16' }],
  ['line', { x1: '8', x2: '3', y1: '16', y2: '16' }],
  ['line', { x1: '14', x2: '14', y1: '6', y2: '10' }],
  ['line', { x1: '8', x2: '8', y1: '14', y2: '18' }],
];
const FEED_CHAT_ICONS = [
  ['go-to-top-msgs', [
    ['path', { d: 'm18 15-6-6-6 6' }],
  ]],
  ['go-to-bottom-msgs', [
    ['path', { d: 'm6 9 6 6 6-6' }],
  ]],
  ['go-to-top-msgs-encrypted-chat', [
    ['path', { d: 'm18 15-6-6-6 6' }],
  ]],
  ['go-to-bottom-msgs-encrypted-chat', [
    ['path', { d: 'm6 9 6 6 6-6' }],
  ]],
  ['show-options-from-topic-chat', OPTIONS_ICON],
  ['show-options-from-topic-chat-btn', OPTIONS_ICON],
  ['show-options-from-encrypted-chat', OPTIONS_ICON],
  ['show-options-from-encrypted-chat-btn', OPTIONS_ICON],
];

const feedChat = document.createElement('div');
feedChat.id = 'feed-chat';
feedChat.hidden = true;
feedChat.setAttribute('role', 'dialog');
feedChat.setAttribute('aria-modal', 'true');
feedChat.setAttribute('aria-label', 'Chat');
const feedChatBar = document.createElement('div');
feedChatBar.className = 'feed-chat-bar';
const feedChatBack = document.createElement('button');
feedChatBack.type = 'button';
feedChatBack.className = 'feed-chat-back';
feedChatBack.setAttribute('aria-label', 'Back');
feedChatBack.appendChild(svgIcon([
  ['path', { d: 'm12 19-7-7 7-7' }],
  ['path', { d: 'M19 12H5' }],
]));
const feedChatTitle = document.createElement('h2');
feedChatTitle.className = 'feed-chat-title';
feedChatTitle.textContent = 'Chat';
const feedChatActions = document.createElement('div');
feedChatActions.className = 'feed-chat-actions';
const feedChatSearch = document.createElement('button');
feedChatSearch.type = 'button';
feedChatSearch.className = 'feed-chat-icon';
feedChatSearch.setAttribute('aria-label', 'Search');
feedChatSearch.appendChild(svgIcon([
  ['circle', { cx: '11', cy: '11', r: '8' }],
  ['path', { d: 'm21 21-4.3-4.3' }],
]));
feedChatSearch.querySelector('svg').classList.add('feed-chat-glyph');
const feedChatUnlock = document.createElement('button');
feedChatUnlock.type = 'button';
feedChatUnlock.className = 'feed-chat-icon';
feedChatUnlock.hidden = true;
feedChatUnlock.setAttribute('aria-label', 'Unlock');
feedChatUnlock.appendChild(svgIcon([
  ['path', { d: 'M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z' }],
  ['circle', { cx: '16.5', cy: '7.5', r: '.5', fill: 'currentColor' }],
]));
feedChatUnlock.querySelector('svg').classList.add('feed-chat-glyph');
feedChatActions.append(feedChatSearch, feedChatUnlock);
feedChatBar.append(feedChatBack, feedChatTitle, feedChatActions);
const feedChatBody = document.createElement('div');
feedChatBody.className = 'feed-chat-body';
feedChat.append(feedChatBar, feedChatBody);
feedChat.addEventListener('click', (event) => event.stopPropagation());
feedChat.addEventListener('pointerdown', (event) => event.stopPropagation());
root.appendChild(feedChat);

// Page state as classes, for style.css. These were :has() rules with body
// and #feed-layout as their subjects. A :has() subject that high makes
// Chrome restyle everything under it on any style write below it, and
// MapLibre writes every marker's transform each frame: ~2,800 elements a
// frame with the feed's cards hidden underneath, so the map crawled while
// it was shown over the feed (and typing in a chat lagged).
//   #feed-layout.has-menu   the column menu is open inside the layout
//   #feed-layout.has-page   a full page covers it: profile, chat, settings
//   html.feed-load-open     the Load page is open (its help overlay)
//   html.feed-draw-open     the Draw page is open (its help overlay)
// Classes change only when a page opens or closes.
function syncShellFlags() {
  const chatOpen = !feedChat.hidden;
  root.classList.toggle('has-menu', !menu.hidden && root.contains(menu));
  root.classList.toggle('has-page', !profilePage.hidden || chatOpen || !settings.hidden);
  const shell = document.documentElement.classList;
  shell.toggle('feed-load-open', chatOpen && feedChat.classList.contains('is-load'));
  shell.toggle('feed-draw-open', chatOpen && feedChat.classList.contains('is-draw'));
}
{
  const watch = new MutationObserver(syncShellFlags);
  // The menu changes class whenever it moves between the layout and body.
  for (const el of [menu, profilePage, feedChat, settings]) {
    watch.observe(el, { attributes: true, attributeFilter: ['hidden', 'class'] });
  }
  syncShellFlags();
}

let feedChatKind = '';
let feedChatHome = null;
let feedChatLeaveGen = 0;
let feedChatWatch = null;
let drawTitleWatch = null;
let feedChatLive = false;
let feedChatPlaced = [];

// Topic and E2EE chat Options, a page of its own (mountChatOptions). tabs
// is the panel of Block / Time / From (and the E2EE key rows) buttons that
// cssLogic.js shows with the header Options button. Each card holds the
// nodes one of those tabs shows; style.css shows a card while any of them is.
const FEED_CHAT_OPTIONS = {
  topic: {
    tabs: 'options-from-topic-chat',
    cards: [
      ['Time range', ['time-from-topic-chat', 'time-from-topic-chat-filter']],
      ['Show messages from', [
        'load-load-from-users-label-from-topic-chat',
        'load-msgs-from-ids-from-topic-chat',
        'load-load-from-users-from-topic-chat',
      ]],
      ['Block users', [
        'load-block-from-users-label-from-topic-chat',
        'load-blocks-from-ids-from-topic-chat',
        'load-block-from-users-from-topic-chat',
      ]],
    ],
  },
  e2ee: {
    tabs: 'options-from-encrypted-chat',
    cards: [
      ['Public key', ['encrypted-chat-public-key', 'pin-public-key-from-encrypted-chat']],
      ['Password', [
        'encrypted-chat-change-password-key-label',
        'encrypted-chat-change-password-key',
        'encrypted-chat-new-password-key-label',
        'encrypted-chat-new-password-key',
        'change-password-encrypted-chat',
        'set-password-encrypted-chat',
      ]],
      ['Time range', ['time-from-encrypted-chat', 'time-from-encrypted-chat-filter']],
      ['Show messages from', [
        'load-load-from-users-label-from-encrypted-chat',
        'load-msgs-from-ids-from-encrypted-chat',
        'load-load-from-users-from-encrypted-chat',
      ]],
      ['Block users', [
        'load-block-from-users-label-from-encrypted-chat',
        'load-blocks-from-ids-from-encrypted-chat',
        'load-block-from-users-from-encrypted-chat',
      ]],
    ],
  },
};

function placeFeedNode(node, parent) {
  if (!node || !parent || node.parentNode === parent) return;
  feedChatPlaced.push({ node, parent: node.parentNode, next: node.nextSibling });
  parent.appendChild(node);
}

function unplaceFeedChat() {
  for (let i = feedChatPlaced.length - 1; i >= 0; i -= 1) {
    const spot = feedChatPlaced[i];
    if (!spot.parent) continue;
    if (spot.next && spot.next.parentNode === spot.parent) spot.parent.insertBefore(spot.node, spot.next);
    else spot.parent.appendChild(spot.node);
  }
  feedChatPlaced = [];
}

function primeFeedOptionPair(openId, closeId, panelId) {
  const open = document.getElementById(openId);
  const close = document.getElementById(closeId);
  const panel = document.getElementById(panelId);
  const shown = panel && panel.style.display !== 'none';
  if (open) open.style.display = shown ? 'none' : 'block';
  if (close) close.style.display = shown ? 'block' : 'none';
}

let loadOptionsWatch = null;

function loadOptionsShown() {
  const options = document.getElementById('options-from-load');
  return !!(options && options.style.display !== 'none');
}

// Options is the next level of the Load page. Same nav-cover helpers as
// the page itself: prep, off to the right, then slide in. Back slides it
// out onto Load.
function slideLoadOptions(open) {
  slideSubPage(feedChat.querySelector('.load-options-page'), open, 'load');
}

// A page over the chat page (Load Options, chat Options): in from the
// right while the chat slides a quarter left and dims, out the same way.
// After it leaves, focus goes back to the chat's Back when kind is still
// the open chat.
function slideSubPage(page, open, kind) {
  if (!page) {
    feedChat.classList.remove('is-nav-under');
    return;
  }
  if (open) {
    delete page.dataset.navLeaving;
    page.hidden = false;
    page.classList.add('nav-cover', 'nav-prep', 'nav-off');
    void page.offsetWidth;
    page.classList.remove('nav-prep');
    void page.offsetWidth;
    feedChat.classList.add('is-nav-under');
    page.classList.remove('nav-off');
    holdNav();
    const back = page.querySelector('.feed-chat-back');
    if (back) back.focus({ preventScroll: true, focusVisible: false });
    return;
  }
  if (page.hidden || page.dataset.navLeaving === '1') {
    page.hidden = true;
    feedChat.classList.remove('is-nav-under');
    return;
  }
  page.dataset.navLeaving = '1';
  pinMotion(page);
  page.classList.add('nav-off');
  feedChat.classList.remove('is-nav-under');
  void page.offsetWidth;
  releaseMotion(page);
  holdNav();
  afterNav(page, () => {
    if (page.dataset.navLeaving !== '1') return;
    page.hidden = true;
    page.classList.remove('nav-off', 'nav-prep', 'nav-cover');
    delete page.dataset.navLeaving;
    if (kind && feedChatKind === kind) feedChatBack.focus({ preventScroll: true, focusVisible: false });
  });
}

// Chat Options as a page. The tab panel and the section nodes move into it
// (placeFeedNode, so closing the chat puts them back). cssLogic.js still
// shows and hides all of them; the page follows the tab panel's display.
// Back on the page and history Back both press the header's close button,
// so cssLogic.js also resets the open section.
let chatOptionsWatch = null;
let chatOptionsOpenId = '';
let chatOptionsCloseId = '';

function mountChatOptions(kind, openId, closeId) {
  const spec = FEED_CHAT_OPTIONS[kind];
  const tabs = spec && document.getElementById(spec.tabs);
  if (!tabs) return;
  chatOptionsOpenId = openId;
  chatOptionsCloseId = closeId;
  // Left open on the map panel: the chat opens on the chat, not its options.
  if (tabs.style.display !== 'none') pressChatOptions(closeId);
  const page = document.createElement('div');
  page.className = 'chat-options-page';
  page.hidden = true;
  page.setAttribute('role', 'dialog');
  page.setAttribute('aria-label', 'Options');
  const bar = document.createElement('div');
  bar.className = 'feed-chat-bar';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'feed-chat-back';
  back.setAttribute('aria-label', 'Back');
  back.appendChild(svgIcon([
    ['path', { d: 'm12 19-7-7 7-7' }],
    ['path', { d: 'M19 12H5' }],
  ]));
  const title = document.createElement('h2');
  title.className = 'feed-chat-title';
  title.textContent = 'Options';
  bar.append(back, title, optionsHelp(kind === 'e2ee' ? 'e2ee-chat-options-help-overlay' : 'topic-chat-options-help-overlay'));
  const body = document.createElement('div');
  body.className = 'chat-options-body';
  placeFeedNode(tabs, body);
  for (const [label, ids] of spec.cards) {
    const card = document.createElement('section');
    card.className = 'chat-options-card';
    const head = document.createElement('h3');
    head.className = 'chat-options-card-title';
    head.textContent = label;
    card.appendChild(head);
    for (const id of ids) placeFeedNode(document.getElementById(id), card);
    body.appendChild(card);
  }
  page.append(bar, body);
  feedChat.appendChild(page);
  bindPress(back);
  back.addEventListener('click', (event) => {
    event.stopPropagation();
    pressChatOptions(chatOptionsCloseId);
  });
  if (chatOptionsWatch) chatOptionsWatch.disconnect();
  chatOptionsWatch = new MutationObserver(() => {
    slideChatOptions(tabs.style.display !== 'none');
  });
  chatOptionsWatch.observe(tabs, { attributes: true, attributeFilter: ['style'] });
}

// The ? on the right of an Options page bar (Load, topic chat, E2EE chat).
// It opens that page's help overlay from index.html; cssLogic.js gives the
// overlay its history layer, so Back closes it.
function optionsHelp(overlayId) {
  const actions = document.createElement('div');
  actions.className = 'feed-chat-actions';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'options-help-btn';
  btn.setAttribute('aria-label', 'Help');
  btn.title = 'Help';
  btn.textContent = '?';
  bindPress(btn);
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    const overlay = document.getElementById(overlayId);
    if (overlay) overlay.style.display = 'block';
  });
  actions.appendChild(btn);
  return actions;
}

function pressChatOptions(id) {
  const btn = id && document.getElementById(id);
  if (btn) btn.click();
}

function slideChatOptions(open) {
  const page = feedChat.querySelector('.chat-options-page');
  if (!page) return;
  const shown = !page.hidden && page.dataset.navLeaving !== '1';
  if (open === shown) return;
  slideSubPage(page, open, feedChatKind);
  if (open) {
    if (window.layerOpened) window.layerOpened('chatoptions');
  } else if (window.layerClosedByUI && window.layerIsOpen && window.layerIsOpen('chatoptions')) {
    window.layerClosedByUI('chatoptions');
  }
}

// The chat is going away with Options still up: give back the Options
// history entry first, so the chat's own entry is the top one it closes.
function dropChatOptionsLayer() {
  if (window.layerClosedByUI && window.layerIsOpen && window.layerIsOpen('chatoptions')) {
    window.layerClosedByUI('chatoptions');
  }
}

function clearChatOptions() {
  if (chatOptionsWatch) {
    chatOptionsWatch.disconnect();
    chatOptionsWatch = null;
  }
  const page = feedChat.querySelector('.chat-options-page');
  if (page) page.remove();
  feedChat.classList.remove('is-nav-under');
  chatOptionsOpenId = '';
  chatOptionsCloseId = '';
}

function mountLoadOptions() {
  if (feedChat.querySelector('.load-options-page')) return;
  const options = document.getElementById('options-from-load');
  const container = document.getElementById('load-column-container');
  if (!options || !container || options.parentNode !== container) return;
  const page = document.createElement('div');
  page.className = 'load-options-page';
  page.hidden = true;
  page.setAttribute('role', 'dialog');
  page.setAttribute('aria-label', 'Options');
  const bar = document.createElement('div');
  bar.className = 'feed-chat-bar';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'feed-chat-back';
  back.setAttribute('aria-label', 'Back');
  back.appendChild(svgIcon([
    ['path', { d: 'm12 19-7-7 7-7' }],
    ['path', { d: 'M19 12H5' }],
  ]));
  const title = document.createElement('h2');
  title.className = 'feed-chat-title';
  title.textContent = 'Options';
  bar.append(back, title, optionsHelp('load-filters-help-overlay'));
  const body = document.createElement('div');
  body.className = 'load-options-body';
  page.append(bar, body);
  let node = options;
  while (node && node.parentNode === container) {
    const next = node.nextSibling;
    placeFeedNode(node, body);
    node = next;
  }
  feedChat.appendChild(page);
  bindPress(back);
  back.addEventListener('click', (event) => {
    event.stopPropagation();
    const hide = document.getElementById('hide-options-from-load');
    if (hide) hide.click();
  });
  if (loadOptionsWatch) loadOptionsWatch.disconnect();
  loadOptionsWatch = new MutationObserver(() => {
    if (feedChatKind !== 'load') return;
    slideLoadOptions(loadOptionsShown());
  });
  loadOptionsWatch.observe(options, { attributes: true, attributeFilter: ['style'] });
}

function clearLoadOptions() {
  if (loadOptionsWatch) {
    loadOptionsWatch.disconnect();
    loadOptionsWatch = null;
  }
  feedChat.classList.remove('is-nav-under');
  const page = feedChat.querySelector('.load-options-page');
  if (page) page.remove();
}

function syncDrawHeader() {
  if (feedChatKind !== 'draw') return;
  // Marker and Polygon change their own buttons. The header stays "Draw".
  feedChatTitle.textContent = 'Draw';
  feedChat.setAttribute('aria-label', 'Draw');
}

function watchDrawHeader() {
  const node = document.getElementById('draw-column-title');
  if (drawTitleWatch) drawTitleWatch.disconnect();
  drawTitleWatch = null;
  if (!node) return;
  drawTitleWatch = new MutationObserver(syncDrawHeader);
  drawTitleWatch.observe(node, { childList: true, characterData: true, subtree: true });
  syncDrawHeader();
}

function clearDrawHeader() {
  if (!drawTitleWatch) return;
  drawTitleWatch.disconnect();
  drawTitleWatch = null;
}

function clearFeedMessenger(panel) {
  // A fullscreen composer goes back to its row with the page.
  collapseComposers();
  unplaceFeedChat();
  clearLoadOptions();
  clearChatOptions();
  clearDrawHeader();
  feedChatSearch.classList.remove('is-on');
  feedChatSearch.hidden = false;
  feedChatSearch.setAttribute('aria-pressed', 'false');
  feedChatUnlock.classList.remove('is-on');
  feedChatUnlock.hidden = true;
  if (!panel) return;
  panel.classList.remove('is-search', 'is-locked');
  panel.querySelectorAll('.feed-chat-room').forEach((el) => el.classList.remove('feed-chat-room'));
  panel.querySelectorAll('.feed-chat-compose').forEach((el) => el.classList.remove('feed-chat-compose'));
  panel.querySelectorAll('.feed-chat-gate').forEach((el) => {
    const parent = el.parentNode;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    el.remove();
  });
}

function mountFeedMessenger(panel, kind) {
  if (kind === 'load') {
    feedChatSearch.hidden = true;
    feedChatUnlock.hidden = true;
    feedChatUnlock.classList.remove('is-on');
    const box = document.getElementById('load-column-container');
    if (box) box.style.display = 'block';
    placeFeedNode(document.getElementById('help-load-column'), feedChatActions);
    mountLoadOptions();
    return;
  }
  if (kind === 'draw') {
    feedChatSearch.hidden = true;
    feedChatUnlock.hidden = true;
    feedChatUnlock.classList.remove('is-on');
    const box = document.getElementById('draw-column-container');
    if (box) box.style.display = 'block';
    placeFeedNode(document.getElementById('help-draw-column'), feedChatActions);
    watchDrawHeader();
    return;
  }
  feedChatSearch.hidden = false;
  if (feedChat.querySelector('.chat-options-page')) return;
  const inner = panel.querySelector('.chat-topic-chat-container');
  if (!inner) return;
  const topic = document.getElementById(kind === 'e2ee' ? 'encrypted-chat-topic-id' : 'topic-chat-topic-id');
  if (topic && topic.parentElement) topic.parentElement.classList.add('feed-chat-room');
  const field = document.getElementById(kind === 'e2ee' ? 'user-write-message-encrypted-chat' : 'user-write-message');
  const compose = field && field.closest('.chat-compose');
  if (compose) compose.classList.add('feed-chat-compose');
  const openId = kind === 'e2ee' ? 'show-options-from-encrypted-chat' : 'show-options-from-topic-chat';
  const closeId = kind === 'e2ee' ? 'show-options-from-encrypted-chat-btn' : 'show-options-from-topic-chat-btn';
  const optionsId = kind === 'e2ee' ? 'options-from-encrypted-chat' : 'options-from-topic-chat';
  primeFeedOptionPair(openId, closeId, optionsId);
  placeFeedNode(document.getElementById(openId), feedChatActions);
  placeFeedNode(document.getElementById(closeId), feedChatActions);
  mountChatOptions(kind, openId, closeId);
  feedChatUnlock.hidden = kind !== 'e2ee';
  if (kind !== 'e2ee') return;
  // Unlock field under the header (with gap), not a centered gate.
  const keyBox = document.getElementById('encrypted-chat-private-key-container');
  const topicRow = topic && topic.parentElement;
  if (keyBox && topicRow && topicRow.parentNode) {
    topicRow.parentNode.insertBefore(keyBox, topicRow);
    if (!feedChatPlaced.some((spot) => spot.node === keyBox)) {
      feedChatPlaced.push({ node: keyBox, parent: keyBox.parentNode, next: keyBox.nextSibling });
    }
  }
  // Drop an inline display from the map panel so the feed lock class owns it.
  if (keyBox) keyBox.style.display = '';
  const key = document.getElementById('encrypted-chat-private-key');
  const locked = !key || !key.value.trim();
  panel.classList.toggle('is-locked', locked);
  feedChatUnlock.classList.toggle('is-on', locked);
  feedChatUnlock.setAttribute('aria-pressed', locked ? 'true' : 'false');
}

function dressFeedChatIcons(on) {
  for (const [id, icon] of FEED_CHAT_ICONS) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    const old = btn.querySelector('svg.feed-chat-glyph');
    if (old) old.remove();
    if (!on) continue;
    const glyph = svgIcon(icon);
    glyph.classList.add('feed-chat-glyph');
    btn.appendChild(glyph);
  }
}

const feedScrollHeight = new WeakMap();

function feedChatScrollers(panel) {
  if (!panel) return [];
  return [...panel.querySelectorAll('#messages-from-topic-chat, #messages-from-encrypted-chat, #load-column-container, #loaded-topics, #marker-column-container, #polygon-column-container')];
}

// Inside the feed shell the lists take the shell's height, not the one the
// map panel set; it comes back when the panel goes home.
function pauseFeedChatScroll(panel) {
  for (const list of feedChatScrollers(panel)) {
    feedScrollHeight.set(list, list.style.height || '');
    if (list.style.height) list.style.height = '';
  }
}

function resumeFeedChatScroll(panel) {
  for (const list of feedChatScrollers(panel)) {
    if (!feedScrollHeight.has(list)) continue;
    list.style.height = feedScrollHeight.get(list);
    feedScrollHeight.delete(list);
  }
}

function restoreFeedChat() {
  if (!feedChatHome) return;
  const home = feedChatHome;
  feedChatHome = null;
  const panel = document.getElementById(home.id);
  if (panel) clearFeedMessenger(panel);
  else clearFeedMessenger(null);
  if (!panel) return;
  panel.classList.remove('is-feed-shell');
  resumeFeedChatScroll(panel);
  // The map Load watcher treats any display other than none as its own
  // history entry. The drawer watcher would also host the column as a
  // Toolbar child. Closing the page puts the column away. One write, so
  // the hold flags cover that single change.
  if (panel.id === 'load-column' || panel.id === 'draw-column') {
    panel.dataset.historyHold = '1';
    panel.dataset.drawerSkip = '1';
    const kept = (home.style || '').split(';').map((part) => part.trim()).filter((part) => part && !/^display\s*:/i.test(part));
    kept.push('display: none');
    panel.setAttribute('style', kept.join('; '));
    queueMicrotask(() => {
      if (panel.dataset.drawerSkip === '1') delete panel.dataset.drawerSkip;
    });
  } else if (home.style == null) panel.removeAttribute('style');
  else panel.setAttribute('style', home.style);
  if (home.parent) home.parent.insertBefore(panel, home.next);
}

function parkFeedChat(kind) {
  const spec = FEED_CHATS[kind];
  const panel = document.getElementById(spec.id);
  if (!panel) return;
  if (panel.parentNode !== feedChatBody) {
    feedChatHome = {
      id: spec.id,
      parent: panel.parentNode,
      next: panel.nextSibling,
      style: panel.getAttribute('style'),
    };
    feedChatBody.appendChild(panel);
  }
  if (kind === 'draw') panel.classList.remove('is-feed-shell');
  else panel.classList.add('is-feed-shell');
  pauseFeedChatScroll(panel);
  panel.classList.remove('topic-chat-compact', 'topic-chat-fit', 'topic-chat-capped', 'is-search');
  feedChatSearch.classList.remove('is-on');
  feedChatSearch.setAttribute('aria-pressed', 'false');
  mountFeedMessenger(panel, kind);
  if (kind === 'load' || kind === 'draw') panel.dataset.historyHold = '1';
  panel.style.display = 'flex';
  if (feedChatWatch) feedChatWatch.disconnect();
  feedChatWatch = new MutationObserver(() => {
    if (!feedChatLive) return;
    if (panel.style.display === 'none') closeFeedChat();
  });
  feedChatWatch.observe(panel, { attributes: true, attributeFilter: ['style'] });
  requestAnimationFrame(() => {
    if (feedChatKind !== kind) return;
    spec.expand();
  });
}

// The chat page lives in the feed column. On the map the column is
// hidden, so the same page is fixed on the body and slides over the drawer.
function placeFeedChatForMap(on) {
  if (!on) {
    feedChat.classList.remove('is-map-chat');
    if (feedChat.parentNode !== root) root.appendChild(feedChat);
    return;
  }
  if (feedChat.parentNode !== document.body) document.body.appendChild(feedChat);
  feedChat.classList.add('is-map-chat');
}

// Open and close clear a leftover inline frame. A live keyboard pin owns
// top, height, and bottom until blur, so this must not strip it.
function fitFeedChatFrame() {
  if (feedChat.dataset.kbPin === '1') return;
  feedChat.style.removeProperty('top');
  feedChat.style.removeProperty('height');
  feedChat.style.removeProperty('bottom');
}

function paintFeedChat(kind) {
  const spec = FEED_CHATS[kind];
  feedChatLeaveGen += 1;
  if (!spec) {
    hideFeedChatPanel();
    return;
  }
  if (feedChatKind && feedChatKind !== kind) {
    feedChatLive = false;
    if (feedChatWatch) {
      feedChatWatch.disconnect();
      feedChatWatch = null;
    }
    restoreFeedChat();
  }
  const keepDraw = kind === 'draw' && feedChatKind === 'draw' && !feedChat.hidden && feedChat.classList.contains('nav-cover');
  feedChatKind = kind;
  feedChatLive = true;
  feedChat.classList.toggle('is-load', kind === 'load');
  feedChat.classList.toggle('is-draw', kind === 'draw');
  feedChatTitle.textContent = spec.title;
  feedChat.setAttribute('aria-label', spec.title);
  placeFeedChatForMap(!feedCovers());
  if (!beginFeedCover(feedChat)) {
    if (kind === 'draw' && !keepDraw) {
      // Map and feed open this page with the drawer closed, or the feed
      // peeked. Same push as the chat page, without shifting a closed drawer.
      delete feedChat.dataset.navLeaving;
      feedChat.classList.add('nav-cover', 'nav-prep', 'nav-off');
      feedChat.hidden = false;
      void feedChat.offsetWidth;
      feedChat.classList.remove('nav-prep');
      void feedChat.offsetWidth;
      feedChat.classList.remove('nav-off');
      holdNav();
    } else if (!keepDraw) {
      delete feedChat.dataset.navLeaving;
      feedChat.classList.remove('nav-off', 'nav-prep', 'nav-cover');
      feedChat.hidden = false;
    }
  }
  dressFeedChatIcons(true);
  parkFeedChat(kind);
  fitFeedChatFrame();
  feedChatBack.focus({ preventScroll: true, focusVisible: false });
}

function hideE2eeWebNotice() {
  const overlay = document.getElementById('e2ee-web-notice-overlay');
  if (overlay) overlay.style.display = 'none';
}

function hideFeedChatPanel() {
  dropChatOptionsLayer();
  hideE2eeWebNotice();
  feedChat.classList.remove('is-nav-under');
  feedChatLive = false;
  if (feedChatWatch) {
    feedChatWatch.disconnect();
    feedChatWatch = null;
  }
  const leaveGen = ++feedChatLeaveGen;
  const covered = feedChat.classList.contains('nav-cover');
  // Draw from the feed's + sits over a peeked feed. Bring the feed back
  // under it now, so Back slides the page off onto the feed. Waiting for
  // returnToFeed (after the slide, when the draw column is put away)
  // showed the map first and then popped the feed back in. That cleanup
  // still runs then; reveal() again there is harmless.
  if (feedChatKind === 'draw' && placing && peek && feedOn()) reveal();
  concealCover(feedChat);
  const releaseChat = () => {
    if (leaveGen !== feedChatLeaveGen) return;
    restoreFeedChat();
    placeFeedChatForMap(false);
    fitFeedChatFrame();
    feedChat.classList.remove('is-load', 'is-draw');
  };
  if (!covered) releaseChat();
  else afterNav(feedChat, releaseChat);
  dressFeedChatIcons(false);
  feedChatKind = '';
}

function closeFeedChat() {
  // The fullscreen composer's history entry sits on the chat's; drop it first.
  collapseComposers();
  if (typeof window.closeTopicChatEdit === 'function') window.closeTopicChatEdit();
  if (typeof window.closeE2eeChatEdit === 'function') window.closeE2eeChatEdit();
  if (feedChatKind === 'load' && loadOptionsShown()) {
    if (loadOptionsWatch) {
      loadOptionsWatch.disconnect();
      loadOptionsWatch = null;
    }
    const hide = document.getElementById('hide-options-from-load');
    if (hide) hide.click();
  }
  hideFeedChatPanel();
  if (window.layerClosedByUI && window.layerIsOpen && window.layerIsOpen('feedchat')) {
    window.layerClosedByUI('feedchat');
  }
  restoreDrawer();
}

// Toolbar Load owns this shell through the feedchat layer. A profile tap
// does not, so Back on that open is the userbio layer instead.
function loadPageOwnedByChat() {
  return feedChatKind === 'load' && !feedChat.hidden
    && !!(window.layerIsOpen && window.layerIsOpen('feedchat'));
}

function hideLoadShellForBio() {
  if (feedChatKind !== 'load' || feedChat.hidden) return;
  hideFeedChatPanel();
}
window.loadPageOwnedByChat = loadPageOwnedByChat;
window.hideLoadShellForBio = hideLoadShellForBio;

// Marker / polygon create. One page for the drawer Draw row, the feed +,
// and a map tap. The drawer keeps the Toolbar page underneath.
function openDrawPage(source) {
  const fromDrawer = source === 'drawer';
  if (fromDrawer && !coverFromDrawerPage()) return false;
  paintFeedChat('draw');
  if (window.layerOpened) {
    window.layerOpened('feedchat', fromDrawer ? drawerState({ kind: 'draw' }) : { kind: 'draw', source: source || 'map' });
  }
  return feedChatKind === 'draw' && !feedChat.hidden;
}
window.openDrawPage = openDrawPage;

function openFeedChat(kind, source) {
  if (root.classList.contains('is-peek')) return;
  if (!FEED_CHATS[kind]) return;
  // The map drawer opens this same page. The feed column stays hidden.
  const onMap = !feedCovers();
  if (!onMap && !feedOn()) return;
  const item = kind === 'e2ee' ? 'E2EE chat' : kind === 'topic' ? 'Topic chat' : '';
  if (source === 'drawer' && kind === 'load' && coverFromDrawerPage()) {
    paintFeedChat(kind);
    if (window.layerOpened) window.layerOpened('feedchat', drawerState({ kind }));
    return;
  }
  if (source === 'drawer' && item && coverFromDrawer(item)) {
    paintFeedChat(kind);
    if (window.layerOpened) window.layerOpened('feedchat', drawerState({ kind }));
    return;
  }
  if (onMap) return;
  openOverFeed(() => {
    paintFeedChat(kind);
    if (window.layerOpened) window.layerOpened('feedchat', { kind });
  });
}

bindPress(feedChatBack);
feedChatBack.addEventListener('click', (event) => {
  event.stopPropagation();
  if (feedChatKind === 'load' && loadOptionsShown()) {
    const hide = document.getElementById('hide-options-from-load');
    if (hide) hide.click();
    return;
  }
  if (window.layerIsTop && window.layerIsTop('userbio') && typeof window.closeUserBio === 'function') {
    window.closeUserBio();
    return;
  }
  closeFeedChat();
});

feedChatSearch.addEventListener('click', (event) => {
  event.stopPropagation();
  const panel = feedChatBody.querySelector('.is-feed-shell');
  if (!panel) return;
  panel.classList.toggle('is-search');
  const on = panel.classList.contains('is-search');
  feedChatSearch.classList.toggle('is-on', on);
  feedChatSearch.setAttribute('aria-pressed', on ? 'true' : 'false');
  if (!on) return;
  const input = panel.querySelector('.loaded-topics-search');
  if (input) input.focus();
});

feedChatUnlock.addEventListener('click', (event) => {
  event.stopPropagation();
  const panel = document.getElementById('encrypted-chat-container');
  if (!panel || !panel.classList.contains('is-feed-shell')) return;
  const keyBox = document.getElementById('encrypted-chat-private-key-container');
  const key = document.getElementById('encrypted-chat-private-key');
  if (!keyBox || !key) return;
  keyBox.style.display = '';
  const show = !panel.classList.contains('is-locked');
  panel.classList.toggle('is-locked', show);
  feedChatUnlock.classList.toggle('is-on', show);
  feedChatUnlock.setAttribute('aria-pressed', show ? 'true' : 'false');
  if (show) key.focus();
});

document.getElementById('load-msgs-from-encrypted-chat').addEventListener('click', () => {
  if (!feedChatLive) return;
  const key = document.getElementById('encrypted-chat-private-key');
  const keyBox = document.getElementById('encrypted-chat-private-key-container');
  const panel = document.getElementById('encrypted-chat-container');
  if (!panel || !key || !key.value.trim()) return;
  panel.classList.remove('is-locked');
  if (keyBox) keyBox.style.display = '';
  feedChatUnlock.classList.remove('is-on');
  feedChatUnlock.setAttribute('aria-pressed', 'false');
});

function paintFeedSettings(open) {
  settingsOpen = open;
  if (open) {
    if (!beginFeedCover(settings)) {
      delete settings.dataset.navLeaving;
      settings.classList.remove('nav-off', 'nav-prep', 'nav-cover');
      settings.hidden = false;
    }
    for (const paint of settingsPaints) paint();
    settingsBack.focus({ preventScroll: true, focusVisible: false });
  } else {
    concealCover(settings);
  }
  syncFeedVideos();
}

function closeFeedSettings() {
  paintFeedSettings(false);
  if (window.layerClosedByUI && window.layerIsOpen && window.layerIsOpen('feedsettings')) {
    window.layerClosedByUI('feedsettings');
  }
  restoreDrawer();
}

function openFeedSettings() {
  if (!feedOn() || root.classList.contains('is-peek')) return;
  if (coverFromDrawer('Settings')) {
    paintFeedSettings(true);
    if (window.layerOpened) window.layerOpened('feedsettings', drawerState());
    return;
  }
  openOverFeed(() => {
    paintFeedSettings(true);
    if (window.layerOpened) window.layerOpened('feedsettings');
  });
}

function openDisconnect() {
  openOverFeed(() => clickId('disconnect-wallet-btn'));
}

// The parked Wallet button reveals Connect. Connect's own handler opens
// the sheet. The drawer closes first so it does not sit under the sheet.
// paintMenuRows swaps this row for the account and Disconnect when the id
// lands. A second tap is ignored only while the sheet is open or this watch
// is running. A leftover "Connecting..." label is not a second tap.
let drawerConnectWatch = 0;
function endDrawerConnect(watchId, failed) {
  if (watchId !== drawerConnectWatch) return;
  drawerConnectWatch = 0;
  if (walletNow()) return;
  updateUI();
  if (failed) toast.info("Couldn't open the wallet");
}
function openDrawerConnect() {
  if (walletModalOpen() || drawerConnectWatch) return;
  closeMenu();
  const watchId = ++drawerConnectWatch;
  clickId('wallet-wallet-btn');
  clickId('connect-wallet-btn');
  const started = Date.now();
  let sawSheet = walletModalOpen();
  let closedAt = 0;
  const watch = () => {
    if (watchId !== drawerConnectWatch) return;
    if (walletNow()) {
      drawerConnectWatch = 0;
      return;
    }
    const open = walletModalOpen();
    const connecting = connectPending();
    if (open) {
      sawSheet = true;
      closedAt = 0;
    } else if (sawSheet && !closedAt) {
      closedAt = Date.now();
    }
    // Same endings as ensureWallet. A sheet that has stayed closed ~1.5s
    // is done even while the label still says "Connecting...".
    if (sawSheet && !open && !connecting) {
      endDrawerConnect(watchId, false);
      return;
    }
    if (sawSheet && !open && closedAt && Date.now() - closedAt >= 1500) {
      endDrawerConnect(watchId, false);
      return;
    }
    if (!sawSheet && !open && !connecting && Date.now() - started >= 4000) {
      endDrawerConnect(watchId, true);
      return;
    }
    if (Date.now() - started >= 90000) {
      endDrawerConnect(watchId, true);
      return;
    }
    setTimeout(watch, 200);
  };
  setTimeout(watch, 200);
}

// A later open or close bumps this so a finishing slide cannot hide
// the drawer the user just reopened.
let menuToken = 0;
let drawerItem = '';
let suppressDrawerRestore = false;
let drawerStack = [];
let drawerPageToken = 0;
let drawerRenderLock = false;
let drawerPage = null;
let drawerPageBody = null;
let drawerPageTitle = null;
let drawerPageBack = null;
const drawerHosted = new Map();
const drawerShells = [];
let navGen = 0;
let backWatch = 0;
let drawerSyncQueued = false;
let drawerSyncAnimate = false;

function motionOff() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function markMenuItem(label) {
  const buttons = menu.querySelectorAll(':scope > li > .feed-menu-item');
  for (const button of buttons) {
    // Search, Locate me and Reset north run once. They are never the open page.
    const on = !!label && button.dataset.shot !== '1' && button.dataset.item === label;
    button.classList.toggle('is-current', on);
    if (on) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
}

function drawerState(data) {
  return Object.assign({ from: 'drawer', item: drawerItem }, data || {});
}

function carryingDrawer() {
  return !!(drawerItem && window.layerIsOpen && window.layerIsOpen('feedmenu')
    && (!window.layerIsTop || !window.layerIsTop('feedmenu')));
}

function closeReplacedMenu() {
  if (carryingDrawer()) return;
  closeMenu();
}

function keepDrawer(item) {
  if (!window.layerIsTop || !window.layerIsTop('feedmenu')) return false;
  holdScroll();
  drawerItem = item;
  paintMenu(false);
  if (window.layerOpened) window.layerOpened('feedmenu', { item: item });
  return true;
}

function restoreDrawer() {
  if (suppressDrawerRestore || !drawerItem) return;
  if (!window.layerIsTop || !window.layerIsTop('feedmenu')) return;
  if (!feedCovers() && !menu.classList.contains('is-map-drawer')) return;
  const shifted = menu.classList.contains('is-nav-back');
  menu.classList.remove('is-nav-back');
  delete menu.dataset.cover;
  if (menu.hidden || !menu.classList.contains('is-open')) paintMenu(true);
  else markMenuItem(drawerItem);
  if (shifted) holdNav();
}

// A page opened from the drawer stays on top of it. The drawer shifts
// left and dims; it does not play its close slide.
function coverFromDrawer(item) {
  if (!window.layerIsTop || !window.layerIsTop('feedmenu')) return false;
  if (navBusy()) return false;
  holdScroll();
  drawerItem = item;
  menu.dataset.cover = '1';
  if (window.layerOpened) window.layerOpened('feedmenu', { item: item });
  return true;
}

// Load opens on top of a drawer page (Toolbar), not the root drawer list.
// The page underneath stays put. Back slides out onto that same page.
function coverFromDrawerPage() {
  if (navBusy()) return false;
  if (!drawerStack.length) return false;
  const name = drawerPageName(drawerStack.length);
  if (window.layerIsTop && !window.layerIsTop(name)) return false;
  holdScroll();
  menu.dataset.cover = '1';
  return true;
}

function beginFeedCover(el) {
  if (!el || menu.dataset.cover !== '1') return false;
  delete menu.dataset.cover;
  delete el.dataset.navLeaving;
  el.classList.add('nav-cover', 'nav-prep', 'nav-off');
  el.hidden = false;
  menu.classList.add('is-nav-back');
  void el.offsetWidth;
  el.classList.remove('nav-prep');
  void el.offsetWidth;
  el.classList.remove('nav-off');
  holdNav();
  return true;
}

function concealCover(el) {
  if (!el || el.dataset.navLeaving === '1') return;
  if (!el.classList.contains('nav-cover')) {
    el.hidden = true;
    return;
  }
  el.dataset.navLeaving = '1';
  pinMotion(el);
  el.classList.add('nav-off');
  menu.classList.remove('is-nav-back');
  void el.offsetWidth;
  releaseMotion(el);
  holdNav();
  afterNav(el, () => {
    if (el.dataset.navLeaving !== '1') return;
    el.hidden = true;
    el.classList.remove('nav-off', 'nav-prep', 'nav-cover');
    delete el.dataset.navLeaving;
  });
}

function hideKeptDrawer(state, fallback) {
  if (!state || state.from !== 'drawer') return;
  drawerItem = state.item || fallback || drawerItem;
  paintMenu(false);
}

function paintMenu(open) {
  menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  mapMenuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) paintMenuRows();
  if (open && !menu.hidden && menu.classList.contains('is-open')) return;
  const token = ++menuToken;
  if (open) {
    menu.hidden = false;
    menuDim.hidden = false;
    if (motionOff()) {
      menu.classList.add('is-prep');
      menu.classList.add('is-open');
      menuDim.classList.add('is-open');
      void menu.offsetWidth;
      menu.classList.remove('is-prep');
      return;
    }
    menu.classList.remove('is-open');
    menuDim.classList.remove('is-open');
    void menu.offsetWidth;
    if (token !== menuToken) return;
    menu.classList.add('is-open');
    menuDim.classList.add('is-open');
    return;
  }
  markMenuItem('');
  if (menu.classList.contains('is-nav-back') || menu.classList.contains('is-nav-under')) {
    menu.classList.add('is-prep');
    menu.classList.remove('is-nav-back', 'is-nav-under');
    void menu.offsetWidth;
    menu.classList.remove('is-prep');
  }
  menu.classList.remove('is-open');
  menuDim.classList.remove('is-open');
  const finish = () => {
    if (token !== menuToken) return;
    menu.hidden = true;
    menuDim.hidden = true;
  };
  if (motionOff() || menu.hidden) {
    finish();
    return;
  }
  let settled = false;
  const end = () => {
    if (settled) return;
    settled = true;
    menu.removeEventListener('transitionend', onEnd);
    finish();
  };
  const onEnd = (event) => {
    if (event.target !== menu || event.propertyName !== 'transform') return;
    end();
  };
  menu.addEventListener('transitionend', onEnd);
  setTimeout(end, 280);
}

// Hides the drawer and, when this gesture closed it, drops its history
// entry. A phone Back already popped that entry, so the history call
// no-ops and the feed stays.
function closeMenu() {
  dropDrawerHistory();
  drawerItem = '';
  paintMenu(false);
  if (window.layerClosedByUI && window.layerIsOpen && window.layerIsOpen('feedmenu')) {
    window.layerClosedByUI('feedmenu');
  }
}

function layerOpen(name) {
  return !!(window.layerIsOpen && window.layerIsOpen(name));
}

// Pages that restore the drawer close first, then the drawer itself.
function closeFeedOverlays() {
  if (!profilePage.hidden || layerOpen('feedprofile')) closeFeedProfile();
  if (feedChatKind || !feedChat.hidden || layerOpen('feedchat')) closeFeedChat();
  if (settingsOpen || layerOpen('feedsettings')) closeFeedSettings();
  if (!menu.hidden || menu.classList.contains('is-open') || menu.classList.contains('is-nav-back') || layerOpen('feedmenu')) {
    closeMenu();
  }
}
window.closeFeedOverlays = closeFeedOverlays;

function openMenu() {
  if (window.layerIsTop && !window.layerIsTop('feed')) return;
  placeMenuForMap(false);
  paintMenu(true);
  if (window.layerOpened) window.layerOpened('feedmenu');
}

// The drawer node lives in the feed column. On the map it is fixed on
// the page, with the map's own rows, and moves back when the feed opens.
function placeMenuForMap(on) {
  if (on) {
    if (menu.parentNode !== document.body) document.body.append(menuDim, menu);
    menu.classList.add('is-map-drawer');
    menuDim.classList.add('is-map-drawer');
  } else {
    menu.classList.remove('is-map-drawer');
    menuDim.classList.remove('is-map-drawer');
    if (menu.parentNode !== frame) frame.append(menuDim, menu);
  }
  paintMenuRows();
}

function openMapMenu() {
  if (feedCovers()) return;
  placeMenuForMap(true);
  paintMenu(true);
  if (window.layerOpened) window.layerOpened('feedmenu');
}
// The place search (search.js) opens the drawer again on its way back
// when the drawer's Search opened it.
window.openMapDrawer = openMapMenu;

// Map tools leave the drawer. The original control still does the work.
// Search skips its own CloseALL: that call commits the drawer's pending
// back and the bar disappears in the same turn.
function runMapControl(selector) {
  const el = document.querySelector(selector);
  if (selector === '#search-toggle-btn' && el) {
    CloseALL();
    closeMenu();
    el.dataset.fromDrawer = '1';
    el.click();
    return;
  }
  closeMenu();
  if (el) el.click();
}

function openMapOptions() {
  if (window.layerIsTop && window.layerIsTop('feedmenu')) keepDrawer('Settings');
  const button = document.getElementById('main-toggle-btn');
  if (button) button.click();
}



function goToFeed() {
  dropDrawerHistory();
  drawerItem = '';
  paintMenu(false);
  if (window.layerClosedByUI && window.layerIsOpen && window.layerIsOpen('feedmenu')) {
    window.layerClosedByUI('feedmenu');
  }
  applyFeed(true);
}

function backToMap() {
  // The menu sits on the feed. Two steps land where one phone Back
  // lands when the menu is shut: the feed closes and the map returns.
  if (window.layerIsTop && window.layerIsTop('feedmenu')) {
    history.go(-2);
    return;
  }
  if (window.layerIsOpen && window.layerIsOpen('feed')) history.back();
}

// One order for both drawers. A feed/map object is the same slot with a
// per-view label, icon, or action. tools are that view's extras; an
// empty list hides the group and its divider.
const DRAWER_ORDER = [
  {
    label: { feed: 'Back to map', map: 'Go to feed' },
    icon: { feed: GLOBE_ICON, map: ROWS_ICON },
    run: { feed: backToMap, map: goToFeed },
  },
  { label: 'My profile', icon: USER_ICON, run: openOwnProfile, wallet: 'on' },
  { label: 'Topic chat', icon: CHAT_ICON, run: openTopicChat },
  { label: 'E2EE chat', icon: LOCK_ICON, run: openE2ee },
  { label: 'Settings', icon: SETTINGS_ICON, run: { feed: openFeedSettings, map: () => openDrawerPanel('rotation-controls') } },
  { label: 'Visibility', icon: EYE_ICON, mode: 'map', run: () => openDrawerPanel('visibility-controls') },
  { label: 'Toolbar', icon: TOOLS_ICON, mode: 'map', run: () => openDrawerPanel('toolbar') },
  {
    kind: 'tools',
    feed: [],
    map: [
      { label: 'Search', icon: SEARCH_ICON, run: () => runMapControl('#search-toggle-btn'), shot: true },
      { label: 'Locate me', icon: LOCATE_ICON, run: () => runMapControl('.maplibregl-ctrl-geolocate'), shot: true },
      { label: 'Reset north', icon: NORTH_ICON, run: () => runMapControl('.maplibregl-ctrl-compass'), shot: true },
    ],
  },
  { kind: 'account', end: true },
  { label: 'Connect wallet', icon: WALLET_ICON, run: openDrawerConnect, wallet: 'off', accent: true, end: true },
  { label: 'Disconnect', icon: LOGOUT_ICON, run: openDisconnect, wallet: 'on', danger: true },
];

let mapAccountBtn;
let mapAvatar;
let mapAccountId;
let feedToolCount = 0;
let mapToolCount = 0;
const viewChoices = [];

function viewValue(value, mapMode) {
  if (value && typeof value === 'object' && !Array.isArray(value)
      && (Object.prototype.hasOwnProperty.call(value, 'feed') || Object.prototype.hasOwnProperty.call(value, 'map'))) {
    return mapMode ? value.map : value.feed;
  }
  return value;
}

function paintChoice(choice, spec, mapMode) {
  const label = viewValue(spec.label, mapMode);
  const icon = viewValue(spec.icon, mapMode);
  const view = mapMode ? 'map' : 'feed';
  if (choice.dataset.item === label && choice.dataset.view === view) return;
  choice.dataset.item = label;
  choice.dataset.view = view;
  choice.replaceChildren(svgIcon(icon), document.createTextNode(label));
}

function appendDrawerItem(spec) {
  const row = document.createElement('li');
  if (spec.mode) row.dataset.mode = spec.mode;
  if (spec.wallet) row.dataset.wallet = spec.wallet;
  if (spec.end) row.classList.add('feed-menu-end');
  const choice = document.createElement('button');
  choice.type = 'button';
  choice.className = spec.danger ? 'feed-menu-item is-danger' : 'feed-menu-item';
  if (spec.accent) choice.classList.add('is-accent');
  if (spec.shot) {
    choice.dataset.shot = '1';
    choice.classList.add('is-shot');
  }
  paintChoice(choice, spec, menu.classList.contains('is-map-drawer'));
  choice.addEventListener('click', (event) => {
    event.stopPropagation();
    const run = viewValue(spec.run, menu.classList.contains('is-map-drawer'));
    if (typeof run === 'function') run();
    if (choice.dataset.shot === '1' || choice.classList.contains('is-accent')) {
      choice.classList.remove('is-current', 'is-hold');
      choice.removeAttribute('aria-current');
      choice.blur();
    }
  });
  bindPress(choice);
  row.appendChild(choice);
  menu.appendChild(row);
  if (viewValue(spec.label, false) !== viewValue(spec.label, true)
      || viewValue(spec.icon, false) !== viewValue(spec.icon, true)) {
    viewChoices.push({ choice, spec });
  }
}

function buildAccountRow(spec) {
  const mapAccount = document.createElement('li');
  mapAccount.className = 'feed-menu-account';
  mapAccount.dataset.wallet = 'on';
  if (spec && spec.end) mapAccount.classList.add('feed-menu-end');
  mapAccountBtn = document.createElement('button');
  mapAccountBtn.type = 'button';
  mapAccountBtn.className = 'feed-menu-item feed-menu-account-btn';
  mapAvatar = pictureElement(DEFAULT_PIC, { className: 'feed-menu-avatar', alt: '', fallback: DEFAULT_PIC });
  mapAccountId = document.createElement('span');
  mapAccountId.className = 'feed-menu-account-id';
  mapAccountBtn.append(mapAvatar, mapAccountId);
  mapAccount.appendChild(mapAccountBtn);
  menu.appendChild(mapAccount);
  mapAccountBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    if (walletNow()) openOwnProfile();
  });
  bindPress(mapAccountBtn);
}

for (const entry of DRAWER_ORDER) {
  if (entry.kind === 'account') {
    buildAccountRow(entry);
    continue;
  }
  if (entry.kind === 'tools') {
    const rule = document.createElement('li');
    rule.className = 'feed-menu-rule';
    rule.dataset.tools = '1';
    rule.setAttribute('role', 'separator');
    menu.appendChild(rule);
    feedToolCount = (entry.feed || []).length;
    mapToolCount = (entry.map || []).length;
    for (const tool of entry.feed || []) appendDrawerItem({ ...tool, mode: 'feed' });
    for (const tool of entry.map || []) appendDrawerItem({ ...tool, mode: 'map' });
    continue;
  }
  appendDrawerItem(entry);
}

// Settings, Visibility and Toolbar slide inside the drawer. One overlay,
// one history level per page. Panels are the existing nodes, parked here
// while the page is open.
const DRAWER_PAGE_LEVELS = 4;
const DRAWER_CHILDREN = {
  toolbar: [
    'Edit_Profile-column', 'load-column', 'create-column', 'draw-column',
    'utility-column', 'memo-column', 'domain-column', 'stack-topic-ids',
    'initial-xyz-column',
  ],
  'rotation-controls': [
    'model-column', 'crosshair-column', 'marker-options-column',
    'topic-chat-column', 'popup-options-column',
  ],
};
const DRAWER_EXTRAS = {
  'model-column': ['model-column-save'],
  'crosshair-column': ['crosshair-column-save'],
  'marker-options-column': ['marker-column-save'],
  'topic-chat-column': ['topic-chat-save'],
  'popup-options-column': ['popup-options-save'],
};

function panelShown(el) {
  if (!el) return false;
  const display = el.style.display;
  return display !== '' && display !== 'none';
}

function drawerPageName(level) {
  return 'drawerpage:' + level;
}

function hideForDrawer(el) {
  if (!el || el.style.display === 'none') return;
  el.dataset.historyHold = '1';
  el.style.display = 'none';
}

function showForDrawer(el) {
  if (!el || panelShown(el)) return;
  el.dataset.historyHold = '1';
  el.style.display = 'block';
}

function hostDrawer(el) {
  if (!el || !drawerPageBody) return;
  // A child parked in the page underneath still has to move onto the new page.
  if (drawerHosted.has(el) || el.classList.contains('in-drawer')) {
    if (el.parentNode !== drawerPageBody) drawerPageBody.appendChild(el);
    return;
  }
  drawerHosted.set(el, { parent: el.parentNode, next: el.nextSibling });
  el.classList.add('in-drawer');
  drawerPageBody.appendChild(el);
}

function unhostDrawer(el, hide) {
  const spot = drawerHosted.get(el);
  drawerHosted.delete(el);
  el.classList.remove('in-drawer');
  if (hide) hideForDrawer(el);
  if (!spot || !spot.parent || !spot.parent.isConnected) return;
  const next = spot.next && spot.next.parentNode === spot.parent ? spot.next : null;
  spot.parent.insertBefore(el, next);
}

const DRAWER_ROOT_PAGES = {
  'rotation-controls': 'Settings',
  'visibility-controls': 'Visibility',
  toolbar: 'Toolbar',
};

const DRAWER_LABELS = {
  'marker-options-column': 'Markers',
  'topic-chat-column': 'Chat',
  'popup-options-column': 'Popups',
  'model-column': 'Model',
  'crosshair-column': 'Crosshair',
  'Edit_Profile-column': 'Edit profile',
};

function drawerPageLabel(id) {
  if (DRAWER_ROOT_PAGES[id]) return DRAWER_ROOT_PAGES[id];
  if (DRAWER_LABELS[id]) return DRAWER_LABELS[id];
  const el = document.getElementById(id);
  const heading = el && el.querySelector('.options-column-title');
  if (heading) {
    const text = heading.textContent.replace(/\s+/g, ' ').trim().replace(/^[^A-Za-z0-9]+/, '').trim();
    if (text) return text;
  }
  return 'Settings';
}

function chevronIcon() {
  return svgIcon([['path', { d: 'm9 18 6-6-6-6' }]]);
}

function rowShown(el) {
  if (!el || el.hidden) return false;
  // A field's × (fieldclear.js) is not a row of its group.
  if (el.classList && el.classList.contains('field-clear')) return false;
  if (el.style.display === 'none') return false;
  return getComputedStyle(el).display !== 'none';
}

function isGroupRow(el) {
  if (!el || !el.classList) return false;
  if (el.classList.contains('save-settings-btn') || el.classList.contains('mb-reset-btn')) return false;
  if (el.classList.contains('mb-card-title') || el.classList.contains('options-column-title')) return false;
  if (el.classList.contains('panel-help-btn') || el.classList.contains('panel-close-btn')) return false;
  if (el.classList.contains('set-nav') || el.classList.contains('mb-row')) return true;
  if (el.matches('.toolbar-column-btns, .toolbar-column-first-settings-btns, .toolbar-column-settings-btns')) return true;
  return !!(el.querySelector && el.querySelector(':scope > input[type="range"]'));
}

function alignSliderColumns(root) {
  const rows = [...root.querySelectorAll('div')].filter((el) => el.querySelector(':scope > input[type="range"]'));
  const groups = new Map();
  for (const row of rows) {
    if (!rowShown(row)) continue;
    const group = row.closest('.mb-card') || row.parentElement;
    if (!group) continue;
    const list = groups.get(group);
    if (list) list.push(row);
    else groups.set(group, [row]);
  }
  for (const [group, list] of groups) {
    let longest = 0;
    let sample = null;
    for (const row of list) {
      const label = row.querySelector(':scope > .mb-row-label, :scope > label');
      if (!label) continue;
      let textWidth = 0;
      if (label.childNodes.length) {
        const range = document.createRange();
        range.selectNodeContents(label);
        textWidth = range.getBoundingClientRect().width;
      }
      if (textWidth < 1) textWidth = label.scrollWidth;
      if (textWidth <= longest) continue;
      longest = textWidth;
      sample = label;
    }
    if (longest <= 0 || !sample) continue;
    const probe = document.createElement('span');
    probe.textContent = '0';
    probe.setAttribute('aria-hidden', 'true');
    const cs = getComputedStyle(sample);
    probe.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;white-space:nowrap;font:' + cs.font + ';letter-spacing:' + cs.letterSpacing + ';';
    document.body.appendChild(probe);
    const zero = probe.getBoundingClientRect().width;
    probe.remove();
    if (zero <= 0) continue;
    const ch = Math.ceil((longest / zero) * 100) / 100 + 0.25;
    const next = ch.toFixed(2) + 'ch';
    const prev = parseFloat(group.style.getPropertyValue('--slider-label-w'));
    if (Number.isFinite(prev) && Math.abs(prev - ch) < 0.2) continue;
    group.style.setProperty('--slider-label-w', next);
  }
}

let sliderAlignFrame = 0;

function shellHasBox(el) {
  if (!el || !el.isConnected || el.hidden) return false;
  if (el.style.display === 'none') return false;
  return el.getClientRects().length > 0;
}

function realignSliderColumns() {
  if (sliderAlignFrame) return;
  sliderAlignFrame = requestAnimationFrame(() => {
    sliderAlignFrame = 0;
    for (const shell of drawerShells) {
      if (!shellHasBox(shell.el) || !shellHasBox(shell.body)) continue;
      alignSliderColumns(shell.body);
    }
  });
}
window.addEventListener('resize', realignSliderColumns);
if (window.visualViewport) window.visualViewport.addEventListener('resize', realignSliderColumns);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(realignSliderColumns);

function paintGroupDividers(root) {
  if (!root) return;
  alignSliderColumns(root);
  for (const group of root.querySelectorAll('.set-group')) {
    let first = true;
    for (const child of group.children) {
      if (!rowShown(child)) {
        child.classList.remove('set-split');
        continue;
      }
      child.classList.toggle('set-split', !first);
      first = false;
    }
  }
  const groups = new Set(root.querySelectorAll('.set-group, .mb-card'));
  for (const el of root.querySelectorAll('div')) {
    if (groups.has(el) || el.closest('.mb-card, .set-group')) continue;
    const stacks = [...el.children].some((child) => child.querySelector && child.querySelector(':scope > input[type="range"]'));
    if (stacks) groups.add(el);
  }
  for (const group of groups) {
    for (const child of group.children) child.classList.remove('is-row-first', 'is-row-last');
    const shown = [...group.children].filter(rowShown);
    const rows = shown.filter(isGroupRow);
    if (!rows.length) continue;
    if (rows[0] === shown[0]) rows[0].classList.add('is-row-first');
    if (rows[rows.length - 1] === shown[shown.length - 1]) rows[rows.length - 1].classList.add('is-row-last');
  }
}

function fillDrawerPanel(id) {
  const el = document.getElementById(id);
  if (!el) return;
  showForDrawer(el);
  hostDrawer(el);
  for (const extraId of DRAWER_EXTRAS[id] || []) {
    const extra = document.getElementById(extraId);
    if (!extra || !panelShown(extra) || el.contains(extra)) continue;
    hostDrawer(extra);
  }
}

// Page pushes are 250ms in both directions, including reduced motion.
function navMs() {
  return 250;
}

function navBusy() {
  return document.documentElement.classList.contains('is-nav-lock');
}

function holdNav() {
  const gen = ++navGen;
  document.documentElement.classList.add('is-nav-lock');
  setTimeout(() => {
    if (gen !== navGen) return;
    document.documentElement.classList.remove('is-nav-lock');
  }, navMs());
}

function motionLive(el) {
  return el.getAnimations().some((anim) => anim.playState === 'running'
    && (anim.transitionProperty === 'transform' || anim.transitionProperty === 'opacity'));
}

// A back press during a slide must start from the frame on screen.
// Dropping the class that owns the running transition cancels it.
function pinMotion(el) {
  if (!el || !motionLive(el)) return;
  const cs = getComputedStyle(el);
  el.style.transition = 'none';
  if (cs.transform && cs.transform !== 'none') el.style.transform = cs.transform;
  void el.offsetWidth;
}

function releaseMotion(el) {
  if (!el) return;
  el.style.transition = '';
  el.style.transform = '';
}

function afterNav(el, done) {
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    el.removeEventListener('transitionend', onEnd);
    done();
  };
  const onEnd = (event) => {
    if (event.target !== el) return;
    if (event.propertyName !== 'transform' && event.propertyName !== 'opacity') return;
    if (motionLive(el)) return;
    finish();
  };
  el.addEventListener('transitionend', onEnd);
  setTimeout(finish, navMs() + 40);
}

function syncShellRefs() {
  const shell = drawerShells[drawerStack.length - 1] || null;
  drawerPage = shell ? shell.el : null;
  drawerPageBody = shell ? shell.body : null;
  drawerPageTitle = shell ? shell.title : null;
  drawerPageBack = shell ? shell.back : null;
}

function unhostShell(shell) {
  if (!shell) return;
  restorePageHelp(shell);
  for (const el of [...drawerHosted.keys()]) {
    if (!shell.body.contains(el)) continue;
    unhostDrawer(el, true);
  }
}

// The ? sits in the header while the panel is hosted, and goes back
// to the panel when the page closes.
function takePageHelp(shell) {
  if (!shell || (shell.help && shell.bar.contains(shell.help))) return;
  const btn = shell.body.querySelector('.in-drawer > .panel-help-btn');
  if (!btn) return;
  shell.help = btn;
  shell.helpSpot = { parent: btn.parentNode, next: btn.nextSibling };
  btn.classList.add('is-bar-help');
  shell.bar.appendChild(btn);
}

function restorePageHelp(shell) {
  const btn = shell && shell.help;
  const spot = shell && shell.helpSpot;
  if (shell) {
    shell.help = null;
    shell.helpSpot = null;
  }
  if (!btn) return;
  btn.classList.remove('is-bar-help');
  if (!spot || !spot.parent || !spot.parent.isConnected) return;
  const next = spot.next && spot.next.parentNode === spot.parent ? spot.next : null;
  spot.parent.insertBefore(btn, next);
}

function paintShell(shell, id) {
  syncShellRefs();
  drawerRenderLock = true;
  try {
    shell.title.textContent = drawerPageLabel(id);
    shell.el.setAttribute('aria-label', shell.title.textContent);
    fillDrawerPanel(id);
    takePageHelp(shell);
    paintGroupDividers(shell.body);
  } finally {
    drawerRenderLock = false;
  }
}

function focusShell(shell) {
  if (!shell) return;
  if (shell.el.tabIndex < 0) shell.el.tabIndex = -1;
  shell.el.focus({ preventScroll: true });
}

// A nested open runs CloseALL, which hides the page underneath. Show it
// again before focus, or the opener row is not rendered and focus is lost.
function showShellPanel(shell) {
  if (!shell || !shell.id) return;
  const panel = document.getElementById(shell.id);
  if (!panel || !shell.body.contains(panel) || panelShown(panel)) return;
  showForDrawer(panel);
}

// Back reveals the parent shell. CloseALL has hidden that panel, and the
// child column may still be shown on the map. Put the parent back in this
// shell and hide the child without letting the display watcher push or pop.
function restoreRevealedPanel(reveal, leaving) {
  const id = drawerStack[drawerStack.length - 1];
  if (!reveal || !id) return;
  drawerRenderLock = true;
  const prevBody = drawerPageBody;
  try {
    drawerPageBody = reveal.body;
    const panel = document.getElementById(id);
    if (panel) {
      showForDrawer(panel);
      if (!reveal.body.contains(panel)) hostDrawer(panel);
    }
    const childId = leaving && leaving.id;
    if (childId && childId !== id) {
      const child = document.getElementById(childId);
      if (child) unhostDrawer(child, true);
      for (const extraId of DRAWER_EXTRAS[childId] || []) {
        const extra = document.getElementById(extraId);
        if (!extra || extra === child) continue;
        if (drawerHosted.has(extra) || extra.classList.contains('in-drawer') || panelShown(extra)) {
          unhostDrawer(extra, true);
        }
      }
    }
    paintGroupDividers(reveal.body);
  } finally {
    drawerPageBody = prevBody;
    queueMicrotask(() => { drawerRenderLock = false; });
  }
}

// Back returns focus to the row that opened the page we left.
function focusDrawerOpener(leftId) {
  const parent = drawerShells[drawerShells.length - 1];
  showShellPanel(parent);
  const row = parent && parent.body.querySelector('[data-panel="' + leftId + '"]');
  if (row) {
    row.focus({ preventScroll: true });
    return;
  }
  const label = DRAWER_ROOT_PAGES[leftId];
  const main = label && [...menu.querySelectorAll(':scope > li > .feed-menu-item')]
    .find((btn) => btn.dataset.item === label);
  if (main) {
    main.focus({ preventScroll: true });
    return;
  }
  if (parent) focusShell(parent);
}

// Push: the new page comes in from the right and the page under it
// shifts left and dims. Pop is the same classes run backwards, so a
// back press reverses from wherever the slide currently is.
// The pencil's Edit profile is the only page on the stack, so it would
// otherwise be a menu row. It still has to be the body screen.
function profileEditScreen(shell) {
  if (!profileEditCover) return false;
  if (shell && shell.id !== 'Edit_Profile-column') return false;
  if (drawerShells.length === 0) return true;
  // tagProfileEditShell runs after the shell is pushed.
  return !!(shell && drawerShells.length === 1 && drawerShells[0] === shell);
}

// Map profile is 8700, above a drawer screen. Drop it under the screen
// until the screen leaves, so this page stacks like the Toolbar one.
// The ? overlay stays on the drawer-page rule above the screen.
function holdMapProfileUnderEdit() {
  if (profileEditZHeld || !profilePage.classList.contains('is-map-profile')) return;
  profileEditZHeld = true;
  profilePage.dataset.editZPrev = profilePage.style.zIndex || '';
  profilePage.style.zIndex = '8640';
}

function releaseMapProfileZ() {
  if (!profileEditZHeld) return;
  profileEditZHeld = false;
  const prev = profilePage.dataset.editZPrev || '';
  delete profilePage.dataset.editZPrev;
  if (prev) profilePage.style.zIndex = prev;
  else profilePage.style.removeProperty('z-index');
}

function tagProfileEditShell(shell) {
  if (!shell || !profileEditScreen(shell)) return;
  shell.el.dataset.profileCover = '1';
  holdMapProfileUnderEdit();
}

function profileEditIsCoverTop() {
  return profileEditCover && drawerStack[drawerStack.length - 1] === 'Edit_Profile-column';
}

// paintFeedProfile scrolls to the top and, when no drawer cover is armed,
// strips nav-cover. The bio paint that follows changes the height, and the
// browser then anchors the scroller. Put the scroll back until that settles.
function keepProfileScroll(scroll) {
  let gen = 0;
  const apply = () => { profileBody.scrollTop = scroll; };
  profileBody.style.overflowAnchor = 'none';
  apply();
  const obs = new MutationObserver(() => {
    const token = ++gen;
    apply();
    setTimeout(() => {
      if (token !== gen) return;
      obs.disconnect();
      apply();
      profileBody.style.removeProperty('overflow-anchor');
    }, 80);
  });
  obs.observe(profileBody, { childList: true, subtree: true, characterData: true });
  setTimeout(() => {
    if (!gen) {
      obs.disconnect();
      apply();
      profileBody.style.removeProperty('overflow-anchor');
    }
  }, 1600);
}

function repaintProfileUnderEdit() {
  const payer = profilePayer;
  const scroll = profileEditScroll;
  const keepCover = !profilePage.hidden
    && profilePage.classList.contains('nav-cover')
    && !profilePage.classList.contains('nav-off');
  if (!payer || profilePage.hidden) return;
  paintFeedProfile(payer);
  keepProfileScroll(scroll);
  if (keepCover && !profilePage.classList.contains('nav-cover')) {
    profilePage.classList.add('nav-cover');
  }
}

function settleProfileEditCover() {
  if (!profileEditCover) return;
  profileEditCover = false;
  repaintProfileUnderEdit();
}

// Profile itself is going away. Drop the shell and do not repaint, or the
// repaint would show the profile again.
function dismissProfileEditCover() {
  if (!profileEditCover) return;
  profileEditCover = false;
  if (drawerStack[drawerStack.length - 1] !== 'Edit_Profile-column') return;
  const name = drawerPageName(drawerStack.length);
  drawerStack.pop();
  mountDrawerBack();
  if (profilePage.hidden) finishDrawerBack();
  if (window.layerIsTop && window.layerIsTop(name)) window.layerClosedByUI(name);
}

// A nested page cannot stay inside #feed-menu: the drawer's transform
// traps position:fixed. Root pages stay in the drawer. Deeper pages
// are a body-level frame and use the same push as the chat pages.
// The profile pencil is the exception: Edit profile is the only page,
// and it still has to be that body frame so it covers the profile.
function placeDrawerShell(shell) {
  const screen = drawerShells.length > 0 || profileEditScreen(shell);
  shell.el.classList.toggle('drawer-screen', screen);
  const parent = screen ? document.body : menu;
  if (shell.el.parentNode !== parent) parent.appendChild(shell.el);
}

function mountDrawerForward(id) {
  const shell = makeDrawerShell();
  shell.id = id;
  shell.el.classList.add('is-prep');
  menu.classList.add('is-page');
  placeDrawerShell(shell);
  drawerShells.push(shell);
  paintShell(shell, id);
  tagProfileEditShell(shell);
  if (shell.el.parentNode === menu) menu.scrollTop = 0;
  const prev = drawerShells[drawerShells.length - 2];
  void shell.el.offsetWidth;
  shell.el.classList.remove('is-prep');
  void shell.el.offsetWidth;
  shell.el.classList.add('is-front');
  if (prev) {
    prev.el.classList.remove('is-front');
    prev.el.classList.add('is-under');
  } else {
    menu.classList.add('is-nav-under');
  }
  document.documentElement.classList.add('drawer-page');
  focusShell(shell);
  holdNav();
}

function mountDrawerParked(id, mode) {
  const shell = makeDrawerShell();
  shell.id = id;
  shell.el.classList.add('is-prep', mode === 'front' ? 'is-front' : 'is-under');
  menu.classList.add('is-page', 'is-nav-under');
  placeDrawerShell(shell);
  drawerShells.push(shell);
  paintShell(shell, id);
  tagProfileEditShell(shell);
  void shell.el.offsetWidth;
  shell.el.classList.remove('is-prep');
  document.documentElement.classList.add('drawer-page');
  if (mode === 'front') focusShell(shell);
}

function watchBack(shell) {
  const watch = ++backWatch;
  const epoch = drawerPageToken;
  afterNav(shell.el, () => {
    if (watch !== backWatch || epoch !== drawerPageToken) return;
    if (!shell.el.classList.contains('is-leave')) return;
    if (drawerShells[drawerShells.length - 1] !== shell) return;
    if (drawerShells.length <= drawerStack.length) return;
    const leftId = shell.id;
    const profileCoverShell = shell.el.dataset.profileCover === '1';
    drawerShells.pop();
    unhostShell(shell);
    shell.el.remove();
    if (profileCoverShell) releaseMapProfileZ();
    syncShellRefs();
    if (!drawerShells.length) {
      menu.classList.remove('is-page');
      document.documentElement.classList.remove('drawer-page');
    }
    focusDrawerOpener(leftId);
  });
}

function mountDrawerBack() {
  while (drawerShells.length > drawerStack.length + 1) {
    const mid = drawerShells.splice(drawerStack.length, 1)[0];
    const profileCoverShell = mid.el.dataset.profileCover === '1';
    unhostShell(mid);
    mid.el.remove();
    if (profileCoverShell) releaseMapProfileZ();
  }
  syncShellRefs();
  if (drawerShells.length <= drawerStack.length) {
    if (!drawerStack.length) {
      menu.classList.remove('is-page', 'is-nav-under');
      document.documentElement.classList.remove('drawer-page');
    }
    return;
  }
  const leaving = drawerShells[drawerShells.length - 1];
  const reveal = drawerShells[drawerShells.length - 2];
  pinMotion(leaving.el);
  if (reveal) pinMotion(reveal.el);
  leaving.el.classList.remove('is-front', 'is-under');
  leaving.el.classList.add('is-leave');
  if (!drawerStack.length) menu.classList.remove('is-nav-under');
  else if (reveal) {
    reveal.el.classList.remove('is-under', 'is-leave');
    reveal.el.classList.add('is-front');
    restoreRevealedPanel(reveal, leaving);
  }
  void leaving.el.offsetWidth;
  releaseMotion(leaving.el);
  if (reveal) releaseMotion(reveal.el);
  holdNav();
  watchBack(leaving);
}

function queueDrawerSync(animate) {
  if (!drawerSyncQueued) drawerSyncAnimate = !!animate;
  if (drawerSyncQueued) return;
  drawerSyncQueued = true;
  queueMicrotask(() => {
    drawerSyncQueued = false;
    const slide = drawerSyncAnimate;
    drawerSyncAnimate = false;
    while (drawerShells.length < drawerStack.length) {
      const id = drawerStack[drawerShells.length];
      const last = drawerShells.length === drawerStack.length - 1;
      if (last && slide) mountDrawerForward(id);
      else mountDrawerParked(id, last ? 'front' : 'under');
    }
  });
}

function pushDrawer(id) {
  if (!id || drawerStack[drawerStack.length - 1] === id) return;
  if (drawerStack.length >= DRAWER_PAGE_LEVELS) return;
  if (navBusy()) return;
  drawerStack.push(id);
  mountDrawerForward(id);
  if (window.layerOpened) {
    const data = { stack: drawerStack.slice() };
    if (profileEditCover && data.stack.length === 1 && data.stack[0] === 'Edit_Profile-column') {
      data.profileCover = 1;
    }
    window.layerOpened(drawerPageName(drawerStack.length), data);
  }
}

function finishDrawerBack() {
  if (!drawerStack.length) markMenuItem('');
}

function drawerBack() {
  if (!drawerStack.length || navBusy()) return;
  const name = drawerPageName(drawerStack.length);
  const cover = profileEditIsCoverTop();
  if (cover) settleProfileEditCover();
  drawerStack.pop();
  mountDrawerBack();
  if (!cover || profilePage.hidden) finishDrawerBack();
  if (window.layerIsTop && window.layerIsTop(name)) window.layerClosedByUI(name);
}

function drawerPageClose(level) {
  if (drawerStack.length < level) return;
  const cover = profileEditIsCoverTop() && level === drawerStack.length;
  if (cover) settleProfileEditCover();
  drawerStack.length = level - 1;
  // Same parent restore as the header back. mountDrawerBack shows it.
  mountDrawerBack();
  if (!cover || profilePage.hidden) finishDrawerBack();
}

function openDrawerPanel(id) {
  if (!window.layerIsTop || !window.layerIsTop('feedmenu')) return;
  if (drawerStack.length || navBusy()) return;
  const label = DRAWER_ROOT_PAGES[id];
  if (!label) return;
  markMenuItem(label);
  pushDrawer(id);
}

function dropDrawerHistory() {
  if (profileEditIsCoverTop() && !profilePage.hidden) settleProfileEditCover();
  else profileEditCover = false;
  while (drawerStack.length) {
    const name = drawerPageName(drawerStack.length);
    drawerStack.pop();
    if (window.layerIsTop && window.layerIsTop(name)) window.layerClosedByUI(name);
  }
  drawerPageToken += 1;
  backWatch += 1;
  for (const shell of drawerShells) {
    unhostShell(shell);
    const profileCoverShell = shell.el.dataset.profileCover === '1';
    shell.el.remove();
    if (profileCoverShell) releaseMapProfileZ();
  }
  drawerShells.length = 0;
  syncShellRefs();
  document.documentElement.classList.remove('drawer-page', 'is-nav-lock');
  menu.classList.add('is-prep');
  menu.classList.remove('is-page', 'is-nav-under', 'is-nav-back');
  void menu.offsetWidth;
  menu.classList.remove('is-prep');
  delete menu.dataset.cover;
}

function makeDrawerShell() {
  const el = document.createElement(drawerShells.length > 0 || profileEditScreen() ? 'div' : 'li');
  el.className = 'feed-menu-page';
  el.setAttribute('role', 'presentation');
  const bar = document.createElement('div');
  bar.className = 'feed-menu-page-bar';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'feed-menu-page-back';
  back.setAttribute('aria-label', 'Back');
  back.appendChild(svgIcon([
    ['path', { d: 'm12 19-7-7 7-7' }],
    ['path', { d: 'M19 12H5' }],
  ]));
  const title = document.createElement('span');
  title.className = 'feed-menu-page-title';
  bar.append(back, title);
  const body = document.createElement('div');
  body.className = 'feed-menu-page-body';
  el.append(bar, body);
  el.addEventListener('click', (event) => event.stopPropagation());
  back.addEventListener('click', (event) => {
    event.stopPropagation();
    drawerBack();
  });
  bindPress(back);
  let paintQueued = false;
  new MutationObserver(() => {
    if (paintQueued || !drawerStack.length || body !== drawerPageBody) return;
    paintQueued = true;
    requestAnimationFrame(() => {
      paintQueued = false;
      if (!drawerStack.length || body !== drawerPageBody) return;
      paintGroupDividers(body);
    });
  }).observe(body, { subtree: true, attributeFilter: ['style', 'hidden'] });
  return { id: '', el, body, title, back, bar };
}

// Map profile, opened from the drawer, uses the same push as a drawer
// sub-page. Topic chat, E2EE and Load use the shared #feed-chat page.
function coverEligible(el) {
  if (!el || menu.dataset.cover !== '1') return false;
  if (el.classList.contains('in-drawer') || el.classList.contains('is-feed-shell')) return false;
  if (el.closest && el.closest('#feed-chat')) return false;
  return true;
}

function startCoverEnter(el) {
  if (!coverEligible(el)) return false;
  delete menu.dataset.cover;
  delete el.dataset.navLeaving;
  el.classList.add('nav-cover', 'nav-prep', 'nav-off');
  menu.classList.add('is-nav-back');
  void el.offsetWidth;
  el.classList.remove('nav-prep');
  void el.offsetWidth;
  el.classList.remove('nav-off');
  holdNav();
  return true;
}

function startCoverLeave(el) {
  if (!el || el.dataset.navLeaving === '1' || !el.classList.contains('nav-cover')) return;
  el.dataset.navLeaving = '1';
  el.dataset.navHold = '1';
  if (el.id === 'load-column') el.dataset.historyHold = '1';
  const shown = el.id === 'load-column' ? 'block' : 'flex';
  el.classList.add('nav-prep');
  el.classList.remove('nav-off');
  el.style.display = shown;
  void el.offsetWidth;
  el.classList.remove('nav-prep');
  void el.offsetWidth;
  el.classList.add('nav-off');
  menu.classList.remove('is-nav-back');
  holdNav();
  afterNav(el, () => {
    if (el.dataset.navLeaving !== '1') return;
    if (el.id === 'load-column') el.dataset.historyHold = '1';
    el.dataset.navHold = '1';
    delete el.dataset.navLeaving;
    el.classList.remove('nav-off', 'nav-prep', 'nav-cover');
    el.style.display = 'none';
  });
}

function bindCoverPanel(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const shownNow = () => el.style.display !== 'none' && el.style.display !== '';
  let wasShown = shownNow();
  new MutationObserver(() => {
    if (el.dataset.navHold === '1') {
      delete el.dataset.navHold;
      wasShown = shownNow();
      return;
    }
    const shown = shownNow();
    if (shown === wasShown) return;
    wasShown = shown;
    if (el.dataset.navLeaving === '1') {
      if (!shown) return;
      delete el.dataset.navLeaving;
      if (!startCoverEnter(el)) {
        el.classList.remove('nav-off', 'nav-prep', 'nav-cover');
        menu.classList.remove('is-nav-back');
      }
      return;
    }
    if (!shown) {
      if (el.classList.contains('nav-cover')) startCoverLeave(el);
      return;
    }
    startCoverEnter(el);
  }).observe(el, { attributes: true, attributeFilter: ['style'] });
}

bindCoverPanel('topic-chat-container');
bindCoverPanel('encrypted-chat-container');
bindCoverPanel('load-column');

// Only the panel whose display just changed. A column already on the map
// (the startup Load panel) must not be pulled in just because its parent opened.
function watchDrawerPanel(id, el) {
  new MutationObserver(() => {
    if (el.dataset.drawerSkip === '1') {
      delete el.dataset.drawerSkip;
      return;
    }
    if (drawerRenderLock || !drawerStack.length) return;
    const top = drawerStack[drawerStack.length - 1];
    const kids = DRAWER_CHILDREN[top] || [];
    if (kids.includes(id) && panelShown(el)) {
      // Load and Draw live in the shared chat page. Their display is not a drawer page.
      if (id === 'load-column' || id === 'draw-column') return;
      if (el.classList.contains('is-feed-shell') || (el.closest && el.closest('#feed-chat'))) return;
      pushDrawer(id);
      return;
    }
    if (id !== top || panelShown(el)) return;
    // CloseALL hides this parent while its child page is opening. Keep the
    // hosted page; Back shows the panel again.
    const owned = DRAWER_CHILDREN[id] || [];
    const childOpen = owned.some((kid) => drawerStack.includes(kid) || panelShown(document.getElementById(kid)));
    if (!childOpen) drawerBack();
  }).observe(el, { attributes: true, attributeFilter: ['style'] });
}

const drawerWatchIds = ['rotation-controls', 'visibility-controls', 'toolbar'];
for (const ids of Object.values(DRAWER_CHILDREN)) drawerWatchIds.push(...ids);
for (const id of drawerWatchIds) {
  const el = document.getElementById(id);
  if (el) watchDrawerPanel(id, el);
}

// A tap during the page slide must not open the row under the moving page.
// Capture on the menu stops the row. The same check is on document so this
// host listener, which is also capture, never runs mid-slide.
function ignoreDrawerSlideTap(event) {
  if (!navBusy()) return;
  const node = event.target;
  if (!node || !node.closest || !node.closest('.feed-menu-page')) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}
document.addEventListener('click', ignoreDrawerSlideTap, true);
menu.addEventListener('click', ignoreDrawerSlideTap, true);

// Move a child into the drawer before its click handler shows it, and
// hold its own history layer so the drawer page stays the one Back step.
document.addEventListener('click', (event) => {
  if (!drawerStack.length || !menu.contains(event.target)) return;
  const top = drawerStack[drawerStack.length - 1];
  const kids = DRAWER_CHILDREN[top] || [];
  if (!kids.length) return;
  const parked = [];
  const park = (id, hold) => {
    const el = document.getElementById(id);
    if (!el || panelShown(el) || el.classList.contains('in-drawer')) return;
    if (hold) el.dataset.historyHold = '1';
    hostDrawer(el);
    parked.push(el);
  };
  for (const id of kids) {
    // Load and Draw are the shared chat page, not columns hosted in the drawer.
    if (id === 'load-column' || id === 'draw-column') continue;
    park(id, true);
    for (const extraId of DRAWER_EXTRAS[id] || []) park(extraId, false);
  }
  if (!parked.length) return;
  setTimeout(() => {
    for (const el of parked) {
      if (panelShown(el)) {
        delete el.dataset.historyHold;
        continue;
      }
      delete el.dataset.historyHold;
      if (drawerHosted.has(el) && !drawerStack.includes(el.id)) unhostDrawer(el, false);
    }
  }, 0);
}, true);

const NAV_ICONS = {
  'change-marker-options': [
    ['path', { d: 'M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0' }],
    ['circle', { cx: '12', cy: '10', r: '3' }],
  ],
  'change-topic-chat-options': CHAT_ICON,
  // A card with a header bar and lines of text: the post popup.
  'change-popup-options': [
    ['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2' }],
    ['path', { d: 'M3 9h18' }],
    ['path', { d: 'M7 13h10' }],
    ['path', { d: 'M7 17h6' }],
  ],
  'change-model-settings': [
    ['path', { d: 'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z' }],
    ['path', { d: 'm3.3 7 8.7 5 8.7-5' }],
    ['path', { d: 'M12 22V12' }],
  ],
  'change-crosshair-settings': [
    ['circle', { cx: '12', cy: '12', r: '10' }],
    ['line', { x1: '22', x2: '18', y1: '12', y2: '12' }],
    ['line', { x1: '6', x2: '2', y1: '12', y2: '12' }],
    ['line', { x1: '12', x2: '12', y1: '6', y2: '2' }],
    ['line', { x1: '12', x2: '12', y1: '22', y2: '18' }],
  ],
  Edit_Profile: [
    ['path', { d: 'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z' }],
    ['path', { d: 'm15 5 4 4' }],
  ],
  Load_Everything: [
    ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }],
    ['polyline', { points: '7 10 12 15 17 10' }],
    ['line', { x1: '12', x2: '12', y1: '15', y2: '3' }],
  ],
  Draw_Marker_Polygon: [
    ['path', { d: 'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z' }],
  ],
  Create_New_Topic: [
    ['path', { d: 'M5 12h14' }],
    ['path', { d: 'M12 5v14' }],
  ],
  Domain: GLOBE_ICON,
  'NFT-utility': [
    ['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2', ry: '2' }],
    ['circle', { cx: '9', cy: '9', r: '2' }],
    ['path', { d: 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21' }],
  ],
  Change_Memo: [
    ['path', { d: 'M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z' }],
    ['circle', { cx: '7.5', cy: '7.5', r: '.5', fill: 'currentColor' }],
  ],
  Stack_topic_IDs: [
    ['path', { d: 'm12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z' }],
    ['path', { d: 'm22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65' }],
    ['path', { d: 'm22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65' }],
  ],
  Set_Initial_XYZ: LOCATE_ICON,
};

const VIS_ROWS = [
  ['toggle-3d-model-visibility', [
    ['path', { d: 'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z' }],
    ['path', { d: 'm3.3 7 8.7 5 8.7-5' }],
    ['path', { d: 'M12 22V12' }],
  ], true, 3],
  ['toggle-marker-visibility', NAV_ICONS['change-marker-options'], true, 4],
  ['toggle-polygon-visibility', [
    ['path', { d: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z' }],
  ], true, 3],
  ['toggle-globe-mode', GLOBE_ICON, false, 2],
];

// One 24-unit window keeps stroke-width 2 at the same weight. The x shift
// parks every outline's left edge on the same line (half the stroke, plus
// one unit of pad) without scaling the shape.
function frameVisIcon(svg, minX) {
  svg.setAttribute('viewBox', (minX - 2) + ' 0 24 24');
}

const NAV_PANELS = {
  'change-marker-options': 'marker-options-column',
  'change-topic-chat-options': 'topic-chat-column',
  'change-popup-options': 'popup-options-column',
  'change-model-settings': 'model-column',
  'change-crosshair-settings': 'crosshair-column',
  Edit_Profile: 'Edit_Profile-column',
  Load_Everything: 'load-column',
  Draw_Marker_Polygon: 'draw-column',
  Create_New_Topic: 'create-column',
  'NFT-utility': 'utility-column',
  Change_Memo: 'memo-column',
  Domain: 'domain-column',
  Stack_topic_IDs: 'stack-topic-ids',
  Set_Initial_XYZ: 'initial-xyz-column',
};

function dressNavRows() {
  for (const [id, icon] of Object.entries(NAV_ICONS)) {
    const el = document.getElementById(id);
    if (!el || el.querySelector('.set-nav-icon')) continue;
    el.classList.add('set-nav');
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    if (NAV_PANELS[id]) el.dataset.panel = NAV_PANELS[id];
    el.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (event.repeat) return;
      event.preventDefault();
      el.click();
    });
    const ico = document.createElement('span');
    ico.className = 'set-nav-icon';
    ico.appendChild(svgIcon(icon));
    const chev = document.createElement('span');
    chev.className = 'set-nav-chev';
    chev.appendChild(chevronIcon());
    el.insertBefore(ico, el.firstChild);
    el.appendChild(chev);
  }
}

function syncVisRow(row) {
  const value = row.querySelector(':scope > span[id$="-value"]');
  if (!value) return;
  const text = value.textContent.replace(/\s+/g, ' ').trim();
  row.classList.toggle('is-switch', text === 'On' || text === 'Off');
  row.classList.toggle('is-on', text === 'On');
  const button = row.querySelector('button');
  if (!button) return;
  if (text === 'On' || text === 'Off') button.setAttribute('aria-pressed', text === 'On' ? 'true' : 'false');
  else button.removeAttribute('aria-pressed');
}

function dressVisibility() {
  for (const [id, icon, binary, minX] of VIS_ROWS) {
    const button = document.getElementById(id);
    const row = button && button.closest('.mb-row');
    if (!row || row.dataset.dressed === '1') continue;
    row.dataset.dressed = '1';
    const ico = document.createElement('span');
    ico.className = 'set-nav-icon';
    const svg = svgIcon(icon);
    frameVisIcon(svg, minX);
    ico.appendChild(svg);
    row.insertBefore(ico, row.firstChild);
    if (binary) {
      const sw = document.createElement('span');
      sw.className = 'set-switch';
      sw.setAttribute('aria-hidden', 'true');
      row.appendChild(sw);
    }
    row.addEventListener('click', (event) => {
      if (button === event.target || button.contains(event.target)) return;
      button.click();
    });
    syncVisRow(row);
    const value = row.querySelector(':scope > span[id$="-value"]');
    if (value) {
      new MutationObserver(() => syncVisRow(row)).observe(value, {
        childList: true, characterData: true, subtree: true,
      });
    }
  }
}

function markSetGroups() {
  const ids = new Set(['toolbar', 'rotation-controls', 'visibility-controls', ...drawerWatchIds]);
  for (const extra of Object.values(DRAWER_EXTRAS)) {
    for (const id of extra) ids.add(id);
  }
  const buttonSel = '.toolbar-column-btns, .toolbar-column-first-settings-btns, .toolbar-column-settings-btns';
  for (const id of ids) {
    const root = document.getElementById(id);
    if (!root) continue;
    for (const div of root.querySelectorAll('div')) {
      const kids = [...div.children];
      if (!kids.length) continue;
      const buttons = kids.filter((kid) => kid.matches(buttonSel));
      if (!buttons.length) continue;
      const other = kids.filter((kid) => !kid.matches(buttonSel) && kid.tagName !== 'BR');
      if (other.length) continue;
      div.classList.add('set-group');
    }
  }
}

dressNavRows();
dressVisibility();
markSetGroups();

function paintMapAccount() {
  const id = walletNow();
  const label = document.getElementById('account-id');
  const text = id || (label && label.textContent.trim()) || 'Not connected';
  mapAccountId.textContent = text;
  mapAvatar = mountPicture(mapAvatar, id ? profilePicUrl(id) : DEFAULT_PIC, {
    className: 'feed-menu-avatar',
    fallback: DEFAULT_PIC,
  });
  paintProfileAvatar(mapAvatar, id);
  mapAccountBtn.classList.toggle('is-connect', !id);
  mapAccountBtn.setAttribute('aria-label', id ? text + ', My profile' : 'My profile');
}

function paintMenuRows() {
  const mapMode = menu.classList.contains('is-map-drawer');
  const on = !!walletNow();
  for (const slot of viewChoices) paintChoice(slot.choice, slot.spec, mapMode);
  const tools = mapMode ? mapToolCount : feedToolCount;
  for (const row of menu.children) {
    if (!row.dataset || row.classList.contains('feed-menu-page')) continue;
    if (row.dataset.tools) {
      row.hidden = tools === 0;
      continue;
    }
    const mode = row.dataset.mode;
    let hide = !!(mode && (mapMode ? mode !== 'map' : mode !== 'feed'));
    const wallet = row.dataset.wallet;
    if (!hide && wallet) hide = on ? wallet !== 'on' : wallet !== 'off';
    row.hidden = hide;
  }
  paintMapAccount();
}

// web3.js writes #account-id on connect and disconnect. Repaint so a
// connect that finishes after the drawer was painted shows the account.
function watchWalletRows() {
  const account = document.getElementById('account-id');
  if (!account) return;
  let last = walletNow();
  const sync = () => {
    const now = walletNow();
    if (now === last) return;
    last = now;
    followSet = null;
    followPromise = null;
    followState = now ? 'idle' : 'nowallet';
    paintMenuRows();
    syncProfileOwn();
    syncFilterControls();
    if (feedFiltering() && (getQuery().filters.mine === true || getQuery().filters.following === true)) showQueryResults();
  };
  new MutationObserver(sync).observe(account, { childList: true, characterData: true, subtree: true });
}
paintMenuRows();
watchWalletRows();
window.restoreDrawerFromMap = restoreDrawer;
document.addEventListener('profiles-loaded', paintMapAccount);

if (window.defineLayer) {
  window.defineLayer('feedmenu', {
    parent: 'feed',
    open: (state) => {
      if (feedCovers()) placeMenuForMap(false);
      else placeMenuForMap(true);
      paintMenu(true);
      if (state && state.item) {
        drawerItem = state.item;
        markMenuItem(state.item);
      }
    },
    close: () => closeMenu(),
  });
  for (let level = 1; level <= DRAWER_PAGE_LEVELS; level += 1) {
    window.defineLayer(drawerPageName(level), {
      parent: level === 1 ? 'feedmenu' : drawerPageName(level - 1),
      open: (state) => {
        const stack = state && Array.isArray(state.stack) ? state.stack : [];
        const profileCover = !!(state && state.profileCover)
          && level === 1
          && stack.length === 1
          && stack[0] === 'Edit_Profile-column';
        if (profileCover) {
          profileEditCover = true;
          profileEditScroll = profileBody.scrollTop;
        }
        const menuWasOpen = !menu.hidden && menu.classList.contains('is-open');
        drawerStack = stack.slice(0, level);
        if (menu.hidden && !profileCover) {
          placeMenuForMap(!feedCovers());
          paintMenu(true);
        }
        const rootLabel = DRAWER_ROOT_PAGES[drawerStack[0]];
        if (rootLabel) markMenuItem(rootLabel);
        queueDrawerSync(menuWasOpen);
      },
      close: () => drawerPageClose(level),
    });
  }
  window.defineLayer('feedsettings', {
    parent: 'feed',
    open: (state) => {
      hideKeptDrawer(state, 'Settings');
      paintFeedSettings(true);
    },
    close: () => closeFeedSettings(),
  });
  window.defineLayer('feedchat', {
    parent: 'feed',
    open: (state) => {
      const fallback = state && state.kind === 'e2ee' ? 'E2EE chat' : state && state.kind === 'load' ? 'Load' : state && state.kind === 'draw' ? 'Draw' : 'Topic chat';
      hideKeptDrawer(state, fallback);
      paintFeedChat(state && state.kind);
    },
    close: () => {
      hideFeedChatPanel();
      restoreDrawer();
    },
  });
  window.defineLayer('loadoptions', {
    parent: 'feedchat',
    open: () => {
      const show = document.getElementById('show-options-from-load');
      if (show && !loadOptionsShown()) show.click();
    },
    close: () => {
      if (!loadOptionsShown()) return;
      const hide = document.getElementById('hide-options-from-load');
      if (hide) hide.click();
    },
  });
  window.defineLayer('feedprofile', {
    parent: 'feed',
    open: (state) => {
      hideKeptDrawer(state, 'My profile');
      if (state && state.coverPopup) {
        window.__profileCoversPopup = true;
        if (window.coverPopupsForPage) window.coverPopupsForPage();
      }
      const payer = state && state.payer;
      if (payer) paintFeedProfile(payer);
    },
    // Phone Back while their posts are showing returns to the account
    // page. The entry is already gone, so the page is pushed again
    // after this pop finishes. Back from the account page leaves.
    close: () => {
      dismissProfileEditCover();
      if (bannerTracks() && profilePayer) {
        const payer = profilePayer;
        backToProfileAccount();
        setTimeout(() => {
          if (profilePayer !== payer || bannerTracks()) return;
          if (window.layerIsOpen && window.layerIsOpen('feedprofile')) return;
          if (!feedCovers()) return;
          const data = drawerItem ? drawerState({ payer }) : { payer };
          if (window.__profileCoversPopup) data.coverPopup = true;
          if (window.layerOpened) window.layerOpened('feedprofile', data);
        }, 0);
        return;
      }
      uncoverPopupUnderProfile();
      hideProfilePage();
      profilePayer = '';
      profileEpoch += 1;
      clearProfileFilter();
      restoreDrawer();
    },
  });
  window.defineLayer('feedsearch', {
    parent: 'feed',
    open: () => {
      if (!searchPage.hidden) return;
      searchPage.hidden = false;
      playSearchMotion('in');
      parkScroller();
      syncSearchChrome();
      focusSearchPage();
    },
    close: () => closeSearchPage(),
  });
  // Chat Options page. Back closes it through the header's close button;
  // Forward opens it the same way.
  window.defineLayer('chatoptions', {
    parent: 'feedchat',
    open: () => {
      if (feedChatKind === 'topic' || feedChatKind === 'e2ee') pressChatOptions(chatOptionsOpenId);
    },
    close: () => pressChatOptions(chatOptionsCloseId),
  });
  window.defineLayer('feedfilters', {
    parent: 'feedsearch',
    open: () => {
      if (searchPage.hidden || filterCard.style.display === 'block') return;
      showFilterCard();
    },
    close: () => concealFilterCard(),
  });
  window.defineLayer('feedplace', {
    parent: 'feed',
    open: () => {
      if (root.style.display === 'none') return;
      placing = true;
      peek = true;
      root.classList.add('is-peek');
      syncCover();
    },
    close: () => {
      if (!placing) {
        placeBusy = false;
        return;
      }
      returnToFeed(false);
    },
  });
}

bindPress(menuBtn);
menuBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  if (drawerStack.length || (window.layerIsTop && window.layerIsTop('feedmenu'))) closeMenu();
  else openMenu();
});
bindPress(mapMenuBtn);
mapMenuBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  if (drawerStack.length || (window.layerIsTop && window.layerIsTop('feedmenu'))) closeMenu();
  else openMapMenu();
});

bindPress(topicBtn);
topicBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  openLoadFromFeed();
});

const optionTrigger = document.getElementById('toggle-toolbar-btn');
if (optionTrigger) {
  new MutationObserver(() => {
    if (!optionsOverFeed) return;
    if (optionTrigger.style.display === 'none') {
      dropOptions();
      return;
    }
    liftOptions();
  }).observe(optionTrigger, { attributes: true, attributeFilter: ['style'] });
}
for (const id of OPTION_PANELS) {
  if (id === 'menu-buttons-group') continue;
  const panel = document.getElementById(id);
  if (!panel) continue;
  new MutationObserver(() => {
    if (!optionsOverFeed || !feedCovers() || panel.style.display === 'none') return;
    liftOptionEl(panel);
  }).observe(panel, { attributes: true, attributeFilter: ['style'] });
}

const drawColumn = document.getElementById('draw-column');
if (drawColumn) {
  new MutationObserver(() => {
    const open = drawColumn.style.display !== 'none' && drawColumn.style.display !== '';
    if (open) {
      if (placing) drawWasOpen = true;
      return;
    }
    if (!placing || !drawWasOpen) return;
    returnToFeed(false);
  }).observe(drawColumn, { attributes: true, attributeFilter: ['style'] });
}

// Load with a topic that exists closes the Load page and the drawer that
// led to it: the map (or the feed, when Load was opened from it) shows the
// topic as it loads. An invalid ID keeps the page open with its message,
// and an account ID still opens that profile. Only a press counts: the
// startup load and other loads close nothing. The wait covers the click
// debounce, the wallet's NFT check and the topic lookup.
const LOAD_CLOSE_MS = 20000;
let loadPressedAt = 0;
const loadTrigger = document.getElementById('toolbar-load');
if (loadTrigger) {
  loadTrigger.addEventListener('click', () => {
    loadPressedAt = performance.now();
    if (!feedOn() || root.classList.contains('is-peek')) return;
    ensureTopic(false);
  });
}
window.addEventListener('topic-load-valid', () => {
  const pressed = loadPressedAt;
  loadPressedAt = 0;
  if (!pressed || performance.now() - pressed > LOAD_CLOSE_MS) return;
  if (feedChatKind !== 'load' || feedChat.hidden) return;
  closeFeedOverlays();
});

window.addEventListener('topics-ready', paintTopicTitle);
const loadedList = document.getElementById('loaded-topics-list');
if (loadedList) {
  new MutationObserver(() => paintTopicTitle()).observe(loadedList, { childList: true, subtree: true });
}

menuDim.addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  const box = postBtn.getBoundingClientRect();
  const onPost = box.width > 0 && box.height > 0
    && event.clientX >= box.left && event.clientX <= box.right
    && event.clientY >= box.top && event.clientY <= box.bottom;
  if (onPost) {
    startPost();
    return;
  }
  closeMenu();
});

let menuSwipe = null;
function endMenuSwipe(event) {
  if (!menuSwipe || event.pointerId !== menuSwipe.id) return;
  const dx = event.clientX - menuSwipe.x;
  const dy = event.clientY - menuSwipe.y;
  const cancelled = event.type === 'pointercancel';
  menuSwipe = null;
  document.removeEventListener('pointerup', endMenuSwipe);
  document.removeEventListener('pointercancel', endMenuSwipe);
  if (cancelled) return;
  const limit = menu.getBoundingClientRect().width * 0.18;
  if (dx >= -limit || dx >= -Math.abs(dy)) return;
  const eat = (click) => {
    click.preventDefault();
    click.stopPropagation();
  };
  menu.addEventListener('click', eat, true);
  setTimeout(() => menu.removeEventListener('click', eat, true), 0);
  closeMenu();
}
menu.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || menuSwipe) return;
  menuSwipe = { id: event.pointerId, x: event.clientX, y: event.clientY };
  document.addEventListener('pointerup', endMenuSwipe);
  document.addEventListener('pointercancel', endMenuSwipe);
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!feedChat.hidden && feedChatKind) {
    // A slide owns the key. Help, the wallet sheet, and any other layer
    // above the chat take Escape before this page does.
    if (navBusy()) return;
    if (feedChatKind === 'draw') {
      const help = document.getElementById('map-draw-help-overlay');
      if (help && help.style.display === 'block') {
        event.preventDefault();
        event.stopPropagation();
        help.style.display = 'none';
        return;
      }
    }
    const chatTop = window.layerIsTop && (window.layerIsTop('feedchat')
      || (feedChatKind === 'load' && window.layerIsTop('loadoptions')));
    if (!chatTop) return;
    event.preventDefault();
    event.stopPropagation();
    if (feedChatKind === 'load' && loadOptionsShown()) {
      const hide = document.getElementById('hide-options-from-load');
      if (hide) hide.click();
      return;
    }
    closeFeedChat();
    return;
  }
  // The pencil page sits on the profile. The menu under a card-opened
  // profile is hidden, so the drawer Esc check further down never runs.
  if (profileEditCover && drawerStack.length) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    drawerBack();
    return;
  }
  if (bannerTracks() && profilePayer && (!window.layerIsTop || window.layerIsTop('feedprofile'))) {
    event.preventDefault();
    event.stopPropagation();
    backToProfileAccount();
    return;
  }
  if (!profilePage.hidden && (!window.layerIsTop || window.layerIsTop('feedprofile'))) {
    event.preventDefault();
    event.stopPropagation();
    closeFeedProfile();
    return;
  }
  if (!settings.hidden && (!window.layerIsTop || window.layerIsTop('feedsettings'))) {
    event.preventDefault();
    event.stopPropagation();
    closeFeedSettings();
    return;
  }
  if (filterCard.style.display === 'block' && (!window.layerIsTop || window.layerIsTop('feedfilters'))) {
    event.preventDefault();
    event.stopPropagation();
    // An open country list closes first and keeps the chosen country.
    if (countryBox.classList.contains('is-open')) closeCountryList();
    else closeFilterCard();
    return;
  }
  if (!searchPage.hidden && (!window.layerIsTop || window.layerIsTop('feedsearch'))) {
    event.preventDefault();
    event.stopPropagation();
    closeSearchPage();
    return;
  }
  if (menu.hidden) return;
  if (drawerStack.length) {
    event.preventDefault();
    event.stopPropagation();
    drawerBack();
    return;
  }
  if (window.layerIsTop && !window.layerIsTop('feedmenu')) return;
  event.preventDefault();
  event.stopPropagation();
  closeMenu();
}, true);
bindPress(settingsBack);
settingsBack.addEventListener('click', (event) => {
  event.stopPropagation();
  closeFeedSettings();
});
settings.addEventListener('click', (event) => event.stopPropagation());

column.addEventListener('click', (event) => {
  const tag = event.target && event.target.closest && event.target.closest('.post-hashtag');
  if (!tag || !column.contains(tag)) return;
  if (feedActIdle(event)) return;
  event.preventDefault();
  event.stopPropagation();
}, true);
root.addEventListener('click', (event) => event.stopPropagation());

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushViewsNow();
  syncFeedVideos();
});
try {
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (motionQuery.addEventListener) motionQuery.addEventListener('change', syncFeedVideos);
} catch {
  /* matchMedia is missing */
}
function feedVideoOverlayNode(node) {
  if (!node || node.nodeType !== 1) return false;
  if (node.id === 'media-fullscreen' || node.classList.contains('comments-modal')) return true;
  return !!(node.querySelector && node.querySelector('#media-fullscreen, .comments-modal'));
}

const feedVideoShell = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.type !== 'childList' || mutation.target !== document.body) {
      queueFeedVideos();
      return;
    }
    for (const node of mutation.addedNodes) {
      if (!feedVideoOverlayNode(node)) continue;
      queueFeedVideos();
      return;
    }
    for (const node of mutation.removedNodes) {
      if (!feedVideoOverlayNode(node)) continue;
      queueFeedVideos();
      return;
    }
  }
});
for (const node of [profilePage, settings, feedChat, menu, root]) {
  feedVideoShell.observe(node, { attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
}
feedVideoShell.observe(filterCard, { attributes: true, attributeFilter: ['style'] });
feedVideoShell.observe(document.body, { childList: true });
window.addEventListener('pagehide', flushViewsNow);

allTab.addEventListener('click', () => { selectTab('all'); });
followTab.addEventListener('click', () => { selectTab('following'); });
bindPress(newPill);
newPill.addEventListener('click', (event) => {
  event.stopPropagation();
  goToFreshPosts();
});
paintTabs();

bindPress(searchBtnFeed);
searchBtnFeed.addEventListener('click', (event) => {
  event.stopPropagation();
  // Enter and Space synthesize a click with detail 0. A tap or mouse click counts.
  searchArmPointer = event.detail > 0;
  openSearch();
});
bindPress(postBtn);
postBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  startPost();
});
bindPress(searchBack);
searchBack.addEventListener('click', (event) => {
  event.stopPropagation();
  closeSearchPage();
});
bindPress(searchClear);
searchClear.addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  if (searchTimer) {
    clearTimeout(searchTimer);
    searchTimer = 0;
  }
  searchInput.value = '';
  searchClear.hidden = true;
  const query = getQuery();
  const still = Object.keys(query.filters).length > 0 || (query.sort && query.sort !== 'newest');
  if (!still) restoreOnClear = true;
  setText('');
  if (!restoreOnClear) return;
  restoreOnClear = false;
  if (feedFiltering()) return;
  found = [];
  if (searchPinned) restorePin();
  else paintEmpty();
});
searchInput.addEventListener('input', () => {
  revealSearchHead();
  searchClear.hidden = searchInput.value.length === 0;
  if (searchTimer) clearTimeout(searchTimer);
  const value = searchInput.value;
  searchTimer = setTimeout(() => {
    searchTimer = 0;
    if (searchPage.hidden) return;
    applyQuery(value);
  }, 250);
});
searchInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
});
searchGear.addEventListener('click', (event) => {
  event.stopPropagation();
  if (filterCard.style.display === 'block') closeFilterCard();
  else openFilterCard();
});
filterBackdrop.addEventListener('click', (event) => {
  event.stopPropagation();
  closeFilterCard();
});
filterCard.addEventListener('click', (event) => event.stopPropagation());
filterCard.addEventListener('pointerdown', (event) => event.stopPropagation());
filterClose.addEventListener('click', (event) => {
  event.stopPropagation();
  closeFilterCard();
});
function setExclusive(key, other) {
  if (getQuery().filters[key] === true) setFilter(key, '');
  else {
    setFilter(other, '');
    setFilter(key, true);
  }
}
filterHasImage.addEventListener('click', (event) => {
  event.stopPropagation();
  setExclusive('hasImage', 'onlyText');
});
filterOnlyText.addEventListener('click', (event) => {
  event.stopPropagation();
  setExclusive('onlyText', 'hasImage');
});
filterMine.addEventListener('click', (event) => {
  event.stopPropagation();
  if (filterMine.getAttribute('aria-disabled') === 'true') return;
  if (getQuery().filters.mine === true) setFilter('mine', '');
  else setFilter('mine', true);
});
filterFollowing.addEventListener('click', (event) => {
  event.stopPropagation();
  if (filterFollowing.getAttribute('aria-disabled') === 'true') return;
  if (getQuery().filters.following === true) setFilter('following', '');
  else {
    setFilter('following', true);
    ensureFollowSet();
  }
});
filterHashinal.addEventListener('click', (event) => {
  event.stopPropagation();
  if (getQuery().filters.hashinal === true) setFilter('hashinal', '');
  else setFilter('hashinal', true);
});
filterComments.addEventListener('click', (event) => {
  event.stopPropagation();
  if (getQuery().filters.hasComments === true) setFilter('hasComments', '');
  else setFilter('hasComments', true);
});
filterSort.addEventListener('change', () => setSort(filterSort.value));
// Pills are the visible sort control. They write the select and use its change listener.
filterSortPills.addEventListener('click', (event) => {
  const pill = event.target.closest('button');
  if (!pill || !filterSortPills.contains(pill)) return;
  event.stopPropagation();
  const value = pill.dataset.sort;
  if (!value || filterSort.value === value) return;
  filterSort.value = value;
  filterSort.dispatchEvent(new Event('change'));
});
filterFrom.addEventListener('change', () => setFilter('dateFrom', filterFrom.value));
filterTo.addEventListener('change', () => setFilter('dateTo', filterTo.value));
filterCountry.addEventListener('change', () => {
  setFilter('country', filterCountry.value);
  if (filterCountry.value && !placePackReady && !placePackFailed) ensurePlacePack();
});
onChange(onFeedSearchChange);

// While search is open the same delta moves the search head, not the tabs.
function followTarget() {
  return searchPage.hidden ? tabs : searchHead;
}

function refreshTabRowHeight(el) {
  const target = el || followTarget();
  if (target === searchHead) {
    if (searchPage.hidden) return;
    const h = searchHead.getBoundingClientRect().height;
    if (h > 1) searchHidePx = h;
    const px = (searchHidePx > 1 ? searchHidePx : 0).toFixed(2) + 'px';
    searchPage.style.setProperty('--feed-search-head-h', px);
    return;
  }
  const h = tabs.getBoundingClientRect().height;
  if (h > 1) tabHidePx = h;
}

function rowHideLimit(el) {
  const px = el === searchHead ? searchHidePx : tabHidePx;
  return px > 1 ? px : 0;
}

function setTabY(value, el) {
  const target = el || followTarget();
  if (target === searchHead) {
    searchHead.style.setProperty('--feed-search-y', value);
    return;
  }
  tabs.style.setProperty('--feed-tab-y', value);
  newPill.style.setProperty('--feed-tab-y', value);
}

function cancelTabFinish() {
  if (tabEndTimer) {
    clearTimeout(tabEndTimer);
    tabEndTimer = 0;
  }
  tabs.classList.remove('is-settle');
  searchHead.classList.remove('is-settle');
}

function writeTabOffset(y, el) {
  const target = el || followTarget();
  const limit = rowHideLimit(target);
  const next = limit > 1 ? Math.max(-limit, Math.min(0, y)) : 0;
  if (target === followTarget()) tabOffset = next;
  setTabY(next.toFixed(2) + 'px', target);
  if (next <= -limit + 0.5 && limit > 1) target.style.pointerEvents = 'none';
  else target.style.removeProperty('pointer-events');
}

function showFeedTabs() {
  cancelTabFinish();
  tabPending = 0;
  tabLastY = scroller.scrollTop;
  writeTabOffset(0);
}

function revealSearchHead() {
  if (searchPage.hidden) return;
  cancelTabFinish();
  tabPending = 0;
  refreshTabRowHeight(searchHead);
  tabLastY = scroller.scrollTop;
  writeTabOffset(0, searchHead);
}

function resetScrollChrome() {
  cancelTabFinish();
  tabPending = 0;
  refreshTabRowHeight(tabs);
  writeTabOffset(0, tabs);
  writeTabOffset(0, searchHead);
  tabOffset = 0;
  tabLastY = scroller.scrollTop;
}

function refreshBarHeight() {
  const h = toolbar.getBoundingClientRect().height;
  if (h > 1) root.style.setProperty('--feed-bar-h', h.toFixed(2) + 'px');
}

function measureTabHide() {
  refreshBarHeight();
  refreshTabRowHeight(tabs);
  if (!searchPage.hidden) refreshTabRowHeight(searchHead);
  writeTabOffset(tabOffset);
  if (bannerTracks()) refreshBannerHeight();
}

function queueTabFollow() {
  if (tabFollowQueued) return;
  tabFollowQueued = true;
  requestAnimationFrame(applyTabFollow);
}

function applyTabFollow() {
  tabFollowQueued = false;
  if (root.classList.contains('is-peek')) {
    tabPending = 0;
    return;
  }
  const delta = tabPending;
  tabPending = 0;
  // The offset stays in JS. Reading the composited transform mid-glide
  // forces layout and makes the row hitch behind the scroll.
  tabs.classList.remove('is-settle');
  searchHead.classList.remove('is-settle');
  if (scroller.scrollTop < 2) {
    writeTabOffset(0);
    if (bannerTracks()) writeBannerOffset(0);
    return;
  }
  writeTabOffset(tabOffset - delta);
  if (bannerTracks()) writeBannerOffset(bannerOffset - delta);
}

// Scrolling has stopped, including a fling. A partial hide stays where
// the gesture left it; the next drag continues from that offset.
function finishTabGlide() {
  tabEndTimer = 0;
  if (root.classList.contains('is-peek')) return;
  tabs.classList.remove('is-settle');
  searchHead.classList.remove('is-settle');
  if (tabFollowQueued) return;
  if (scroller.scrollTop < 2) {
    writeTabOffset(0);
    if (bannerTracks()) writeBannerOffset(0);
  }
}

// Browsers without scrollend get this instead. Each scroll frame resets
// it, so it cannot run while a fling is still emitting events.
function armTabFinish() {
  if ('onscrollend' in scroller) return;
  if (tabEndTimer) clearTimeout(tabEndTimer);
  tabEndTimer = setTimeout(finishTabGlide, 140);
}

// Script scrolls must not count as a finger moving the row.
function setFeedScroll(value) {
  const before = scroller.scrollTop;
  tabTrackHold = true;
  scroller.scrollTop = value;
  if (scroller.scrollTop === before) tabTrackHold = false;
}

function feedScrollTo(options) {
  const before = scroller.scrollTop;
  tabTrackHold = true;
  scroller.scrollTo(options);
  const top = options && typeof options === 'object' ? options.top : options;
  if (typeof top === 'number' && scroller.scrollTop === before && top === before) tabTrackHold = false;
}

tabs.addEventListener('focusin', () => showFeedTabs());
searchHead.addEventListener('focusin', () => revealSearchHead());
window.addEventListener('resize', measureTabHide);
if (window.visualViewport) window.visualViewport.addEventListener('resize', measureTabHide);
if (document.fonts) {
  document.fonts.ready.then(() => measureTabHide());
  document.fonts.addEventListener('loadingdone', measureTabHide);
}

scroller.addEventListener('scroll', (event) => {
  const hold = tabTrackHold;
  if (hold) tabTrackHold = false;
  if (root.classList.contains('is-peek')) return;
  const y = scroller.scrollTop;
  if (hold || !event.isTrusted) {
    tabLastY = y;
    if (y < 2) {
      showFeedTabs();
      if (bannerTracks()) writeBannerOffset(0);
    }
  } else {
    // Hold this delta until the frame. A script scroll only moves tabLastY.
    tabPending += y - tabLastY;
    tabLastY = y;
    queueTabFollow();
    armTabFinish();
    fillAgain = 0;
  }
  savedScroll = y;
  // Captions can still be waiting on layout when a card is first built.
  // Fills run in that frame, not on this event.
  scheduleScrollFrame();
  scheduleScrollWrite();
}, { passive: true });

scroller.addEventListener('scrollend', () => {
  cancelTabFinish();
  finishTabGlide();
}, { passive: true });

paintToggle(false);
applyFeedChrome();
if (savedMode() === 'feed') applyFeed(true);
const feedLink = linkInfo();
if (feedLink && typeof feedLink.addEventListener === 'function') {
  feedLink.addEventListener('change', syncFeedVideos);
}

setInterval(() => {
  if (document.hidden) return;
  if (!feedOn() || root.classList.contains('is-peek')) return;
  ensureTopic(false);
}, 2000);

function cmpNewestPosts(a, b) {
  const ts = cmpTs(b && b.ts, a && a.ts);
  if (ts) return ts;
  return (Number(b && b.seq) || 0) - (Number(a && a.seq) || 0);
}

function likeScore(post) {
  const record = recordFor(post) || {};
  const marker = Number(record.likeCountMarker);
  const polygon = Number(record.likeCountPolygon);
  const left = Number.isFinite(marker) ? marker : 0;
  const right = Number.isFinite(polygon) ? polygon : 0;
  return left + right;
}

function cmpViewedPosts(a, b) {
  const aKnown = !!(a && viewTotals.has(a.key));
  const bKnown = !!(b && viewTotals.has(b.key));
  if (!aKnown && !bKnown) return cmpNewestPosts(a, b);
  if (!aKnown) return 1;
  if (!bKnown) return -1;
  const diff = viewTotals.get(b.key) - viewTotals.get(a.key);
  if (diff) return diff;
  return cmpNewestPosts(a, b);
}

registerSort('oldest', (a, b) => cmpNewestPosts(b, a));
registerSort('liked', (a, b) => {
  const diff = likeScore(b) - likeScore(a);
  if (diff) return diff;
  return cmpNewestPosts(a, b);
});
registerSort('viewed', cmpViewedPosts);

registerFilter('hasImage', (post, record) => mediaOf(record && record.image) !== '');
registerFilter('onlyText', (post, record) => {
  const rec = record || {};
  return !mediaOf(rec.image) && !mediaOf(rec.coverimage) && textOf(rec.msg).trim() !== '';
});
registerFilter('mine', (post) => {
  const me = walletNow();
  return !!me && postBy(post, me);
});
registerFilter('following', (post) => !!(followSet && post && followSet.has(post.payer)));
registerFilter('hashinal', (post) => earlyHashinalNumber(post && post.payer) > 0);
// Chat records have no comments field (chatRecord). Those posts are not matches.
// Shares store comments: [] and are not matches either.
registerFilter('hasComments', (post, record) => Array.isArray(record && record.comments) && record.comments.length > 0);
registerFilter('dateFrom', (post, record, value) => {
  const start = localDaySeconds(value, false);
  const ts = postSeconds(post, record);
  if (start == null || ts == null) return false;
  return ts >= start;
});
registerFilter('dateTo', (post, record, value) => {
  const end = localDaySeconds(value, true);
  const ts = postSeconds(post, record);
  if (end == null || ts == null) return false;
  return ts <= end;
});
registerFilter('country', (post, record, value) => {
  const code = String(value || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return false;
  return countryOf(post) === code;
});

const countryBlank = document.createElement('option');
countryBlank.value = '';
countryBlank.textContent = 'Any country';
filterCountry.appendChild(countryBlank);

// ── Country field ──────────────────────────────────────────────────────
// Tap it: every country, the chosen one in view. Type: the countries that
// match, best first: the exact code or name ("us", "uk", "uae"), a name
// that starts with the text, another name that does, a word in the name
// that starts with it, then the text anywhere in a name. Enter or a tap picks;
// Escape or leaving the field keeps what was chosen. × goes back to Any.
function foldCountry(text) {
  return normPlaceName(text).normalize('NFD').replace(/[̀-ͯ]/g, '');
}
const countryAliases = new Map(); // code -> folded names
for (const [name, code] of countryCodeByName) {
  if (!countryAliases.has(code)) countryAliases.set(code, []);
  countryAliases.get(code).push(foldCountry(name));
}
function countryRowEl(code, name) {
  const row = document.createElement('div');
  row.className = 'feed-country-option';
  row.id = 'feed-country-' + (code || 'any').toLowerCase();
  row.setAttribute('role', 'option');
  row.setAttribute('aria-selected', 'false');
  row.dataset.code = code;
  const flag = code ? flagImg(code) : null;
  if (flag) {
    flag.className = 'feed-country-flag';
    row.appendChild(flag);
  } else {
    const spacer = document.createElement('span');
    spacer.className = 'feed-country-flag';
    spacer.setAttribute('aria-hidden', 'true');
    row.appendChild(spacer);
  }
  const label = document.createElement('span');
  label.className = 'feed-country-name';
  label.textContent = name;
  row.appendChild(label);
  return row;
}
const countryAny = { code: '', name: 'Any country', el: countryRowEl('', 'Any country') };
const countryRows = [];
for (const [code, name] of [...countryNameByCode.entries()].sort((a, b) => a[1].localeCompare(b[1]))) {
  const opt = document.createElement('option');
  opt.value = code;
  opt.textContent = name;
  filterCountry.appendChild(opt);
  const label = foldCountry(name);
  countryRows.push({
    code,
    name,
    label,
    words: label.split(/[\s,()'-]+/).filter(Boolean),
    aliases: countryAliases.get(code) || [label],
    el: countryRowEl(code, name),
  });
}
const countryByEl = new Map([[countryAny.el, countryAny], ...countryRows.map((row) => [row.el, row])]);
let countryShown = [];
let countryActive = -1;

function countryRank(row, q) {
  if (row.code.toLowerCase() === q || row.aliases.includes(q)) return 0;
  if (row.label.startsWith(q)) return 1;
  if (row.aliases.some((name) => name.startsWith(q))) return 2;
  if (row.words.some((word) => word.startsWith(q))) return 3;
  if (row.aliases.some((name) => name.includes(q))) return 4;
  return -1;
}

// The country a finished entry names: a full name, another name, or the code.
function countryNamed(text) {
  const q = foldCountry(text);
  if (!q) return null;
  return countryRows.find((row) => row.aliases.includes(q) || row.label === q || row.code.toLowerCase() === q) || null;
}

// The field shows the chosen country unless the list is open for typing.
function paintCountryField() {
  const code = filterCountry.value;
  const name = code ? (countryNameByCode.get(code) || code) : '';
  if (!countryBox.classList.contains('is-open')) countryInput.value = name;
  countryClear.hidden = !code;
  countryBox.classList.toggle('has-value', !!code);
}

function clearCountryActive() {
  for (const el of countryList.querySelectorAll('.is-active')) el.classList.remove('is-active');
  countryActive = -1;
}

function setCountryActive(index, scroll) {
  if (countryShown[countryActive]) countryShown[countryActive].el.classList.remove('is-active');
  countryActive = countryShown.length ? Math.max(0, Math.min(index, countryShown.length - 1)) : -1;
  const row = countryShown[countryActive];
  if (!row) {
    countryInput.removeAttribute('aria-activedescendant');
    return;
  }
  row.el.classList.add('is-active');
  countryInput.setAttribute('aria-activedescendant', row.el.id);
  if (!scroll) return;
  // Only the list scrolls; scrollIntoView would move the sheet as well.
  const top = row.el.offsetTop;
  const bottom = top + row.el.offsetHeight;
  if (scroll === 'center') countryList.scrollTop = top - (countryList.clientHeight - row.el.offsetHeight) / 2;
  else if (top < countryList.scrollTop) countryList.scrollTop = top;
  else if (bottom > countryList.scrollTop + countryList.clientHeight) countryList.scrollTop = bottom - countryList.clientHeight;
}

function paintCountryList(query) {
  const q = foldCountry(query);
  const chosen = filterCountry.value;
  if (!q) {
    countryShown = [countryAny, ...countryRows];
  } else {
    countryShown = countryRows
      .map((row) => [countryRank(row, q), row])
      .filter(([rank]) => rank >= 0)
      .sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name))
      .map(([, row]) => row);
  }
  for (const row of countryShown) row.el.setAttribute('aria-selected', row.code === chosen ? 'true' : 'false');
  clearCountryActive();
  countryList.replaceChildren(...countryShown.map((row) => row.el));
  countryList.hidden = countryShown.length === 0;
  countryEmpty.hidden = countryShown.length > 0;
  if (q) {
    countryList.scrollTop = 0;
    setCountryActive(0, false);
  } else {
    setCountryActive(Math.max(0, countryShown.findIndex((row) => row.code === chosen)), 'center');
  }
}

function openCountryList() {
  countryInput.setAttribute('aria-expanded', 'true');
  countryBox.classList.add('is-open');
  countryList.hidden = false;
  paintCountryList('');
  // The list is the last thing in the sheet: bring it up to the field.
  requestAnimationFrame(() => {
    const body = countryBox.closest('.feed-filter-body');
    if (!body || countryList.hidden) return;
    const listBox = countryList.getBoundingClientRect();
    const bodyBox = body.getBoundingClientRect();
    if (listBox.bottom > bodyBox.bottom) body.scrollTop += listBox.bottom - bodyBox.bottom + 8;
  });
}

function closeCountryList() {
  countryInput.setAttribute('aria-expanded', 'false');
  countryInput.removeAttribute('aria-activedescendant');
  countryBox.classList.remove('is-open');
  clearCountryActive();
  countryList.hidden = true;
  countryEmpty.hidden = true;
  paintCountryField();
}

function pickCountry(code) {
  closeCountryList();
  if (filterCountry.value !== code) {
    filterCountry.value = code;
    filterCountry.dispatchEvent(new Event('change'));
  }
  paintCountryField();
}

countryInput.addEventListener('focus', () => {
  if (!countryBox.classList.contains('is-open')) openCountryList();
  countryInput.select();
});
countryInput.addEventListener('click', () => {
  if (countryBox.classList.contains('is-open')) return;
  openCountryList();
  countryInput.select();
});
countryInput.addEventListener('input', () => {
  if (!countryBox.classList.contains('is-open')) {
    countryInput.setAttribute('aria-expanded', 'true');
    countryBox.classList.add('is-open');
  }
  paintCountryList(countryInput.value);
});
countryInput.addEventListener('keydown', (event) => {
  const open = countryBox.classList.contains('is-open');
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (!open) {
      openCountryList();
      return;
    }
    setCountryActive(countryActive + (event.key === 'ArrowDown' ? 1 : -1), true);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    if (!open) return;
    const row = countryShown[countryActive];
    if (row) pickCountry(row.code);
    else if (!foldCountry(countryInput.value)) pickCountry('');
    countryInput.blur(); // a phone drops its keyboard
  }
  // Escape: the page's capture handler closes the list first (closeCountryList).
});
// Leaving the field: a typed full name (or code) is picked, an emptied
// field is Any country, anything else keeps the country already chosen.
countryBox.addEventListener('focusout', () => {
  setTimeout(() => {
    if (countryBox.contains(document.activeElement) || !countryBox.classList.contains('is-open')) return;
    const text = countryInput.value;
    if (!foldCountry(text)) pickCountry('');
    else {
      const named = countryNamed(text);
      if (named) pickCountry(named.code);
      else closeCountryList();
    }
  }, 0);
});
// A press on a row keeps the focus in the field. The row is picked when
// the finger lifts without having moved, before a phone moves the focus
// (and this list closes); a drag scrolls the list (pointercancel) instead.
let countryPress = null;
function countryRowAt(target) {
  const el = target && target.closest ? target.closest('.feed-country-option') : null;
  return el ? countryByEl.get(el) || null : null;
}
countryList.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  countryPress = event.isPrimary ? { id: event.pointerId, x: event.clientX, y: event.clientY, row: countryRowAt(event.target) } : null;
});
countryList.addEventListener('pointermove', (event) => {
  if (countryPress && countryPress.id === event.pointerId
    && Math.hypot(event.clientX - countryPress.x, event.clientY - countryPress.y) > 8) countryPress = null;
});
countryList.addEventListener('pointercancel', () => { countryPress = null; });
countryList.addEventListener('pointerup', (event) => {
  const press = countryPress;
  countryPress = null;
  if (!press || press.id !== event.pointerId || !press.row) return;
  if (countryRowAt(document.elementFromPoint(event.clientX, event.clientY)) !== press.row) return;
  event.preventDefault();
  pickCountry(press.row.code);
  countryInput.blur();
});
countryList.addEventListener('mousedown', (event) => event.preventDefault());
// Assistive tech can click an option without a pointer.
countryList.addEventListener('click', (event) => {
  event.stopPropagation();
  const row = countryRowAt(event.target);
  if (!row || !countryBox.classList.contains('is-open')) return;
  pickCountry(row.code);
  countryInput.blur();
});
countryList.addEventListener('pointermove', (event) => {
  if (event.pointerType !== 'mouse') return;
  const el = event.target.closest('.feed-country-option');
  const index = el ? countryShown.findIndex((row) => row.el === el) : -1;
  if (index >= 0 && index !== countryActive) setCountryActive(index, false);
});
countryClear.addEventListener('pointerdown', (event) => event.preventDefault());
countryClear.addEventListener('click', (event) => {
  event.stopPropagation();
  pickCountry('');
});
paintCountryField();

placePackListeners.add(() => {
  if (!getQuery().filters.country || !feedOn()) return;
  showQueryResults();
});
onOwnersChange(() => {
  if (getQuery().filters.hashinal !== true || !feedOn()) return;
  showQueryResults();
});
