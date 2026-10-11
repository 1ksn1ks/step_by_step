// Marker rules and polygon rules are separate stacks. Different NFT topics
// stay listed together. Mentioning the same NFT topic again updates only
// that rule, so 5 per NFT and later 6 per NFT leaves 6 for that id.
// A message that is not a valid rule does not change the previous one.
// A message without `add` replaces that side (older combined messages).
// `remove: true` drops the named NFT id. With no id it clears that side.
// An id that does not start with "0.0." (including "0") means anyone can post.

function parseRuleMessage(message) {
  if (typeof message === 'string') {
    return JSON.parse(message);
  }
  return message;
}

function adminMaySetRules(payer, topicAdmin) {
  return !topicAdmin || topicAdmin.length === 0 || topicAdmin.includes(payer);
}

function applyStackedRule(list, side, idKey, extraKeys) {
  if (!side || typeof side !== 'object') return;
  const rawId = side[idKey];
  const id = typeof rawId === 'string' ? rawId.trim() : '';

  if (side.remove === true) {
    if (!id) {
      list.length = 0;
      return;
    }
    const removeAt = list.findIndex((item) => item.id === id);
    if (removeAt !== -1) list.splice(removeAt, 1);
    return;
  }

  const open = id.length > 0 && !id.startsWith('0.0.');
  const validNft = id.startsWith('0.0.');
  if (!validNft && !open) return;
  if (validNft && extraKeys.some((key) => side[key] === undefined || String(side[key]).trim() === '')) return;

  if (!side.add) list.length = 0;

  const next = { id, open };
  if (!open) {
    next[idKey] = id;
    for (const key of extraKeys) next[key] = side[key];
  }
  const index = list.findIndex((item) => item.id === next.id);
  if (index === -1) list.push(next);
  else list[index] = next;
}

export function stackedTopicRules(messages, topicAdmin) {
  const markers = [];
  const polygons = [];
  if (!Array.isArray(messages)) return { markers, polygons };

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    let parsedMessage;
    try {
      parsedMessage = parseRuleMessage(message);
    } catch {
      continue;
    }
    if (!parsedMessage || !parsedMessage.rules || typeof parsedMessage.rules !== 'object') continue;
    if (!adminMaySetRules(message && message.payer, topicAdmin)) continue;

    const rules = parsedMessage.rules;
    if (Object.prototype.hasOwnProperty.call(rules, 'formarker')) {
      applyStackedRule(markers, rules.formarker, 'markerTopicId', ['markerMessagesPerNft']);
    }
    if (Object.prototype.hasOwnProperty.call(rules, 'forpolygon')) {
      applyStackedRule(polygons, rules.forpolygon, 'polygonTopicId', ['polygonMessagesPerNft', 'polygonSize']);
    }
  }

  return { markers, polygons };
}

export function smallestPolygonSize(rules) {
  let smallest = Infinity;
  for (const rule of rules) {
    const size = Number(rule.polygonSize);
    if (Number.isFinite(size) && size > 0) smallest = Math.min(smallest, size);
  }
  return Number.isFinite(smallest) ? smallest : 1;
}

export function latestTopicRules(messages, topicAdmin) {
  const { markers, polygons } = stackedTopicRules(messages, topicAdmin);
  return {
    marker: markers.find((rule) => !rule.open) || null,
    polygon: polygons.find((rule) => !rule.open) || null,
  };
}
