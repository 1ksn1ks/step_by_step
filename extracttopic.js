import { loadedDomains } from './loaddomains';
import { DEFAULT_TOPIC, startFromUrl } from './installtarget.js';

export let initialTopicId = '';
const defaultTopicId = DEFAULT_TOPIC;

export async function extractTopicId() {
  // The first path segment, else ?topic= (notification links carry it so
  // an older path-less link still opens it). installtarget.js reads a link
  // the same way for an installed app's start.
  const userInput = startFromUrl(window.location.href);
  
  let topicId;
  if (userInput.startsWith('0.0.')) {
    topicId = userInput;
  } else {
    let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
    if (domainEntry && domainEntry.lastMessage) {
      topicId = domainEntry.lastMessage.topic;
    } else {
      topicId = defaultTopicId;
    }
  }

  // The id is what the background load reads. Do not show #load-column
  // or move focus; the Load page opens only from the drawer.
  const inputarea = document.getElementById("input-field");
  inputarea.value = topicId;

  initialTopicId = topicId; 
  return initialTopicId;
}

extractTopicId()
