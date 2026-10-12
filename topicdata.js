// The app's single data layer for topic messages.
//
// Every read in the app goes through getTopicData() — the ONE place that
// decides where messages come from:
//   1. in-memory session cache (repeated loads within the TTL are instant)
//   2. messages already saved on this phone (IndexedDB)
//   3. the backend (server/) — only the rows after the saved sequence
//   4. the mirror node (getMessages) — fallback when the backend is
//      offline or hasn't backfilled the topic yet. Same tail, not a
//      second full history, once this phone has saved the topic.
//
// Files import it as `getMessages` (same name, same { messages, error }
// shape) so no call-site logic changes. The backend is optional by design:
// with it off, the app behaves exactly like before.
//
// NOTE: this module must keep ZERO static imports from app modules —
// hedera/web3 loop back into the data loaders, and a static import here
// would leave DEFAULT_TTL in the temporal dead zone when their top-level
// loads run getTopicData (circular init).

import { trackTopic, fetchMessagesBackend } from './msgbackend';
import {
  highestSequence,
  mergeMessages,
  readTopicCache,
  writeTopicMessages,
} from './topiccache.js';

const cache = new Map(); // topicId -> { at, ttl, viaBackend, messages, error }
const inflight = new Map();
const DEFAULT_TTL = 60 * 1000; // session cache: 60s
let toldCacheFull = false;

function tellCacheFull() {
  if (toldCacheFull || typeof window === 'undefined') return;
  toldCacheFull = true;
  window.dispatchEvent(new CustomEvent('topic-cache-full'));
}

function splitBatch(batch) {
  const confirmed = [];
  const extras = [];
  for (const message of batch || []) {
    const seq = Number(message && message.sequence_number);
    if (Number.isFinite(seq) && seq > 0) confirmed.push(message);
    else extras.push(message);
  }
  return { confirmed, extras };
}

async function fetchTail(topicId, limit, lastSeq) {
  const collected = [];
  // Pending sends are appended to every server page. Keep the latest page's
  // copy once, or a full page would list the same unconfirmed send again.
  let pending = [];
  let after = Number(lastSeq) || 0;
  let reached = after;
  for (let guard = 0; guard < 30; guard++) {
    const page = await fetchMessagesBackend(topicId, limit, after);
    if (!page.ready) {
      const { getMessages: getMessagesMirror } = await import('./hedera');
      const mirrorResult = await getMessagesMirror(topicId, { afterSeq: after });
      const messages = collected.concat(mirrorResult.messages || [], pending);
      const mirrorReached = Number(mirrorResult.lastSequence) || highestSequence(messages, after);
      return {
        save: messages.length > 0 || mirrorReached > after,
        messages,
        reached: Math.max(reached, mirrorReached),
        error: mirrorResult.error || '',
        viaBackend: false,
      };
    }
    const { confirmed, extras } = splitBatch(page.messages);
    collected.push(...confirmed);
    pending = extras;
    const next = highestSequence(confirmed, after);
    reached = Math.max(reached, next);
    if (confirmed.length < limit || next <= after) {
      return { save: true, messages: collected.concat(pending), reached, error: '', viaBackend: true };
    }
    after = next;
  }
  return { save: true, messages: collected.concat(pending), reached, error: '', viaBackend: true };
}

async function loadTopic(topicId, { limit, ttl }) {
  trackTopic(topicId);
  let local = { messages: [], lastSeq: 0 };
  try {
    local = await readTopicCache(topicId);
  } catch (error) {
    console.warn('topic cache read failed', error);
  }

  const fetched = await fetchTail(topicId, limit, local.lastSeq);
  const messages = mergeMessages(local.messages, fetched.messages);
  if (fetched.save) {
    try {
      const full = await writeTopicMessages(topicId, fetched.messages, fetched.reached);
      if (full) tellCacheFull();
    } catch (error) {
      console.warn('topic cache write failed', error);
    }
  }

  const result = { messages, error: fetched.error, viaBackend: fetched.viaBackend };
  if (!fetched.error) cache.set(topicId, { at: Date.now(), ttl, ...result });
  return { ...result, messages: messages.slice() };
}

export async function getTopicData(topicId, { limit = 20000, ttl = DEFAULT_TTL, force = false } = {}) {
  const key = String(topicId || '');
  if (!key) return { messages: [], error: 'missing topic', viaBackend: false };
  if (!force) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < hit.ttl) {
      return { messages: hit.messages.slice(), error: hit.error, viaBackend: hit.viaBackend };
    }
  }

  const running = inflight.get(key);
  if (running) {
    const shared = await running;
    return { messages: shared.messages.slice(), error: shared.error, viaBackend: shared.viaBackend };
  }

  const job = loadTopic(key, { limit, ttl });
  inflight.set(key, job);
  try {
    return await job;
  } finally {
    inflight.delete(key);
  }
}

