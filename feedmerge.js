// The feed reads several topics as one newest-first list: the open topic
// and the topics stacked on it (topicstack.js). Each topic is a source.
// Its pages arrive newest first into `rows`; `cursor` is the oldest
// position fetched so far, and `done` is set once its history is read.
//
// Everything a source has not fetched yet is older than its cursor. So a
// fetched row can be shown once it is at or above the cursor of every
// source still being read: no topic can turn up anything newer later.
// That keeps the combined list in consensus order page after page, and
// only a source whose fetched rows have all been shown is fetched again.

export function cmpTs(a, b) {
  const left = String(a || '').split('.');
  const right = String(b || '').split('.');
  const as = left[0].padStart(12, '0') + (left[1] || '').padEnd(9, '0');
  const bs = right[0].padStart(12, '0') + (right[1] || '').padEnd(9, '0');
  if (as === bs) return 0;
  return as < bs ? -1 : 1;
}

// Oldest first: consensus timestamp, then sequence number.
export function cmpMessage(a, b) {
  const ts = cmpTs(a && a.consensus_timestamp, b && b.consensus_timestamp);
  if (ts) return ts;
  return (Number(a && a.sequence_number) || 0) - (Number(b && b.sequence_number) || 0);
}

// high: the newest sequence fetched, so a catch-up starts past rows that
// are still waiting below the floor.
export function feedSource(topic) {
  return { topic, cursor: null, done: false, rows: [], fails: 0, high: 0 };
}

export function needsPull(source) {
  return !source.done && source.rows.length === 0;
}

export function sourcesDone(sources) {
  return sources.every((source) => source.done && source.rows.length === 0);
}

// One fetched page for a source, newest first, as { messages, done }.
// Returns false when the page brought nothing new and the source is done.
export function addPage(source, page) {
  const messages = (page && page.messages) || [];
  if (!messages.length) {
    source.done = true;
    return false;
  }
  const oldest = messages[messages.length - 1];
  const ts = String(oldest.consensus_timestamp || '');
  // The same oldest row twice: the topic has nothing older to give.
  if (source.cursor && ts === String(source.cursor.ts)) {
    source.done = true;
    return false;
  }
  source.cursor = { ts, seq: Number(oldest.sequence_number) || 0 };
  if (page.done) source.done = true;
  for (const message of messages) {
    const seq = Number(message.sequence_number) || 0;
    if (seq > source.high) source.high = seq;
    source.rows.push({ topic: source.topic, message });
  }
  return true;
}

// Takes every row that is safe to show, newest first, as { topic, message }.
// A source still being read that has not fetched yet holds everything back.
export function takeMerged(sources) {
  let floor = null;
  for (const source of sources) {
    if (source.done) continue;
    if (!source.cursor) return [];
    if (floor == null || cmpTs(source.cursor.ts, floor) > 0) floor = source.cursor.ts;
  }
  const out = [];
  for (const source of sources) {
    let count = 0;
    while (count < source.rows.length
      && (floor == null || cmpTs(source.rows[count].message.consensus_timestamp, floor) >= 0)) {
      count += 1;
    }
    if (count) out.push(...source.rows.splice(0, count));
  }
  out.sort((a, b) => cmpMessage(b.message, a.message));
  return out;
}
