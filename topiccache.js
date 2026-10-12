// Messages a phone has already loaded, kept until that person deletes them.
// One copy per topic id. Pending sends use a negative sequence and are not
// stored. The topic's lastSeq is the highest mirror sequence reached, which
// can sit past a message this cache skipped.

const DB_NAME = 'meritocracy-topic-messages';
const MESSAGES = 'messages';
const TOPICS = 'topics';

let dbPromise = null;

export function sequenceOf(message) {
  const seq = Number(message && message.sequence_number);
  return Number.isFinite(seq) ? seq : null;
}

export function highestSequence(messages, floor = 0) {
  let max = Number(floor) || 0;
  for (const message of messages || []) {
    const seq = sequenceOf(message);
    if (seq !== null && seq > max) max = seq;
  }
  return max;
}

// Confirmed rows replace by sequence. Messages without a positive sequence
// (pending sends) stay only for this response and are listed after the rest.
export function mergeMessages(local, incoming) {
  const bySeq = new Map();
  const extras = [];
  const add = (message, pending) => {
    const seq = sequenceOf(message);
    if (seq !== null && seq > 0) bySeq.set(seq, message);
    else if (pending) extras.push(message);
  };
  for (const message of local || []) add(message, false);
  for (const message of incoming || []) add(message, true);
  const confirmed = Array.from(bySeq.values()).sort((a, b) => sequenceOf(a) - sequenceOf(b));
  return confirmed.concat(extras);
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(MESSAGES)) {
        const messages = database.createObjectStore(MESSAGES, { keyPath: 'key' });
        messages.createIndex('topicId', 'topicId', { unique: false });
      }
      if (!database.objectStoreNames.contains(TOPICS)) {
        database.createObjectStore(TOPICS, { keyPath: 'topicId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
  return dbPromise;
}

function isQuota(error) {
  return !!error && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');
}

export async function readTopicCache(topicId) {
  const database = await openDb();
  if (!database || !topicId) return { messages: [], lastSeq: 0 };
  return new Promise((resolve, reject) => {
    const tx = database.transaction([MESSAGES, TOPICS], 'readonly');
    const metaRequest = tx.objectStore(TOPICS).get(topicId);
    const messageRequest = tx.objectStore(MESSAGES).index('topicId').getAll(topicId);
    let lastSeq = 0;
    let messages = [];
    metaRequest.onsuccess = () => {
      const stored = metaRequest.result && Number(metaRequest.result.lastSeq);
      if (Number.isFinite(stored) && stored > lastSeq) lastSeq = stored;
    };
    messageRequest.onsuccess = () => {
      messages = (messageRequest.result || []).map((row) => row.message);
    };
    tx.oncomplete = () => {
      messages.sort((a, b) => sequenceOf(a) - sequenceOf(b));
      resolve({ messages, lastSeq: Math.max(lastSeq, highestSequence(messages, 0)) });
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('topic cache read aborted'));
  });
}

// Returns true when the phone refused to store more.
export async function writeTopicMessages(topicId, messages, reachedSeq = 0) {
  const database = await openDb();
  if (!database || !topicId) return false;
  const rows = [];
  let maxSeq = Number(reachedSeq) || 0;
  for (const message of messages || []) {
    const seq = sequenceOf(message);
    if (seq === null || seq <= 0) continue;
    if (seq > maxSeq) maxSeq = seq;
    rows.push({
      key: topicId + '\u0000' + seq,
      topicId,
      sequence_number: seq,
      message,
    });
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      fn();
    };
    const tx = database.transaction([MESSAGES, TOPICS], 'readwrite');
    const topics = tx.objectStore(TOPICS);
    const store = tx.objectStore(MESSAGES);
    const metaRequest = topics.get(topicId);
    metaRequest.onsuccess = () => {
      const previous = metaRequest.result && Number(metaRequest.result.lastSeq);
      const lastSeq = Math.max(Number.isFinite(previous) ? previous : 0, maxSeq);
      if (!rows.length && lastSeq <= (Number.isFinite(previous) ? previous : 0)) return;
      for (const row of rows) store.put(row);
      topics.put({ topicId, lastSeq, updatedAt: Date.now() });
    };
    tx.oncomplete = () => finish(() => resolve(false));
    tx.onabort = () => finish(() => {
      if (isQuota(tx.error)) resolve(true);
      else reject(tx.error || new Error('topic cache write aborted'));
    });
    tx.onerror = () => {
      if (isQuota(tx.error)) finish(() => resolve(true));
    };
  });
}

