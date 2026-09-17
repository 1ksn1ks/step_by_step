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
import { getMessages, getTopicInfo } from "./hedera";
import { newActiveMarkerPopups, updateClusters, index } from "./marker";
import { newActivePolygonPopups, addPolygonWithImageFill } from "./polygons";
import { map } from './map.js';
import { processTopicMessages, allLoadedMessages } from "./processallmessages.js";
import { initialTopicId } from "./extracttopic.js";
import { toast } from "./toast";
import { applyInitialXYZ } from "./setinitialxyz.js";

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

// Pressing the ▸ arrow expands/collapses that topic's bio below its row
function toggleTopicBio(topicId, row, arrowBtn) {
  const existing = row.nextElementSibling;
  if (existing && existing.classList && existing.classList.contains('topic-bio-row')) {
    existing.remove();
    arrowBtn.textContent = '▸';
    return;
  }
  const bioEl = document.createElement('div');
  bioEl.className = 'topic-bio-row';
  bioEl.style.cssText = 'color: rgba(255,255,255,0.6); font-size: 1.6vh; line-height: 1.4; padding: 0.1em 0.2em 0.3em 1.4em; white-space: pre-wrap; word-break: break-word;';
  bioEl.textContent = globalTopicBios[topicId] || 'No bio set yet';
  row.after(bioEl);
  arrowBtn.textContent = '▾';
}

// Render the "Loaded topics:" list as rows: topic id + name, a ▸ arrow that
// expands the topic bio below the row, and a 📋 button that copies just the
// topic id. Filtered by the search box and sorted by the A→Z / Z→A buttons —
// re-renders on every keystroke / press.
export function renderLoadedTopics() {
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
    row.style.cssText = 'display: flex; align-items: center; gap: 0.5em; padding: 0.15em 0.2em;';

    const arrowBtn = document.createElement('span');
    arrowBtn.textContent = '▸';
    arrowBtn.style.cssText = 'cursor: pointer; font-size: 1.6vh;';
    arrowBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleTopicBio(topicId, row, arrowBtn);
      adjustTextareaHeight(el); // grow/shrink the list box for the bio row
    });
    row.appendChild(arrowBtn);

    const label = document.createElement('span');
    label.style.cssText = 'flex: 1; white-space: normal; word-break: break-all;';
    label.textContent = entry;
    row.appendChild(label);

    const copyBtn = document.createElement('span');
    copyBtn.textContent = '📋';
    copyBtn.style.cssText = 'cursor: pointer; font-size: 1.6vh;';
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
    row.appendChild(copyBtn);

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
      newStoredMarkers([]);
      newStoredPolygons([]);
      allLoadedMessages.length = 0;
      let userInput = document.getElementById("input-field").value.toLowerCase();
      let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
      let topicId;
  
      if (domainEntry && domainEntry.lastMessage) {
        topicId = domainEntry.lastMessage.topic;
      } else {
        topicId = userInput || initialTopicId;
      }
  
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

      applyInitialXYZ(result.messages, topicAdmin);

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
        }
  };
  
  