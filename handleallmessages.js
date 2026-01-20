import { adjustTextareaHeight } from "./adjusttextarea";
import { 
  newStoredMarkers,
  storedMarkers,
  newStoredPolygons,
  storedPolygons,
  newGlobalLoadedTopicIdsWithNames,
  geojson,
  polygons,
  newExistingMarkers,
  existingMarkers,
  globalLoadedTopicIdsWithNames
  } from "./letall";
import { loadedDomains } from "./loaddomains";
import { getMessages, getTopicInfo } from "./hedera";
import { newActiveMarkerPopups, updateClusters, index } from "./marker";
import { newActivePolygonPopups, addPolygonWithImageFill } from "./polygons";
import { map } from './map.js';
import { processTopicMessages } from "./processallmessages.js";
import { initialTopicId } from "./extracttopic.js";


export let allLoadedMessages = [];


export async function handleAllMessages() {
    try {
      newStoredMarkers([]);
      newStoredPolygons([]);
      console.log(polygons)
      let userInput = document.getElementById("input-field").value.toLowerCase();
      let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
      let topicId;
  
      if (domainEntry && domainEntry.lastMessage) {
        topicId = domainEntry.lastMessage.topic;
      } else {
        topicId = userInput || initialTopicId;
      }
  
      const loaded_text_area = document.getElementById("loaded-topics");
      loaded_text_area.value = '';
      const topicSpinnerChat = `
      <div style="display: flex; justify-content: left; align-items: left; padding-top: 1vh; padding-bottom: 1vh;">
        <div id="topicspinnerchat"></div>
         <span style="margin-left: 1vw;">loading messages from ${topicId}</span>
        </div>`;
      loaded_text_area.innerHTML = topicSpinnerChat;
      adjustTextareaHeight(loaded_text_area);
  
  
      const topicAdmin = [];
  
  try{
      const topicInfo = await getTopicInfo(topicId);
            const memo = topicInfo.memo;
  
            const parts = memo.split(',');
  
            parts.forEach(part => {
              if (part.startsWith("0.0.")) {
                topicAdmin.push(part);
              }
            });
          }catch (error){
            const loaded_text_area = document.getElementById("loaded-topics");
      loaded_text_area.value = '';
      const topicSpinnerChat = `
      <div style="display: flex; justify-content: left; align-items: left; padding-top: 1vh; padding-bottom: 1vh;">
         <span style="margin-left: 1vw;">Invalid Topic ID</span>
        </div>`;
      loaded_text_area.innerHTML = topicSpinnerChat;
      adjustTextareaHeight(loaded_text_area);
      console.error("Error getting topic info:", error);
      return;
          }
  
  
      newGlobalLoadedTopicIdsWithNames([]);
      let addedTopics = [];
      let removedTopics = [];
      let loadedTopicsIds = [];
      newActiveMarkerPopups([]);
      newActivePolygonPopups([]);
  
  
      const result = await getMessages(topicId);
      allLoadedMessages = [];
      allLoadedMessages.push(result);
  
      let hasMoreThanOneTopic = false;
  
      geojson.features = [];
      polygons.length = 0;
  
      existingMarkers.forEach(marker => marker.remove());
      newExistingMarkers([]);
  
      // Remove existing polygon layers
      map.getStyle().layers.forEach(layer => {
        if (layer.id.includes('-layer')) {
          map.removeLayer(layer.id);
        }
      });
  
      // Remove existing polygon sources
      const sourceIds = Object.keys(map.getStyle().sources);
      sourceIds.forEach(sourceId => {
        if (sourceId.includes('-source')) {
          map.removeSource(sourceId);
        }
      });
  
  
  
  
      const topicActions = new Map();
  
      for (let index = 0; index < result.messages.length; index++) {
        const message = result.messages[index];
        try {
          let parsedMessage = message;
          if (typeof message === 'string') {
            parsedMessage = JSON.parse(message);
          }
          const timestamp = message.consensus_timestamp
  
          if (parsedMessage.addTopic && parsedMessage.addTopic.addTopic && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
            hasMoreThanOneTopic = true;
            const topics = typeof parsedMessage.addTopic.addTopic === 'string'
              ? parsedMessage.addTopic.addTopic.split(',')
              : [];
            topics.forEach(topic => {
              topicActions.set(topic, { action: 'add', timestamp });
            });
          }
  
          if (parsedMessage.removeTopic && parsedMessage.removeTopic.removeTopic && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
            hasMoreThanOneTopic = true;
            const topics = typeof parsedMessage.removeTopic.removeTopic === 'string'
              ? parsedMessage.removeTopic.removeTopic.split(',')
              : [];
            topics.forEach(topic => {
              topicActions.set(topic, { action: 'remove', timestamp });
            });
          }
        } catch (messageError) {
          console.error(`Error processing message ${index}:`, messageError);
        }
      }
  
      // Determine the final list of topics based on the latest action
      loadedTopicsIds = Array.from(topicActions.entries())
        .filter(([topic, { action }]) => action === 'add' && topic.startsWith('0.0.'))
        .map(([topic]) => topic);
  
        const loadedTopicIdsWithNames = [];
  
  
      // Load and process messages from each topic in loadedTopicsIds
      for (const topicId of loadedTopicsIds) {
        const { topicGeojsonFeatures, topicPolygons, loadedTopicName } = await processTopicMessages(topicId); // Ensure this is awaited if it's async
  
  
  
  
        storedMarkers.push(topicGeojsonFeatures);
        storedPolygons.push(topicPolygons);

        if (geojson.features.length > 0) {
          index.load(geojson.features);
          updateClusters();
        }
        // Add new polygons
        polygons.forEach(polygon => {
          addPolygonWithImageFill(map, polygon);
        });
  
  
      if (loadedTopicName !== undefined) { // Only skip if loadedTopicName is undefined
        const topicNamePart = loadedTopicName ? `-${loadedTopicName}` : '';
        loadedTopicIdsWithNames.push(`${topicId}${topicNamePart}`);
       }
      }
  
      newGlobalLoadedTopicIdsWithNames(loadedTopicIdsWithNames);
  
  
      globalLoadedTopicIdsWithNames.sort((a, b) => {
        const idA = parseFloat(a.split('-')[0].replace('0.0.', ''));
        const idB = parseFloat(b.split('-')[0].replace('0.0.', ''));
        return idA - idB;
      });
  
      loaded_text_area.innerHTML = globalLoadedTopicIdsWithNames.join('<br>'); // Update with new values
      adjustTextareaHeight(loaded_text_area); // Adjust height after loading
  
      return loadedTopicIdsWithNames; // Return the loadedTopicsIds array
  
        } catch (error) {
          console.error("Error processing topic messages:", error);
        }
  };
  
  