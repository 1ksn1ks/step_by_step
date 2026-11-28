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
import { getTopicData as getMessages, latestTopicTs } from "./topicdata";
import { newActiveMarkerPopups, updateClusters, index } from "./marker";
import { newActivePolygonPopups, addPolygonWithImageFill } from "./polygons";
import { map } from './map.js';
import { beginMapDraw, mapDrawCurrent, processTopicMessages, allLoadedMessages } from "./processallmessages.js";
import { PULL_AT_ONCE, STACK_FIRST_MS, mapLimited, settlesWithin } from "./feedmerge.js";
import { inTimeRange, isStale, timeFilterFor, timeRange } from "./timefilter.js";
import { initialTopicId } from "./extracttopic.js";
import { toast } from "./toast";
import { applyInitialXYZ } from "./setinitialxyz.js";
import { fillTopicIds } from "./topicidintext.js";
import { clearXEmbeds, paintXEmbeds } from "./xembed.js";
import { STACK_MAX, activeStack, currentPinnedStacks, currentStackedTopics, readStackPicks, saveStackPicks, topicsToLoad } from "./loadcurrenttopic.js";

// Account ids and topic ids share the 0.0. form, and Hedera gives each number
// to only one of them. A remembered answer skips a second mirror ask.
const accountChecks = new Map();

async function mirrorHas(kind, id, signal) {
  const response = await fetch(`https://mainnet.mirrornode.hedera.com/api/v1/${kind}/${encodeURIComponent(id)}`, { signal });
  if (response.status === 404) return false;
  if (!response.ok) return null;
  return true;
}

export async function isHederaAccount(id) {
  if (!id) return false;
  if (accountChecks.has(id)) return accountChecks.get(id);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    // Account ids and topic ids share 0.0.N. Ask /accounts/ and stop when
    // it answers, so an account load does not also 404 /topics/.
    const account = await mirrorHas('accounts', id, controller.signal);
    if (account === null) return false;
    accountChecks.set(id, account);
    return account;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Copy text to the clipboard with an http-safe fallback: navigator.clipboard
// only exists on HTTPS/localhost, so on a plain http origin (the dev remote)
// a temporary textarea + execCommand is used instead. The same fallback runs
// when writeText refuses (the document not focused, permission denied).
function copyWithTextarea(text) {
  return new Promise((resolve, reject) => {
    const before = document.activeElement;
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position: fixed; top: 0; left: 0; opacity: 0;';
    document.body.appendChild(ta);
    ta.focus({ preventScroll: true });
    ta.select();
    try {
      const ok = document.execCommand('copy');
      ok ? resolve() : reject(new Error('execCommand copy failed'));
    } catch (err) {
      reject(err);
    } finally {
      ta.remove();
      if (before && before.focus && before !== document.body) before.focus({ preventScroll: true });
    }
  });
}

export function copyTextToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).catch(() => copyWithTextarea(text));
  }
  return copyWithTextarea(text);
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
  const toggle = arrowBtn.parentElement;
  if (toggle && toggle.tagName === 'BUTTON') {
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
}

// The row chevron expands/collapses that topic's bio below its row.
function toggleTopicBio(topicId, row, arrowBtn) {
  const existing = row.nextElementSibling;
  if (existing && existing.classList && existing.classList.contains('topic-bio-row')) {
    // An X post card under the bio goes with it.
    clearXEmbeds(existing);
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
  paintXEmbeds(bioEl);
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
}

// The open topic's stack as the list shows it: every stacked topic, the
// ones a Load fetches ticked (picks, admin pins, or the newest), and the
// admin's pins. A tick follows the topic id, so search and sort keep it.
// Load saves the ticks (saveStackPicks) only after a box was changed.
let stackView = null;

function setStackView(open, messages, admins) {
  const stack = activeStack(messages, admins, open);
  stackView = {
    open,
    messages,
    admins,
    stack,
    onStack: new Set(stack),
    pins: new Set(currentPinnedStacks(messages, admins, open) || []),
    checked: new Set(currentStackedTopics(messages, admins, open)),
    dirty: false,
  };
}

// A new list is coming; the last one's ticks and Reset go with it.
function clearStackView() {
  stackView = null;
  syncStackTicks(null);
}

function stackTicked() {
  return stackView ? stackView.stack.filter((id) => stackView.checked.has(id)) : [];
}

// At STACK_MAX ticks the other boxes lock. The open topic always loads.
// Reset to default shows while saved picks decide the load.
function syncStackTicks(list) {
  const reset = document.getElementById('loaded-topics-reset');
  if (reset) reset.hidden = !(stackView && readStackPicks(stackView.open, stackView.stack).length);
  if (!list || !stackView) return;
  const full = stackTicked().length >= STACK_MAX;
  for (const box of list.querySelectorAll('.loaded-topic-pick > input')) {
    const open = box.dataset.topic === stackView.open;
    box.checked = open || stackView.checked.has(box.dataset.topic);
    box.disabled = open || (full && !box.checked);
  }
}

function tickStack(topicId, on, list) {
  if (!stackView || topicId === stackView.open) return;
  if (on && !stackView.checked.has(topicId) && stackTicked().length >= STACK_MAX) {
    toast.info(`Up to ${STACK_MAX} stacked topics load at once`);
  } else {
    if (on) stackView.checked.add(topicId);
    else stackView.checked.delete(topicId);
    stackView.dirty = true;
  }
  syncStackTicks(list);
}

// The box at the start of a row. A tap on it, or on the space around it,
// never opens the bio. A locked box lets the tap through to say why.
function stackPick(topicId, list) {
  const pick = document.createElement('span');
  pick.className = 'loaded-topic-pick';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.dataset.topic = topicId;
  box.setAttribute('aria-label', topicId === stackView.open ? 'Open topic, always loads' : `Load ${topicId}`);
  box.addEventListener('click', (e) => e.stopPropagation());
  box.addEventListener('change', () => tickStack(topicId, box.checked, list));
  pick.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!stackView || topicId === stackView.open) return;
    if (box.disabled) {
      toast.info(`Up to ${STACK_MAX} stacked topics load at once`);
      return;
    }
    tickStack(topicId, !box.checked, list);
  });
  pick.appendChild(box);
  return pick;
}

export function renderLoadedTopics() {
  restoreLoadedTopics();
  const el = document.getElementById('loaded-topics');
  const list = document.getElementById('loaded-topics-list');
  syncStackTicks(null);
  if (!el || !list) return;
  const searchEl = document.getElementById('loaded-topics-search');
  const query = (searchEl ? searchEl.value : '').trim().toLowerCase();

  let entries = [...globalLoadedTopicIdsWithNames];
  // Stacked topics this Load did not fetch are listed by id, to tick.
  const picks = stackView && stackView.stack.length ? stackView : null;
  if (picks) {
    const listed = new Set(entries.map((entry) => entry.split(' - ')[0]));
    const unread = picks.stack.filter((id) => !listed.has(id));
    if (unread.length) {
      entries.push(...unread);
      sortTopicRows(entries);
    }
  }
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
    if (picks && (topicId === picks.open || picks.onStack.has(topicId))) {
      row.classList.add('has-pick');
      row.appendChild(stackPick(topicId, list));
    }

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'loaded-topic-open';
    openBtn.setAttribute('aria-expanded', 'false');

    const label = document.createElement('span');
    label.className = 'loaded-topic-label';
    label.textContent = entry;
    if (picks && picks.pins.has(topicId)) {
      const pin = document.createElement('span');
      pin.className = 'loaded-topic-pin';
      pin.textContent = '📌';
      pin.title = 'Pinned by admin';
      pin.setAttribute('aria-label', 'Pinned by admin');
      label.prepend(pin);
    }
    openBtn.appendChild(label);

    const arrowBtn = document.createElement('span');
    arrowBtn.className = 'loaded-topic-chev';
    arrowBtn.setAttribute('aria-hidden', 'true');
    arrowBtn.appendChild(topicChevron());
    setTopicChevron(arrowBtn, false);
    openBtn.appendChild(arrowBtn);
    row.appendChild(openBtn);

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'loaded-topic-copy';
    copyBtn.textContent = '📋';
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
    row.appendChild(copyBtn);

    row.addEventListener('click', () => {
      const selected = window.getSelection && window.getSelection();
      if (selected && selected.toString()) return;
      toggleTopicBio(topicId, row, arrowBtn);
      adjustTextareaHeight(el);
    });
    list.appendChild(row);
  }

  syncStackTicks(list);
  adjustTextareaHeight(el);
}

// Load keeps the ticks for this topic first, then runs as before (the
// load itself waits for its click debounce). Untouched boxes save nothing,
// so the admin's pins and the newest adds still decide.
const loadPress = document.getElementById('toolbar-load');
if (loadPress) {
  loadPress.addEventListener('click', () => {
    if (!stackView || !stackView.dirty) return;
    saveStackPicks(stackView.open, stackTicked());
    stackView.dirty = false;
  }, true);
}

const stackReset = document.getElementById('loaded-topics-reset');
if (stackReset) {
  stackReset.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!stackView) return;
    saveStackPicks(stackView.open, []);
    stackView.checked = new Set(currentStackedTopics(stackView.messages, stackView.admins, stackView.open));
    stackView.dirty = false;
    syncStackTicks(document.getElementById('loaded-topics-list'));
  });
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

// The topic and time filter the map was last loaded with. The feed reloads
// the map when it uncovers it and the filter has changed since (syncCover),
// and the map's time chip shows that topic's filter: mapTopic(), and
// onMapTopic(fn) runs each time a load takes a topic.
let mapApplied = null;
const mapTopicListeners = new Set();

export function mapFilterStale() {
  return !!mapApplied && timeFilterFor(mapApplied.topic) !== mapApplied.key;
}

export function mapTopic() {
  return mapApplied ? mapApplied.topic : '';
}

export function onMapTopic(fn) {
  mapTopicListeners.add(fn);
  return () => mapTopicListeners.delete(fn);
}

function applyMapTopic(topic, key) {
  mapApplied = { topic, key };
  for (const fn of mapTopicListeners) {
    try {
      fn(topic);
    } catch (error) {
      console.warn('map topic listener failed', error);
    }
  }
}

// With a range, a topic whose newest message is older than it is not read:
// "Today" on a year topic reads its current month. The newest time comes
// from this device's copy, else a one-row ask (topicdata.js latestTopicTs),
// three at a time. A topic whose time is unknown is read.
async function topicsInRange(topics, range) {
  if (!range) return topics;
  const latest = await mapLimited(topics, PULL_AT_ONCE, (topic) => latestTopicTs(topic).catch(() => ''));
  return topics.filter((topic, i) => !isStale(latest[i], range));
}

function nameRow(topicId, loadedTopicName) {
  return `${topicId}${loadedTopicName ? ` - ${loadedTopicName}` : ''}`;
}

function sortTopicRows(list) {
  list.sort((a, b) => {
    const idA = parseFloat(a.split('-')[0].replace('0.0.', ''));
    const idB = parseFloat(b.split('-')[0].replace('0.0.', ''));
    return idA - idB;
  });
}

// topic: load this topic id instead of what #input-field holds. The map's
// time chip reloads the topic the map shows; the field may hold one that
// was typed or filled in but not loaded yet.
// opts.keepView: leave the camera where it is (no fly to the topic's saved
// start view). A time filter reload redraws the same topic in place.
export async function handleAllMessages(topic, opts = {}) {
    try {
      const userInput = (typeof topic === "string" && topic ? topic : document.getElementById("input-field").value).toLowerCase();
      const accountMatch = userInput.trim().match(/^(0\.0\.\d+)(?:-[a-z0-9]+)?$/);
      // An account id shares the 0.0. shape with a topic. Stop here, before
      // any stored map data is cleared, even when the profile hook is absent.
      if (accountMatch && await isHederaAccount(accountMatch[1])) {
        if (typeof window.loadBio4PIC === 'function') {
          await window.loadBio4PIC(accountMatch[1]);
        }
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
      clearStackView();
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

      // The topic exists. A press on Load closes the Load page and the
      // drawer behind it now (feedlayout.js), so the map or the feed shows
      // the topic while its messages come in.
      window.dispatchEvent(new CustomEvent("topic-load-valid", { detail: { topicId } }));

      newGlobalLoadedTopicIdsWithNames([]);
      let loadedTopicsIds = [];
      newActiveMarkerPopups([]);
      newActivePolygonPopups([]);

      // This load's time filter. From here, drawings of an older load that
      // is still running stop (its late topics), and only posts inside the
      // range are drawn (processallmessages.js publishApprovedDrawings).
      const filterKey = timeFilterFor(topicId);
      const range = timeRange(filterKey);
      applyMapTopic(topicId, filterKey);
      const drawToken = beginMapDraw(range);

      const result = await getMessages(topicId);
      // A newer load started while this one waited.
      if (!mapDrawCurrent(drawToken)) return [];

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
  
  
  
  
      // The open topic, then its stacked topics (loadcurrenttopic.js: at most
      // STACK_MAX, newest adds first, one level deep). The feed reads the
      // same list (topicstack.js).
      loadedTopicsIds = await topicsInRange(topicsToLoad(topicId, result.messages, topicAdmin), range);
      if (!mapDrawCurrent(drawToken)) return [];

      const loadedTopicIdsWithNames = [];
      const topicBios = {};
      // What a topic adds once processed. A topic that failed adds nothing
      // and the others still draw.
      const take = (stackedId, out) => {
        if (!out) return;
        storedMarkers.push((out.topicGeojsonFeatures || []).filter((f) => inTimeRange(f && f.created, range)));
        storedPolygons.push((out.topicPolygons || []).filter((p) => inTimeRange(p && p.created, range)));
        if (out.topicBio) topicBios[stackedId] = out.topicBio;
        if (out.loadedTopicName !== undefined) loadedTopicIdsWithNames.push(nameRow(stackedId, out.loadedTopicName));
      };
      const processed = (stackedId) => processTopicMessages(stackedId, { token: drawToken }).catch((error) => {
        console.warn('map leaves out topic', stackedId, error);
        return null;
      });
      // Three topics at a time; each gets STACK_FIRST_MS before the map goes
      // on without it. A late topic keeps drawing as it loads (its drawings
      // publish as they are approved) and joins the topic list when done.
      await mapLimited(loadedTopicsIds, PULL_AT_ONCE, async (stackedId) => {
        const job = processed(stackedId);
        if (await settlesWithin(job, STACK_FIRST_MS)) {
          take(stackedId, await job);
          return;
        }
        job.then((out) => {
          if (!mapDrawCurrent(drawToken) || !out) return;
          storedMarkers.push((out.topicGeojsonFeatures || []).filter((f) => inTimeRange(f && f.created, range)));
          storedPolygons.push((out.topicPolygons || []).filter((p) => inTimeRange(p && p.created, range)));
          if (out.topicBio) newGlobalTopicBios({ ...globalTopicBios, [stackedId]: out.topicBio });
          if (out.loadedTopicName !== undefined) {
            globalLoadedTopicIdsWithNames.push(nameRow(stackedId, out.loadedTopicName));
            sortTopicRows(globalLoadedTopicIdsWithNames);
            renderLoadedTopics();
          }
        });
      });
      if (!mapDrawCurrent(drawToken)) return [];
      newGlobalTopicBios(topicBios);

      polygons.forEach(polygon => {
        addPolygonWithImageFill(map, polygon);
      });

      if (geojson.features.length > 0) {
        index.load(geojson.features);
        updateClusters();
      }

      // After the cluster index exists. Flying earlier runs updateClusters
      // on every animation frame before index.load and kills the map.
      if (!opts || !opts.keepView) applyInitialXYZ(result.messages, topicAdmin);
  
      newGlobalLoadedTopicIdsWithNames(loadedTopicIdsWithNames);
      sortTopicRows(globalLoadedTopicIdsWithNames);
      setStackView(String(topicId).trim(), result.messages, topicAdmin);

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
  
  