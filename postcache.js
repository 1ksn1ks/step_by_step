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

export async function writePostCard(topicId, created, card) {
  const database = await openDb();
  if (!database || !topicId || !created || !card) return;
  return new Promise((resolve) => {
    const tx = database.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(card, cardKey(topicId, created));
    tx.oncomplete = () => resolve();
    tx.onerror = () => {
      if (isQuota(tx.error) && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('topic-cache-full'));
      }
      resolve();
    };
  });
}
