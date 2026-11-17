import { getTopicInfo } from './hedera'
import { getTopicData as getMessages } from './topicdata'
import { adminsFromMemo, currentStackedTopics, currentTopicName } from './loadcurrenttopic'
import { PULL_AT_ONCE, STACK_FIRST_MS, mapLimited, settlesWithin } from './feedmerge.js'
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
      const topicIdStr = String(topicId[0] || '').trim();
      let topicAdmin = [];

      try{
      const topicInfo = await getTopicInfo(topicIdStr);
      topicAdmin = adminsFromMemo(topicInfo.memo);
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
  
      // The shared stack rule (loadcurrenttopic.js): at most STACK_MAX
      // stacked topics, newest adds first, ids cleaned, one level deep.
      const loadedTopicsIds = currentStackedTopics(result.messages, topicAdmin, topicIdStr);

      // Names three at a time. A topic that takes longer than STACK_FIRST_MS,
      // or fails, is listed by its id; one slow topic never holds the list.
      const loadedTopicIdsWithNames = await mapLimited(loadedTopicsIds, PULL_AT_ONCE, async (stackedId) => {
        const job = getMessages(stackedId).catch(() => null);
        if (!(await settlesWithin(job, STACK_FIRST_MS))) return stackedId;
        const topicData = await job;
        const loadedTopicName = currentTopicName(topicData && topicData.messages, []);
        return loadedTopicName ? `${stackedId}-${loadedTopicName}` : stackedId;
      });

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