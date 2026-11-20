// domainregistry.js — which names on the domain registry topic are live,
// and the topic each one opens. The page (loaddomains.js) and the server
// (server/installmanifest.js, which only installs a registered name) read
// the registry by this one rule.
//
// A message is { payer, domain, topic } plus its consensus_timestamp. A
// name's messages are walked oldest first, tracking the current owner and
// when their time lapses: the same owner before the lapse adds
// DOMAIN_SECONDS, after it buys again; another payer is ignored while the
// owner's time runs and takes the name over once it has lapsed. A name
// whose time has run out is not live.

export const DOMAIN_TOPIC = '0.0.9606779';
export const DOMAIN_SECONDS = 2419200;

function parsed(message) {
  if (typeof message !== 'string') return message;
  try {
    return JSON.parse(message);
  } catch {
    return null;
  }
}

// The live names, as [{ domain, lastMessage, addedTime }]: lastMessage is
// the owner's newest counted message (its topic is where the name points),
// addedTime when the name lapses, in seconds. A message repeated with the
// same sequence number counts once.
export function activeDomains(messages, nowSeconds = Date.now() / 1000) {
  const list = Array.isArray(messages) ? messages : [];
  const seen = new Set();
  const byDomain = new Map();
  for (const raw of list) {
    const message = parsed(raw);
    if (!message || typeof message !== 'object') continue;
    const seq = message.sequence_number;
    if (seq != null) {
      if (seen.has(seq)) continue;
      seen.add(seq);
    }
    if (!message.payer || !message.domain) continue;
    const domain = message.domain;
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain).push({
      topic: message.topic,
      domain,
      payer: message.payer,
      timestamp: message.consensus_timestamp,
    });
  }

  const live = [];
  for (const [domain, owned] of byDomain) {
    owned.sort((a, b) => parseFloat(a.timestamp) - parseFloat(b.timestamp));
    let owner = owned[0].payer;
    let windowEnd = parseFloat(owned[0].timestamp) + DOMAIN_SECONDS;
    let lastMessage = owned[0];
    for (let i = 1; i < owned.length; i++) {
      const msg = owned[i];
      const t = parseFloat(msg.timestamp);
      if (msg.payer === owner) {
        windowEnd = t < windowEnd ? windowEnd + DOMAIN_SECONDS : t + DOMAIN_SECONDS;
        lastMessage = msg;
      } else if (t >= windowEnd) {
        owner = msg.payer;
        windowEnd = t + DOMAIN_SECONDS;
        lastMessage = msg;
      }
    }
    if (windowEnd > nowSeconds) live.push({ domain, lastMessage, addedTime: windowEnd });
  }
  return live;
}

// The names a link may open: live, and not shaped like a topic id.
export function linkableDomains(messages, nowSeconds) {
  return activeDomains(messages, nowSeconds).filter((entry) => !String(entry.domain).includes('0.0.'));
}
