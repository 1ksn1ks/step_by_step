// Following-list cache. No DOM, so tests can load this file alone.
// A failed fetch stays offline. It is not an empty follow list.

export const FOLLOWING_CACHE_MS = 5 * 60 * 1000;
export const FOLLOWING_RETRY_MS = 1500;
export const FOLLOWING_UPDATED = 'following-updated';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// getAccount() is the connected wallet id, or a falsy value when signed out.
// fetchFollowing(account) resolves to { accounts, topics } or null.
export function createFollowingStore({ getAccount, fetchFollowing, delay, onUpdated, now } = {}) {
  const wait = typeof delay === 'function' ? delay : sleep;
  const clock = typeof now === 'function' ? now : () => Date.now();
  const fetchList = typeof fetchFollowing === 'function' ? fetchFollowing : async () => null;
  const readAccount = typeof getAccount === 'function' ? getAccount : () => '';

  let cacheAccount = '';
  let cacheAt = 0;
  let cacheData = null;
  let inflight = null;
  let failedAccount = '';
  let failedAt = 0;
  let notifyGen = 0;

  function account() {
    const id = readAccount();
    if (typeof id !== 'string') return '';
    return id.trim();
  }

  function followingStatus() {
    const id = account();
    if (!id) return 'nowallet';
    if (inflight && inflight.account === id) return 'loading';
    if (failedAccount === id && (clock() - failedAt) < FOLLOWING_CACHE_MS) return 'offline';
    if (cacheData && cacheAccount === id) return 'ready';
    return 'loading';
  }

  function clearFollowingFailure() {
    failedAccount = '';
    failedAt = 0;
  }

  function getData() {
    const id = account();
    if (!id || !cacheData || cacheAccount !== id) return null;
    return cacheData;
  }

  function ensureData(allowRetry) {
    const id = account();
    if (!id) return Promise.resolve(null);
    if (cacheData && cacheAccount === id && (clock() - cacheAt) < FOLLOWING_CACHE_MS) {
      return Promise.resolve(cacheData);
    }
    if (inflight && inflight.account === id) return inflight.promise;
    if (!allowRetry && failedAccount === id && (clock() - failedAt) < FOLLOWING_CACHE_MS) {
      return Promise.resolve(null);
    }
    let run;
    const current = () => inflight && inflight.promise === run && account() === id;
    run = (async () => {
      let data = null;
      try {
        data = await fetchList(id);
      } catch {
        data = null;
      }
      if (!data && current()) {
        await wait(FOLLOWING_RETRY_MS);
        if (current()) {
          try {
            data = await fetchList(id);
          } catch {
            data = null;
          }
        }
      }
      const live = current();
      if (inflight && inflight.promise === run) inflight = null;
      if (!live) return null;
      if (!data) {
        cacheData = null;
        cacheAt = 0;
        cacheAccount = '';
        failedAccount = id;
        failedAt = clock();
        return null;
      }
      failedAccount = '';
      failedAt = 0;
      cacheAccount = id;
      cacheData = data;
      cacheAt = clock();
      return data;
    })();
    inflight = { account: id, promise: run };
    return run;
  }

  function resetCache() {
    cacheAccount = '';
    cacheAt = 0;
    cacheData = null;
    inflight = null;
    failedAccount = '';
    failedAt = 0;
  }

  function refreshFollowing() {
    const gen = ++notifyGen;
    resetCache();
    const id = account();
    if (!id) {
      if (gen === notifyGen && typeof onUpdated === 'function') onUpdated();
      return Promise.resolve(null);
    }
    return ensureData(true).then((data) => {
      if (gen === notifyGen && typeof onUpdated === 'function') onUpdated();
      return data;
    });
  }

  return {
    followingStatus,
    ensureData,
    clearFollowingFailure,
    refreshFollowing,
    getData,
  };
}

export function followingCountText(status, count) {
  if (status !== 'ready') return '';
  const n = typeof count === 'number' && count > 0 ? count : 0;
  return n + ' following';
}

// Ready with nothing to show keeps the picker's own empty sentence.
// Loading with rows already on screen leaves the empty line blank.
export function followingEmptyText(status, itemCount, rowCount) {
  if (status === 'nowallet') return 'Connect your wallet to see who you follow';
  if (status === 'offline') return "Couldn't load who you follow. Tap to retry";
  if (status !== 'ready') return itemCount ? '' : 'Loading';
  if (!itemCount) return 'Not following anyone yet';
  if (!rowCount) return 'No matches';
  return '';
}

// A pasted account or topic id is not a search. See all opens the full list.
export function seeAllQuery(value) {
  const text = value == null ? '' : String(value);
  if (/^\d+\.\d+\.\d+$/.test(text.trim())) return '';
  return text;
}
