// Profile Swap asks this before a token is saved. The mirror says the token
// exists. SaucerSwap's public lists say whether a V1 or V2 pool pairs it
// with WHBAR. No API key: GET /tokens, GET /pools, and GET /v2/pools.
// Answers are reused for a few minutes so a retry does not download the
// full lists again. The answer map is capped so unknown token ids cannot
// grow it without limit.

export const SAUCER_API = "https://api.saucerswap.finance";
export const SWAP_TOKEN_CACHE_MS = 5 * 60 * 1000;
export const SWAP_TOKEN_CACHE_MAX = 2000;
// Current WHBAR and the deprecated WHBAR token. Only these ids are the
// HBAR side. A different token that uses the symbol HBAR or WHBAR is not.
export const WHBAR_TOKEN_IDS = ["0.0.1456986", "0.0.1062664"];

const TOKEN_ID = /^\d+\.\d+\.\d+$/;
const WHBAR = new Set(WHBAR_TOKEN_IDS);
const LOOKUP_TIMEOUT_MS = 12_000;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function decimalsOf(...values) {
  for (const value of values) {
    if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255) return value;
    if (typeof value === "string" && /^\d+$/.test(value.trim())) {
      const n = Number(value.trim());
      if (n <= 255) return n;
    }
  }
  return 0;
}

export function isHbarSide(token) {
  return !!token && typeof token === "object" && WHBAR.has(text(token.id));
}

function tokenIdOf(token) {
  return token && typeof token === "object" ? text(token.id) : "";
}

// One pass over the public lists. V1 (`/pools`) and V2 (`/v2/pools`) both
// use tokenA and tokenB. `paired` is every token that sits across from a
// WHBAR token id. The token's own record supplies dueDiligenceComplete.
export function readSaucerLists(tokens, pools) {
  const byId = new Map();
  if (Array.isArray(tokens)) {
    for (const row of tokens) {
      const id = tokenIdOf(row);
      if (id) byId.set(id, row);
    }
  }
  const paired = new Set();
  const poolDue = new Map();
  if (Array.isArray(pools)) {
    for (const pool of pools) {
      const sides = [pool && pool.tokenA, pool && pool.tokenB];
      for (let i = 0; i < sides.length; i += 1) {
        const token = sides[i];
        const other = sides[1 - i];
        const id = tokenIdOf(token);
        const otherId = tokenIdOf(other);
        if (!id || id === otherId || !isHbarSide(other)) continue;
        paired.add(id);
        if (!poolDue.has(id)) poolDue.set(id, token.dueDiligenceComplete === true);
      }
    }
  }
  return { byId, paired, poolDue };
}

async function getJson(fetchImpl, url, { notFound } = {}) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
  } catch (err) {
    const error = new Error("lookup");
    error.cause = err;
    throw error;
  }
  if (response.status === 404) {
    if (notFound) return null;
    throw new Error("lookup");
  }
  if (!response.ok) throw new Error("lookup");
  return response.json();
}

export function createSwapTokenLookup({
  fetchImpl = fetch,
  now = Date.now,
  cacheMs = SWAP_TOKEN_CACHE_MS,
  cacheMax = SWAP_TOKEN_CACHE_MAX,
  mirror = "https://mainnet.mirrornode.hedera.com",
  saucer = SAUCER_API,
} = {}) {
  const answers = new Map();
  const flights = new Map();
  let lists = null;
  let listsFlight = null;

  function remember(id, status, body) {
    // Storing again moves this id to the end. Past the cap, the earliest goes.
    if (answers.has(id)) answers.delete(id);
    answers.set(id, { at: now(), status, body });
    while (answers.size > cacheMax) {
      const oldest = answers.keys().next().value;
      answers.delete(oldest);
    }
    return { status, body };
  }

  async function loadLists() {
    if (lists && now() - lists.at < cacheMs) return lists;
    if (!listsFlight) {
      listsFlight = Promise.all([
        getJson(fetchImpl, `${saucer}/tokens`),
        getJson(fetchImpl, `${saucer}/pools`),
        getJson(fetchImpl, `${saucer}/v2/pools`),
      ]).then(([tokens, poolsV1, poolsV2]) => {
        if (!Array.isArray(tokens) || !Array.isArray(poolsV1) || !Array.isArray(poolsV2)) throw new Error("lookup");
        lists = { at: now(), ...readSaucerLists(tokens, poolsV1.concat(poolsV2)) };
        return lists;
      }).finally(() => {
        listsFlight = null;
      });
    }
    return listsFlight;
  }

  async function load(id) {
    const row = await getJson(fetchImpl, `${mirror}/api/v1/tokens/${id}`, { notFound: true });
    if (row == null) return remember(id, 404, { error: "not found" });
    if (typeof row !== "object" || !text(row.token_id)) throw new Error("lookup");
    const saucerLists = await loadLists();
    const listed = saucerLists.byId.get(id);
    const due = listed
      ? listed.dueDiligenceComplete === true
      : saucerLists.poolDue.get(id) === true;
    return remember(id, 200, {
      tokenId: id,
      name: text(row.name) || text(listed && listed.name),
      symbol: text(row.symbol) || text(listed && listed.symbol),
      decimals: decimalsOf(row.decimals, listed && listed.decimals),
      pool: saucerLists.paired.has(id),
      dueDiligenceComplete: due,
    });
  }

  return {
    async lookup(tokenId) {
      const id = text(tokenId);
      if (!TOKEN_ID.test(id)) return { status: 400, body: { error: "token" } };
      const cached = answers.get(id);
      if (cached && now() - cached.at < cacheMs) return { status: cached.status, body: cached.body };
      const pending = flights.get(id);
      if (pending) return pending;
      const job = load(id).finally(() => flights.delete(id));
      flights.set(id, job);
      try {
        return await job;
      } catch {
        return { status: 502, body: { error: "lookup" } };
      }
    },
  };
}

export function swapTokenRoute(lookup) {
  return async function swapToken(req, res) {
    try {
      const result = await lookup.lookup(req.params.tokenId);
      if (!res.headersSent) res.status(result.status).json(result.body);
    } catch (err) {
      console.error("swap token lookup", err && err.message);
      if (!res.headersSent) res.status(502).json({ error: "lookup" });
    }
  };
}
