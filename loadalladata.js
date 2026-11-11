import { perfJob } from './perf.js';
import { getTopicData as getMessages } from "./topicdata";
import { fetchUserSettings } from "./msgbackend";
import { readSettings, writeSettings } from "./settingscache.js";
import { profilePictureUrls, publishProfilePictures } from "./picturecache.js";
import { profileTopicAction } from "./server/profiletopic.js";
import { normalizeSwap, sameSwapProfile, swapProfileAction } from "./server/swapprofile.js";
import { swapBioAction } from "./server/swapbio.js";

export let profilePictures = [];
export let usernames = [];
export let click2url = [];
export let topicBio = [];
// The topic connected to an account. Shares land there. Followers follow it.
export let profileTopics = {};
// Optional swap on an account. Missing means off (enabled false, fee 0).
export let profileSwaps = {};
// The creator's Swap bio. Missing or "" means the sheet shows no note.
export let profileSwapBios = {};

// A change this phone just sent. It is shown immediately and is not written
// into the saved copy. The next server card that matches it removes it. If
// the message never lands, the next cold open shows the saved server value.
const ownOverlay = new Map();
// Account rows last read from this phone or from the server. Picture messages
// send these links plus ownOverlay, so one edit cannot shrink the set.
let savedAccounts = [];
let savedAccountsReady = false;
let inflight = null;
let toldCacheFull = false;
let triedTopicFallback = false;
const SETTINGS_POLL_MS = 30000;

function tellCacheFull() {
  if (toldCacheFull) return;
  toldCacheFull = true;
  window.dispatchEvent(new CustomEvent('topic-cache-full'));
}

function snapshot() {
  return { profilePictures, usernames, click2url, topicBio };
}

async function ensureSavedAccounts() {
  if (savedAccountsReady) return;
  try {
    const local = await readSettings();
    if (savedAccountsReady) return;
    savedAccounts = (local && local.accounts) || [];
    savedAccountsReady = true;
  } catch (error) {
    console.warn('settings cache read failed', error);
  }
}

// A picture message is the full current list. Skip it when the saved accounts
// could not be read, so a short list cannot wipe the cache.
async function publishSavedPictures(nextAccounts) {
  if (nextAccounts !== undefined) {
    savedAccounts = nextAccounts || [];
    savedAccountsReady = true;
  } else {
    await ensureSavedAccounts();
    if (!savedAccountsReady) return;
  }
  await publishProfilePictures(profilePictureUrls(savedAccounts, [...ownOverlay.values()]));
}

function applyAccounts(accounts) {
  const pics = {};
  const names = {};
  const links = {};
  const bios = {};
  const topics = {};
  const swaps = {};
  const swapBios = {};
  for (const row of accounts || []) {
    if (!row || !row.accountId) continue;
    if (row.profilePic) pics[row.accountId] = { url: row.profilePic, timestamp: row.updatedAt };
    if (row.username) names[row.accountId] = { username: row.username, timestamp: row.updatedAt };
    if (row.click2url) links[row.accountId] = { click2url: row.click2url, timestamp: row.updatedAt };
    if (row.bio) bios[row.accountId] = { topic_bio: row.bio, timestamp: row.updatedAt };
    if (row.topic) topics[row.accountId] = row.topic;
    // An old saved card has no swap key. Leave it out so the profile stays off.
    if (row.swap && typeof row.swap === "object") swaps[row.accountId] = normalizeSwap(row.swap);
    if (typeof row.swapBio === "string" && row.swapBio.length > 0 && row.swapBio.length <= 280) {
      swapBios[row.accountId] = row.swapBio;
    }
  }
  profilePictures = pics;
  usernames = names;
  click2url = links;
  topicBio = bios;
  profileTopics = topics;
  profileSwaps = swaps;
  profileSwapBios = swapBios;
}

function mergeAccounts(local, incoming) {
  const byId = new Map();
  for (const row of local || []) {
    if (row && row.accountId) byId.set(row.accountId, row);
  }
  for (const row of incoming || []) {
    if (row && row.accountId) byId.set(row.accountId, row);
  }
  return [...byId.values()];
}

function reconcileOverlay(accounts) {
  const byId = new Map();
  for (const row of accounts || []) {
    if (row && row.accountId) byId.set(row.accountId, row);
  }
  for (const [accountId, patch] of ownOverlay) {
    const row = byId.get(accountId);
    if (!row) continue;
    if (patch.username && row.username === patch.username) delete patch.username;
    if (patch.profilePic && row.profilePic === patch.profilePic) delete patch.profilePic;
    if (patch.click2url && row.click2url === patch.click2url) delete patch.click2url;
    if (patch.bio && row.bio === patch.bio) delete patch.bio;
    if ('topic' in patch && (row.topic || '') === (patch.topic || '')) delete patch.topic;
    // A card from before swap existed has no swap key. Keep the local edit
    // until a server card actually carries swap and it matches.
    if (patch.swap && Object.prototype.hasOwnProperty.call(row, "swap") && sameSwapProfile(row.swap, patch.swap)) delete patch.swap;
    if ("swapBio" in patch && Object.prototype.hasOwnProperty.call(row, "swapBio") && (row.swapBio || "") === patch.swapBio) delete patch.swapBio;
    if (!patch.username && !patch.profilePic && !patch.click2url && !patch.bio && !('topic' in patch) && !patch.swap && !("swapBio" in patch)) ownOverlay.delete(accountId);
  }
}

function applyOverlay() {
  for (const [accountId, patch] of ownOverlay) {
    if (patch.profilePic) profilePictures[accountId] = { url: patch.profilePic, timestamp: Date.now() };
    if (patch.username) usernames[accountId] = { username: patch.username, timestamp: Date.now() };
    if (patch.click2url) click2url[accountId] = { click2url: patch.click2url, timestamp: Date.now() };
    if (patch.bio) topicBio[accountId] = { topic_bio: patch.bio, timestamp: Date.now() };
    if ('topic' in patch) {
      if (patch.topic) profileTopics[accountId] = patch.topic;
      else delete profileTopics[accountId];
    }
    if (patch.swap) profileSwaps[accountId] = normalizeSwap(patch.swap);
    if ("swapBio" in patch) {
      if (patch.swapBio) profileSwapBios[accountId] = patch.swapBio;
      else delete profileSwapBios[accountId];
    }
  }
}

export function showOwnProfile(accountId, patch) {
  if (!accountId || !patch) return;
  const prev = ownOverlay.get(accountId) || {};
  ownOverlay.set(accountId, { ...prev, ...patch });
  applyOverlay();
  if (patch.profilePic) publishSavedPictures();
  document.dispatchEvent(new CustomEvent('profiles-loaded'));
}

async function loadAllDataBody() {
  let local = { generation: '', revision: 0, accounts: [] };
  try {
    local = await readSettings();
  } catch (error) {
    console.warn('settings cache read failed', error);
  }
  if (local.accounts.length) {
    applyAccounts(local.accounts);
    applyOverlay();
    await publishSavedPictures(local.accounts);
    document.dispatchEvent(new CustomEvent('profiles-loaded'));
  }

  let remote = { ready: false, generation: '', revision: 0, settings: [] };
  try {
    remote = await fetchUserSettings(local.revision, local.generation);
  } catch (error) {
    console.warn('settings fetch failed', error);
  }
  if (remote.ready) {
    const replace = remote.generation !== local.generation || !(local.revision > 0);
    const unchanged = !replace
      && remote.generation === local.generation
      && remote.revision === local.revision
      && !(remote.settings && remote.settings.length);
    if (unchanged) return snapshot();
    const accounts = replace ? (remote.settings || []) : mergeAccounts(local.accounts, remote.settings);
    reconcileOverlay(accounts);
    applyAccounts(accounts);
    applyOverlay();
    try {
      const full = await writeSettings(
        remote.generation,
        remote.revision,
        replace ? accounts : remote.settings,
        replace
      );
      if (full) tellCacheFull();
    } catch (error) {
      console.warn('settings cache write failed', error);
    }
    await publishSavedPictures(accounts);
    document.dispatchEvent(new CustomEvent('profiles-loaded'));
    return snapshot();
  }

  if (local.accounts.length || triedTopicFallback) return snapshot();
  triedTopicFallback = true;
  profilePictures = await loadProfilePicture();
  usernames = await loadUsername();
  click2url = await loadCLICK2URL();
  topicBio = await loadTopicBio();
  profileTopics = bioTopicLinks;
  profileSwaps = bioSwapLinks;
  profileSwapBios = bioSwapBios;
  applyOverlay();
  document.dispatchEvent(new CustomEvent('profiles-loaded'));
  return snapshot();
}

export function loadAllData() {
  if (inflight) return inflight;
  inflight = perfJob('loadAllData', () => loadAllDataBody()).finally(() => {
    inflight = null;
  });
  return inflight;
}

loadAllData();

setInterval(() => {
  if (document.visibilityState === 'hidden') return;
  loadAllData();
}, SETTINGS_POLL_MS);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') loadAllData();
});

export async function loadProfilePicture() {
const topicId = "0.0.9609881";
const accountUrls = {}; // Dictionary to store account IDs and their URLs

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

    

    if (!rawResult || !Array.isArray(rawResult.messages)) {
      console.log("No profile pictures found, using defaults");
      return {};
    }

    rawResult.messages.forEach(message => {
      if (message.payer && message.data && message.data.urls && message.data.urls.length > 0) {
        accountUrls[message.payer] = {
        url: message.data.urls[0],
        timestamp: message.timestamp
        };
      }
    });

    return accountUrls;

    } catch (error) {
      console.log("Error in loadProfilePicture:", error);
      return {};
    }
}
  

export async function loadUsername() {
const topicId = "0.0.9609904";
const accountUsernames = {};

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


  

  // Check if rawResult exists and has messages
  if (!rawResult || !Array.isArray(rawResult.messages)) {
    console.log("No usernames found, using defaults");
    return {};
  }

  // Process all messages to build the accountUsernames dictionary
  rawResult.messages.forEach(message => {
    if (message.payer && message.data && message.data.username) {
      // Only store usernames with less than 20 characters
      if (message.data.username.length < 20) {
        accountUsernames[message.payer] = {
          username: message.data.username,
          timestamp: message.timestamp
        };
      }
    }
  });

  return accountUsernames;

} catch (error) {
  console.log("Error in loadUsername:", error);
  return {}; // Return empty object instead of throwing error
}
}

export async function loadCLICK2URL() {
const topicId = "0.0.9752486";
const accountCLICK2URL = {};

try {
  const rawResult = await getMessages(topicId);

  // Check if rawResult exists and has messages
  if (!rawResult || !Array.isArray(rawResult.messages)) {
    console.log("No CLICK2URL found, using defaults");
    return {};
  }

  // Process all messages to build the accountUsernames dictionary
  rawResult.messages.forEach(message => {
    if (message.payer && message.data && message.data.click2url && message.data.click2url.length > 0) {
      // Only store usernames with less than 20 characters
        accountCLICK2URL[message.payer] = {
          click2url: message.data.click2url[0],
          timestamp: message.timestamp
        };
      }
  });

  return accountCLICK2URL;

} catch (error) {
  console.log("Error in loadCLICK2URL:", error);
  return {}; // Return empty object instead of throwing error
}
}


// Last bio-topic walk. Used only when the settings server is not ready.
let bioTopicLinks = {};
let bioSwapLinks = {};
let bioSwapBios = {};

export async function loadTopicBio() {
const topicId = "0.0.9759201";
const accountTopicBio = {}; // Dictionary to store account IDs and their bios
const links = {};
const swaps = {};
const swapBios = {};

try {
  const rawResult = await getMessages(topicId);

  // Check if rawResult exists and has messages
  if (!rawResult || !Array.isArray(rawResult.messages)) {
    console.log("No topic_bio found, using defaults");
    bioTopicLinks = {};
    bioSwapLinks = {};
    bioSwapBios = {};
    return {};
  }

  // Process all messages to build the accountTopicBio dictionary
  rawResult.messages.forEach(message => {
    if (message.payer && message.data && message.data.topic_bio) {
      // Only store bios with less than 256 characters
      if (message.data.topic_bio.length < 256) {
        accountTopicBio[message.payer] = {
          topic_bio: message.data.topic_bio,
          timestamp: message.timestamp
        };
      }
    }
    const link = profileTopicAction(message && message.data);
    if (link && message.payer) {
      if (link.action === "set") links[message.payer] = link.topic;
      else delete links[message.payer];
    }
    const swap = swapProfileAction(message && message.data);
    if (swap && !swap.error && message.payer) swaps[message.payer] = normalizeSwap(swap);
    const note = swapBioAction(message && message.data);
    if (note && !note.error && message.payer) {
      if (note.text) swapBios[message.payer] = note.text;
      else delete swapBios[message.payer];
    }
  });

  bioTopicLinks = links;
  bioSwapLinks = swaps;
  bioSwapBios = swapBios;
  return accountTopicBio;

} catch (error) {
  console.log("Error in loadTopicBio:", error);
  bioSwapLinks = {};
  bioSwapBios = {};
  return {}; // Return empty object instead of throwing error
}
}

