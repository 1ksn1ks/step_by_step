import { getMessages } from "./hedera";


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
      console.log("No messages found or rawResult is not an array.");
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

      const firstPayer = messages[0].payer;
      const firstTimestamp = parseFloat(messages[0].timestamp);
      const initialWindowEnd = firstTimestamp + SECONDS_TO_ADD;

      // Check if firstPayer has any renewal (subsequent message) within the initial window
      const hasRenewal = messages.some((msg, idx) => idx > 0 && msg.payer === firstPayer && parseFloat(msg.timestamp) <= initialWindowEnd);

      let validPayerMessages = [];
      let startTimestamp;

      if (hasRenewal) {
        // Use firstPayer and all their messages
        validPayerMessages = messages.filter(message => message.payer === firstPayer);
        startTimestamp = firstTimestamp;
      } else {
        // Find the first takeover message from a different payer AFTER the initial window end
        let takeoverIndex = -1;
        for (let i = 1; i < messages.length; i++) {
          const msgTimestamp = parseFloat(messages[i].timestamp);
          if (messages[i].payer !== firstPayer && msgTimestamp > initialWindowEnd) {
            takeoverIndex = i;
            break;
          }
        }

        if (takeoverIndex === -1) {
          // No takeover, fall back to firstPayer with no renewal (initial period only)
          validPayerMessages = messages.filter(message => message.payer === firstPayer);
          startTimestamp = firstTimestamp;
        } else {
          // Switch to takeover payer and their messages from takeover onwards
          const takeoverPayer = messages[takeoverIndex].payer;
          startTimestamp = parseFloat(messages[takeoverIndex].timestamp);
          validPayerMessages = messages.slice(takeoverIndex).filter(message => message.payer === takeoverPayer);
        }
      }

      if (validPayerMessages.length === 0) {
        return { domain, lastMessage: null, addedTime: 0 };
      }

      // Compute addedTime starting from the startTimestamp
      let addedTime = startTimestamp + SECONDS_TO_ADD;

      // Handle sequential renewals: iterate through subsequent messages
      for (let i = 1; i < validPayerMessages.length; i++) {
        const renewalTime = parseFloat(validPayerMessages[i].timestamp);
        if (renewalTime < addedTime) {
          // Extend expiry if renewal is within current window
          addedTime = addedTime + SECONDS_TO_ADD;
        }
      }

      // Get the last message from the valid payer
      const lastMessage = validPayerMessages[validPayerMessages.length - 1];

      return {
        domain,
        lastMessage,
        addedTime
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
