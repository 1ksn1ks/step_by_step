// Bridge to the topic message backend (see server/).
// The backend is a cache of the Hedera mirror — OPTIONAL by design:
// every call here fails fast and the caller falls back to the mirror
// path (getMessages / subscribeToTopic), so the app works without it.
//
// NOTE: this module must keep ZERO static imports — hedera/web3 loop back
// into the data loaders, and a static import here would put BACKEND_URL in
// the temporal dead zone when their top-level loads run (circular init).

// Empty = same origin as the app. The dev server (vite.config.js) and the
// production reverse proxy forward /api/* to the backend — the app never
// hardcodes the VPS IP, and there's no CORS/mixed-content to fight.
export const BACKEND_URL = "";

// "people are viewing this topic now" — fire and forget on chat Load
export function trackTopic(topicId) {
  if (!topicId || !/^\d+\.\d+\.\d+$/.test(topicId)) return;
  fetch(BACKEND_URL + "/api/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic: topicId }),
  }).catch(() => {});
}

// Same shape as getMessages(): { messages, error } + ready
// ready=false → backend offline or topic not backfilled yet → caller falls back
export async function fetchMessagesBackend(topicId, limit = 1000) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(
      `${BACKEND_URL}/api/messages?topic=${encodeURIComponent(topicId)}&limit=${limit}`,
      { signal: ctrl.signal }
    );
    clearTimeout(t);
    if (!res.ok) return { messages: [], error: "backend HTTP " + res.status, ready: false };
    const data = await res.json();
    return { messages: data.messages || [], error: "", ready: !!data.ready };
  } catch (e) {
    return { messages: [], error: e.message || String(e), ready: false };
  }
}

// Stable identity of one chat message: the pending form and the confirmed
// form of the same send must produce the same signature (volatile fields
// like created / seq are stripped, payer and body are not).
export function messageSig(m) {
  const { created, consensus_timestamp, sequence_number, pending, _pendingId, ...rest } = m;
  return (m.payer || "") + "|" + JSON.stringify(rest);
}

// Lightweight live tail for chat panels: one small request every 3s.
// Reads the BACKEND (confirmed rows + pending sends), not the mirror, so
// phones stay off the mirror entirely. Dedupes by message signature — a
// send arrives as pending first, then as confirmed, and the tail must
// deliver it exactly once (onConfirm fires on that transition).
export function startLiveTail(topicId, startSeq, onMessage, pollMs = 3000, initialMessages = [], onConfirm = null) {
  let lastSeq = startSeq || 0;
  let stopped = false;
  let timer = null;
  const seen = new Set(initialMessages.map(messageSig));
  const pendingSigs = new Set();
  const poll = async () => {
    if (stopped) return;
    try {
      const res = await fetch(
        `${BACKEND_URL}/api/messages?topic=${encodeURIComponent(topicId)}&limit=100&after_seq=${lastSeq}`
      );
      if (res.ok) {
        const data = await res.json();
        for (const m of data.messages || []) {
          const sig = messageSig(m);
          if (seen.has(sig)) {
            if (!m.pending && pendingSigs.has(sig)) {
              pendingSigs.delete(sig);
              if (onConfirm) onConfirm(m);
            }
            continue;
          }
          seen.add(sig);
          if (m.pending) pendingSigs.add(sig);
          if (!m.pending && m.sequence_number > lastSeq) lastSeq = m.sequence_number;
          onMessage(m);
        }
      }
    } catch (e) {
      // backend offline — keep trying on the next tick
    }
    if (!stopped) timer = setTimeout(poll, pollMs);
  };
  poll();
  return {
    close() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

// ── Live stream (SSE) ──────────────────────────────────────────────────
// ONE shared connection per app session. Chat panels subscribe per topic
// (streamOnTopic) and the server pushes events the moment they happen —
// no 3s polling. EventSource reconnects natively; on every (re)open the
// registered callbacks fire so panels can re-fetch anything they missed
// (their signature dedupe absorbs duplicates).
let streamSource = null;
const streamTopicRefs = new Map(); // topic_id -> refcount
const streamHandlers = new Map();  // topic_id -> Set<handler>
const streamReconnects = new Set();

function streamEnsure() {
  if (streamSource || streamTopicRefs.size === 0) return;
  streamSource = new EventSource(
    `${BACKEND_URL}/api/stream?topics=${[...streamTopicRefs.keys()].join(",")}`
  );
  streamSource.onmessage = (e) => {
    let evt;
    try {
      evt = JSON.parse(e.data);
    } catch {
      return;
    }
    const set = streamHandlers.get(evt.topic);
    if (!set) return;
    for (const h of [...set]) {
      try {
        h(evt);
      } catch (err) {
        console.error("stream handler:", err);
      }
    }
  };
  streamSource.onopen = () => {
    for (const fn of [...streamReconnects]) {
      try {
        fn();
      } catch {
        /* panel gone */
      }
    }
  };
  // onerror: EventSource retries on its own (server sends retry: 2000)
}

export function streamOnTopic(topicId, handler) {
  if (!topicId || !/^\d+\.\d+\.\d+$/.test(topicId)) return () => {};
  streamTopicRefs.set(topicId, (streamTopicRefs.get(topicId) || 0) + 1);
  if (!streamHandlers.has(topicId)) streamHandlers.set(topicId, new Set());
  streamHandlers.get(topicId).add(handler);
  streamEnsure();
  return () => {
    const set = streamHandlers.get(topicId);
    if (set) {
      set.delete(handler);
      if (set.size === 0) streamHandlers.delete(topicId);
    }
    const n = (streamTopicRefs.get(topicId) || 1) - 1;
    if (n <= 0) {
      streamTopicRefs.delete(topicId);
      // Reconnect with the reduced topic list (one cheap reopen)
      if (streamSource) {
        streamSource.close();
        streamSource = null;
      }
      streamEnsure();
    } else {
      streamTopicRefs.set(topicId, n);
    }
  };
}

// Called on every (re)open of the shared stream — panels use it to
// re-fetch their topic and absorb anything missed while disconnected.
export function streamOnReconnect(fn) {
  streamReconnects.add(fn);
  return () => streamReconnects.delete(fn);
}

// Send path: the wallet-confirmed send is reported to the backend as
// PENDING so every viewer sees the message instantly; the poller confirms
// it against the mirror (source of truth). Backend offline = a plain
// Hedera send, exactly as before. Dynamic imports: see the circular-init
// note at the top of this file.
export async function sendMessage(topicId, message) {
  const { sendMessage: sendToHedera } = await import('./hedera');
  const receipt = await sendToHedera(topicId, message);
  try {
    const { connectedAccount } = await import('./web3');
    if (connectedAccount && /^\d+\.\d+\.\d+$/.test(connectedAccount)) {
      await fetch(BACKEND_URL + "/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topicId, body: message, payer: connectedAccount }),
      });
    }
  } catch (e) {
    // backend offline — the mirror still has the message
  }
  return receipt;
}

// Live-marker view (24h, country-based search). The app reports each marker
// it uploads; the backend keeps it live for 24h and tags it with a country.
// Both are OPTIONAL — a failed call just means the local view is empty.
// Fire-and-forget: never blocks the wallet-confirmed upload.
export function reportMarker(topic, cord, title, image, msg, payer, number) {
  if (!topic || !cord) return;
  fetch(BACKEND_URL + "/api/marker", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic, cord, title, image, msg, payer, number }),
  }).catch(() => {});
}

// Live markers in one country: [{ lng, lat, title, image, msg, topic, lastSeen }]
export async function fetchLocalMarkers(country) {
  if (!country) return { markers: [], error: "" };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(
      `${BACKEND_URL}/api/local?country=${encodeURIComponent(country)}`,
      { signal: ctrl.signal }
    );
    clearTimeout(t);
    if (!res.ok) return { markers: [], error: "backend HTTP " + res.status };
    const data = await res.json();
    return { markers: data.markers || [], error: "" };
  } catch (e) {
    return { markers: [], error: e.message || String(e) };
  }
}

// Current per-account settings, one row per user (latest valid value per
// field) — the backend denormalizes the four profile topics for us.
// ready=false → backend offline or profile topics not backfilled yet →
// the caller falls back to reading the topics directly.
export async function fetchUserSettings() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(BACKEND_URL + "/api/user-settings", { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return { ready: false, settings: [] };
    const data = await res.json();
    return { ready: !!data.ready, settings: data.settings || [] };
  } catch (e) {
    return { ready: false, settings: [] };
  }
}
