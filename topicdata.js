// The app's single data layer for topic messages.
//
// Every read in the app goes through getTopicData() — the ONE place that
// decides where messages come from:
//   1. in-memory session cache (repeated loads within the TTL are instant)
//   2. the backend (server/) — our synced cache of the mirror
//   3. the mirror node (getMessages) — fallback when the backend is
//      offline or hasn't backfilled the topic yet
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

const cache = new Map(); // topicId -> { at, ttl, viaBackend, messages, error }
const DEFAULT_TTL = 60 * 1000; // session cache: 60s

export async function getTopicData(topicId, { limit = 20000, ttl = DEFAULT_TTL, force = false } = {}) {
  if (!force) {
    const hit = cache.get(topicId);
    if (hit && Date.now() - hit.at < hit.ttl) {
      return { messages: hit.messages.slice(), error: hit.error, viaBackend: hit.viaBackend };
    }
  }

  trackTopic(topicId);
  const viaBackendResult = await fetchMessagesBackend(topicId, limit);

  let viaBackend, messages, error;
  if (viaBackendResult.ready) {
    viaBackend = true;
    messages = viaBackendResult.messages;
    error = '';
  } else {
    viaBackend = false;
    // Dynamic import: see the circular-init note at the top of this file
    const { getMessages: getMessagesMirror } = await import('./hedera');
    const mirrorResult = await getMessagesMirror(topicId);
    messages = mirrorResult.messages;
    error = mirrorResult.error;
  }

  cache.set(topicId, { at: Date.now(), ttl, viaBackend, messages, error });
  return { messages: messages.slice(), error, viaBackend };
}
