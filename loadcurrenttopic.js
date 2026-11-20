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
// or remove of an id wins. One topic reads at most STACK_MAX stacked topics
// (one per month of a year): the ones added most recently, so a flood of
// adds cannot fan out into hundreds of reads on every phone, and an admin
// who adds a 13th month pushes the oldest off without a remove. Stacks are
// read one level deep: only the open topic's own messages are read, never a
// stacked topic's stacks, so a chain or a loop of stacks cannot recurse.

export const STACK_MAX = 12;
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

// The stacked topics a load reads: at most STACK_MAX, newest adds first.
export function currentStackedTopics(messages, topicAdmin, self = '') {
  return activeStack(messages, topicAdmin, self).slice(0, STACK_MAX);
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
// A year topic stacks up to twelve month topics; news for a month is posted
// to that month's topic. Start new month (monthstack.js) makes one.

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

// What Start new month does to a stack: add the new topic, and when the
// stack is already full, take off the topic added longest ago. The add
// goes first; the cap already hides the oldest if the remove is declined.
export function monthPlan(stack, max = STACK_MAX) {
  const list = Array.isArray(stack) ? stack : [];
  return { remove: list.length >= max ? list[list.length - 1] : '' };
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
