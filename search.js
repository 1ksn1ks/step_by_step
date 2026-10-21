import { map } from './map.js';
import { CloseALL } from './cssLogic.js';
import { activeMarkerPopups } from './marker.js';
import { activePolygonPopups } from './polygons.js';
import { showSearchPin, closeDrawAnchor } from './drawhere.js';
import { fetchLocalMarkers } from './msgbackend.js';
import { showLocalMarkers } from './localnews.js';
import { cancelAnimateMapTo, animateMapTo } from './animatemapto.js';
import { geojson, polygons } from './letall.js';
import { hashtagQuery, hashtagsIn } from './hashtag.js';
import { openLinkedPlace, MARKER_ZOOM } from './openplace.js';
import { ringCenter } from './polygonframe.js';

const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const searchBar = document.getElementById('search-bar');
const searchToggleBtn = document.getElementById('search-toggle-btn');
const searchClearBtn = document.getElementById('search-clear-btn');

// Fit the input to the placeholder at rest; it grows with the typed text
searchInput.size = 30;

let debounceTimer = null;
let currentRequest = 0;

function closeResults() {
  searchResults.style.display = 'none';
  searchResults.innerHTML = '';
  // Back to sizing for the typed text
  searchInput.size = Math.max(searchInput.value.length + 1, 20);
}

// Hide the whole bar (results are closed first, typed text is kept)
function closeSearchBar() {
  const wasOpen = searchBar.style.display === 'block';
  closeResults();
  searchBar.style.display = 'none';
  searchInput.blur();
  if (wasOpen) layerClosedByUI('search');
}

// 🔍 button: open the bar (below it, same height the topic chat opens) and
// focus the input; press again to close. Opening closes all panels (CloseALL)
// but leaves any open marker/polygon popups alone
searchToggleBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  closeDrawAnchor();
  if (searchBar.style.display !== 'block') {
    CloseALL();
    searchBar.style.display = 'block';
    searchInput.focus();
    layerOpened('search', { query: searchInput.value });
  } else {
    closeSearchBar();
  }
});

// Back/Forward: the search bar is a layer; Forward re-opens the same
// bar (typed text is kept), Back closes it through the normal funnel.
if (window.defineLayer) {
  window.defineLayer('search', {
    open: () => searchToggleBtn.click(),
    close: () => closeSearchBar(),
  });
}

function showResults(results, query) {
  if (results.length === 0) {
    const item = document.createElement('div');
    item.className = 'search-result-item';
    item.textContent = `No results for "${query}"`;
    item.style.cursor = 'default';
    searchResults.innerHTML = '';
    searchResults.appendChild(item);
    searchResults.style.display = 'block';
    return;
  }

  searchResults.innerHTML = '';
  for (const r of results) {
    const item = document.createElement('div');
    item.className = 'search-result-item';
    item.textContent = r.display_name;
    item.title = r.display_name;
    item.addEventListener('click', (e) => {
      // Don't let this click reach the map's "tap outside closes the pin"
      // listeners, or the freshly dropped search pin would vanish at once
      e.stopPropagation();
      cancelAnimateMapTo(); // stop the popup-open loop, or it kills this flyTo
      map.flyTo({
        center: [parseFloat(r.lon), parseFloat(r.lat)],
        zoom: 14,
        essentialOnly: true,
      });
      searchInput.value = r.display_name.split(',')[0];
      closeResults();
      searchInput.blur();
      // Drop the draw-here pin (no buttons) at the picked location
      showSearchPin({ lng: parseFloat(r.lon), lat: parseFloat(r.lat) });
      // Picking a destination closes any open marker/polygon popups
      activePolygonPopups.forEach((popup) => popup.remove());
      activeMarkerPopups.forEach((popup) => popup.remove());
      // Local news: show the 24h live markers for this result's country.
      // A new pick swaps the set (showLocalMarkers clears the previous one).
      const country = (r.address && r.address.country) || r.country_name || "";
      if (country) {
        fetchLocalMarkers(country).then(({ markers }) => showLocalMarkers(markers));
      } else {
        showLocalMarkers([]);
      }
    });
    searchResults.appendChild(item);
  }
  // While suggestions are visible, size the input to the longest one
  let longest = 0;
  for (const r of results) {
    longest = Math.max(longest, r.display_name.length);
  }
  searchInput.size = Math.max(searchInput.value.length + 1, longest + 1, 20);
  searchResults.style.display = 'block';
}

async function doSearch(query) {
  const requestId = ++currentRequest;
  try {
    // addressdetails=1 → r.address.country for the local-news view;
    // accept-language=en → country names in English, matching the backend's
    // (also English) reverse-geocode so the two sides always agree;
    // viewbox → bias results toward what's currently on screen, so "Athens"
    // means Athens, Greece when you're looking at Europe (skipped when the
    // whole globe is visible — there's no context to bias by).
    let viewbox = "";
    const b = map.getBounds();
    if (
      [b.west, b.south, b.east, b.north].every(Number.isFinite) &&
      b.north - b.south < 180
    ) {
      viewbox = `&viewbox=${b.west},${b.south},${b.east},${b.north}`;
    }
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=10&addressdetails=1&accept-language=en&q=${encodeURIComponent(query)}${viewbox}`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return;
    const data = await res.json();
    // Ignore stale responses from earlier keystrokes
    if (requestId !== currentRequest) return;
    showResults(data, query);
  } catch (err) {
    console.error('Search error:', err);
    if (requestId === currentRequest) closeResults();
  }
}

function postText(value) {
  if (Array.isArray(value)) return String(value[0] || "");
  return value == null ? "" : String(value);
}

function recordText(record) {
  if (!record) return { title: "", msg: "" };
  return { title: postText(record.title).slice(0, 20), msg: postText(record.msg) };
}

function readRecord(data) {
  if (typeof data === "function") {
    try { return data(); } catch { return null; }
  }
  return data || null;
}

function timeValue(value) {
  if (value == null || value === "") return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 1e12) return numeric;
  if (Number.isFinite(numeric) && numeric > 1e9) return numeric * 1000;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function localHashtagPosts(tag) {
  const posts = [];
  for (const feature of geojson.features) {
    const record = readRecord(feature.properties && feature.properties.popupData);
    const text = recordText(record);
    const tags = hashtagsIn(`${text.title} ${text.msg}`);
    if (!tags.includes(tag)) continue;
    const coords = feature.geometry && feature.geometry.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    posts.push({
      kind: "marker",
      topicId: feature.topicId,
      payer: feature.payer,
      number: feature.msgNumber,
      title: text.title,
      msg: text.msg,
      lng: Number(coords[0]),
      lat: Number(coords[1]),
      created: feature.created,
    });
  }
  for (const polygon of polygons) {
    const record = readRecord(polygon.popupData);
    const text = recordText(record);
    const tags = hashtagsIn(`${text.title} ${text.msg}`);
    if (!tags.includes(tag)) continue;
    const center = ringCenter(polygon);
    if (!center) continue;
    posts.push({
      kind: "polygon",
      topicId: polygon.topicId,
      payer: polygon.payer,
      number: polygon.msgNumber,
      title: text.title,
      msg: text.msg,
      lng: center[0],
      lat: center[1],
      created: polygon.created,
    });
  }
  return posts;
}

function hashtagLabel(post) {
  const icon = post.kind === "polygon" ? "🔷" : "📍";
  const title = String(post.title || "").trim() || "Untitled";
  const msg = String(post.msg || "").replace(/\s+/g, " ").trim();
  const extra = msg && msg !== title ? ` — ${msg}` : "";
  return `${icon} ${title}${extra}`;
}

function showHashtagResults(posts, tag) {
  if (posts.length === 0) {
    showResults([], `#${tag}`);
    return;
  }
  searchResults.innerHTML = "";
  let longest = 0;
  for (const post of posts) {
    const label = hashtagLabel(post);
    longest = Math.max(longest, label.length);
    const item = document.createElement("div");
    item.className = "search-result-item";
    item.textContent = label;
    item.title = label;
    item.addEventListener("click", (event) => {
      event.stopPropagation();
      const href = `${location.origin}${location.pathname}?place=${post.kind}&topic=${encodeURIComponent(post.topicId || "")}&payer=${encodeURIComponent(post.payer || "")}&n=${encodeURIComponent(post.number == null ? "" : String(post.number))}&at=${post.lng},${post.lat}`;
      closeSearchBar();
      openLinkedPlace(href);
    });
    searchResults.appendChild(item);
  }
  searchInput.size = Math.max(searchInput.value.length + 1, Math.min(longest + 1, 60), 20);
  searchResults.style.display = "block";
}

async function searchHashtags(tag) {
  const requestId = ++currentRequest;
  const merged = new Map();
  for (const post of localHashtagPosts(tag)) {
    if (!Number.isFinite(post.lng) || !Number.isFinite(post.lat)) continue;
    merged.set(`${post.kind}|${post.topicId}|${post.payer}|${post.number}`, post);
  }
  try {
    const res = await fetch(`/api/hashtags?tag=${encodeURIComponent(tag)}`);
    if (res.ok) {
      const data = await res.json();
      for (const post of data.posts || []) {
        const lng = Number(post.lng);
        const lat = Number(post.lat);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
        const row = { ...post, lng, lat };
        const key = `${row.kind}|${row.topicId}|${row.payer}|${row.number}`;
        if (!merged.has(key)) merged.set(key, row);
      }
    }
  } catch {
    /* loaded posts still show when the cache is offline */
  }
  if (requestId !== currentRequest) return;
  const posts = [...merged.values()].sort((a, b) => timeValue(b.created) - timeValue(a.created)).slice(0, 20);
  showHashtagResults(posts, tag);
}

searchInput.addEventListener('input', () => {
  const query = searchInput.value.trim();
  // Grow the input (and its bar) with the text; show × while there is text
  searchInput.size = Math.max(searchInput.value.length + 1, 20);
  searchClearBtn.style.display = searchInput.value ? 'flex' : 'none';
  const tag = hashtagQuery(query);
  if (query.startsWith("#")) {
    clearTimeout(debounceTimer);
    if (!tag) {
      closeResults();
      return;
    }
    debounceTimer = setTimeout(() => searchHashtags(tag), 250);
    return;
  }
  if (query.length < 2) {
    closeResults();
    return;
  }
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => doSearch(query), 400);
});

document.addEventListener("hashtag-search", (event) => {
  const tag = String(event.detail || "");
  if (!tag) return;
  closeDrawAnchor();
  searchBar.style.display = "block";
  layerOpened('search', { query: tag });
  searchInput.value = `#${tag}`;
  searchInput.size = Math.max(tag.length + 2, 20);
  searchClearBtn.style.display = "flex";
  searchHashtags(tag);
});

// × inside the bar: wipe the current text (and results) and refocus
searchClearBtn.addEventListener('click', () => {
  searchInput.value = '';
  searchInput.size = 30;
  searchClearBtn.style.display = 'none';
  closeResults();
  searchInput.focus();
});

// "45.81, 15.98" or "45.81 15.98" is lat, lng. If the first value only
// fits as a longitude, the pair is read the other way round.
// The 📋 copy button (map.js) writes "lng,lat" with 5 decimals and no
// space, e.g. "15.98000,45.81000". That exact shape is read lng first.
const COPIED_COORDS = /^(-?\d+\.\d{5}),(-?\d+\.\d{5})$/;

function parseCoords(text) {
  const copied = String(text).trim().match(COPIED_COORDS);
  if (copied) {
    const lng = Number(copied[1]);
    const lat = Number(copied[2]);
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat, lng };
  }
  const m = String(text).trim().match(/^(-?\d+(?:\.\d+)?)\s*(?:,\s*|\s+)(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  let lat = Number(m[1]);
  let lng = Number(m[2]);
  if (Math.abs(lat) > 90 && Math.abs(lat) <= 180 && Math.abs(lng) <= 90) [lat, lng] = [lng, lat];
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function flyToCoords(point) {
    clearTimeout(debounceTimer);
    closeResults();
    searchInput.blur();
    showSearchPin(point);
    activePolygonPopups.forEach((popup) => popup.remove());
    activeMarkerPopups.forEach((popup) => popup.remove());
    // Same camera move as opening a marker link.
    animateMapTo(map, [point.lng, point.lat], MARKER_ZOOM);
}

// Pasting coordinates flies at once, the same as Enter.
searchInput.addEventListener('paste', (e) => {
  const text = (e.clipboardData || window.clipboardData)?.getData('text') || '';
  const point = parseCoords(text);
  if (!point) return;
  e.preventDefault();
  searchInput.value = text.trim();
  searchInput.size = Math.max(searchInput.value.length + 1, 20);
  searchClearBtn.style.display = 'flex';
  flyToCoords(point);
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const point = parseCoords(searchInput.value);
    if (!point) return;
    e.preventDefault();
    flyToCoords(point);
    return;
  }
  if (e.key === 'Escape') {
    closeResults();
    searchInput.blur();
  }
});

// Close the whole bar when clicking outside it (the 🔍 button toggles itself).
// Capture phase: the toolbar buttons (OPTIONS, TOPIC CHAT, E2EE CHAT, ...)
// stopPropagation, so a bubble listener would never see their clicks
document.addEventListener('click', (e) => {
  if (!e.target.closest('#search-bar') && !e.target.closest('#search-toggle-btn')) {
    closeSearchBar();
  }
}, true);
