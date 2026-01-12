import {getMessages, getTopicInfo } from './hedera'
import { loadTOPIC2PIC, usernames } from './loadalladata'
import { activePolygonPopups} from './polygons';
import { activeMarkerPopups } from './marker';
import { CloseALL, OpenToggleToolbar } from './cssLogic'
import { adjustTextareaHeight } from './adjusttextarea';
import { globalLoadedTopicIdsWithNames } from './letall';



export async function loadTOPIC4PIC(payer) {
    try {
      const accountTOPIC2PIC = await loadTOPIC2PIC();
  
      if (!accountTOPIC2PIC[payer] || !accountTOPIC2PIC[payer].topic2pic) {
      activePolygonPopups.forEach((popup) => popup.remove());
      activeMarkerPopups.forEach((popup) => popup.remove());
      CloseALL();
      const loadColumn = document.getElementById("load-column");
      loadColumn.style.display = "block";
      OpenToggleToolbar();
      const inputarea = document.getElementById("input-field");
      inputarea.value = '';
      const loaded_text_area = document.getElementById("loaded-topics");
      loaded_text_area.value = '';
      const topicSpinnerChat = `
      <div style="display: flex; justify-content: left; align-items: left; padding-top: 1vh; padding-bottom: 1vh;">
         <span style="margin-left: 1vw;">User has not set any topics, it can be done by going to OPTIONS > TOOLBAR > EDIT > add Topic ID and press TOPIC2PIC<br><br>
         U can also stack multiple by going to OPTIONS > TOOLBAR > Stack Topic IDs (include one into TOPIC2PIC and then u stack them onto that one)</span>
        </div>`;
      loaded_text_area.innerHTML = topicSpinnerChat;
      adjustTextareaHeight(loaded_text_area);
      console.error("Error getting topic info:", error);
      return;
      }
  
      const topicId = accountTOPIC2PIC[payer].topic2pic;
      const topicIdStr = topicId[0];
      const topicAdmin = [];
  
      try{
      const topicInfo = await getTopicInfo(topicIdStr);
      const memo = topicInfo.memo;
      const parts = memo.split(',');
      let hasRules = false;
      parts.forEach(part => {
        if (part.startsWith("0.0.")) {
          topicAdmin.push(part);
          hasRules = true;
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
  
      const result = await getMessages(topicIdStr);
  
      if (!result || !Array.isArray(result.messages)) {
        console.log(`No messages found for topicId ${topicId}, returning empty object`);
        return {};
      }
  
      let hasMoreThanOneTopic = false;
      const topicActions = new Map();
  
      for (let index = 0; index < result.messages.length; index++) {
        const message = result.messages[index];
        try {
          let parsedMessage = message;
          if (typeof message === 'string') {
            parsedMessage = JSON.parse(message);
          }
          const timestamp = message.timestamp || Date.now();
  
          if (
            parsedMessage.addTopic &&
            parsedMessage.addTopic.addTopic &&
            (topicAdmin.length === 0 || topicAdmin.includes(message.payer))
          ) {
            hasMoreThanOneTopic = true;
            const topics =
              typeof parsedMessage.addTopic.addTopic === 'string'
                ? parsedMessage.addTopic.addTopic.split(',')
                : [];
            topics.forEach(topic => {
              topicActions.set(topic, { action: 'add', timestamp });
            });
          }
  
          if (
            parsedMessage.removeTopic &&
            parsedMessage.removeTopic.removeTopic &&
            (topicAdmin.length === 0 || topicAdmin.includes(message.payer))
          ) {
            hasMoreThanOneTopic = true;
            const topics =
              typeof parsedMessage.removeTopic.removeTopic === 'string'
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
  
      const loadedTopicsIds = Array.from(topicActions.entries())
        .filter(([topic, { action }]) => action === 'add' && topic.startsWith('0.0.'))
        .map(([topic]) => topic);

      const loadedTopicIdsWithNames = [];

      for (const topicId of loadedTopicsIds) {
        const { loadedTopicName } = await getMessages(topicId);
  
        if (loadedTopicName !== undefined) {
          const topicNamePart = loadedTopicName ? `-${loadedTopicName}` : '';
          loadedTopicIdsWithNames.push(`${topicId}${topicNamePart}`);
        }
      }

      let newglobalLoadedTopicIdsWithNames = globalLoadedTopicIdsWithNames
  
      newglobalLoadedTopicIdsWithNames = loadedTopicIdsWithNames.sort((a, b) => {
        const idA = parseFloat(a.split('-')[0].replace('0.0.', ''));
        const idB = parseFloat(b.split('-')[0].replace('0.0.', ''));
        return idA - idB;
      });
  
      let editUsername = usernames[payer]?.username;
  
      activePolygonPopups.forEach((popup) => popup.remove());
      activeMarkerPopups.forEach((popup) => popup.remove());
      CloseALL();
      const loadColumn = document.getElementById("load-column");
      loadColumn.style.display = "block";
      OpenToggleToolbar();
      const inputarea = document.getElementById("input-field");
      inputarea.value = '';
      const loaded_text_area = document.getElementById("loaded-topics");
      loaded_text_area.innerHTML = '';
      loaded_text_area.innerHTML = 'User ' + payer + ' ' + editUsername + '<br><br>' + newglobalLoadedTopicIdsWithNames.join('<br>');
      adjustTextareaHeight(loaded_text_area);
  
      return { loadedTopicIdsWithNames };
  
    } catch (error) {
      console.log(`Error in loadTOPIC4PIC for payer ${payer}:`, error);
      return {};
    }
  }
  
  window.loadTOPIC4PIC = loadTOPIC4PIC;