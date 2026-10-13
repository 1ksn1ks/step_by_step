// Current username, picture link, CLICK2LINK, and bio for each account.
// Kept until this phone clears everything saved. One card per account.
// The revision is the server's write counter, not a message clock.

const DB_NAME = 'meritocracy-user-settings';
const ACCOUNTS = 'accounts';
const META = 'meta';
const META_ID = 'sync';

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
      if (!database.objectStoreNames.contains(ACCOUNTS)) {
        database.createObjectStore(ACCOUNTS, { keyPath: 'accountId' });
      }
      if (!database.objectStoreNames.contains(META)) {
        database.createObjectStore(META, { keyPath: 'id' });
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

export async function readSettings() {
  const database = await openDb();
  if (!database) return { generation: '', revision: 0, accounts: [] };
  return new Promise((resolve, reject) => {
    const tx = database.transaction([ACCOUNTS, META], 'readonly');
    const metaRequest = tx.objectStore(META).get(META_ID);
    const accountRequest = tx.objectStore(ACCOUNTS).getAll();
    let generation = '';
    let revision = 0;
    let accounts = [];
    metaRequest.onsuccess = () => {
      const stored = metaRequest.result;
      if (!stored) return;
      generation = stored.generation || '';
      revision = Number(stored.revision) || 0;
    };
    accountRequest.onsuccess = () => {
      accounts = accountRequest.result || [];
    };
    tx.oncomplete = () => resolve({ generation, revision, accounts });
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('settings cache read aborted'));
  });
}

// Returns true when the phone refused to store more.
export async function writeSettings(generation, revision, rows, replace) {
  const database = await openDb();
  if (!database) return false;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      fn();
    };
    const tx = database.transaction([ACCOUNTS, META], 'readwrite');
    const accounts = tx.objectStore(ACCOUNTS);
    if (replace) accounts.clear();
    for (const row of rows || []) {
      if (!row || !row.accountId) continue;
      accounts.put({
        accountId: row.accountId,
        username: row.username || '',
        profilePic: row.profilePic || '',
        click2url: row.click2url || '',
        bio: row.bio || '',
        topic: row.topic || '',
        updatedAt: Number(row.updatedAt) || 0,
      });
    }
    tx.objectStore(META).put({
      id: META_ID,
      generation: generation || '',
      revision: Number(revision) || 0,
    });
    tx.oncomplete = () => finish(() => resolve(false));
    tx.onabort = () => finish(() => {
      if (isQuota(tx.error)) resolve(true);
      else reject(tx.error || new Error('settings cache write aborted'));
    });
    tx.onerror = () => {
      if (isQuota(tx.error)) finish(() => resolve(true));
    };
  });
}

