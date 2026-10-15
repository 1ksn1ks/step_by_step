// One person counts once on a post. The latest sharePost or unsharePost
// from that account wins. Callers walk messages oldest to newest.
const sharePayers = new Map();

function shareKey(topicId, timestamp) {
  return String(topicId || '') + '|' + String(timestamp || '');
}

export function clearShareTopic(topicId) {
  const prefix = String(topicId || '') + '|';
  for (const key of sharePayers.keys()) {
    if (key.startsWith(prefix)) sharePayers.delete(key);
  }
}

export function noteShare(parsed, topicId) {
  if (!parsed || typeof parsed !== 'object' || !topicId) return;
  const unshareBody = parsed.unsharePost;
  const shareBody = parsed.sharePost;
  const dropping = unshareBody && unshareBody.timestamp;
  const body = dropping ? unshareBody : shareBody;
  if (!body || !body.timestamp || !parsed.payer) return;
  const key = shareKey(topicId, body.timestamp);
  let row = sharePayers.get(key);
  if (!row) {
    row = new Map();
    sharePayers.set(key, row);
  }
  row.set(parsed.payer, dropping ? 'unsharePost' : 'sharePost');
}

export function shareState(topicId, timestamp, account) {
  const row = sharePayers.get(shareKey(topicId, timestamp));
  if (!row) return { count: 0, mine: false };
  let count = 0;
  for (const type of row.values()) {
    if (type === 'sharePost') count += 1;
  }
  return { count, mine: !!(account && row.get(account) === 'sharePost') };
}

// null: this account has no share or unshare for that post in this visit.
// true or false: the latest message from this account, including one the
// wallet just confirmed and the server has not mirrored yet.
export function shareMine(topicId, timestamp, account) {
  const row = sharePayers.get(shareKey(topicId, timestamp));
  if (!row || !account || !row.has(account)) return null;
  return row.get(account) === 'sharePost';
}

// Pin walk is newest first. The first share or unshare for a key decides.
// An older message does not put the pin back or add a second one.
export function takeSharePin(decisions, features, key, feature) {
  if (!decisions.has(key)) decisions.set(key, 'share');
  if (decisions.get(key) !== 'share') return;
  if (features.some((item) => item.shareKey === key)) return;
  features.push(feature);
}

export function takeUnsharePin(decisions, features, key) {
  if (!decisions.has(key)) decisions.set(key, 'unshare');
  if (decisions.get(key) !== 'unshare') return;
  for (let i = features.length - 1; i >= 0; i--) {
    if (features[i].shareKey === key) features.splice(i, 1);
  }
}
