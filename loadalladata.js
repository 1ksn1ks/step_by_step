import { getTopicData as getMessages } from "./topicdata";
import { fetchUserSettings } from "./msgbackend";
import { readSettings, writeSettings } from "./settingscache.js";
import { publishProfilePictures } from "./picturecache.js";
import { profileTopicAction } from "./server/profiletopic.js";

export let profilePictures = [];
export let usernames = [];
export let click2url = [];
export let topicBio = [];
// The topic connected to an account. Shares land there. Followers follow it.
export let profileTopics = {};

// A change this phone just sent. It is shown immediately and is not written
// into the saved copy. The next server card that matches it removes it. If
// the message never lands, the next cold open shows the saved server value.
const ownOverlay = new Map();
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

function pictureList(accounts) {
  const urls = [];
  for (const row of accounts || []) {
    if (row && row.profilePic) urls.push(row.profilePic);
  }
  return urls;
}

function applyAccounts(accounts) {
  const pics = {};
  const names = {};
  const links = {};
  const bios = {};
  const topics = {};
  for (const row of accounts || []) {
    if (!row || !row.accountId) continue;
    if (row.profilePic) pics[row.accountId] = { url: row.profilePic, timestamp: row.updatedAt };
    if (row.username) names[row.accountId] = { username: row.username, timestamp: row.updatedAt };
    if (row.click2url) links[row.accountId] = { click2url: row.click2url, timestamp: row.updatedAt };
    if (row.bio) bios[row.accountId] = { topic_bio: row.bio, timestamp: row.updatedAt };
    if (row.topic) topics[row.accountId] = row.topic;
  }
  profilePictures = pics;
  usernames = names;
  click2url = links;
  topicBio = bios;
  profileTopics = topics;
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
    if (!patch.username && !patch.profilePic && !patch.click2url && !patch.bio && !('topic' in patch)) ownOverlay.delete(accountId);
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
  }
}

export function showOwnProfile(accountId, patch) {
  if (!accountId || !patch) return;
  const prev = ownOverlay.get(accountId) || {};
  ownOverlay.set(accountId, { ...prev, ...patch });
  applyOverlay();
  if (patch.profilePic) publishProfilePictures([patch.profilePic]);
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
    await publishProfilePictures(pictureList(local.accounts));
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
    await publishProfilePictures(pictureList(accounts));
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
  applyOverlay();
  document.dispatchEvent(new CustomEvent('profiles-loaded'));
  return snapshot();
}

export function loadAllData() {
  if (inflight) return inflight;
  inflight = loadAllDataBody().finally(() => {
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

export async function loadTopicBio() {
const topicId = "0.0.9759201";
const accountTopicBio = {}; // Dictionary to store account IDs and their bios
const links = {};

try {
  const rawResult = await getMessages(topicId);

  // Check if rawResult exists and has messages
  if (!rawResult || !Array.isArray(rawResult.messages)) {
    console.log("No topic_bio found, using defaults");
    bioTopicLinks = {};
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
  });

  bioTopicLinks = links;
  return accountTopicBio;

} catch (error) {
  console.log("Error in loadTopicBio:", error);
  return {}; // Return empty object instead of throwing error
}
}

