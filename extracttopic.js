
import {adjustTextareaHeight} from './adjusttextarea' 
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

    const loadColumn = document.getElementById("load-column");
    loadColumn.style.display = "block";
    const inputarea = document.getElementById("input-field");
    inputarea.value = '';
    inputarea.value = topicId;
    adjustTextareaHeight(inputarea);
    // toolbarload = true;

  initialTopicId = topicId; 
  return initialTopicId;
}

extractTopicId()
