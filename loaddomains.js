import { getTopicData as getMessages } from "./topicdata";
import { DOMAIN_TOPIC, linkableDomains } from "./domainregistry.js";

// The live names on the domain registry (domainregistry.js has the rule;
// the server reads the registry the same way).
export let loadedDomains = [];

async function loadDomains() {
  try {
    const rawResult = await getMessages(DOMAIN_TOPIC);
    if (!rawResult || !Array.isArray(rawResult.messages)) return [];
    return linkableDomains(rawResult.messages, Date.now() / 1000);
  } catch (error) {
    console.error("Error in loadDomains:", error);
    return [];
  }
}

loadDomains().then((domains) => {
  loadedDomains = domains;
});
