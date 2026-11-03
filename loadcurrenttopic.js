// Current values stored as topic messages. The rules match the readers that
// draw the map: newest topic bio and topic name win, stacked ids keep the
// latest add or remove, and the last valid setInitialXYZ wins. When the
// topic memo lists 0.0. admins, only those payers count.

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

export function currentStackedTopics(messages, topicAdmin) {
  const topicActions = new Map();
  for (let index = 0; index < (messages || []).length; index++) {
    const message = messages[index];
    const parsed = readMessage(message);
    if (!parsed || !payerAllowed(message, topicAdmin)) continue;
    if (parsed.addTopic && parsed.addTopic.addTopic) {
      const topics = typeof parsed.addTopic.addTopic === 'string'
        ? parsed.addTopic.addTopic.split(',')
        : [];
      topics.forEach((topic) => topicActions.set(topic, 'add'));
    }
    if (parsed.removeTopic && parsed.removeTopic.removeTopic) {
      const topics = typeof parsed.removeTopic.removeTopic === 'string'
        ? parsed.removeTopic.removeTopic.split(',')
        : [];
      topics.forEach((topic) => topicActions.set(topic, 'remove'));
    }
  }
  return Array.from(topicActions.entries())
    .filter(([topic, action]) => action === 'add' && topic.startsWith('0.0.'))
    .map(([topic]) => topic);
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
