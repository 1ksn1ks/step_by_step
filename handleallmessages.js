import { adjustTextareaHeight } from "./adjusttextarea";
import { 
  newStoredMarkers,
  storedMarkers,
  newStoredPolygons,
  storedPolygons,
  newGlobalLoadedTopicIdsWithNames,
  geojson,
  polygons,
  newExistingMarkers,
  existingMarkers,
  globalLoadedTopicIdsWithNames,
  globalTopicBios,
  newGlobalTopicBios
  } from "./letall";
import { loadedDomains } from "./loaddomains";
import { getTopicInfo } from "./hedera";
import { getTopicData as getMessages } from "./topicdata";
import { newActiveMarkerPopups, updateClusters, index } from "./marker";
import { newActivePolygonPopups, addPolygonWithImageFill } from "./polygons";
import { map } from './map.js';
import { processTopicMessages, allLoadedMessages } from "./processallmessages.js";
import { initialTopicId } from "./extracttopic.js";
import { toast } from "./toast";
import { applyInitialXYZ } from "./setinitialxyz.js";
import { fillTopicIds } from "./topicidintext.js";

// Account ids and topic ids share the 0.0. form, and Hedera gives each number
// to only one of them. A remembered answer skips a second mirror ask.
const accountChecks = new Map();

export async function isHederaAccount(id) {
  if (accountChecks.has(id)) return accountChecks.get(id);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(`https://mainnet.mirrornode.hedera.com/api/v1/accounts/${id}`, { signal: controller.signal });
    if (response.status === 404) {
      accountChecks.set(id, false);
      return false;
    }
    if (!response.ok) return false;
    const data = await response.json();
    const yes = !!(data && data.account);
    if (yes) accountChecks.set(id, true);
    return yes;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Copy text to the clipboard with an http-safe fallback: navigator.clipboard
// only exists on HTTPS/localhost, so on a plain http origin (the dev remote)
// a temporary textarea + execCommand is used instead.
export function copyTextToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position: fixed; opacity: 0;';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      const ok = document.execCommand('copy');
      ok ? resolve() : reject(new Error('execCommand copy failed'));
    } catch (err) {
      reject(err);
    } finally {
      ta.remove();
    }
  });
}

// null = numeric topic id order (set at load), 'az'/'za' = by topic name
let loadedTopicsSortDir = null;

function topicNameOf(entry) {
  return entry.split(' - ').slice(1).join(' - ') || entry;
}

function topicChevron() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'm9 18 6-6-6-6');
  svg.appendChild(path);
  return svg;
}

function setTopicChevron(arrowBtn, open) {
  if (!arrowBtn) return;
  arrowBtn.classList.toggle('is-open', open);
  arrowBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

// The row chevron expands/collapses that topic's bio below its row.
function toggleTopicBio(topicId, row, arrowBtn) {
  const existing = row.nextElementSibling;
  if (existing && existing.classList && existing.classList.contains('topic-bio-row')) {
    existing.remove();
    setTopicChevron(arrowBtn, false);
    return;
  }
  const bioEl = document.createElement('div');
  bioEl.className = 'topic-bio-row';
  const raw = globalTopicBios[topicId];
  const bio = Array.isArray(raw) ? String(raw[0] || '') : (typeof raw === 'string' ? raw : '');
  if (bio) fillTopicIds(bioEl, bio);
  else bioEl.textContent = 'No bio set yet';
  row.after(bioEl);
  setTopicChevron(arrowBtn, true);
}

// Render the "Loaded topics:" list as rows: topic id + name, a ▸ arrow that
// expands the topic bio below the row, and a 📋 button that copies just the
// topic id. Filtered by the search box and sorted by the A→Z / Z→A buttons —
// re-renders on every keystroke / press.
function restoreLoadedTopics() {
  const label = document.getElementById('loaded-topics-label');
  if (label) label.style.display = '';
  const el = document.getElementById('loaded-topics');
  const controls = el && el.querySelector('.loaded-topics-controls');
  if (controls) controls.style.display = '';
  const list = document.getElementById('loaded-topics-list');
  if (list) list.style.display = '';
  const card = document.getElementById('loaded-bio-card');
  if (card) card.remove();
}

export function renderLoadedTopics() {
  restoreLoadedTopics();
  const el = document.getElementById('loaded-topics');
  const list = document.getElementById('loaded-topics-list');
  if (!el || !list) return;
  const searchEl = document.getElementById('loaded-topics-search');
  const query = (searchEl ? searchEl.value : '').trim().toLowerCase();

  let entries = [...globalLoadedTopicIdsWithNames];
  if (query) {
    entries = entries.filter(entry => entry.toLowerCase().includes(query));
  }
  if (loadedTopicsSortDir === 'az') {
    entries.sort((a, b) => topicNameOf(a).localeCompare(topicNameOf(b), undefined, { sensitivity: 'base', numeric: true }));
  } else if (loadedTopicsSortDir === 'za') {
    entries.sort((a, b) => topicNameOf(b).localeCompare(topicNameOf(a), undefined, { sensitivity: 'base', numeric: true }));
  }

  list.innerHTML = '';

  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'color: gray; padding: 0.15em 0.2em;';
    empty.textContent = query ? 'No matching topics' : 'No loaded topics';
    list.appendChild(empty);
    adjustTextareaHeight(el);
    return;
  }

  for (const entry of entries) {
    const topicId = entry.split(' - ')[0];

    const row = document.createElement('div');
    row.className = 'loaded-topic-row';

    const label = document.createElement('span');
    label.className = 'loaded-topic-label';
    label.textContent = entry;
    row.appendChild(label);

    const copyBtn = document.createElement('span');
    copyBtn.className = 'loaded-topic-copy';
    copyBtn.textContent = '📋';
    copyBtn.setAttribute('role', 'button');
    copyBtn.tabIndex = 0;
    copyBtn.setAttribute('aria-label', 'Copy topic id');
    copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await copyTextToClipboard(topicId);
        toast.success("Copied topic id");
        copyBtn.textContent = '✓';
        setTimeout(() => (copyBtn.textContent = '📋'), 900);
      } catch (err) {
        console.error('Copy failed:', err);
        toast.error('Could not copy topic id');
      }
    });
    copyBtn.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      copyBtn.click();
    });
    row.appendChild(copyBtn);

    const arrowBtn = document.createElement('span');
    arrowBtn.className = 'loaded-topic-chev';
    arrowBtn.setAttribute('aria-hidden', 'true');
    arrowBtn.appendChild(topicChevron());
    setTopicChevron(arrowBtn, false);
    row.appendChild(arrowBtn);

    row.addEventListener('click', () => {
      toggleTopicBio(topicId, row, arrowBtn);
      adjustTextareaHeight(el);
    });
    list.appendChild(row);
  }

  adjustTextareaHeight(el);
}

// Live search + sort for the loaded topics list
const loadedTopicsSearch = document.getElementById('loaded-topics-search');
const sortTopicsAz = document.getElementById('sort-topics-az');
const sortTopicsZa = document.getElementById('sort-topics-za');

function updateTopicSortButtons() {
  sortTopicsAz.classList.toggle('active', loadedTopicsSortDir === 'az');
  sortTopicsZa.classList.toggle('active', loadedTopicsSortDir === 'za');
}

if (loadedTopicsSearch) {
  loadedTopicsSearch.addEventListener('input', () => renderLoadedTopics());
}
if (sortTopicsAz) {
  sortTopicsAz.addEventListener('click', (e) => {
    e.stopPropagation();
    loadedTopicsSortDir = loadedTopicsSortDir === 'az' ? null : 'az';
    updateTopicSortButtons();
    renderLoadedTopics();
  });
}
if (sortTopicsZa) {
  sortTopicsZa.addEventListener('click', (e) => {
    e.stopPropagation();
    loadedTopicsSortDir = loadedTopicsSortDir === 'za' ? null : 'za';
    updateTopicSortButtons();
    renderLoadedTopics();
  });
}

export async function handleAllMessages() {
    try {
      const userInput = document.getElementById("input-field").value.toLowerCase();
      const accountMatch = userInput.trim().match(/^(0\.0\.\d+)(?:-[a-z0-9]+)?$/);
      if (accountMatch && await isHederaAccount(accountMatch[1]) && typeof window.loadBio4PIC === 'function') {
        await window.loadBio4PIC(accountMatch[1]);
        return;
      }
      newStoredMarkers([]);
      newStoredPolygons([]);
      allLoadedMessages.length = 0;
      let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
      let topicId;
  
      if (domainEntry && domainEntry.lastMessage) {
        topicId = domainEntry.lastMessage.topic;
      } else {
        topicId = userInput || initialTopicId;
      }

      restoreLoadedTopics();
      const loaded_text_area = document.getElementById("loaded-topics");
      loaded_text_area.value = '';
      const topicSpinnerChat = `
      <div style="display: flex; justify-content: left; align-items: left; padding-top: 1vh; padding-bottom: 1vh;">
        <div id="topicspinnerchat"></div>
         <span style="margin-left: 0.45vh;">loading messages from ${topicId}</span>
        </div>`;
      document.getElementById("loaded-topics-list").innerHTML = topicSpinnerChat;
      adjustTextareaHeight(loaded_text_area);
  
  
      const topicAdmin = [];
  
  try{
      const topicInfo = await getTopicInfo(topicId);
            const memo = topicInfo.memo;
  
            const parts = memo.split(',');
  
            parts.forEach(part => {
              if (part.startsWith("0.0.")) {
                topicAdmin.push(part);
              }
            });
          }catch (error){
            const loaded_text_area = document.getElementById("loaded-topics");
      loaded_text_area.value = '';
      const topicSpinnerChat = `
      <div style="display: flex; justify-content: left; align-items: left; padding-top: 1vh; padding-bottom: 1vh;">
         <span style="margin-left: 0.45vh;">Invalid Topic ID</span>
        </div>`;
      document.getElementById("loaded-topics-list").innerHTML = topicSpinnerChat;
      adjustTextareaHeight(loaded_text_area);
      console.error("Error getting topic info:", error);
      return;
          }
  
  
      newGlobalLoadedTopicIdsWithNames([]);
      let loadedTopicsIds = [];
      newActiveMarkerPopups([]);
      newActivePolygonPopups([]);
  
  
      const result = await getMessages(topicId);

      let hasMoreThanOneTopic = false;
  
      geojson.features = [];
      polygons.length = 0;
  
      existingMarkers.forEach(marker => marker.remove());
      newExistingMarkers([]);
  
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
  
  
  
  
      const topicActions = new Map();
  
      for (let index = 0; index < result.messages.length; index++) {
        const message = result.messages[index];
        try {
          let parsedMessage = message;
          if (typeof message === 'string') {
            parsedMessage = JSON.parse(message);
          }
          const timestamp = message.consensus_timestamp
  
          if (parsedMessage.addTopic && parsedMessage.addTopic.addTopic && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
            hasMoreThanOneTopic = true;
            const topics = typeof parsedMessage.addTopic.addTopic === 'string'
              ? parsedMessage.addTopic.addTopic.split(',')
              : [];
            topics.forEach(topic => {
              topicActions.set(topic, { action: 'add', timestamp });
            });
          }
  
          if (parsedMessage.removeTopic && parsedMessage.removeTopic.removeTopic && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
            hasMoreThanOneTopic = true;
            const topics = typeof parsedMessage.removeTopic.removeTopic === 'string'
              ? parsedMessage.removeTopic.removeTopic.split(',')
              : [];
            topics.forEach(topic => {
              topicActions.set(topic, { action: 'remove', timestamp });
            });
          }
        } catch (messageError) {
          console.error(`Error processing message ${index}:`, messageError);
        }
      }
  
      // Determine the final list of topics based on the latest action
      loadedTopicsIds = Array.from(topicActions.entries())
        .filter(([topic, { action }]) => action === 'add' && topic.startsWith('0.0.'))
        .map(([topic]) => topic);

      // A shared topic address is the topic itself, not a list of other topics.
      // Load its markers and polygons so Open on the map can land on that pin.
      if (loadedTopicsIds.length === 0 && String(topicId || '').startsWith('0.0.')) {
        loadedTopicsIds = [topicId];
      }

        const loadedTopicIdsWithNames = [];
  
        const totalTopics = loadedTopicsIds.length;
        let processedCount = 0;
  
      // Load and process messages from each topic in loadedTopicsIds
      const topicBios = {};
      for (const topicId of loadedTopicsIds) {
        const { topicGeojsonFeatures, topicPolygons, loadedTopicName, topicBio } = await processTopicMessages(topicId);

        storedMarkers.push(topicGeojsonFeatures);
        storedPolygons.push(topicPolygons);

        if (topicBio) {
          topicBios[topicId] = topicBio;
        }

        if (loadedTopicName !== undefined) { // Only skip if loadedTopicName is undefined
          const topicNamePart = loadedTopicName ? ` - ${loadedTopicName}` : '';
          loadedTopicIdsWithNames.push(`${topicId}${topicNamePart}`);
        }

       processedCount++;
      }
      newGlobalTopicBios(topicBios);

      if ( totalTopics === processedCount){

        polygons.forEach(polygon => {
          addPolygonWithImageFill(map, polygon);
        });

        if (geojson.features.length > 0) {
          index.load(geojson.features);
          updateClusters();
        }

      }

      // After the cluster index exists. Flying earlier runs updateClusters
      // on every animation frame before index.load and kills the map.
      applyInitialXYZ(result.messages, topicAdmin);
  
      newGlobalLoadedTopicIdsWithNames(loadedTopicIdsWithNames);
  
  
      globalLoadedTopicIdsWithNames.sort((a, b) => {
        const idA = parseFloat(a.split('-')[0].replace('0.0.', ''));
        const idB = parseFloat(b.split('-')[0].replace('0.0.', ''));
        return idA - idB;
      });
  
      renderLoadedTopics(); // Update with rows: topic id + name + 📋 + ✕

      toast.loaded("Topic loaded");
      return loadedTopicIdsWithNames; // Return the loadedTopicsIds array
  
        } catch (error) {
          console.error("Error processing topic messages:", error);
        } finally {
          // Notification links wait for this before looking up a marker.
          if (!window.__topicsReady) {
            window.__topicsReady = true;
            window.dispatchEvent(new Event("topics-ready"));
          }
        }
  };
  
  