// Current values stored as topic messages. The map (handleallmessages.js,
// loadTOPIC4PIC.js) and the feed (topicstack.js) read stacks through these:
// newest topic bio and topic name win, stacked ids keep the latest add or
// remove, and the last valid setInitialXYZ wins. When the topic memo lists
// 0.0. admins, only those payers count; a memo that lists none lets anyone
// set them (the stack cap below bounds what that can cost).

export function adminsFromMemo(memo) {
  const topicAdmin = [];
  String(memo || '').split(',').forEach((part) => {
    const trimmed = part.trim();
    if (trimmed.startsWith('0.0.')) topicAdmin.push(trimmed);
  });
  return topicAdmin;
}

function readMessage(message) {
  if (message == null) return null;
  if (typeof message === 'string') {
    try {
      return JSON.parse(message);
    } catch {
      return null;
    }
  }
  return message;
}

function payerAllowed(message, topicAdmin) {
  return !topicAdmin || topicAdmin.length === 0 || topicAdmin.includes(message && message.payer);
}

export function currentTopicBio(messages, topicAdmin) {
  for (let index = (messages || []).length - 1; index >= 0; index--) {
    const message = messages[index];
    const parsed = readMessage(message);
    if (!parsed || !parsed.data || parsed.data.topic_bio == null) continue;
    if (!payerAllowed(message, topicAdmin)) continue;
    const raw = parsed.data.topic_bio;
    const text = Array.isArray(raw) ? String(raw[0] == null ? '' : raw[0]) : String(raw);
    return text;
  }
  return '';
}

export function currentTopicName(messages, topicAdmin) {
  for (let index = (messages || []).length - 1; index >= 0; index--) {
    const message = messages[index];
    const parsed = readMessage(message);
    if (!parsed || !parsed.changeName) continue;
    if (!payerAllowed(message, topicAdmin)) continue;
    return String(parsed.changeName);
  }
  return '';
}

// --- Stacks ----------------------------------------------------------------
// A topic stacks others with { addTopic: { addTopic: "0.0.1,0.0.2" } } and
// lets them go with { removeTopic: { removeTopic: "..." } }. The latest add
// or remove of an id wins. activeStack is the full list: every stacked
// topic stays listed. STACK_MAX is the most stacked topics one Load
// fetches, not the most that stay listed. A flood of adds cannot fan out
// into hundreds of reads on every phone. Stacks are read one level deep:
// only the open topic's own messages are read, never a stacked topic's
// stacks, so a chain or a loop of stacks cannot recurse.

export const STACK_MAX = 8;
const TOPIC_ID = /^0\.0\.\d+$/;

export function isTopicId(value) {
  return typeof value === 'string' && TOPIC_ID.test(value);
}

// "0.0.5, 0.0.6 ,bad,0.0.5" -> ["0.0.5", "0.0.6"]. Only a comma string is a
// list (the message format); anything else names nothing.
export function cleanTopicIds(value, self = '') {
  if (typeof value !== 'string') return [];
  const out = [];
  for (const part of value.split(',')) {
    const id = part.trim();
    if (!isTopicId(id) || id === self || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

// Every id whose latest action is an add, most recently added first,
// uncapped. `self` (the topic the messages belong to) is never its own stack.
export function activeStack(messages, topicAdmin, self = '') {
  const last = new Map(); // id -> { add, at }
  for (let index = 0; index < (messages || []).length; index++) {
    const message = messages[index];
    const parsed = readMessage(message);
    if (!parsed || !payerAllowed(message, topicAdmin)) continue;
    if (parsed.addTopic && parsed.addTopic.addTopic) {
      for (const id of cleanTopicIds(parsed.addTopic.addTopic, self)) last.set(id, { add: true, at: index });
    }
    if (parsed.removeTopic && parsed.removeTopic.removeTopic) {
      for (const id of cleanTopicIds(parsed.removeTopic.removeTopic, self)) last.set(id, { add: false, at: index });
    }
  }
  return Array.from(last.entries())
    .filter(([, state]) => state.add)
    .sort((a, b) => b[1].at - a[1].at)
    .map(([id]) => id);
}

// The stacked topics one Load fetches, at most STACK_MAX. Saved picks win
// when any are still on the stack, then the admin's pins, then the newest
// adds. The open topic is not in this list.
export function currentStackedTopics(messages, topicAdmin, self = '') {
  const stack = activeStack(messages, topicAdmin, self);
  const picks = readStackPicks(self, stack);
  if (picks.length) return picks;
  const pins = currentPinnedStacks(messages, topicAdmin, self);
  if (pins && pins.length) return pins;
  return stack.slice(0, STACK_MAX);
}

// The topics a load reads, the feed's and the map's: the open topic first,
// then its stacked topics. A topic that stacks none reads only itself.
export function topicsToLoad(topicId, messages, topicAdmin) {
  const open = String(topicId || '').trim();
  const stacked = currentStackedTopics(messages, topicAdmin, open);
  return isTopicId(open) ? [open, ...stacked] : stacked;
}

// The feed's name for the same list.
export function feedTopics(topicId, messages, topicAdmin) {
  return topicsToLoad(topicId, messages, topicAdmin);
}

// The messages the stacking tools send (rest.js, monthstack.js).
export function addTopicMessage(ids) {
  return JSON.stringify({ addTopic: { addTopic: [].concat(ids).join(',') } });
}

export function removeTopicMessage(ids) {
  return JSON.stringify({ removeTopic: { removeTopic: [].concat(ids).join(',') } });
}

export function changeNameMessage(name) {
  return JSON.stringify({ changeName: String(name) });
}

// --- Monthly archive ---------------------------------------------------------
// A year topic lists every month topic; news for a month is posted to that
// month's topic. Start new month (monthstack.js) adds one and leaves the
// older months listed. A load fetches at most STACK_MAX of them.

const pad2 = (n) => String(n).padStart(2, '0');

// "2026-12" for a local date.
export function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

export function isMonthKey(value) {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

// "News 2026" + "2026-12" -> "News 2026 - 2026-12". A topic name is plain
// text; a year topic without a name gives just the month.
export function monthTopicName(yearName, key) {
  const base = String(yearName || '').replace(/\s+/g, ' ').trim();
  return base ? `${base} - ${key}` : key;
}

// What Start new month does to a stack: add the new topic. Every month
// stays listed. max is how many one Load fetches, not how many may be listed.
export function monthPlan(stack, max = STACK_MAX) {
  void stack;
  void max;
  return { remove: '' };
}

// Newest admin autoplayNft wins. An empty value clears it. A message that
// is not a token id is skipped, same as a name or bio that fails its check.
// payerAllowed is the topic-settings check: memo admins only, or anyone
// when the memo lists none.
const HEDERA_TOKEN_ID = /^0\.0\.\d+$/;

export function isHederaTokenId(value) {
  return HEDERA_TOKEN_ID.test(String(value || '').trim());
}

export function autoplayConfigMessage(tokenId) {
  const id = tokenId == null ? '' : String(tokenId).trim();
  if (id && !isHederaTokenId(id)) return '';
  return JSON.stringify({ autoplayNft: id });
}

export function currentAutoplayNft(messages, topicAdmin) {
  for (let index = (messages || []).length - 1; index >= 0; index--) {
    const message = messages[index];
    const parsed = readMessage(message);
    if (!parsed || !Object.prototype.hasOwnProperty.call(parsed, 'autoplayNft')) continue;
    if (!payerAllowed(message, topicAdmin)) continue;
    const raw = parsed.autoplayNft;
    if (raw == null || (typeof raw === 'string' && raw.trim() === '')) return '';
    if (typeof raw !== 'string' || !isHederaTokenId(raw)) continue;
    return raw.trim();
  }
  return '';
}

// Newest admin commentPinNfts wins. [] clears the rule. A message that is
// not a list of at most five token ids is skipped. Only a memo admin counts:
// anyone may post the message, and a payer who is not an admin is ignored.
// No memo admins means no rule (null), so a post can still use its own pin.
const COMMENT_PIN_MAX = 5;

export function commentPinConfigMessage(tokens) {
  if (!Array.isArray(tokens)) return '';
  const out = [];
  const seen = new Set();
  for (const item of tokens) {
    const id = String(item == null ? '' : item).trim();
    if (!id) continue;
    if (!isHederaTokenId(id)) return '';
    if (seen.has(id)) continue;
    if (out.length >= COMMENT_PIN_MAX) return '';
    seen.add(id);
    out.push(id);
  }
  return JSON.stringify({ commentPinNfts: out });
}

export function currentCommentPinNfts(messages, topicAdmin) {
  const admins = Array.isArray(topicAdmin) ? topicAdmin : [];
  if (!admins.length) return null;
  for (let index = (messages || []).length - 1; index >= 0; index--) {
    const message = messages[index];
    const parsed = readMessage(message);
    if (!parsed || !Object.prototype.hasOwnProperty.call(parsed, 'commentPinNfts')) continue;
    if (!admins.includes(message && message.payer)) continue;
    const raw = parsed.commentPinNfts;
    if (!Array.isArray(raw)) continue;
    if (raw.length === 0) return [];
    if (raw.length > COMMENT_PIN_MAX) continue;
    const tokens = [];
    const seen = new Set();
    let bad = false;
    for (const item of raw) {
      const id = String(item == null ? '' : item).trim();
      if (!isHederaTokenId(id)) {
        bad = true;
        break;
      }
      if (seen.has(id)) continue;
      seen.add(id);
      tokens.push(id);
    }
    if (bad || tokens.length > COMMENT_PIN_MAX) continue;
    return tokens;
  }
  return null;
}

// One device's chosen load set, { topicId: [ids] }. Private mode keeps it
// for this visit when storage throws.
const STACK_PICKS_KEY = 'stack-picks-v1';
const stackPickVisit = new Map();

function stackPickStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function readStackPickMap() {
  try {
    const storage = stackPickStorage();
    const parsed = JSON.parse((storage && storage.getItem(STACK_PICKS_KEY)) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Saved ids for one topic, capped at STACK_MAX. Pass the live stack to drop
// an id that is no longer stacked. Without it, the saved ids come back.
export function readStackPicks(topicId, stack) {
  const topic = String(topicId || '').trim();
  if (!isTopicId(topic)) return [];
  const raw = stackPickVisit.has(topic) ? stackPickVisit.get(topic) : readStackPickMap()[topic];
  const on = Array.isArray(stack) ? new Set(stack) : null;
  const out = [];
  for (const item of [].concat(raw || [])) {
    const id = String(item == null ? '' : item).trim();
    if (!isTopicId(id) || id === topic || out.includes(id)) continue;
    if (on && !on.has(id)) continue;
    out.push(id);
    if (out.length >= STACK_MAX) break;
  }
  return out;
}

export function saveStackPicks(topicId, ids) {
  const topic = String(topicId || '').trim();
  if (!isTopicId(topic)) return;
  const saved = [];
  for (const item of [].concat(ids || [])) {
    const id = String(item == null ? '' : item).trim();
    if (!isTopicId(id) || id === topic || saved.includes(id)) continue;
    if (saved.length >= STACK_MAX) break;
    saved.push(id);
  }
  stackPickVisit.set(topic, saved);
  try {
    const storage = stackPickStorage();
    if (!storage) return;
    const map = readStackPickMap();
    if (saved.length) map[topic] = saved;
    else delete map[topic];
    storage.setItem(STACK_PICKS_KEY, JSON.stringify(map));
  } catch {
    /* private mode: the choice holds until the page closes */
  }
}

// Newest admin pinStacks wins. [] clears the set. Bad ids, this topic, and
// anything past STACK_MAX are skipped. Only a memo admin counts. No memo
// admins means no pins (null). A pinned id no longer on the stack is dropped.
export function pinStacksConfigMessage(ids) {
  if (!Array.isArray(ids)) return '';
  const out = [];
  const seen = new Set();
  for (const item of ids) {
    const id = String(item == null ? '' : item).trim();
    if (!id || !isTopicId(id) || seen.has(id)) continue;
    if (out.length >= STACK_MAX) break;
    seen.add(id);
    out.push(id);
  }
  if (!out.length && ids.some((item) => String(item == null ? '' : item).trim())) return '';
  return JSON.stringify({ pinStacks: out });
}

export function currentPinnedStacks(messages, admins, self = '') {
  const adminList = Array.isArray(admins) ? admins : [];
  if (!adminList.length) return null;
  const own = String(self || '').trim();
  const stack = new Set(activeStack(messages, adminList, own));
  for (let index = (messages || []).length - 1; index >= 0; index--) {
    const message = messages[index];
    const parsed = readMessage(message);
    if (!parsed || !Object.prototype.hasOwnProperty.call(parsed, 'pinStacks')) continue;
    if (!adminList.includes(message && message.payer)) continue;
    const raw = parsed.pinStacks;
    if (!Array.isArray(raw)) continue;
    if (raw.length === 0) return [];
    const chosen = [];
    const seen = new Set();
    let valid = 0;
    for (const item of raw) {
      const id = String(item == null ? '' : item).trim();
      if (!isTopicId(id)) continue;
      valid += 1;
      if (id === own || seen.has(id)) continue;
      if (chosen.length >= STACK_MAX) continue;
      seen.add(id);
      chosen.push(id);
    }
    if (!valid || !chosen.length) continue;
    return chosen.filter((id) => stack.has(id));
  }
  return null;
}

// The install icon, on the same signed admin message as autoplayNft.
// Newest appIcon wins. An empty value clears it. A value acceptUrl rejects
// (not our own R2 image) is skipped, as is a message from anyone who is
// not a memo admin. No memo admins means no icon: unlike autoplay, an
// empty memo does not let everyone set it.
export function appIconConfigMessage(url) {
  const raw = url == null ? '' : String(url).trim();
  return JSON.stringify({ appIcon: raw });
}

export function currentAppIcon(messages, topicAdmin, acceptUrl) {
  const admins = Array.isArray(topicAdmin) ? topicAdmin : [];
  if (!admins.length) return '';
  const accept = typeof acceptUrl === 'function' ? acceptUrl : () => false;
  for (let index = (messages || []).length - 1; index >= 0; index--) {
    const message = messages[index];
    const parsed = readMessage(message);
    if (!parsed || !Object.prototype.hasOwnProperty.call(parsed, 'appIcon')) continue;
    if (!payerAllowed(message, admins)) continue;
    const raw = parsed.appIcon;
    if (raw == null || (typeof raw === 'string' && raw.trim() === '')) return '';
    if (typeof raw !== 'string') continue;
    const url = raw.trim();
    if (accept(url)) return url;
  }
  return '';
}

export function currentInitialXYZ(messages, topicAdmin) {
  let target = null;
  for (const message of messages || []) {
    const parsed = readMessage(message);
    if (!parsed || !parsed.setInitialXYZ) continue;
    if (!payerAllowed(message, topicAdmin)) continue;
    const { lng, lat, zoom } = parsed.setInitialXYZ;
    if (!Number.isFinite(Number(lng)) || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(zoom))) continue;
    target = { lng: Number(lng), lat: Number(lat), zoom: Number(zoom) };
  }
  return target;
}
