import { map } from './map.js';
import { CloseALL } from './cssLogic.js';
import { activeMarkerPopups } from './marker.js';
import { activePolygonPopups } from './polygons.js';
import { showSearchPin } from './drawhere.js';

const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const searchBar = document.getElementById('search-bar');
const searchToggleBtn = document.getElementById('search-toggle-btn');
const searchClearBtn = document.getElementById('search-clear-btn');

// Fit the input to the placeholder at rest; it grows with the typed text
searchInput.size = 24;

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
  closeResults();
  searchBar.style.display = 'none';
  searchInput.blur();
}

// 🔍 button: open the bar (below it, same height the topic chat opens) and
// focus the input; press again to close. Opening closes all panels (CloseALL)
// but leaves any open marker/polygon popups alone
searchToggleBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (searchBar.style.display !== 'block') {
    CloseALL();
    searchBar.style.display = 'block';
    searchInput.focus();
  } else {
    closeSearchBar();
  }
});

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
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}`;
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

searchInput.addEventListener('input', () => {
  const query = searchInput.value.trim();
  // Grow the input (and its bar) with the text; show × while there is text
  searchInput.size = Math.max(searchInput.value.length + 1, 20);
  searchClearBtn.style.display = searchInput.value ? 'flex' : 'none';
  if (query.length < 2) {
    closeResults();
    return;
  }
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => doSearch(query), 400);
});

// × inside the bar: wipe the current text (and results) and refocus
searchClearBtn.addEventListener('click', () => {
  searchInput.value = '';
  searchInput.size = 24;
  searchClearBtn.style.display = 'none';
  closeResults();
  searchInput.focus();
});

searchInput.addEventListener('keydown', (e) => {
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
