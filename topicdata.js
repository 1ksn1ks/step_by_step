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

import { trackTopic, fetchMessagesBackend, takePopupViews } from './msgbackend';
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

// The server never returns more than this many rows, even when the caller
// asked for the whole 20000-message window.
const MESSAGE_PAGE = 1000;

function lowestSequence(messages) {
  let min = 0;
  for (const message of messages || []) {
    const seq = Number(message && message.sequence_number);
    if (Number.isFinite(seq) && seq > 0 && (min === 0 || seq < min)) min = seq;
  }
  return min;
}

function confirmedCount(messages) {
  let count = 0;
  for (const message of messages || []) {
    if (Number(message && message.sequence_number) > 0) count += 1;
  }
  return count;
}

// Keep the newest `limit` confirmed rows. Pending sends stay on the end.
function trimNewest(messages, limit) {
  const confirmed = [];
  const extras = [];
  for (const message of messages || []) {
    if (Number(message && message.sequence_number) > 0) confirmed.push(message);
    else extras.push(message);
  }
  confirmed.sort((a, b) => Number(a.sequence_number) - Number(b.sequence_number));
  const kept = confirmed.length > limit ? confirmed.slice(confirmed.length - limit) : confirmed;
  return kept.concat(extras);
}

async function mirrorTail(topicId, after, collected, pending) {
  // getMessages joins HCS chunk_info with the same hcschunks assembler the
  // server uses, so a long message is one row here when the backend is down.
  const { getMessages: getMessagesMirror } = await import('./hedera');
  const mirrorResult = await getMessagesMirror(topicId, { afterSeq: after });
  const messages = collected.concat(mirrorResult.messages || [], pending);
  const mirrorReached = Number(mirrorResult.lastSequence) || highestSequence(messages, after);
  return {
    save: messages.length > 0 || mirrorReached > after,
    messages,
    reached: Math.max(after, mirrorReached),
    error: mirrorResult.error || '',
    viaBackend: false,
  };
}

// Newer than the saved sequence, one server page at a time.
async function fetchForward(topicId, lastSeq) {
  const collected = [];
  let pending = [];
  let after = Number(lastSeq) || 0;
  let reached = after;
  for (let guard = 0; guard < 30; guard++) {
    const page = await fetchMessagesBackend(topicId, MESSAGE_PAGE, after, 0);
    if (page.views) takePopupViews(topicId, page.views);
    if (!page.ready) return mirrorTail(topicId, after, collected, pending);
    const { confirmed, extras } = splitBatch(page.messages);
    collected.push(...confirmed);
    pending = extras;
    const next = highestSequence(confirmed, after);
    reached = Math.max(reached, next);
    if (confirmed.length < MESSAGE_PAGE || next <= after) break;
    after = next;
  }
  return { save: true, messages: collected.concat(pending), reached, error: '', viaBackend: true };
}

// Newest page first, then older pages through before_seq, until `need`
// confirmed rows are in hand or a page comes back short.
async function fetchOlder(topicId, need, beforeStart) {
  const collected = [];
  let pending = [];
  let before = Number(beforeStart) || 0;
  let includePending = before === 0;
  for (let guard = 0; guard < 30 && collected.length < need; guard++) {
    const page = await fetchMessagesBackend(topicId, MESSAGE_PAGE, 0, before);
    if (page.views) takePopupViews(topicId, page.views);
    if (!page.ready) {
      if (collected.length) {
        return {
          save: true,
          messages: collected.concat(pending),
          reached: highestSequence(collected, 0),
          error: '',
          viaBackend: true,
        };
      }
      return mirrorTail(topicId, 0, collected, pending);
    }
    const { confirmed, extras } = splitBatch(page.messages);
    if (includePending) pending = extras;
    includePending = false;
    collected.push(...confirmed);
    if (confirmed.length < MESSAGE_PAGE) break;
    const oldest = lowestSequence(confirmed);
    if (!oldest || (before > 0 && oldest >= before)) break;
    before = oldest;
  }
  return {
    save: true,
    messages: collected.concat(pending),
    reached: highestSequence(collected, 0),
    error: '',
    viaBackend: true,
  };
}

async function loadTopic(topicId, { limit, ttl }) {
  trackTopic(topicId);
  let local = { messages: [], lastSeq: 0 };
  try {
    local = await readTopicCache(topicId);
  } catch (error) {
    console.warn('topic cache read failed', error);
  }

  const incoming = [];
  let error = '';
  let viaBackend = true;
  let save = false;
  let reached = Number(local.lastSeq) || 0;

  if (reached > 0) {
    const tail = await fetchForward(topicId, reached);
    incoming.push(...tail.messages);
    error = tail.error;
    viaBackend = tail.viaBackend;
    save = tail.save;
    reached = Math.max(reached, Number(tail.reached) || 0);
  }

  const soFar = mergeMessages(local.messages, incoming);
  // Sequence 1 is the first message. Nothing older exists, so do not ask.
  if (viaBackend && !error && confirmedCount(soFar) < limit && lowestSequence(soFar) !== 1) {
    const oldest = lowestSequence(soFar);
    const older = await fetchOlder(topicId, limit - confirmedCount(soFar), reached > 0 ? oldest : 0);
    incoming.push(...older.messages);
    if (older.error) error = older.error;
    viaBackend = viaBackend && older.viaBackend;
    save = save || older.save;
    reached = Math.max(reached, Number(older.reached) || 0);
  }

  const messages = trimNewest(mergeMessages(local.messages, incoming), limit);
  if (save) {
    try {
      const full = await writeTopicMessages(topicId, incoming, reached);
      if (full) tellCacheFull();
    } catch (error) {
      console.warn('topic cache write failed', error);
    }
  }

  const result = { messages, error, viaBackend };
  if (!error) cache.set(topicId, { at: Date.now(), ttl, ...result });
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

