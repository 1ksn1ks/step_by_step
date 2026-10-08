import { getTopicData as getMessages } from "./topicdata";


export let loadedDomains = [];


async function loadDomains() {
  try {
    const topicId = "0.0.9606779";

    const rawResult = await getMessages(topicId);

    const seen = new Map();
    const uniqueMessages = {messages:[]};

    for (let index = 0; index < rawResult.messages.length; index++) {
      const message = rawResult.messages[index];
      const seqNum = message.sequence_number;

      if (!seen.has(seqNum)) {
        seen.set(seqNum, true);
        uniqueMessages.messages.push(message);
      }
    }



    if (!rawResult || !Array.isArray(rawResult.messages)) {
      return [];
    }

    const domainsMap = new Map();

    for (let index = 0; index < rawResult.messages.length; index++) {
      const message = rawResult.messages[index];
      try {
        let parsedMessage = message;
        if (typeof message === 'string') {
          parsedMessage = JSON.parse(message);
        }

        if (parsedMessage.payer && parsedMessage.domain) {
          const domain = parsedMessage.domain;
          if (!domainsMap.has(domain)) {
            domainsMap.set(domain, []);
          }
          domainsMap.get(domain).push({
            topic: parsedMessage.topic,
            domain: domain,
            payer: parsedMessage.payer,
            timestamp: parsedMessage.consensus_timestamp // or parsedMessage.timestamp
          });
        } else {
          console.warn(`Message ${index} is missing payer or domain.`);
        }
      } catch (messageError) {
        console.error(`Error processing message ${index}:`, messageError);
      }
    }

    const SECONDS_TO_ADD = 2419200;
    const currentTime = Date.now() / 1000;

    let domainsArray = Array.from(domainsMap.entries()).map(([domain, messages]) => {
      // Sort all messages for the domain by timestamp
      messages.sort((a, b) => parseFloat(a.timestamp) - parseFloat(b.timestamp));

      if (messages.length === 0) {
        return { domain, lastMessage: null, addedTime: 0 };
      }

      // Walk the sorted messages tracking the CURRENT owner and when their
      // time lapses. The winner is whoever holds the unbroken chain up to now:
      //   - same owner before lapse  -> adds more time (extend the chain)
      //   - same owner after lapse   -> re-purchase (window resets)
      //   - different payer, live    -> ignored (no takeover while active)
      //   - different payer, lapsed  -> takeover (new owner, new chain)
      let owner = messages[0].payer;
      let windowEnd = parseFloat(messages[0].timestamp) + SECONDS_TO_ADD;
      let lastMessage = messages[0];

      for (let i = 1; i < messages.length; i++) {
        const msg = messages[i];
        const t = parseFloat(msg.timestamp);
        if (msg.payer === owner) {
          if (t < windowEnd) {
            windowEnd += SECONDS_TO_ADD;       // owner adds more time
          } else {
            windowEnd = t + SECONDS_TO_ADD;     // owner re-bought after a lapse
          }
          lastMessage = msg;
        } else if (t >= windowEnd) {
          owner = msg.payer;                    // expired -> takeover
          windowEnd = t + SECONDS_TO_ADD;
          lastMessage = msg;
        }
        // else: different payer while the window is live -> ignored
      }

      return {
        domain,
        lastMessage,
        addedTime: windowEnd
      };
    });

    // Filter out expired domains (keep only active ones where addedTime > currentTime)
    domainsArray = domainsArray.filter(item => item.addedTime > currentTime);

    return domainsArray;

  } catch (error) {
    console.error("Error in loadDomains:", error);
    return [];
  }
}

loadDomains().then(domains => {
  loadedDomains = domains.filter(domain => !domain.domain.includes("0.0."));
});
