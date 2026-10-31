// One rebuilt card per original post, kept on the phone. A shared pin
// reads this first, then asks the server and writes the answer back.
// The key is topicId|created (the post's ISO time).

const DB_NAME = 'meritocracy-posts';
const STORE = 'cards';

let dbPromise = null;

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
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE);
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

function cardKey(topicId, created) {
  return String(topicId || '') + '|' + String(created || '');
}

// IndexedDB can store ids, text, urls, and numbers. A card built for the
// screen also carries onPrev / onclick closures, and put() throws
// DataCloneError on the first one of those. Drop anything that is not
// plain data. The screen rebuilds the handlers when it paints the card.
function plainCard(value, seen) {
  if (value == null) return value;
  const kind = typeof value;
  if (kind === 'string' || kind === 'boolean') return value;
  if (kind === 'number') return Number.isFinite(value) ? value : null;
  if (kind !== 'object') return undefined;
  if (typeof Node !== 'undefined' && value instanceof Node) return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) {
    const list = [];
    for (const item of value) {
      const next = plainCard(item, seen);
      if (next !== undefined) list.push(next);
    }
    return list;
  }
  const out = {};
  for (const key of Object.keys(value)) {
    const next = plainCard(value[key], seen);
    if (next !== undefined) out[key] = next;
  }
  return out;
}

export async function readPostCard(topicId, created) {
  const database = await openDb();
  if (!database || !topicId || !created) return null;
  return new Promise((resolve) => {
    const tx = database.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(cardKey(topicId, created));
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => resolve(null);
  });
}

export async function forgetPostCard(topicId, created) {
  const database = await openDb();
  if (!database || !topicId || !created) return;
  return new Promise((resolve) => {
    const tx = database.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(cardKey(topicId, created));
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function writePostCard(topicId, created, card) {
  const database = await openDb();
  if (!database || !topicId || !created || !card) return;
  try {
    const plain = plainCard(card, new WeakSet());
    if (!plain || typeof plain !== 'object') return;
    return await new Promise((resolve) => {
      let tx;
      try {
        tx = database.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(plain, cardKey(topicId, created));
      } catch {
        resolve();
        return;
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        if (isQuota(tx.error) && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('topic-cache-full'));
        }
        resolve();
      };
    });
  } catch {
    return;
  }
}
