import { loadedDomains } from './loaddomains';

export let initialTopicId = '';
const defaultTopicId = '0.0.9609912';

export async function extractTopicId() {
  const url = new URL(window.location.href);
  const fromPath = url.pathname && url.pathname !== '/'
    ? decodeURIComponent(url.pathname.slice(1).split('/')[0])
    : '';
  // Notification links also carry ?topic= so an older path-less link still opens it.
  const fromQuery = (url.searchParams.get('topic') || '').trim();
  const userInput = fromPath || fromQuery;
  
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
