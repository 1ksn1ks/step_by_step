import {getMessages, getTopicInfo, sendMessage, getAccountNFTs} from './hedera'
import { adjustTextareaHeight } from './adjusttextarea';
import { activePolygonPopups, newActivePolygonPopups, addPolygonWithImageFill} from './polygons';
import { activeMarkerPopups, newActiveMarkerPopups, updateClusters, index } from './marker';
import { removeUfoModel, changePopupState} from './cssLogic'
import { polygons, geojson, storedMarkers, storedPolygons, currentUfoModelInGLTF,  newExistingMarkers,  existingMarkers, newStoredMarkers, newStoredPolygons,
  accidTopicChatColor, usernameTopicChatColor, textTopicChatColor, innerContainerTopicChatColor, topicChatHeaderColor,
  textFontSizeTopicChat, timestampFontSizeTopicChat, headerFontSizeTopicChat } from './letall';
import {updateRulesForModelNFTState} from './confirmnft'
import { animateMapTo } from './animatemapto';
import { profilePictures, usernames, click2url} from './loadalladata'
import maplibregl from 'maplibre-gl';
import { map } from './map';
import { applyAllStyles } from './loadprofilepopup';
import { scene } from './threejs'
import { parsePrivateKey, decryptMessage, parsePublicKey, encryptMessage, encryptWithPassword, decryptWithPassword } from './sodium'
import { signer } from './web3';
import { makeScrollable } from './makescrollable';
import { toast } from './toast'




export let allLoadedMessages = [];

window.openPopupSettings = function() {
  requestAnimationFrame(() => {
    // The settings live in one centered card over a dark backdrop; the
    // backdrop hides the map popup underneath and closes on tap.
    const backdrop = document.getElementById("popup-settings-backdrop");
    const card = document.getElementById("popup-settings-card");
    if (backdrop.style.display === "block") {
      backdrop.style.display = "none";
      card.style.display = "none";
      document.getElementById("popup-column-container-3").style.display = "none";
    } else {
      backdrop.style.display = "block";
      card.style.display = "block";
      document.getElementById("popup-column-container-3").style.display = "block";
      removeUfoModel();
    }
  });
};

function isValidUrl(url) {
  try {
      new URL(url);
      return true;
  } catch {
      return false;
  }
}

// Helper function to create marker popup HTML using DOM
function createMarkerPopupHTML(data) {
  const {
    markernumber,
    topicId,
    loadedTopicName,
    profileUrl,
    payer,
    payerInfo,
    username,
    click2link,
    title,
    image,
    msg,
    timestamp,
    likeCountMarker,
    dislikeCountMarker,
    comments,
    coords
  } = data;

  const container = document.createElement('div');

  // Top header with number and topic info
  const topHeader = document.createElement('div');
  topHeader.style.cssText = 'position: flex;';

  const numberDiv = document.createElement('div');
  numberDiv.className = 'number';
  numberDiv.style.cssText = 'position: absolute; top: -0.1em; left: 0.1em; font-weight: bold;';
  numberDiv.textContent = markernumber;
  topHeader.appendChild(numberDiv);

  const topicSpan = document.createElement('span');
  topicSpan.style.cssText = 'position: absolute; top: -0.1em; left: 50%; transform: translateX(-50%); font-size: 1.5vh; color: gray; white-space: nowrap;';
  topicSpan.textContent = `${topicId} ${loadedTopicName}`;
  topicSpan.style.cursor = "pointer"

  topicSpan.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(topicId);
      
      const originalText = topicSpan.textContent;
      topicSpan.textContent = "Copyed!";
      setTimeout(() => {
        topicSpan.textContent = originalText;
      }, 1000);
  
    } catch (err) {
      console.error("Error: ", err);
    }
  });

  topHeader.appendChild(topicSpan);

  container.appendChild(topHeader);

  // Profile section
  const profileSection = document.createElement('div');
  profileSection.style.cssText = 'display: flex; align-items: center;';

  const profileImg = document.createElement('img');
  profileImg.src = profileUrl;
  profileImg.alt = 'Profile photo';
  profileImg.style.cssText = 'width: 7vh; height: 7vh; margin-right: 1em; border-radius: 50%; cursor: pointer;';
  profileImg.onclick = () => window.loadTOPIC4PIC(payer);
  profileSection.appendChild(profileImg);

  const headerDiv = document.createElement('div');
  const h2 = document.createElement('h2');

  const payerLink = document.createElement('a');
  payerLink.href = `https://explore.hashpack.app/${encodeURIComponent(payerInfo)}`;
  payerLink.target = '_blank';
  payerLink.rel = 'noopener noreferrer';
  payerLink.className = 'payer-info';
  payerLink.style.textDecoration = 'none';
  payerLink.textContent = payerInfo;
  h2.appendChild(payerLink);

  h2.appendChild(document.createElement('br'));

  const trimmedUsername = username.trim();
  const trimmedClick2link = click2link.trim();

  if (trimmedClick2link) {
    const usernameLink = document.createElement('a');
    try {
      new URL(trimmedClick2link);
      usernameLink.href = trimmedClick2link;
    } catch (e) {
      console.warn('Invalid click2link URL:', trimmedClick2link);
    }
    usernameLink.target = '_blank';
    usernameLink.rel = 'noopener noreferrer';
    usernameLink.className = 'username';
    usernameLink.style.textDecoration = 'none';
    usernameLink.textContent = trimmedUsername;
    h2.appendChild(usernameLink);
  } else if (trimmedUsername) {
    const usernameText = document.createTextNode(trimmedUsername);
    h2.appendChild(usernameText);
  }

  headerDiv.appendChild(h2);
  profileSection.appendChild(headerDiv);
  container.appendChild(profileSection);

  // Content section
  const contentSection = document.createElement('div');
  contentSection.style.textAlign = 'center';

  // Navigation and title
  const navSection = document.createElement('div');
  navSection.style.cssText = 'display: flex; align-items: center; justify-content: space-between; position: relative; margin-bottom: 1vh;';

  const prevSpan = document.createElement('span');
  prevSpan.style.cssText = 'font-size: 1.5vh; color: gray; cursor: pointer;';
  prevSpan.textContent = '◀️';
  prevSpan.onclick = () => window.prevMsgFromPayerMarker(payer, markernumber, topicId);
  navSection.appendChild(prevSpan);

  const titleDiv = document.createElement('div');
  titleDiv.style.cssText = 'text-align: center; flex-grow: 1;';
  const titleStrong = document.createElement('strong');
  titleStrong.className = 'title_color';
  titleStrong.textContent = title;
  titleDiv.appendChild(titleStrong);
  navSection.appendChild(titleDiv);

  const nextSpan = document.createElement('span');
  nextSpan.style.cssText = 'font-size: 1.5vh; color: gray; cursor: pointer;';
  nextSpan.textContent = '▶️';
  nextSpan.onclick = () => window.nextMsgFromPayerMarker(payer, markernumber, topicId);
  navSection.appendChild(nextSpan);

  contentSection.appendChild(navSection);

  // Image
  if (isValidUrl(image)) {
    const imageDiv = document.createElement('div');
    const img = document.createElement('img');
    img.src = image;
    img.style.cssText = 'width: 20vh; height: 20vh; display: block; margin: 0 auto;';
    imageDiv.appendChild(img);
    contentSection.appendChild(imageDiv);
  }

  // Message text
  const msgDiv = document.createElement('div');
  const msgP = document.createElement('p');
  msgP.className = 'text_color';
  msgP.textContent = msg;
  msgDiv.appendChild(msgP);
  contentSection.appendChild(msgDiv);

  container.appendChild(contentSection);

  // Bottom row (in-flow so the comments section can open below it,
  // still inside the popup)
  const bottomRow = document.createElement('div');
  bottomRow.style.cssText = 'position: relative; height: 2.5vh;';

  // Timestamp (bottom right)
  const timestampDiv = document.createElement('div');
  timestampDiv.style.cssText = 'position: absolute; bottom: 0em; right: 1vh; font-size: 1vh; color: gray;';
  timestampDiv.textContent = timestamp;
  bottomRow.appendChild(timestampDiv);

  // Like/Dislike + Comment (bottom center)
  const likeDislikeDiv = document.createElement('div');
  likeDislikeDiv.style.cssText = 'position: absolute; bottom: 0em; left: 50%; transform: translateX(-50%); display: flex; gap: 1vh;';

  const likeSpan = document.createElement('span');
  likeSpan.style.cssText = 'font-size: 1.5vh; color: gray; cursor: pointer;';
  likeSpan.textContent = `${likeCountMarker || 0}👍`;
  likeSpan.onclick = () => window.likeMarker(timestamp, topicId);
  likeDislikeDiv.appendChild(likeSpan);

  // 💬 Comment Button (between Like and Dislike)
  const commentSpan = document.createElement('span');
  commentSpan.style.cssText = 'font-size: 1.5vh; color: gray; cursor: pointer;';
  commentSpan.textContent = comments.length ? `💬${comments.length}` : '💬';
  commentSpan.onclick = () => window.openMarkerComments(timestamp, topicId);
  likeDislikeDiv.appendChild(commentSpan);

  const dislikeSpan = document.createElement('span');
  dislikeSpan.style.cssText = 'font-size: 1.5vh; color: gray; cursor: pointer;';
  dislikeSpan.textContent = `${dislikeCountMarker || 0}👎`;
  dislikeSpan.onclick = () => window.dislikeMarker(timestamp, topicId);
  likeDislikeDiv.appendChild(dislikeSpan);

  bottomRow.appendChild(likeDislikeDiv);

  // Settings (bottom left)
  const settingsSpan = document.createElement('span');
  settingsSpan.style.cssText = 'position: absolute; bottom: 0em; left: 1vh; font-size: 1.5vh; color: gray; cursor: pointer;';
  settingsSpan.textContent = '⚙️';
  settingsSpan.onclick = () => window.openPopupSettings();
  bottomRow.appendChild(settingsSpan);

  // 📍 Location Button
  const locationSpan = document.createElement('span');
  locationSpan.style.cssText = 'position: absolute; bottom: 0em; left: 4vh; font-size: 1.5vh; color: gray; cursor: pointer;';
  locationSpan.textContent = '📍';
  locationSpan.onclick = () => window.openMarkerNavigation(coords);
  bottomRow.appendChild(locationSpan);

  container.appendChild(bottomRow);

  // Comments (below the bottom row, hidden until 💬 is pressed)
  container.appendChild(buildCommentsSection(`marker-comments-${topicId}-${timestamp}`, comments, (input) => window.sendMarkerComment(timestamp, topicId, input), (parentId, input) => window.sendMarkerReply(timestamp, parentId, topicId, input), topicId, 'marker'));

  return container;
}

// Helper function to create polygon popup HTML using DOM
function createPolygonPopupHTML(data) {
  const {
    polygonnumber,
    topicId,
    loadedTopicName,
    profileUrl,
    payer,
    payerInfo,
    username,
    click2link,
    title,
    image,
    msg,
    timestamp,
    likeCountPolygon,
    dislikeCountPolygon,
    comments,
    coordinates
  } = data;

  const container = document.createElement('div');

  // Top header with number and topic info
  const topHeader = document.createElement('div');
  topHeader.style.cssText = 'position: flex;';

  const numberDiv = document.createElement('div');
  numberDiv.className = 'number';
  numberDiv.style.cssText = 'position: absolute; top: -0.1em; left: 0.1em; font-weight: bold;';
  numberDiv.textContent = polygonnumber;
  topHeader.appendChild(numberDiv);

  const topicSpan = document.createElement('span');
  topicSpan.style.cssText = 'position: absolute; top: -0.1em; left: 50%; transform: translateX(-50%); font-size: 1.5vh; color: gray; white-space: nowrap;';

  topicSpan.textContent = `${topicId} ${loadedTopicName}`;
  topicSpan.style.cursor = "pointer"

  topicSpan.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(topicId);
      
      const originalText = topicSpan.textContent;
      topicSpan.textContent = "Copyed!";
      setTimeout(() => {
        topicSpan.textContent = originalText;
      }, 1000);
  
    } catch (err) {
      console.error("Error: ", err);
    }
  });

  topHeader.appendChild(topicSpan);


  container.appendChild(topHeader);

  // Profile section
  const profileSection = document.createElement('div');
  profileSection.style.cssText = 'display: flex; align-items: center;';

  const profileImg = document.createElement('img');
  profileImg.src = profileUrl;
  profileImg.alt = 'Profile photo';
  profileImg.style.cssText = 'width: 7vh; height: 7vh; margin-right: 1em; border-radius: 50%; cursor: pointer;';
  profileImg.onclick = () => window.loadTOPIC4PIC(payer);
  profileSection.appendChild(profileImg);

  const headerDiv = document.createElement('div');
  const h2 = document.createElement('h2');

  const payerLink = document.createElement('a');
  payerLink.href = `https://explore.hashpack.app/${encodeURIComponent(payerInfo)}`;
  payerLink.target = '_blank';
  payerLink.rel = 'noopener noreferrer';
  payerLink.className = 'payer-info';
  payerLink.style.textDecoration = 'none';
  payerLink.textContent = payerInfo;
  h2.appendChild(payerLink);

  h2.appendChild(document.createElement('br'));

  const trimmedUsername = username.trim();
  const trimmedClick2link = click2link.trim();

  if (trimmedClick2link) {
    const usernameLink = document.createElement('a');
    try {
      new URL(trimmedClick2link);
      usernameLink.href = trimmedClick2link;
    } catch (e) {
      console.warn('Invalid click2link URL:', trimmedClick2link);
    }
    usernameLink.target = '_blank';
    usernameLink.rel = 'noopener noreferrer';
    usernameLink.className = 'username';
    usernameLink.style.textDecoration = 'none';
    usernameLink.textContent = trimmedUsername;
    h2.appendChild(usernameLink);
  } else if (trimmedUsername) {
    const usernameText = document.createTextNode(trimmedUsername);
    h2.appendChild(usernameText);
  }

  headerDiv.appendChild(h2);
  profileSection.appendChild(headerDiv);
  container.appendChild(profileSection);

  // Content section
  const contentSection = document.createElement('div');
  contentSection.style.textAlign = 'center';

  // Navigation and title
  const navSection = document.createElement('div');
  navSection.style.cssText = 'display: flex; align-items: center; justify-content: space-between; position: relative; margin-bottom: 1vh;';

  const prevSpan = document.createElement('span');
  prevSpan.style.cssText = 'font-size: 1.5vh; color: gray; cursor: pointer;';
  prevSpan.textContent = '◀️';
  prevSpan.onclick = () => window.prevMsgFromPayerPolygon(payer, polygonnumber, topicId);
  navSection.appendChild(prevSpan);

  const titleDiv = document.createElement('div');
  titleDiv.style.cssText = 'text-align: center; flex-grow: 1;';
  const titleStrong = document.createElement('strong');
  titleStrong.className = 'title_color';
  titleStrong.textContent = title;
  titleDiv.appendChild(titleStrong);
  navSection.appendChild(titleDiv);

  const nextSpan = document.createElement('span');
  nextSpan.style.cssText = 'font-size: 1.5vh; color: gray; cursor: pointer;';
  nextSpan.textContent = '▶️';
  nextSpan.onclick = () => window.nextMsgFromPayerPolygon(payer, polygonnumber, topicId);
  navSection.appendChild(nextSpan);

  contentSection.appendChild(navSection);

  // Image
  if (isValidUrl(image)) {
    const imageDiv = document.createElement('div');
    const img = document.createElement('img');
    img.src = image;
    img.style.cssText = 'width: 20vh; height: 20vh; display: block; margin: 0 auto;';
    imageDiv.appendChild(img);
    contentSection.appendChild(imageDiv);
  }

  // Message text
  const msgDiv = document.createElement('div');
  const msgP = document.createElement('p');
  msgP.className = 'text_color';
  msgP.textContent = msg;
  msgDiv.appendChild(msgP);
  contentSection.appendChild(msgDiv);

  container.appendChild(contentSection);

  // Bottom row (in-flow so the comments section can open below it,
  // still inside the popup)
  const bottomRow = document.createElement('div');
  bottomRow.style.cssText = 'position: relative; height: 2.5vh;';

  // Timestamp (bottom right)
  const timestampDiv = document.createElement('div');
  timestampDiv.style.cssText = 'position: absolute; bottom: 0em; right: 1vh; font-size: 1vh; color: gray;';
  timestampDiv.textContent = timestamp;
  bottomRow.appendChild(timestampDiv);

  // Like/Dislike + Comment (bottom center)
  const likeDislikeDiv = document.createElement('div');
  likeDislikeDiv.style.cssText = 'position: absolute; bottom: 0em; left: 50%; transform: translateX(-50%); display: flex; gap: 1vh;';

  const likeSpan = document.createElement('span');
  likeSpan.style.cssText = 'font-size: 1.5vh; color: gray; cursor: pointer;';
  likeSpan.textContent = `${likeCountPolygon || 0}👍`;
  likeSpan.onclick = () => window.likePolygon(timestamp, topicId);
  likeDislikeDiv.appendChild(likeSpan);

  // 💬 Comment Button (between Like and Dislike)
  const commentSpan = document.createElement('span');
  commentSpan.style.cssText = 'font-size: 1.5vh; color: gray; cursor: pointer;';
  commentSpan.textContent = comments.length ? `💬${comments.length}` : '💬';
  commentSpan.onclick = () => window.openPolygonComments(timestamp, topicId);
  likeDislikeDiv.appendChild(commentSpan);

  const dislikeSpan = document.createElement('span');
  dislikeSpan.style.cssText = 'font-size: 1.5vh; color: gray; cursor: pointer;';
  dislikeSpan.textContent = `${dislikeCountPolygon || 0}👎`;
  dislikeSpan.onclick = () => window.dislikePolygon(timestamp, topicId);
  likeDislikeDiv.appendChild(dislikeSpan);

  bottomRow.appendChild(likeDislikeDiv);

  // Settings (bottom left)
  const settingsSpan = document.createElement('span');
  settingsSpan.style.cssText = 'position: absolute; bottom: 0em; left: 1vh; font-size: 1.5vh; color: gray; cursor: pointer;';
  settingsSpan.textContent = '⚙️';
  settingsSpan.onclick = () => window.openPopupSettings();
  bottomRow.appendChild(settingsSpan);

  // 📍 Location Button
  const locationSpan = document.createElement('span');
  locationSpan.style.cssText = 'position: absolute; bottom: 0em; left: 4vh; font-size: 1.5vh; color: gray; cursor: pointer;';
  locationSpan.textContent = '📍';
  locationSpan.onclick = () => window.openPolygonNavigation(coordinates);
  bottomRow.appendChild(locationSpan);

  container.appendChild(bottomRow);

  // Comments (below the bottom row, hidden until 💬 is pressed)
  container.appendChild(buildCommentsSection(`polygon-comments-${topicId}-${timestamp}`, comments, (input) => window.sendPolygonComment(timestamp, topicId, input), (parentId, input) => window.sendPolygonReply(timestamp, parentId, topicId, input), topicId, 'polygon'));

  return container;
}

export async function processTopicMessages(topicId) {
  let topicGeojsonFeatures = [];
  let topicPolygons = [];
  let loadedTopicName = '';

  try {
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

    allLoadedMessages.push({topicId:topicId,uniqueMessages});


const likeCountMapMarker = new Map();
const dislikeCountMapMarker = new Map();
const likeCountMapPolygon = new Map();
const dislikeCountMapPolygon = new Map();
const payerActionsPerTimestamp = new Map();
const commentsMapMarker = new Map();
const commentsMapPolygon = new Map();
const repliesMapMarker = new Map();
const repliesMapPolygon = new Map();


if (rawResult.messages && Array.isArray(rawResult.messages)) {
  for (const message of rawResult.messages) {
    try {
      let parsedMessage = message;
      if (typeof message === 'string') {
        parsedMessage = JSON.parse(message);
      }

      const payerId = parsedMessage.payer;
      let actionTimestamp, actionType;

      // Check for like
      if (parsedMessage.likeMarker && parsedMessage.likeMarker.timestamp && parsedMessage.payer) {
        actionTimestamp = parsedMessage.likeMarker.timestamp;
        actionType = 'likeMarker';
      }
      // Check for dislike
      if (parsedMessage.dislikeMarker && parsedMessage.dislikeMarker.timestamp && parsedMessage.payer) {
        const dislikeTimestamp = parsedMessage.dislikeMarker.timestamp;
        // If no like or dislike timestamp is newer, update action
        if (!actionTimestamp || dislikeTimestamp > actionTimestamp) {
          actionTimestamp = dislikeTimestamp;
          actionType = 'dislikeMarker';
        }
      }
      // Check for like
      if (parsedMessage.likePolygon && parsedMessage.likePolygon.timestamp && parsedMessage.payer) {
        actionTimestamp = parsedMessage.likePolygon.timestamp;
        actionType = 'likePolygon';
      }
      // Check for dislike
      if (parsedMessage.dislikePolygon && parsedMessage.dislikePolygon.timestamp && parsedMessage.payer) {
        actionTimestamp = parsedMessage.dislikePolygon.timestamp;
        actionType = 'dislikePolygon';
      }

      // Process the action if it exists
      if (actionTimestamp && actionType && payerId) {
        // Initialize map for this timestamp if it doesn't exist
        if (!payerActionsPerTimestamp.has(actionTimestamp)) {
          payerActionsPerTimestamp.set(actionTimestamp, new Map());
        }

        // Update or set the latest action for this payer at this timestamp
        const payerActions = payerActionsPerTimestamp.get(actionTimestamp);
        const existingAction = payerActions.get(payerId);

        // Only update if this is a new action or a newer timestamp
        if (!existingAction || actionTimestamp >= existingAction.timestamp) {
          // If there's an existing action, remove its previous count
          if (existingAction) {
            if (existingAction.type === 'likeMarker') {
              likeCountMapMarker.set(actionTimestamp, (likeCountMapMarker.get(actionTimestamp) || 0) - 1);
            } else if (existingAction.type === 'dislikeMarker') {
              dislikeCountMapMarker.set(actionTimestamp, (dislikeCountMapMarker.get(actionTimestamp) || 0) - 1);
            }
            if (existingAction.type === 'likePolygon') {
              likeCountMapPolygon.set(actionTimestamp, (likeCountMapPolygon.get(actionTimestamp) || 0) - 1);
            } else if (existingAction.type === 'dislikePolygon') {
              dislikeCountMapPolygon.set(actionTimestamp, (dislikeCountMapPolygon.get(actionTimestamp) || 0) - 1);
            }
          }

          // Store the new action
          payerActions.set(payerId, { type: actionType, timestamp: actionTimestamp });

          // Increment the count for the new action
          if (actionType === 'likeMarker') {
            likeCountMapMarker.set(actionTimestamp, (likeCountMapMarker.get(actionTimestamp) || 0) + 1);
          } else if (actionType === 'dislikeMarker') {
            dislikeCountMapMarker.set(actionTimestamp, (dislikeCountMapMarker.get(actionTimestamp) || 0) + 1);
          }
          if (actionType === 'likePolygon') {
            likeCountMapPolygon.set(actionTimestamp, (likeCountMapPolygon.get(actionTimestamp) || 0) + 1);
          } else if (actionType === 'dislikePolygon') {
            dislikeCountMapPolygon.set(actionTimestamp, (dislikeCountMapPolygon.get(actionTimestamp) || 0) + 1);
          }
        }
      }

      // Collect comments (each topic message is one comment; the payer is
      // the Hedera account that signed it, same as likes)
      if (parsedMessage.commentMarker && parsedMessage.commentMarker.timestamp && payerId) {
        const commentTimestamp = parsedMessage.commentMarker.timestamp;
        if (!commentsMapMarker.has(commentTimestamp)) {
          commentsMapMarker.set(commentTimestamp, []);
        }
        commentsMapMarker.get(commentTimestamp).push({
          payer: payerId,
          text: String(parsedMessage.commentMarker.text || '').slice(0, 300),
          created: parsedMessage.created
        });
      }
      if (parsedMessage.commentPolygon && parsedMessage.commentPolygon.timestamp && payerId) {
        const commentTimestamp = parsedMessage.commentPolygon.timestamp;
        if (!commentsMapPolygon.has(commentTimestamp)) {
          commentsMapPolygon.set(commentTimestamp, []);
        }
        commentsMapPolygon.get(commentTimestamp).push({
          payer: payerId,
          text: String(parsedMessage.commentPolygon.text || '').slice(0, 300),
          created: parsedMessage.created
        });
      }

      // Collect replies (nested comments; parentId = the created timestamp
      // of the comment or reply being answered)
      if (parsedMessage.replyMarker && parsedMessage.replyMarker.parentId && payerId) {
        const parentId = parsedMessage.replyMarker.parentId;
        if (!repliesMapMarker.has(parentId)) {
          repliesMapMarker.set(parentId, []);
        }
        repliesMapMarker.get(parentId).push({
          payer: payerId,
          text: String(parsedMessage.replyMarker.text || '').slice(0, 300),
          created: parsedMessage.created
        });
      }
      if (parsedMessage.replyPolygon && parsedMessage.replyPolygon.parentId && payerId) {
        const parentId = parsedMessage.replyPolygon.parentId;
        if (!repliesMapPolygon.has(parentId)) {
          repliesMapPolygon.set(parentId, []);
        }
        repliesMapPolygon.get(parentId).push({
          payer: payerId,
          text: String(parsedMessage.replyPolygon.text || '').slice(0, 300),
          created: parsedMessage.created
        });
      }
    } catch (error) {
      console.error(`Error parsing message for likes/dislikes: ${error}`);
    }
  }
}
          

          const topicInfo = await getTopicInfo(topicId);
          const topicAdmin = [];
          let hasRulesForMarker = false;
          let hasRulesForPolygon = false;
          const memo = topicInfo.memo;

          // Split the memo by commas
          const parts = memo.split(',');

          // Iterate over each part
          parts.forEach(part => {
            // Check if the part starts with "0.0."
            if (part.startsWith("0.0.")) {
              // Add it to the topicAdmin array
              topicAdmin.push(part);
            }
          });



          // Check if messages exist and is an array
          if (!rawResult.messages || !Array.isArray(rawResult.messages)) {
            console.error(`No messages found for topic ${topicId}.`, rawResult);
            return { topicGeojsonFeatures, topicPolygons }; // Return empty arrays
          }

          const messages = rawResult.messages; // Extract messages

          const loadedTopicRulesForMarker = [];
          const loadedTopicRulesForPolygon = [];



          // Read rules from messages
          for (let index = messages.length - 1; index >= 0; index--) {
            const message = messages[index];
            try {
              let parsedMessage = message;
              if (typeof message === 'string') {
                parsedMessage = JSON.parse(message);
              }

              if (parsedMessage.rules && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
                if (parsedMessage.rules.formarker.markerTopicId.startsWith('0.0.') && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
                loadedTopicRulesForMarker.push(parsedMessage.rules.formarker);
                hasRulesForMarker = true;

              }
              if (parsedMessage.rules.forpolygon.polygonTopicId.startsWith('0.0.') && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
                loadedTopicRulesForPolygon.push(parsedMessage.rules.forpolygon);
                hasRulesForPolygon = true;

              }
                break; // Exit the loop after finding the last message with rules
              }
            } catch (messageError) {
              console.error(`Error processing message ${index}:`, messageError);
            }
          }

          for (let index = messages.length - 1; index >= 0; index--) {
            const message = messages[index];
            try {
              let parsedMessage = message;
              if (typeof message === 'string') {
                parsedMessage = JSON.parse(message);
              }
              // Check if changeName exists and either topicAdmin is empty or includes the payer
              if (parsedMessage.changeName && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
                loadedTopicName = parsedMessage.changeName;
                break; // Stop after finding the first valid message
              }
            } catch (messageError) {
              console.error(`Error processing message ${index}:`, messageError);
            }
          }
          const uniquePayerIdsForMarker = new Set();
          const uniquePayerIdsForPolygon = new Set();

          // Extract payer IDs from messages
      for (const message of messages) {
        try {
          let parsedMessage = message;
          if (typeof message === 'string') {
            parsedMessage = JSON.parse(message);
          }

          // Add payer IDs for markers
          if (parsedMessage.marker && parsedMessage.marker.data) {
            uniquePayerIdsForMarker.add(parsedMessage.payer);
          }

          // Add payer IDs for polygons
          if (parsedMessage.polygon && parsedMessage.polygon.data) {
            uniquePayerIdsForPolygon.add(parsedMessage.payer);
          }

          if (parsedMessage.addTopicNFT && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
          const nfts = parsedMessage.addTopicNFT.split(',').map(nft => nft.trim());
          nfts.forEach(nft => {
            if (!loadedNFTsForModel.includes(nft)) {
              loadedNFTsForModel.push(nft);
            }
          });
          }

          if (parsedMessage.removeTopicNFT && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
            const nft = parsedMessage.removeTopicNFT.trim();
            const index = loadedNFTsForModel.indexOf(nft);
            if (index !== -1) {
              loadedNFTsForModel.splice(index, 1);
            }
          }

        if (parsedMessage.addScale && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
          const { NFT, scale } = parsedMessage.addScale;
          loadedNFTScaleForModel.push({ NFT, scale });
        }

        if (parsedMessage.removeScale && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
          const { NFT } = parsedMessage.removeScale;
          const index = loadedNFTScaleForModel.findIndex(item => item.NFT === NFT);
          if (index !== -1) {
            loadedNFTScaleForModel.splice(index, 1); // Remove the item if it exists
          } else {
            console.log(`NFT: ${NFT} not found in addScale list`);
          }
        }

        updateRulesForModelNFTState();

        } catch (error) {
          console.error("Error extracting payer ID:", error);
        }
      }

          // Ownership logic
          const markerOwnershipArray = [];
          const polygonOwnershipArray = [];


          if (hasRulesForMarker) {
            // Iterate over each unique payer ID for markers
            for (const payerId of uniquePayerIdsForMarker) {
              const tokenIdForMarker = loadedTopicRulesForMarker[0].markerTopicId;
              const filteredNftsForMarker = await getAccountNFTs(payerId, tokenIdForMarker);

              // Check if the user owns NFTs and push to an array
              if (filteredNftsForMarker.length > 0) {
                const numberOfMessages = filteredNftsForMarker.length * loadedTopicRulesForMarker[0].markerMessagesPerNft;
                const numberOfMarker = [];
                markerOwnershipArray.push({ payerId, numberOfMessages, numberOfMarker });
              }
            }
          }

          if (hasRulesForPolygon) {

            // Iterate over each unique payer ID for polygons
            for (const payerId of uniquePayerIdsForPolygon) {
              const tokenIdForPoly = loadedTopicRulesForPolygon[0].polygonTopicId;
              const filteredNftsForPoly = await getAccountNFTs(payerId, tokenIdForPoly);

              // Check if the user owns NFTs and push to an array
              if (filteredNftsForPoly.length > 0) {
                const numberOfMessages = filteredNftsForPoly.length * loadedTopicRulesForPolygon[0].polygonMessagesPerNft;
                const numberOfPolygon = [];
                polygonOwnershipArray.push({ payerId, numberOfMessages, numberOfPolygon });
              }
            }
          }

          if (!hasRulesForMarker) {
          for (const payerId of uniquePayerIdsForMarker) {
            const numberOfMarker = [];
            markerOwnershipArray.push({ payerId, numberOfMarker });
          }
        }
        if (!hasRulesForPolygon) {
          for (const payerId of uniquePayerIdsForPolygon) {
            const numberOfPolygon = [];
            polygonOwnershipArray.push({ payerId, numberOfPolygon });
          }
        }
          // Process each message
          for (let index = messages.length - 1; index >= 0; index--) {
            const message = messages[index];
            try {
              let parsedMessage = message;
              if (typeof message === 'string') {
                parsedMessage = JSON.parse(message);
              }

              const timestamp = new Date(parsedMessage.created)
              .toLocaleString('en-US', {
                hour12: false,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
              })


              const defaultProfilePic = "https://kiloscribe.com/api/inscription-cdn/0.0.4819119";
              const profileUrl = isValidUrl(message.payer && profilePictures[message.payer] ?
                profilePictures[message.payer].url :
                defaultProfilePic) ?
                (message.payer && profilePictures[message.payer] ? profilePictures[message.payer].url : defaultProfilePic) :
                defaultProfilePic;

              const payerInfo = message.payer ? `${message.payer}` : 'Anonymous';
              const username = message.payer && usernames[message.payer] ?
                ` ${usernames[message.payer].username}` :
                '';
              const click2link = message.payer && click2url[message.payer] ?
                ` ${click2url[message.payer].click2url}` :
                '';

              if (parsedMessage.marker && parsedMessage.marker.data) {
                const markernumber = parsedMessage.marker.data.numberOfMarker;
                const markerOwner = markerOwnershipArray.find(owner => owner.payerId === message.payer);
                
                if (parsedMessage.marker.data.deleteMarkerNumber) {
                  const deleteMarkerNumber = parsedMessage.marker.data.deleteMarkerNumber;
                  markerOwner.numberOfMarker.push(deleteMarkerNumber);
                }

                if (markernumber === undefined || markernumber === null || !Number.isInteger(Number(markernumber))) {
                  continue;
                }
                  
                if (!markerOwner.numberOfMarker.includes(markernumber)) {
                  markerOwner.numberOfMarker.push(markernumber);
                
                if (!hasRulesForMarker || (markerOwner && markerOwner.numberOfMessages > 0)) {

                  if (hasRulesForMarker) {
                    markerOwner.numberOfMessages -= 1;
                  }

                  let coords;
                  try {
                    const cordData = parsedMessage.marker.data.cord;

                    if (typeof cordData === 'string') {
                      coords = cordData.split(',').map(num => parseFloat(num.trim()));
                    } else if (Array.isArray(cordData)) {
                      coords = cordData;
                    } else {
                      throw new Error('Unsupported coordinate format');
                    }

                    if (!Array.isArray(coords) || coords.length !== 2 || coords.some(isNaN)) {
                      throw new Error('Invalid coordinate format');
                    }

                    // Use the final like and dislike counts from the maps
                    const likeCountMarker = likeCountMapMarker.get(timestamp) || 0;
                    const dislikeCountMarker = dislikeCountMapMarker.get(timestamp) || 0;

                    // Create marker popup HTML using DOM helper
                    const markerPopupHTML = createMarkerPopupHTML({
                      markernumber,
                      topicId,
                      loadedTopicName,
                      profileUrl,
                      payer: message.payer,
                      payerInfo,
                      username,
                      click2link,
                      title: parsedMessage.marker.data.title,
                      image: parsedMessage.marker.data.image,
                      msg: parsedMessage.marker.data.msg,
                      timestamp,
                      likeCountMarker,
                      dislikeCountMarker,
                      comments: (commentsMapMarker.get(timestamp) || []).map((c) => ({
                        ...c,
                        likeCount: likeCountMapMarker.get(c.created) || 0,
                        dislikeCount: dislikeCountMapMarker.get(c.created) || 0,
                        replies: buildReplyTree(c, repliesMapMarker, likeCountMapMarker, dislikeCountMapMarker)
                      })),
                      coords
                    });

                    topicGeojsonFeatures.push({
                      topicId: topicId,
                      created: parsedMessage.created,
                      msgNumber: parsedMessage.marker.data.numberOfMarker,
                      type: "Feature",
                      payer: message.payer,
                      properties: {
                        message: markerPopupHTML,
                        imageUrl: isValidUrl(parsedMessage.marker.data.coverimage) ? parsedMessage.marker.data.coverimage : profileUrl
                      },
                      geometry: {
                        type: "Point",
                        coordinates: coords
                      }
                    });
                  } catch (coordError) {
                    console.error("Error parsing marker coordinates:", coordError, "Raw coords:", parsedMessage.marker.data.cord);
                  }
                }
              }
            }

              // Handle polygon type messages
              if (parsedMessage.polygon && parsedMessage.polygon.data) {
                const polygonOwner = polygonOwnershipArray.find(owner => owner.payerId === message.payer) ;
                const polygonnumber = parsedMessage.polygon.data.numberOfPolygon;
                
                if (parsedMessage.polygon.data.deletePolygonNumber) {
                  const deletePolygonNumber = parsedMessage.polygon.data.deletePolygonNumber;
                  polygonOwner.numberOfPolygon.push(deletePolygonNumber);
                }

                if (polygonnumber === undefined || polygonnumber === null || !Number.isInteger(Number(polygonnumber))) {
                  continue;
                }

                if (!polygonOwner.numberOfPolygon.includes(polygonnumber)) {
                  polygonOwner.numberOfPolygon.push(polygonnumber);


                if (!hasRulesForPolygon || (polygonOwner && polygonOwner.numberOfMessages > 0)) {
                  if (hasRulesForPolygon) {
                    polygonOwner.numberOfMessages -= 1;
                  }

                  try {
                    const cordStr = parsedMessage.polygon.data.cord;

                    // Validate the coordinate string format
                    const validCoordPattern = /^\[-?\d+\.?\d*,\s*-?\d+\.?\d*\](,\s*\[-?\d+\.?\d*,\s*-?\d+\.?\d*\])*$/;
                    if (!validCoordPattern.test(cordStr)) {
                      continue; // Skip processing this message
                    }

                    // Parse the coordinates
                    const coordinates = JSON.parse(`[${cordStr}]`); // Wrap in brackets for valid JSON

                    if (Array.isArray(coordinates) && coordinates.length > 2) {
                      const polygonSize = hasRulesForPolygon ? loadedTopicRulesForPolygon[0].polygonSize : 1;

                      const likeCountPolygon = likeCountMapPolygon.get(timestamp) || 0;
                      const dislikeCountPolygon = dislikeCountMapPolygon.get(timestamp) || 0;

                      // Create polygon popup HTML using DOM helper
                      const polygonPopupHTML = createPolygonPopupHTML({
                        polygonnumber,
                        topicId,
                        loadedTopicName,
                        profileUrl,
                        payer: message.payer,
                        payerInfo,
                        username,
                        click2link,
                        title: parsedMessage.polygon.data.title,
                        image: parsedMessage.polygon.data.image,
                        msg: parsedMessage.polygon.data.msg,
                        timestamp,
                        likeCountPolygon,
                        dislikeCountPolygon,
                        comments: (commentsMapPolygon.get(timestamp) || []).map((c) => ({
                          ...c,
                          likeCount: likeCountMapPolygon.get(c.created) || 0,
                          dislikeCount: dislikeCountMapPolygon.get(c.created) || 0,
                          replies: buildReplyTree(c, repliesMapPolygon, likeCountMapPolygon, dislikeCountMapPolygon)
                        })),
                        coordinates
                      });

                      topicPolygons.push({
                        topicId: topicId,
                        created: parsedMessage.created,
                        msgNumber: parsedMessage.polygon.data.numberOfPolygon,
                        id: `polygon-${message.payer}-${topicId}-${parsedMessage.polygon.data.numberOfPolygon}`,
                        payer: message.payer,
                        coordinates: [coordinates],
                        description: polygonPopupHTML,
                        imageUrl: isValidUrl(parsedMessage.polygon.data.coverimage) ? parsedMessage.polygon.data.coverimage : profileUrl
                      });
                    }
                  } catch (polygonError) {
                    console.error("Error parsing polygon data:", polygonError);
                  }
                }
              }
            }
            } catch (messageError) {
              console.error(`Error processing message ${index}:`, messageError);
            }
          }


        // At the end of the function, push the collected features to the parent arrays
        geojson.features.push(...topicGeojsonFeatures); // Push topic features to parent geojson array
        polygons.push(...topicPolygons); // Push topic polygons to parent polygons array
        return { topicGeojsonFeatures, topicPolygons, loadedTopicName };


        } catch (error) {
          console.error(`Error loading messages for topic ${topicId}:`, error);
          return { topicGeojsonFeatures: [], topicPolygons: [] }; // Return empty arrays on error
        }
      }

window.nextMsgFromPayerMarker = function(payer, markerNumber, topicId) {
    if (!storedMarkers || !payer || markerNumber == null || !topicId) {
        console.error('Invalid input or missing storedMarkers');
        return null;
    }

    // --------------------------------------------------------------
    // 1. Flatten + sort all markers chronologically
    // --------------------------------------------------------------
    const markers = storedMarkers
        .flat()
        .sort((a, b) => new Date(a.msgNumber) - new Date(b.msgNumber));

    // --------------------------------------------------------------
    // 2. Locate the current marker
    // --------------------------------------------------------------
    let curIdx = -1;
    for (let i = 0; i < markers.length; i++) {
        if (markers[i].payer === payer &&
            markers[i].msgNumber === String(markerNumber) &&
            markers[i].topicId === topicId) {
            curIdx = i;
            break;
        }
    }
    if (curIdx === -1) return null;

    // --------------------------------------------------------------
    // 3. Next marker in the SAME topic
    // --------------------------------------------------------------
    for (let i = curIdx + 1; i < markers.length; i++) {
        if (markers[i].payer === payer && markers[i].topicId === topicId) {
            return showMarker(markers[i]);
        }
    }

    // --------------------------------------------------------------
    // 4. No more in this topic → next topic (or wrap to first)
    // --------------------------------------------------------------
    const firstSeen = new Map();               // topicId → earliest msgNumber
    for (const m of markers) {
        if (m.payer !== payer) continue;
        if (!firstSeen.has(m.topicId)) {
            firstSeen.set(m.topicId, m.msgNumber);
        }
    }

    const orderedTopics = Array.from(firstSeen.entries())
        .sort(([, a], [, b]) => new Date(a) - new Date(b))
        .map(([t]) => t);

    const curTopicPos = orderedTopics.indexOf(topicId);
    let nextTopicPos = curTopicPos + 1;

    // LOOP to first topic if we are at the end
    if (nextTopicPos >= orderedTopics.length) nextTopicPos = 0;

    const nextTopicId = orderedTopics[nextTopicPos];

    // --------------------------------------------------------------
    // 5. Return FIRST marker of that next topic
    // --------------------------------------------------------------
    for (const m of markers) {
        if (m.payer === payer && m.topicId === nextTopicId) {
            return showMarker(m);
        }
    }

    return null;   // should never hit
};

function showMarker(m) {
    activeMarkerPopups.forEach(p => p.remove());
    newActiveMarkerPopups([]);
    const popup = new maplibregl.Popup()
        .setLngLat(m.geometry.coordinates)
        .setDOMContent(m.properties.message)
        .addTo(map);

    activeMarkerPopups.push(popup);
    changePopupState(true);

    animateMapTo(map, m.geometry.coordinates, null);

    popup.on("close", () => {
      changePopupState(false);
        if (currentUfoModelInGLTF) {
            scene.add(currentUfoModelInGLTF);
            crosshair.style.display = "block";
        }
    });

    applyAllStyles();

    if (currentUfoModelInGLTF) {
        scene.remove(currentUfoModelInGLTF);
        crosshair.style.display = "none";
    }

    return m;
}

window.nextMsgFromPayerPolygon = function(payer, polygonNumber, topicId) {
    if (!storedPolygons || !payer || polygonNumber == null || !topicId) {
        console.error('Invalid input or missing storedPolygons');
        return null;
    }

    // 1. Flatten & sort all polygons by time
    const polygons = storedPolygons
        .flat()
        .sort((a, b) => new Date(a.msgNumber) - new Date(b.msgNumber));

    // 2. Find current polygon index
    let currentIdx = -1;
    for (let i = 0; i < polygons.length; i++) {
        if (polygons[i].payer === payer &&
            polygons[i].msgNumber === String(polygonNumber) &&
            polygons[i].topicId === topicId) {
            currentIdx = i;
            break;
        }
    }
    if (currentIdx === -1) {
        console.log('Current polygon not found');
        return null;
    }

    // 3. Try next polygon in SAME topic
    for (let i = currentIdx + 1; i < polygons.length; i++) {
        if (polygons[i].payer === payer && polygons[i].topicId === topicId) {
            return showPolygon(polygons[i]);
        }
    }

    // 4. No more in this topic → find next topic (or loop to first)
    const firstSeen = new Map(); // topicId → earliest msgNumber
    for (const p of polygons) {
        if (p.payer !== payer) continue;
        if (!firstSeen.has(p.topicId)) {
            firstSeen.set(p.topicId, p.msgNumber);
        }
    }

    const orderedTopics = Array.from(firstSeen.entries())
        .sort(([, a], [, b]) => new Date(a) - new Date(b))
        .map(([t]) => t);

    const currentTopicIdx = orderedTopics.indexOf(topicId);
    let nextTopicIdx = currentTopicIdx + 1;

    // LOOP: if at last topic → go to first
    if (nextTopicIdx >= orderedTopics.length) {
        nextTopicIdx = 0; // wrap around
    }

    const nextTopicId = orderedTopics[nextTopicIdx];

    // 5. Return FIRST polygon of the next topic
    for (const p of polygons) {
        if (p.payer === payer && p.topicId === nextTopicId) {
            return showPolygon(p);
        }
    }

    return null; // fallback
};

function showPolygon(p) {
    activePolygonPopups.forEach(popup => popup.remove());
    newActivePolygonPopups([]);

    const coordinates = p.coordinates[0];
    const bounds = coordinates.reduce((b, coord) => ({
        minLng: Math.min(b.minLng, coord[0]),
        maxLng: Math.max(b.maxLng, coord[0]),
        minLat: Math.min(b.minLat, coord[1]),
        maxLat: Math.max(b.maxLat, coord[1])
    }), { minLng: Infinity, maxLng: -Infinity, minLat: Infinity, maxLat: -Infinity });

    const centerLng = (bounds.minLng + bounds.maxLng) / 2;
    const centerLat = (bounds.minLat + bounds.maxLat) / 2;
    const targetLngLat = [centerLng, centerLat];

    const popup = new maplibregl.Popup()
        .setLngLat(targetLngLat)
        .setDOMContent(p.description)
        .addTo(map);

    activePolygonPopups.push(popup);
    changePopupState(true);

    animateMapTo(map, targetLngLat, null);

    popup.on("close", () => {
      changePopupState(false);
        if (currentUfoModelInGLTF) {
            scene.add(currentUfoModelInGLTF);
            crosshair.style.display = "block";
        }
    });

    applyAllStyles();
    if (currentUfoModelInGLTF) {
        scene.remove(currentUfoModelInGLTF);
        crosshair.style.display = "none";
    }

    return p;
}

window.prevMsgFromPayerMarker = function(payer, markerNumber, topicId) {
  if (!storedMarkers || !payer || markerNumber == null || !topicId) {
        console.error('Invalid input or missing storedMarkers');
        return null;
    }

    // --------------------------------------------------------------
    // 1. Flatten + sort all markers chronologically
    // --------------------------------------------------------------
    const markers = storedMarkers
        .flat()
        .sort((a, b) => new Date(a.msgNumber) - new Date(b.msgNumber));

    // --------------------------------------------------------------
    // 2. Locate the current marker
    // --------------------------------------------------------------
    let curIdx = -1;
    for (let i = 0; i < markers.length; i++) {
        if (markers[i].payer === payer &&
            markers[i].msgNumber === String(markerNumber) &&
            markers[i].topicId === topicId) {
            curIdx = i;
            break;
        }
    }
    if (curIdx === -1) return null;

    // 1. previous in SAME topic
    for (let i = curIdx - 1; i >= 0; i--) {
        if (markers[i].payer === payer && markers[i].topicId === topicId) {
            return showMarker(markers[i]);
        }
    }

    // 2. previous topic (wrap to last if first)
    const lastSeen = new Map();   // topicId → latest msgNumber
    for (const m of markers) {
        if (m.payer !== payer) continue;
        if (!lastSeen.has(m.topicId) ||
            new Date(m.msgNumber) > new Date(lastSeen.get(m.topicId))) {
            lastSeen.set(m.topicId, m.msgNumber);
        }
    }

    const orderedTopics = Array.from(lastSeen.entries())
        .sort(([, a], [, b]) => new Date(a) - new Date(b))
        .map(([t]) => t);

    const curPos = orderedTopics.indexOf(topicId);
    let prevPos = curPos - 1;
    if (prevPos < 0) prevPos = orderedTopics.length - 1;

    const prevTopicId = orderedTopics[prevPos];

    // 3. LAST marker of previous topic
    for (let i = markers.length - 1; i >= 0; i--) {
        if (markers[i].payer === payer && markers[i].topicId === prevTopicId) {
            return showMarker(markers[i]);
        }
    }

    return null;
};

window.prevMsgFromPayerPolygon = function(payer, polygonNumber, topicId) {
    if (!storedPolygons || !payer || polygonNumber == null || !topicId) {
        console.error('Invalid input or missing storedPolygons');
        return null;
    }

    // 1. Flatten & sort chronologically
    const polygons = storedPolygons
        .flat()
        .sort((a, b) => new Date(a.msgNumber) - new Date(b.msgNumber));

    // 2. Find current polygon index
    let currentIdx = -1;
    for (let i = 0; i < polygons.length; i++) {
        if (polygons[i].payer === payer &&
            polygons[i].msgNumber === String(polygonNumber) &&
            polygons[i].topicId === topicId) {
            currentIdx = i;
            break;
        }
    }
    if (currentIdx === -1) {
        console.log('Current polygon not found');
        return null;
    }

    // 3. Try previous polygon in SAME topic
    for (let i = currentIdx - 1; i >= 0; i--) {
        if (polygons[i].payer === payer && polygons[i].topicId === topicId) {
            return showPolygon(polygons[i]);
        }
    }

    // 4. No previous in this topic → go to PREVIOUS topic (or wrap to last)
    const lastSeen = new Map(); // topicId → latest msgNumber
    for (const p of polygons) {
        if (p.payer !== payer) continue;
        if (!lastSeen.has(p.topicId) || new Date(p.msgNumber) > new Date(lastSeen.get(p.topicId))) {
            lastSeen.set(p.topicId, p.msgNumber);
        }
    }

    const orderedTopics = Array.from(lastSeen.entries())
        .sort(([, a], [, b]) => new Date(a) - new Date(b))
        .map(([t]) => t);

    const currentTopicIdx = orderedTopics.indexOf(topicId);
    let prevTopicIdx = currentTopicIdx - 1;

    // LOOP: if at first topic → go to last topic
    if (prevTopicIdx < 0) {
        prevTopicIdx = orderedTopics.length - 1;
    }

    const prevTopicId = orderedTopics[prevTopicIdx];

    // 5. Return LAST polygon of the previous topic
    for (let i = polygons.length - 1; i >= 0; i--) {
        if (polygons[i].payer === payer && polygons[i].topicId === prevTopicId) {
            return showPolygon(polygons[i]);
        }
    }

    return null;
};

window.likeMarker = async function(timestamp, topicId) {
    if (!signer) {
      toast.error("Connect wallet first");
      return;
    }

    const meesageobject = {
    likeMarker: {
      timestamp: timestamp
    }
  };

  const meesage = JSON.stringify(meesageobject);
  toast.info("Confirm in wallet 👛");
  await sendMessage(topicId, meesage);

};

// Recursively build a reply thread (replies-to-replies supported; the
// depth guard stops malformed parentId cycles from overflowing the stack).
function buildReplyTree(node, repliesMap, likeMap, dislikeMap, depth = 0) {
  if (depth > 50) return [];
  return (repliesMap.get(node.created) || []).map((r) => ({
    ...r,
    likeCount: likeMap.get(r.created) || 0,
    dislikeCount: dislikeMap.get(r.created) || 0,
    replies: buildReplyTree(r, repliesMap, likeMap, dislikeMap, depth + 1)
  }));
}

// Comment section for marker/polygon popups: the list of comments below the
// message plus a box to leave your own. Hidden until 💬 is pressed.
// Glass card: rounded corners, blur, thin white border (app-wide glass look).
function buildCommentsSection(id, comments, onSend, onReply, topicId, kind) {
  const section = document.createElement('div');
  section.id = id;
  section.style.cssText = 'display: none; margin-top: 1vh; padding: 1vh; border-radius: 1.2vh; background: rgba(255, 255, 255, 0.06); backdrop-filter: blur(1vh); -webkit-backdrop-filter: blur(1vh); border: 0.05vh solid rgba(255, 255, 255, 0.15); text-align: left;';

  const header = document.createElement('div');
  header.style.cssText = 'font-size: 1.2vh; color: gray; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 0.8vh;';
  header.textContent = `Comments (${comments.length})`;
  section.appendChild(header);

  const list = document.createElement('div');
  list.className = 'comments-scroll';
  list.style.cssText = 'max-height: 15vh; overflow-y: auto; margin-bottom: 1vh;';
  if (comments.length === 0) {
    const empty = document.createElement('p');
    empty.style.cssText = 'font-size: 1.3vh; color: gray; margin: 0.5vh 0; text-align: center;';
    empty.textContent = 'No comments yet';
    list.appendChild(empty);
  }

  // Topic-chat look: consecutive comments by the same payer form one group -
  // round profile photo on the left (opens the payer's topic), payer/username
  // header, then each comment's text with a small gray timestamp below it.
  const defaultProfilePic = 'https://kiloscribe.com/api/inscription-cdn/0.0.4819119';
  let currentGroupPayer = null;
  let currentMessagesDiv = null;

  const startGroup = (payer) => {
    currentGroupPayer = payer;
    const group = document.createElement('div');
    group.className = 'toolbar-group-messages';
    group.style.cssText = `position: relative; padding-left: 2.5em; min-height: 2.5em; border-color: ${innerContainerTopicChatColor};`;

    const payerImage = profilePictures[payer]?.url || defaultProfilePic;
    const validPayerImage = isValidUrl(payerImage) ? payerImage : defaultProfilePic;
    const img = document.createElement('img');
    img.src = validPayerImage;
    img.alt = 'Profile photo';
    img.style.cssText = 'position: absolute; left: 0.25em; top: 0.5em; width: 2em; height: 2em; border-radius: 1em; cursor: pointer;';
    img.addEventListener('click', () => window.loadTOPIC4PIC(payer));
    group.appendChild(img);

    const contentWrapper = document.createElement('div');
    contentWrapper.style.cssText = 'display: flex; flex-direction: column;';

    const header = document.createElement('div');
    header.className = 'toolbar-group-messages-header';
    header.style.cssText = `display: flex; align-items: center; border: 0.05vh solid ${topicChatHeaderColor}; font-size: ${headerFontSizeTopicChat}vh;`;
    const payerLink = document.createElement('a');
    payerLink.href = `https://explore.hashpack.app/${encodeURIComponent(payer)}`;
    payerLink.target = '_blank';
    payerLink.rel = 'noopener noreferrer';
    payerLink.style.cssText = `color: ${accidTopicChatColor}; text-decoration: none;`;
    payerLink.textContent = payer;
    header.appendChild(payerLink);
    header.appendChild(document.createTextNode('\u00A0'));

    const username = usernames[payer]?.username ? ` ${usernames[payer].username}` : '';
    const click2link = click2url[payer]?.click2url ? ` ${click2url[payer].click2url}` : '';
    if (click2link.trim()) {
      const usernameLink = document.createElement('a');
      usernameLink.href = click2link.trim();
      usernameLink.target = '_blank';
      usernameLink.rel = 'noopener noreferrer';
      usernameLink.style.cssText = `color: ${usernameTopicChatColor}; text-decoration: none;`;
      usernameLink.textContent = username.trim();
      header.appendChild(usernameLink);
    } else if (username.trim()) {
      const usernameSpan = document.createElement('span');
      usernameSpan.style.cssText = `color: ${usernameTopicChatColor};`;
      usernameSpan.textContent = username.trim();
      header.appendChild(usernameSpan);
    }
    contentWrapper.appendChild(header);

    currentMessagesDiv = document.createElement('div');
    contentWrapper.appendChild(currentMessagesDiv);
    group.appendChild(contentWrapper);
    list.appendChild(group);
  };

  let replyTarget = null;

  // Render one comment/reply and its whole reply thread (recursive, so
  // replies-to-replies nest without a depth limit; the visual indent caps
  // at 4 levels so deep threads still fit on a phone). A like on any node
  // is just a regular likeMarker/likePolygon with that node's own created
  // timestamp, so the existing per-payer counting applies unchanged.
  const renderNode = (node, depth) => {
    const wrapper = document.createElement('div');
    if (depth === 0) {
      wrapper.style.cssText = 'display: flex; flex-direction: column; margin-top: 0.2em;';
    } else {
      wrapper.style.cssText = depth <= 4
        ? 'margin-top: 0.2em; padding-left: 1em; border-left: 0.1vh solid rgba(255, 255, 255, 0.18);'
        : 'margin-top: 0.2em;';
    }

    if (depth > 0) {
      const payerLabel = document.createElement('a');
      payerLabel.href = `https://explore.hashpack.app/${encodeURIComponent(node.payer)}`;
      payerLabel.target = '_blank';
      payerLabel.rel = 'noopener noreferrer';
      payerLabel.style.cssText = `color: ${accidTopicChatColor}; text-decoration: none; font-size: 1.1vh;`;
      const uname = usernames[node.payer]?.username ? ` ${usernames[node.payer].username}` : '';
      payerLabel.textContent = node.payer + uname;
      wrapper.appendChild(payerLabel);
    }

    const messageText = document.createElement('div');
    messageText.className = 'chat-msg-text';
    messageText.style.cssText = `font-size: ${textFontSizeTopicChat}vh; color: ${textTopicChatColor}; white-space: pre-wrap; word-wrap: break-word;`;
    messageText.textContent = node.text;
    wrapper.appendChild(messageText);

    // Meta row: 👍 👎 ↩ (left) ... timestamp (right)
    const metaRow = document.createElement('div');
    metaRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-top: 0.05em;';

    const likeDislikeDiv = document.createElement('div');
    likeDislikeDiv.style.cssText = 'display: flex; gap: 0.5em;';

    const likeSpan = document.createElement('span');
    likeSpan.style.cssText = 'font-size: 1.5vh; color: gray; cursor: pointer;';
    likeSpan.textContent = `${node.likeCount || 0}👍`;
    likeSpan.onclick = () => kind === 'polygon' ? window.likePolygon(node.created, topicId) : window.likeMarker(node.created, topicId);
    likeDislikeDiv.appendChild(likeSpan);

    const dislikeSpan = document.createElement('span');
    dislikeSpan.style.cssText = 'font-size: 1.5vh; color: gray; cursor: pointer;';
    dislikeSpan.textContent = `${node.dislikeCount || 0}👎`;
    dislikeSpan.onclick = () => kind === 'polygon' ? window.dislikePolygon(node.created, topicId) : window.dislikeMarker(node.created, topicId);
    likeDislikeDiv.appendChild(dislikeSpan);

    const replyBtn = document.createElement('span');
    replyBtn.style.cssText = 'font-size: 1.5vh; color: gray; cursor: pointer;';
    replyBtn.textContent = '↩';
    replyBtn.onclick = () => {
      replyTarget = node;
      const uname = usernames[node.payer]?.username || node.payer;
      replyChipLabel.textContent = `↩ Replying to ${uname}`;
      replyChip.style.display = 'flex';
      input.focus();
    };
    likeDislikeDiv.appendChild(replyBtn);

    metaRow.appendChild(likeDislikeDiv);

    const timestampSpan = document.createElement('span');
    timestampSpan.className = 'chat-msg-time';
    timestampSpan.style.cssText = `font-size: ${timestampFontSizeTopicChat}vh; color: gray;`;
    timestampSpan.textContent = new Date(node.created).toLocaleString('en-US', {
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    metaRow.appendChild(timestampSpan);

    wrapper.appendChild(metaRow);

    (node.replies || []).forEach((child) => wrapper.appendChild(renderNode(child, depth + 1)));

    return wrapper;
  };

  for (const comment of comments) {
    if (comment.payer !== currentGroupPayer) {
      startGroup(comment.payer);
    }
    currentMessagesDiv.appendChild(renderNode(comment, 0));
  }
  makeScrollable(list);
  section.appendChild(list);

  // Reply-mode chip above the input ("↩ Replying to @payer ✕")
  const replyChip = document.createElement('div');
  replyChip.style.cssText = 'display: none; align-items: center; gap: 0.5em; margin-bottom: 0.8vh; font-size: 1.2vh; color: gray;';
  const replyChipLabel = document.createElement('span');
  replyChipLabel.style.cssText = 'flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
  const replyChipClose = document.createElement('span');
  replyChipClose.textContent = '✕';
  replyChipClose.style.cssText = 'cursor: pointer; color: gray;';
  replyChipClose.onclick = () => { replyTarget = null; replyChip.style.display = 'none'; };
  replyChip.appendChild(replyChipLabel);
  replyChip.appendChild(replyChipClose);
  section.appendChild(replyChip);

  // Input row: rounded glass textarea + rounded pill Send button,
  // bottom-aligned so the button stays put as the textarea grows.
  const inputRow = document.createElement('div');
  inputRow.style.cssText = 'display: flex; align-items: flex-end; gap: 1vh;';

  const input = document.createElement('textarea');
  input.placeholder = 'Leave a comment...';
  input.maxLength = 300;
  input.rows = 2;
  input.style.cssText = 'flex: 1; resize: none; font-size: 1.4vh; padding: 0.6vh 1vh; border-radius: 1vh; border: 0.05vh solid rgba(255, 255, 255, 0.2); background: rgba(255, 255, 255, 0.08); color: white; outline: none;';
  input.addEventListener('input', () => adjustTextareaHeight(input));
  inputRow.appendChild(input);

  const sendBtn = document.createElement('span');
  sendBtn.textContent = 'Send';
  sendBtn.style.cssText = 'padding: 0.6vh 1.5vh; border-radius: 1.5vh; background: rgba(255, 255, 255, 0.9); color: black; font-size: 1.3vh; font-weight: 600; cursor: pointer; user-select: none; transition: transform 0.15s ease, filter 0.15s ease;';
  sendBtn.addEventListener('mouseenter', () => { sendBtn.style.transform = 'scale(1.03)'; sendBtn.style.filter = 'brightness(1.1)'; });
  sendBtn.addEventListener('mouseleave', () => { sendBtn.style.transform = ''; sendBtn.style.filter = ''; });
  sendBtn.addEventListener('mousedown', () => { sendBtn.style.transform = 'scale(0.97)'; });
  sendBtn.addEventListener('mouseup', () => { sendBtn.style.transform = 'scale(1.03)'; });
  sendBtn.onclick = () => {
    if (replyTarget) {
      onReply(replyTarget.created, input);
      replyTarget = null;
      replyChip.style.display = 'none';
    } else {
      onSend(input);
    }
  };
  inputRow.appendChild(sendBtn);
  section.appendChild(inputRow);

  return section;
}

function toggleCommentsSection(id) {
  const section = document.getElementById(id);
  if (!section) return;
  const isOpen = section.style.display !== 'none';
  section.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) {
    // Soft spring pop-in (app-wide glass look): fade + scale from 0.96
    section.animate(
      [{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'scale(1)' }],
      { duration: 250, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }
    );
    const input = section.querySelector('textarea');
    if (input) input.focus();
  }
}

window.openMarkerComments = function(timestamp, topicId) {
  toggleCommentsSection(`marker-comments-${topicId}-${timestamp}`);
};

window.openPolygonComments = function(timestamp, topicId) {
  toggleCommentsSection(`polygon-comments-${topicId}-${timestamp}`);
};

window.sendMarkerComment = async function(timestamp, topicId, input) {
  if (!signer) {
    toast.error("Connect wallet first");
    return;
  }
  const text = (input.value || '').trim().slice(0, 300);
  if (!text) {
    toast.error("Comment is empty");
    return;
  }
  const messageObject = {
    commentMarker: {
      timestamp: timestamp,
      text: text
    }
  };
  toast.info("Confirm in wallet 👛");
  await sendMessage(topicId, JSON.stringify(messageObject));
};

window.sendPolygonComment = async function(timestamp, topicId, input) {
  if (!signer) {
    toast.error("Connect wallet first");
    return;
  }
  const text = (input.value || '').trim().slice(0, 300);
  if (!text) {
    toast.error("Comment is empty");
    return;
  }
  const messageObject = {
    commentPolygon: {
      timestamp: timestamp,
      text: text
    }
  };
  toast.info("Confirm in wallet 👛");
  await sendMessage(topicId, JSON.stringify(messageObject));
};

window.sendMarkerReply = async function(postTimestamp, parentId, topicId, input) {
  if (!signer) {
    toast.error("Connect wallet first");
    return;
  }
  const text = (input.value || '').trim().slice(0, 300);
  if (!text) {
    toast.error("Comment is empty");
    return;
  }
  const messageObject = {
    replyMarker: {
      timestamp: postTimestamp,
      parentId: parentId,
      text: text
    }
  };
  toast.info("Confirm in wallet 👛");
  await sendMessage(topicId, JSON.stringify(messageObject));
};

window.sendPolygonReply = async function(postTimestamp, parentId, topicId, input) {
  if (!signer) {
    toast.error("Connect wallet first");
    return;
  }
  const text = (input.value || '').trim().slice(0, 300);
  if (!text) {
    toast.error("Comment is empty");
    return;
  }
  const messageObject = {
    replyPolygon: {
      timestamp: postTimestamp,
      parentId: parentId,
      text: text
    }
  };
  toast.info("Confirm in wallet 👛");
  await sendMessage(topicId, JSON.stringify(messageObject));
};

window.openPolygonNavigation = async function(coordinates) {

  try {  
    // Calculate center (centroid) of all points
    let sumLat = 0;
    let sumLng = 0;
    let count = 0;

    coordinates.forEach(point => {
      if (Array.isArray(point) && point.length >= 2) {
        const lng = point[0];   // longitude
        const lat = point[1];   // latitude
        sumLat += lat;
        sumLng += lng;
        count++;
      }
    });

    if (count === 0) {
      console.error("Invalid coordinate data");
      return;
    }

    const centerLat = sumLat / count;
    const centerLng = sumLng / count;

    const destination = `${centerLat},${centerLng}`;


    // Opens Google Maps centered on the location with a pin
    window.open( `https://www.google.com/maps?q=${destination}`, '_blank');
            

  } catch (err) {
    console.error("Error opening navigation:", err);
  }
  
};

window.openMarkerNavigation = async function(coords) {

  try {  
    const lat = coords[1];
    const lng = coords[0];

    const destination = `${lat},${lng}`;
    
    window.open( `https://www.google.com/maps?q=${destination}`, '_blank');

  } catch (err) {
    console.error("Error opening navigation:", err);
  }
  
};

window.likePolygon = async function(timestamp, topicId) {
    if (!signer) {
      toast.error("Connect wallet first");
      return;
    }

    const meesageobject = {
    likePolygon: {
      timestamp: timestamp
    }
  };

  const meesage = JSON.stringify(meesageobject);
  toast.info("Confirm in wallet 👛");
  await sendMessage(topicId, meesage);
};

window.dislikeMarker = async function(timestamp, topicId) {
    if (!signer) {
      toast.error("Connect wallet first");
      return;
    }

    const meesageobject = {
    dislikeMarker: {
      timestamp: timestamp
    }
  };

  const meesage = JSON.stringify(meesageobject);
  toast.info("Confirm in wallet 👛");
  await sendMessage(topicId, meesage);
};

window.dislikePolygon = async function(timestamp, topicId) {
    if (!signer) {
      toast.error("Connect wallet first");
      return;
    }

    const meesageobject = {
    dislikePolygon: {
      timestamp: timestamp
    }
  };

  const meesage = JSON.stringify(meesageobject);
  toast.info("Confirm in wallet 👛");
  await sendMessage(topicId, meesage);
};







document.getElementById("unlock-load-all").addEventListener("click", async () => {
  try {
    let pass = document.getElementById("unlockkey-load").value;


    geojson.features = [];
    polygons.length = 0;

    existingMarkers.forEach(marker => marker.remove());
    newExistingMarkers([]);

    newStoredMarkers([]);
    newStoredPolygons([]);

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


    let encryptedPrivateKey;
    let decryptedPrivateKey;

    const totalTopics = allLoadedMessages.length;
    let processedCount = 0;

    for (const topicData of allLoadedMessages) {

      const topicId = topicData.topicId; 

      const messages = Object.values(topicData.uniqueMessages).flat();

      const w = pass;

      const topicAdmin = [];
      try {
        const topicInfo = await getTopicInfo(topicId);
        const memo = topicInfo.memo || "";
        const parts = memo.split(',');
        parts.forEach(part => {
          if (part.trim().startsWith("0.0.")) {
            topicAdmin.push(part.trim());
          }
        });
      } catch (error) {

        console.error("Error getting topic info:", error);
        return;
      }

      try {
        for (let index = messages.length - 1; index >= 0; index--) {
          const message = messages[index];

          let parsedMessage = typeof message === 'string' ? JSON.parse(message) : message;

          if (parsedMessage.encryptedPrivateKeyForLoad && (topicAdmin.length === 0 || topicAdmin.includes(parsedMessage.payer))) {
  
            encryptedPrivateKey = parsedMessage.encryptedPrivateKeyForLoad;
  
            const nonce = parsedMessage.nonce;
            const salt = parsedMessage.salt;
            const password = w;
  
            decryptedPrivateKey = await decryptWithPassword(encryptedPrivateKey, nonce, salt, password);

            break;
  
          }
          else {
            decryptedPrivateKey = '';
          }
    
       }
      } catch (error) {

        console.error("Error getting public key:", error);

      }




    const { topicGeojsonFeatures, topicPolygons } = await processTopicE2EEMessages(decryptedPrivateKey, messages, topicId);

    storedMarkers.push(topicGeojsonFeatures);
    storedPolygons.push(topicPolygons);


   processedCount++;


  }

  if ( totalTopics === processedCount){

    polygons.forEach(polygon => {
      addPolygonWithImageFill(map, polygon);
    });

    if (geojson.features.length > 0) {
      index.load(geojson.features);
      updateClusters();
    }

  }

  } catch (error) {
    console.error('Error submitting message:', error);
  }
});






export async function processTopicE2EEMessages(decryptedPrivateKey, messages, topicId) {
  let topicGeojsonFeatures = [];
  let topicPolygons = [];
  let loadedTopicName = '';
  let PrivateKey;
  const rawResult = messages;

  try{
  PrivateKey = parsePrivateKey(decryptedPrivateKey);
  }catch (error) {
    console.error(`Error loading private key: ${error}`);
  }


  try {


      const likeCountMapMarker = new Map();
      const dislikeCountMapMarker = new Map();
      const likeCountMapPolygon = new Map();
      const dislikeCountMapPolygon = new Map();
      const payerActionsPerTimestamp = new Map();
      const commentsMapMarker = new Map();
      const commentsMapPolygon = new Map();
      const repliesMapMarker = new Map();
      const repliesMapPolygon = new Map();


if (rawResult && Array.isArray(rawResult)) {



  for (const message of rawResult) {
    try {
      let parsedMessage = message;

      if (typeof message === 'string') {
        parsedMessage = JSON.parse(message);
      }

      const payerId = parsedMessage.payer;
      let actionTimestamp, actionType;

      // Check for like
      if (parsedMessage.likeMarker && parsedMessage.likeMarker.timestamp && parsedMessage.payer) {
        actionTimestamp = parsedMessage.likeMarker.timestamp;
        actionType = 'likeMarker';
      }
      // Check for dislike
      if (parsedMessage.dislikeMarker && parsedMessage.dislikeMarker.timestamp && parsedMessage.payer) {
        const dislikeTimestamp = parsedMessage.dislikeMarker.timestamp;
        // If no like or dislike timestamp is newer, update action
        if (!actionTimestamp || dislikeTimestamp > actionTimestamp) {
          actionTimestamp = dislikeTimestamp;
          actionType = 'dislikeMarker';
        }
      }
      // Check for like
      if (parsedMessage.likePolygon && parsedMessage.likePolygon.timestamp && parsedMessage.payer) {
        actionTimestamp = parsedMessage.likePolygon.timestamp;
        actionType = 'likePolygon';
      }
      // Check for dislike
      if (parsedMessage.dislikePolygon && parsedMessage.dislikePolygon.timestamp && parsedMessage.payer) {
        actionTimestamp = parsedMessage.dislikePolygon.timestamp;
        actionType = 'dislikePolygon';
      }

      // Process the action if it exists
      if (actionTimestamp && actionType && payerId) {
        // Initialize map for this timestamp if it doesn't exist
        if (!payerActionsPerTimestamp.has(actionTimestamp)) {
          payerActionsPerTimestamp.set(actionTimestamp, new Map());
        }

        // Update or set the latest action for this payer at this timestamp
        const payerActions = payerActionsPerTimestamp.get(actionTimestamp);
        const existingAction = payerActions.get(payerId);

        // Only update if this is a new action or a newer timestamp
        if (!existingAction || actionTimestamp >= existingAction.timestamp) {
          // If there's an existing action, remove its previous count
          if (existingAction) {
            if (existingAction.type === 'likeMarker') {
              likeCountMapMarker.set(actionTimestamp, (likeCountMapMarker.get(actionTimestamp) || 0) - 1);
            } else if (existingAction.type === 'dislikeMarker') {
              dislikeCountMapMarker.set(actionTimestamp, (dislikeCountMapMarker.get(actionTimestamp) || 0) - 1);
            }
            if (existingAction.type === 'likePolygon') {
              likeCountMapPolygon.set(actionTimestamp, (likeCountMapPolygon.get(actionTimestamp) || 0) - 1);
            } else if (existingAction.type === 'dislikePolygon') {
              dislikeCountMapPolygon.set(actionTimestamp, (dislikeCountMapPolygon.get(actionTimestamp) || 0) - 1);
            }
          }

          // Store the new action
          payerActions.set(payerId, { type: actionType, timestamp: actionTimestamp });

          // Increment the count for the new action
          if (actionType === 'likeMarker') {
            likeCountMapMarker.set(actionTimestamp, (likeCountMapMarker.get(actionTimestamp) || 0) + 1);
          } else if (actionType === 'dislikeMarker') {
            dislikeCountMapMarker.set(actionTimestamp, (dislikeCountMapMarker.get(actionTimestamp) || 0) + 1);
          }
          if (actionType === 'likePolygon') {
            likeCountMapPolygon.set(actionTimestamp, (likeCountMapPolygon.get(actionTimestamp) || 0) + 1);
          } else if (actionType === 'dislikePolygon') {
            dislikeCountMapPolygon.set(actionTimestamp, (dislikeCountMapPolygon.get(actionTimestamp) || 0) + 1);
          }
        }
      }

      // Collect comments (each topic message is one comment; the payer is
      // the Hedera account that signed it, same as likes)
      if (parsedMessage.commentMarker && parsedMessage.commentMarker.timestamp && payerId) {
        const commentTimestamp = parsedMessage.commentMarker.timestamp;
        if (!commentsMapMarker.has(commentTimestamp)) {
          commentsMapMarker.set(commentTimestamp, []);
        }
        commentsMapMarker.get(commentTimestamp).push({
          payer: payerId,
          text: String(parsedMessage.commentMarker.text || '').slice(0, 300),
          created: parsedMessage.created
        });
      }
      if (parsedMessage.commentPolygon && parsedMessage.commentPolygon.timestamp && payerId) {
        const commentTimestamp = parsedMessage.commentPolygon.timestamp;
        if (!commentsMapPolygon.has(commentTimestamp)) {
          commentsMapPolygon.set(commentTimestamp, []);
        }
        commentsMapPolygon.get(commentTimestamp).push({
          payer: payerId,
          text: String(parsedMessage.commentPolygon.text || '').slice(0, 300),
          created: parsedMessage.created
        });
      }

      // Collect replies (nested comments; parentId = the created timestamp
      // of the comment or reply being answered)
      if (parsedMessage.replyMarker && parsedMessage.replyMarker.parentId && payerId) {
        const parentId = parsedMessage.replyMarker.parentId;
        if (!repliesMapMarker.has(parentId)) {
          repliesMapMarker.set(parentId, []);
        }
        repliesMapMarker.get(parentId).push({
          payer: payerId,
          text: String(parsedMessage.replyMarker.text || '').slice(0, 300),
          created: parsedMessage.created
        });
      }
      if (parsedMessage.replyPolygon && parsedMessage.replyPolygon.parentId && payerId) {
        const parentId = parsedMessage.replyPolygon.parentId;
        if (!repliesMapPolygon.has(parentId)) {
          repliesMapPolygon.set(parentId, []);
        }
        repliesMapPolygon.get(parentId).push({
          payer: payerId,
          text: String(parsedMessage.replyPolygon.text || '').slice(0, 300),
          created: parsedMessage.created
        });
      }
    } catch (error) {
      console.error(`Error parsing message for likes/dislikes: ${error}`);
    }
  }
}
          

          const topicInfo = await getTopicInfo(topicId);
          const topicAdmin = [];
          let hasRulesForMarker = false;
          let hasRulesForPolygon = false;
          const memo = topicInfo.memo;

          // Split the memo by commas
          const parts = memo.split(',');

          // Iterate over each part
          parts.forEach(part => {
            // Check if the part starts with "0.0."
            if (part.startsWith("0.0.")) {
              // Add it to the topicAdmin array
              topicAdmin.push(part);
            }
          });



          // Check if messages exist and is an array
          if (!rawResult || !Array.isArray(rawResult)) {
            console.error(`No messages found for topic ${topicId}.`, rawResult);
            return { topicGeojsonFeatures, topicPolygons }; // Return empty arrays
          }

          const messages = rawResult; // Extract messages

          const loadedTopicRulesForMarker = [];
          const loadedTopicRulesForPolygon = [];



          // Read rules from messages
          for (let index = messages.length - 1; index >= 0; index--) {
            const message = messages[index];
            try {
              let parsedMessage = message;
              if (typeof message === 'string') {
                parsedMessage = JSON.parse(message);
              }

              if (parsedMessage.rules && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
                if (parsedMessage.rules.formarker.markerTopicId.startsWith('0.0.') && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
                loadedTopicRulesForMarker.push(parsedMessage.rules.formarker);
                hasRulesForMarker = true;

              }
              if (parsedMessage.rules.forpolygon.polygonTopicId.startsWith('0.0.') && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
                loadedTopicRulesForPolygon.push(parsedMessage.rules.forpolygon);
                hasRulesForPolygon = true;

              }
                break; // Exit the loop after finding the last message with rules
              }
            } catch (messageError) {
              console.error(`Error processing message ${index}:`, messageError);
            }
          }

          for (let index = messages.length - 1; index >= 0; index--) {
            const message = messages[index];
            try {
              let parsedMessage = message;
              if (typeof message === 'string') {
                parsedMessage = JSON.parse(message);
              }
              // Check if changeName exists and either topicAdmin is empty or includes the payer
              if (parsedMessage.changeName && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
                loadedTopicName = parsedMessage.changeName;
                break; // Stop after finding the first valid message
              }
            } catch (messageError) {
              console.error(`Error processing message ${index}:`, messageError);
            }
          }
          const uniquePayerIdsForMarker = new Set();
          const uniquePayerIdsForPolygon = new Set();

          // Extract payer IDs from messages
      for (const message of messages) {
        try {
          let parsedMessage = message;
          if (typeof message === 'string') {
            parsedMessage = JSON.parse(message);
          }

          // Add payer IDs for markers
          if (parsedMessage.marker && parsedMessage.marker.data) {
            uniquePayerIdsForMarker.add(parsedMessage.payer);
          }

          // Add payer IDs for polygons
          if (parsedMessage.polygon && parsedMessage.polygon.data) {
            uniquePayerIdsForPolygon.add(parsedMessage.payer);
          }

          if (parsedMessage.addTopicNFT && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
          const nfts = parsedMessage.addTopicNFT.split(',').map(nft => nft.trim());
          nfts.forEach(nft => {
            if (!loadedNFTsForModel.includes(nft)) {
              loadedNFTsForModel.push(nft);
            }
          });
          }

          if (parsedMessage.removeTopicNFT && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
            const nft = parsedMessage.removeTopicNFT.trim();
            const index = loadedNFTsForModel.indexOf(nft);
            if (index !== -1) {
              loadedNFTsForModel.splice(index, 1);
            }
          }

        if (parsedMessage.addScale && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
          const { NFT, scale } = parsedMessage.addScale;
          loadedNFTScaleForModel.push({ NFT, scale });
        }

        if (parsedMessage.removeScale && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
          const { NFT } = parsedMessage.removeScale;
          const index = loadedNFTScaleForModel.findIndex(item => item.NFT === NFT);
          if (index !== -1) {
            loadedNFTScaleForModel.splice(index, 1); // Remove the item if it exists
          } else {
            console.log(`NFT: ${NFT} not found in addScale list`);
          }
        }

        updateRulesForModelNFTState();

        } catch (error) {
          console.error("Error extracting payer ID:", error);
        }
      }

          // Ownership logic
          const markerOwnershipArray = [];
          const polygonOwnershipArray = [];


          if (hasRulesForMarker) {
            // Iterate over each unique payer ID for markers
            for (const payerId of uniquePayerIdsForMarker) {
              const tokenIdForMarker = loadedTopicRulesForMarker[0].markerTopicId;
              const filteredNftsForMarker = await getAccountNFTs(payerId, tokenIdForMarker);

              // Check if the user owns NFTs and push to an array
              if (filteredNftsForMarker.length > 0) {
                const numberOfMessages = filteredNftsForMarker.length * loadedTopicRulesForMarker[0].markerMessagesPerNft;
                const numberOfMarker = [];
                markerOwnershipArray.push({ payerId, numberOfMessages, numberOfMarker });
              }
            }
          }

          if (hasRulesForPolygon) {

            // Iterate over each unique payer ID for polygons
            for (const payerId of uniquePayerIdsForPolygon) {
              const tokenIdForPoly = loadedTopicRulesForPolygon[0].polygonTopicId;
              const filteredNftsForPoly = await getAccountNFTs(payerId, tokenIdForPoly);

              // Check if the user owns NFTs and push to an array
              if (filteredNftsForPoly.length > 0) {
                const numberOfMessages = filteredNftsForPoly.length * loadedTopicRulesForPolygon[0].polygonMessagesPerNft;
                const numberOfPolygon = [];
                polygonOwnershipArray.push({ payerId, numberOfMessages, numberOfPolygon });
              }
            }
          }

          if (!hasRulesForMarker) {
          for (const payerId of uniquePayerIdsForMarker) {
            const numberOfMarker = [];
            markerOwnershipArray.push({ payerId, numberOfMarker });
          }
        }
        if (!hasRulesForPolygon) {
          for (const payerId of uniquePayerIdsForPolygon) {
            const numberOfPolygon = [];
            polygonOwnershipArray.push({ payerId, numberOfPolygon });
          }
        }
          // Process each message
          for (let index = messages.length - 1; index >= 0; index--) {
            const message = messages[index];
            try {
              let parsedMessage = message;
              let decryptedMessage;


              if (typeof message === 'string') {
                parsedMessage = JSON.parse(message);
              }
              
              if (parsedMessage.ciphertext){
                decryptedMessage = await decryptMessage(parsedMessage, PrivateKey);
                parsedMessage = JSON.parse(decryptedMessage)
              }

              const timestamp = new Date(message.created)
              .toLocaleString('en-US', {
                hour12: false,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
              })


              const defaultProfilePic = "https://kiloscribe.com/api/inscription-cdn/0.0.4819119";
              const profileUrl = isValidUrl(message.payer && profilePictures[message.payer] ?
                profilePictures[message.payer].url :
                defaultProfilePic) ?
                (message.payer && profilePictures[message.payer] ? profilePictures[message.payer].url : defaultProfilePic) :
                defaultProfilePic;

              const payerInfo = message.payer ? `${message.payer}` : 'Anonymous';
              const username = message.payer && usernames[message.payer] ?
                ` ${usernames[message.payer].username}` :
                '';
              const click2link = message.payer && click2url[message.payer] ?
                ` ${click2url[message.payer].click2url}` :
                '';

              if (parsedMessage.marker && parsedMessage.marker.data) {
                const markernumber = parsedMessage.marker.data.numberOfMarker;
                const markerOwner = markerOwnershipArray.find(owner => owner.payerId === message.payer);
                
                if (parsedMessage.marker.data.deleteMarkerNumber) {
                  const deleteMarkerNumber = parsedMessage.marker.data.deleteMarkerNumber;
                  markerOwner.numberOfMarker.push(deleteMarkerNumber);
                }

                if (markernumber === undefined || markernumber === null || !Number.isInteger(Number(markernumber))) {
                  continue;
                }
                  
                if (!markerOwner.numberOfMarker.includes(markernumber)) {
                  markerOwner.numberOfMarker.push(markernumber);
                
                if (!hasRulesForMarker || (markerOwner && markerOwner.numberOfMessages > 0)) {

                  if (hasRulesForMarker) {
                    markerOwner.numberOfMessages -= 1;
                  }

                  let coords;
                  try {
                    const cordData = parsedMessage.marker.data.cord;

                    if (typeof cordData === 'string') {
                      coords = cordData.split(',').map(num => parseFloat(num.trim()));
                    } else if (Array.isArray(cordData)) {
                      coords = cordData;
                    } else {
                      throw new Error('Unsupported coordinate format');
                    }

                    if (!Array.isArray(coords) || coords.length !== 2 || coords.some(isNaN)) {
                      throw new Error('Invalid coordinate format');
                    }

                    // Use the final like and dislike counts from the maps
                    const likeCountMarker = likeCountMapMarker.get(timestamp) || 0;
                    const dislikeCountMarker = dislikeCountMapMarker.get(timestamp) || 0;

                    // Create marker popup HTML using DOM helper
                    const markerPopupHTML = createMarkerPopupHTML({
                      markernumber,
                      topicId,
                      loadedTopicName,
                      profileUrl,
                      payer: message.payer,
                      payerInfo,
                      username,
                      click2link,
                      title: parsedMessage.marker.data.title,
                      image: parsedMessage.marker.data.image,
                      msg: parsedMessage.marker.data.msg,
                      timestamp,
                      likeCountMarker,
                      dislikeCountMarker,
                      comments: (commentsMapMarker.get(timestamp) || []).map((c) => ({
                        ...c,
                        likeCount: likeCountMapMarker.get(c.created) || 0,
                        dislikeCount: dislikeCountMapMarker.get(c.created) || 0,
                        replies: buildReplyTree(c, repliesMapMarker, likeCountMapMarker, dislikeCountMapMarker)
                      })),
                      coords
                    });

                    topicGeojsonFeatures.push({
                      topicId: topicId,
                      created: parsedMessage.created,
                      msgNumber: parsedMessage.marker.data.numberOfMarker,
                      type: "Feature",
                      payer: message.payer,
                      properties: {
                        message: markerPopupHTML,
                        imageUrl: isValidUrl(parsedMessage.marker.data.coverimage) ? parsedMessage.marker.data.coverimage : profileUrl
                      },
                      geometry: {
                        type: "Point",
                        coordinates: coords
                      }
                    });
                  } catch (coordError) {
                    console.error("Error parsing marker coordinates:", coordError, "Raw coords:", parsedMessage.marker.data.cord);
                  }
                }
              }
            }

              // Handle polygon type messages
              if (parsedMessage.polygon && parsedMessage.polygon.data) {
                const polygonOwner = polygonOwnershipArray.find(owner => owner.payerId === message.payer) ;
                const polygonnumber = parsedMessage.polygon.data.numberOfPolygon;
                
                if (parsedMessage.polygon.data.deletePolygonNumber) {
                  const deletePolygonNumber = parsedMessage.polygon.data.deletePolygonNumber;
                  polygonOwner.numberOfPolygon.push(deletePolygonNumber);
                }

                if (polygonnumber === undefined || polygonnumber === null || !Number.isInteger(Number(polygonnumber))) {
                  continue;
                }

                if (!polygonOwner.numberOfPolygon.includes(polygonnumber)) {
                  polygonOwner.numberOfPolygon.push(polygonnumber);


                if (!hasRulesForPolygon || (polygonOwner && polygonOwner.numberOfMessages > 0)) {
                  if (hasRulesForPolygon) {
                    polygonOwner.numberOfMessages -= 1;
                  }

                  try {
                    const cordStr = parsedMessage.polygon.data.cord;

                    // Validate the coordinate string format
                    const validCoordPattern = /^\[-?\d+\.?\d*,\s*-?\d+\.?\d*\](,\s*\[-?\d+\.?\d*,\s*-?\d+\.?\d*\])*$/;
                    if (!validCoordPattern.test(cordStr)) {
                      continue; // Skip processing this message
                    }

                    // Parse the coordinates
                    const coordinates = JSON.parse(`[${cordStr}]`); // Wrap in brackets for valid JSON

                    if (Array.isArray(coordinates) && coordinates.length > 2) {
                      const polygonSize = hasRulesForPolygon ? loadedTopicRulesForPolygon[0].polygonSize : 1;

                      const likeCountPolygon = likeCountMapPolygon.get(timestamp) || 0;
                      const dislikeCountPolygon = dislikeCountMapPolygon.get(timestamp) || 0;

                      // Create polygon popup HTML using DOM helper
                      const polygonPopupHTML = createPolygonPopupHTML({
                        polygonnumber,
                        topicId,
                        loadedTopicName,
                        profileUrl,
                        payer: message.payer,
                        payerInfo,
                        username,
                        click2link,
                        title: parsedMessage.polygon.data.title,
                        image: parsedMessage.polygon.data.image,
                        msg: parsedMessage.polygon.data.msg,
                        timestamp,
                        likeCountPolygon,
                        dislikeCountPolygon,
                        comments: (commentsMapPolygon.get(timestamp) || []).map((c) => ({
                          ...c,
                          likeCount: likeCountMapPolygon.get(c.created) || 0,
                          dislikeCount: dislikeCountMapPolygon.get(c.created) || 0,
                          replies: buildReplyTree(c, repliesMapPolygon, likeCountMapPolygon, dislikeCountMapPolygon)
                        })),
                        coordinates
                      });

                      topicPolygons.push({
                        topicId: topicId,
                        created: parsedMessage.created,
                        msgNumber: parsedMessage.polygon.data.numberOfPolygon,
                        id: `polygon-${message.payer}-${topicId}-${parsedMessage.polygon.data.numberOfPolygon}`,
                        payer: message.payer,
                        coordinates: [coordinates],
                        description: polygonPopupHTML,
                        imageUrl: isValidUrl(parsedMessage.polygon.data.coverimage) ? parsedMessage.polygon.data.coverimage : profileUrl
                      });
                    }
                  } catch (polygonError) {
                    console.error("Error parsing polygon data:", polygonError);
                  }
                }
              }
            }
            } catch (messageError) {
              console.error(`Error processing message ${index}:`, messageError);
            }
          }


        // At the end of the function, push the collected features to the parent arrays
        geojson.features.push(...topicGeojsonFeatures); // Push topic features to parent geojson array
        polygons.push(...topicPolygons); // Push topic polygons to parent polygons array
        return { topicGeojsonFeatures, topicPolygons };


        } catch (error) {
          console.error(`Error loading messages for topic ${topicId}:`, error);
          return { topicGeojsonFeatures: [], topicPolygons: [] }; // Return empty arrays on error
        }
      }





document.getElementById("unlock-load-few").addEventListener("click", async () => {
  try {
    let pass = document.getElementById("unlockkey-load").value;


    geojson.features = [];
    polygons.length = 0;

    existingMarkers.forEach(marker => marker.remove());
    newExistingMarkers([]);

    newStoredMarkers([]);
    newStoredPolygons([]);

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


    let encryptedPrivateKey;
    let decryptedPrivateKey;

    const totalTopics = allLoadedMessages.length;
    let processedCount = 0;

    for (const topicData of allLoadedMessages) {

      const topicId = topicData.topicId; 

      const messages = Object.values(topicData.uniqueMessages).flat();

      const w = pass;

      const topicAdmin = [];
      try {
        const topicInfo = await getTopicInfo(topicId);
        const memo = topicInfo.memo || "";
        const parts = memo.split(',');
        parts.forEach(part => {
          if (part.trim().startsWith("0.0.")) {
            topicAdmin.push(part.trim());
          }
        });
      } catch (error) {

        console.error("Error getting topic info:", error);
        return;
      }

      try {
        for (let index = messages.length - 1; index >= 0; index--) {
          const message = messages[index];

          let parsedMessage = typeof message === 'string' ? JSON.parse(message) : message;

          if (parsedMessage.encryptedPrivateKeyForLoad && (topicAdmin.length === 0 || topicAdmin.includes(parsedMessage.payer))) {
  
            encryptedPrivateKey = parsedMessage.encryptedPrivateKeyForLoad;
  
            const nonce = parsedMessage.nonce;
            const salt = parsedMessage.salt;
            const password = w;
  
            decryptedPrivateKey = await decryptWithPassword(encryptedPrivateKey, nonce, salt, password);

            break;
  
          }
          else {
            decryptedPrivateKey = '';
          }
    
        }
      } catch (error) {

        console.error("Error getting public key:", error);

      }




    const { topicGeojsonFeatures, topicPolygons } = await processFewTopicE2EEMessages(decryptedPrivateKey, messages, topicId);

    storedMarkers.push(topicGeojsonFeatures);
    storedPolygons.push(topicPolygons);


    processedCount++;


  }

  if ( totalTopics === processedCount){

    polygons.forEach(polygon => {
      addPolygonWithImageFill(map, polygon);
    });

    if (geojson.features.length > 0) {
      index.load(geojson.features);
      updateClusters();
    }

  }

  } catch (error) {
    console.error('Error submitting message:', error);
  }
});




export async function processFewTopicE2EEMessages(decryptedPrivateKey, messages, topicId) {
  let topicGeojsonFeatures = [];
  let topicPolygons = [];
  let loadedTopicName = '';
  let PrivateKey;
  const rawResult = messages;

  try{
  PrivateKey = parsePrivateKey(decryptedPrivateKey);
  }catch (error) {
    console.error(`Error loading private key: ${error}`);
  }


  try {


      const likeCountMapMarker = new Map();
      const dislikeCountMapMarker = new Map();
      const likeCountMapPolygon = new Map();
      const dislikeCountMapPolygon = new Map();
      const payerActionsPerTimestamp = new Map();
      const commentsMapMarker = new Map();
      const commentsMapPolygon = new Map();
      const repliesMapMarker = new Map();
      const repliesMapPolygon = new Map();


if (rawResult && Array.isArray(rawResult)) {



  for (const message of rawResult) {
    try {
      let parsedMessage = message;

      if (typeof message === 'string') {
        parsedMessage = JSON.parse(message);
      }

      const payerId = parsedMessage.payer;
      let actionTimestamp, actionType;

      // Check for like
      if (parsedMessage.likeMarker && parsedMessage.likeMarker.timestamp && parsedMessage.payer) {
        actionTimestamp = parsedMessage.likeMarker.timestamp;
        actionType = 'likeMarker';
      }
      // Check for dislike
      if (parsedMessage.dislikeMarker && parsedMessage.dislikeMarker.timestamp && parsedMessage.payer) {
        const dislikeTimestamp = parsedMessage.dislikeMarker.timestamp;
        // If no like or dislike timestamp is newer, update action
        if (!actionTimestamp || dislikeTimestamp > actionTimestamp) {
          actionTimestamp = dislikeTimestamp;
          actionType = 'dislikeMarker';
        }
      }
      // Check for like
      if (parsedMessage.likePolygon && parsedMessage.likePolygon.timestamp && parsedMessage.payer) {
        actionTimestamp = parsedMessage.likePolygon.timestamp;
        actionType = 'likePolygon';
      }
      // Check for dislike
      if (parsedMessage.dislikePolygon && parsedMessage.dislikePolygon.timestamp && parsedMessage.payer) {
        actionTimestamp = parsedMessage.dislikePolygon.timestamp;
        actionType = 'dislikePolygon';
      }

      // Process the action if it exists
      if (actionTimestamp && actionType && payerId) {
        // Initialize map for this timestamp if it doesn't exist
        if (!payerActionsPerTimestamp.has(actionTimestamp)) {
          payerActionsPerTimestamp.set(actionTimestamp, new Map());
        }

        // Update or set the latest action for this payer at this timestamp
        const payerActions = payerActionsPerTimestamp.get(actionTimestamp);
        const existingAction = payerActions.get(payerId);

        // Only update if this is a new action or a newer timestamp
        if (!existingAction || actionTimestamp >= existingAction.timestamp) {
          // If there's an existing action, remove its previous count
          if (existingAction) {
            if (existingAction.type === 'likeMarker') {
              likeCountMapMarker.set(actionTimestamp, (likeCountMapMarker.get(actionTimestamp) || 0) - 1);
            } else if (existingAction.type === 'dislikeMarker') {
              dislikeCountMapMarker.set(actionTimestamp, (dislikeCountMapMarker.get(actionTimestamp) || 0) - 1);
            }
            if (existingAction.type === 'likePolygon') {
              likeCountMapPolygon.set(actionTimestamp, (likeCountMapPolygon.get(actionTimestamp) || 0) - 1);
            } else if (existingAction.type === 'dislikePolygon') {
              dislikeCountMapPolygon.set(actionTimestamp, (dislikeCountMapPolygon.get(actionTimestamp) || 0) - 1);
            }
          }

          // Store the new action
          payerActions.set(payerId, { type: actionType, timestamp: actionTimestamp });

          // Increment the count for the new action
          if (actionType === 'likeMarker') {
            likeCountMapMarker.set(actionTimestamp, (likeCountMapMarker.get(actionTimestamp) || 0) + 1);
          } else if (actionType === 'dislikeMarker') {
            dislikeCountMapMarker.set(actionTimestamp, (dislikeCountMapMarker.get(actionTimestamp) || 0) + 1);
          }
          if (actionType === 'likePolygon') {
            likeCountMapPolygon.set(actionTimestamp, (likeCountMapPolygon.get(actionTimestamp) || 0) + 1);
          } else if (actionType === 'dislikePolygon') {
            dislikeCountMapPolygon.set(actionTimestamp, (dislikeCountMapPolygon.get(actionTimestamp) || 0) + 1);
          }
        }
      }

      // Collect comments (each topic message is one comment; the payer is
      // the Hedera account that signed it, same as likes)
      if (parsedMessage.commentMarker && parsedMessage.commentMarker.timestamp && payerId) {
        const commentTimestamp = parsedMessage.commentMarker.timestamp;
        if (!commentsMapMarker.has(commentTimestamp)) {
          commentsMapMarker.set(commentTimestamp, []);
        }
        commentsMapMarker.get(commentTimestamp).push({
          payer: payerId,
          text: String(parsedMessage.commentMarker.text || '').slice(0, 300),
          created: parsedMessage.created
        });
      }
      if (parsedMessage.commentPolygon && parsedMessage.commentPolygon.timestamp && payerId) {
        const commentTimestamp = parsedMessage.commentPolygon.timestamp;
        if (!commentsMapPolygon.has(commentTimestamp)) {
          commentsMapPolygon.set(commentTimestamp, []);
        }
        commentsMapPolygon.get(commentTimestamp).push({
          payer: payerId,
          text: String(parsedMessage.commentPolygon.text || '').slice(0, 300),
          created: parsedMessage.created
        });
      }

      // Collect replies (nested comments; parentId = the created timestamp
      // of the comment or reply being answered)
      if (parsedMessage.replyMarker && parsedMessage.replyMarker.parentId && payerId) {
        const parentId = parsedMessage.replyMarker.parentId;
        if (!repliesMapMarker.has(parentId)) {
          repliesMapMarker.set(parentId, []);
        }
        repliesMapMarker.get(parentId).push({
          payer: payerId,
          text: String(parsedMessage.replyMarker.text || '').slice(0, 300),
          created: parsedMessage.created
        });
      }
      if (parsedMessage.replyPolygon && parsedMessage.replyPolygon.parentId && payerId) {
        const parentId = parsedMessage.replyPolygon.parentId;
        if (!repliesMapPolygon.has(parentId)) {
          repliesMapPolygon.set(parentId, []);
        }
        repliesMapPolygon.get(parentId).push({
          payer: payerId,
          text: String(parsedMessage.replyPolygon.text || '').slice(0, 300),
          created: parsedMessage.created
        });
      }
    } catch (error) {
      console.error(`Error parsing message for likes/dislikes: ${error}`);
    }
  }
}
          

          const topicInfo = await getTopicInfo(topicId);
          const topicAdmin = [];
          let hasRulesForMarker = false;
          let hasRulesForPolygon = false;
          const memo = topicInfo.memo;

          // Split the memo by commas
          const parts = memo.split(',');

          // Iterate over each part
          parts.forEach(part => {
            // Check if the part starts with "0.0."
            if (part.startsWith("0.0.")) {
              // Add it to the topicAdmin array
              topicAdmin.push(part);
            }
          });



          // Check if messages exist and is an array
          if (!rawResult || !Array.isArray(rawResult)) {
            console.error(`No messages found for topic ${topicId}.`, rawResult);
            return { topicGeojsonFeatures, topicPolygons }; // Return empty arrays
          }

          const messages = rawResult; // Extract messages

          const loadedTopicRulesForMarker = [];
          const loadedTopicRulesForPolygon = [];



          // Read rules from messages
          for (let index = messages.length - 1; index >= 0; index--) {
            const message = messages[index];
            try {
              let parsedMessage = message;
              if (typeof message === 'string') {
                parsedMessage = JSON.parse(message);
              }

              if (parsedMessage.rules && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
                if (parsedMessage.rules.formarker.markerTopicId.startsWith('0.0.') && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
                loadedTopicRulesForMarker.push(parsedMessage.rules.formarker);
                hasRulesForMarker = true;

              }
              if (parsedMessage.rules.forpolygon.polygonTopicId.startsWith('0.0.') && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
                loadedTopicRulesForPolygon.push(parsedMessage.rules.forpolygon);
                hasRulesForPolygon = true;

              }
                break; // Exit the loop after finding the last message with rules
              }
            } catch (messageError) {
              console.error(`Error processing message ${index}:`, messageError);
            }
          }

          for (let index = messages.length - 1; index >= 0; index--) {
            const message = messages[index];
            try {
              let parsedMessage = message;
              if (typeof message === 'string') {
                parsedMessage = JSON.parse(message);
              }
              // Check if changeName exists and either topicAdmin is empty or includes the payer
              if (parsedMessage.changeName && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
                loadedTopicName = parsedMessage.changeName;
                break; // Stop after finding the first valid message
              }
            } catch (messageError) {
              console.error(`Error processing message ${index}:`, messageError);
            }
          }
          const uniquePayerIdsForMarker = new Set();
          const uniquePayerIdsForPolygon = new Set();

          // Extract payer IDs from messages
      for (const message of messages) {
        try {
          let parsedMessage = message;
          if (typeof message === 'string') {
            parsedMessage = JSON.parse(message);
          }

          // Add payer IDs for markers
          if (parsedMessage.marker && parsedMessage.marker.data) {
            uniquePayerIdsForMarker.add(parsedMessage.payer);
          }

          // Add payer IDs for polygons
          if (parsedMessage.polygon && parsedMessage.polygon.data) {
            uniquePayerIdsForPolygon.add(parsedMessage.payer);
          }

          if (parsedMessage.addTopicNFT && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
          const nfts = parsedMessage.addTopicNFT.split(',').map(nft => nft.trim());
          nfts.forEach(nft => {
            if (!loadedNFTsForModel.includes(nft)) {
              loadedNFTsForModel.push(nft);
            }
          });
          }

          if (parsedMessage.removeTopicNFT && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
            const nft = parsedMessage.removeTopicNFT.trim();
            const index = loadedNFTsForModel.indexOf(nft);
            if (index !== -1) {
              loadedNFTsForModel.splice(index, 1);
            }
          }

        if (parsedMessage.addScale && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
          const { NFT, scale } = parsedMessage.addScale;
          loadedNFTScaleForModel.push({ NFT, scale });
        }

        if (parsedMessage.removeScale && (topicAdmin.length === 0 || topicAdmin.includes(message.payer))) {
          const { NFT } = parsedMessage.removeScale;
          const index = loadedNFTScaleForModel.findIndex(item => item.NFT === NFT);
          if (index !== -1) {
            loadedNFTScaleForModel.splice(index, 1); // Remove the item if it exists
          } else {
            console.log(`NFT: ${NFT} not found in addScale list`);
          }
        }

        updateRulesForModelNFTState();

        } catch (error) {
          console.error("Error extracting payer ID:", error);
        }
      }

          // Ownership logic
          const markerOwnershipArray = [];
          const polygonOwnershipArray = [];


          if (hasRulesForMarker) {
            // Iterate over each unique payer ID for markers
            for (const payerId of uniquePayerIdsForMarker) {
              const tokenIdForMarker = loadedTopicRulesForMarker[0].markerTopicId;
              const filteredNftsForMarker = await getAccountNFTs(payerId, tokenIdForMarker);

              // Check if the user owns NFTs and push to an array
              if (filteredNftsForMarker.length > 0) {
                const numberOfMessages = filteredNftsForMarker.length * loadedTopicRulesForMarker[0].markerMessagesPerNft;
                const numberOfMarker = [];
                markerOwnershipArray.push({ payerId, numberOfMessages, numberOfMarker });
              }
            }
          }

          if (hasRulesForPolygon) {

            // Iterate over each unique payer ID for polygons
            for (const payerId of uniquePayerIdsForPolygon) {
              const tokenIdForPoly = loadedTopicRulesForPolygon[0].polygonTopicId;
              const filteredNftsForPoly = await getAccountNFTs(payerId, tokenIdForPoly);

              // Check if the user owns NFTs and push to an array
              if (filteredNftsForPoly.length > 0) {
                const numberOfMessages = filteredNftsForPoly.length * loadedTopicRulesForPolygon[0].polygonMessagesPerNft;
                const numberOfPolygon = [];
                polygonOwnershipArray.push({ payerId, numberOfMessages, numberOfPolygon });
              }
            }
          }

          if (!hasRulesForMarker) {
          for (const payerId of uniquePayerIdsForMarker) {
            const numberOfMarker = [];
            markerOwnershipArray.push({ payerId, numberOfMarker });
          }
        }
        if (!hasRulesForPolygon) {
          for (const payerId of uniquePayerIdsForPolygon) {
            const numberOfPolygon = [];
            polygonOwnershipArray.push({ payerId, numberOfPolygon });
          }
        }
          // Process each message
          for (let index = messages.length - 1; index >= 0; index--) {
            const message = messages[index];
            try {
              let parsedMessage = message;

              
              let decryptedMessage;


              if (typeof message === 'string') {
                parsedMessage = JSON.parse(message);
              }
              
              if (parsedMessage.ciphertext){
                decryptedMessage = await decryptMessage(parsedMessage, PrivateKey);
                parsedMessage = JSON.parse(decryptedMessage)
              }

              const timestamp = new Date(message.created)
              .toLocaleString('en-US', {
                hour12: false,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
              })


              const defaultProfilePic = "https://kiloscribe.com/api/inscription-cdn/0.0.4819119";
              const profileUrl = isValidUrl(message.payer && profilePictures[message.payer] ?
                profilePictures[message.payer].url :
                defaultProfilePic) ?
                (message.payer && profilePictures[message.payer] ? profilePictures[message.payer].url : defaultProfilePic) :
                defaultProfilePic;

              const payerInfo = message.payer ? `${message.payer}` : 'Anonymous';
              const username = message.payer && usernames[message.payer] ?
                ` ${usernames[message.payer].username}` :
                '';
              const click2link = message.payer && click2url[message.payer] ?
                ` ${click2url[message.payer].click2url}` :
                '';

              if (parsedMessage.marker && parsedMessage.marker.data) {
                const markernumber = parsedMessage.marker.data.numberOfMarker;
                const markerOwner = markerOwnershipArray.find(owner => owner.payerId === message.payer);
                
                if (parsedMessage.marker.data.deleteMarkerNumber) {
                  const deleteMarkerNumber = parsedMessage.marker.data.deleteMarkerNumber;
                  markerOwner.numberOfMarker.push(deleteMarkerNumber);
                }

                if (markernumber === undefined || markernumber === null || !Number.isInteger(Number(markernumber))) {
                  continue;
                }
                  
                if (!markerOwner.numberOfMarker.includes(markernumber)) {
                  markerOwner.numberOfMarker.push(markernumber);
                
                if (!hasRulesForMarker || (markerOwner && markerOwner.numberOfMessages > 0)) {

                  if (hasRulesForMarker) {
                    markerOwner.numberOfMessages -= 1;
                  }

                  let coords;
                  try {
                    const cordData = parsedMessage.marker.data.cord;

                    if (typeof cordData === 'string') {
                      coords = cordData.split(',').map(num => parseFloat(num.trim()));
                    } else if (Array.isArray(cordData)) {
                      coords = cordData;
                    } else {
                      throw new Error('Unsupported coordinate format');
                    }

                    if (!Array.isArray(coords) || coords.length !== 2 || coords.some(isNaN)) {
                      throw new Error('Invalid coordinate format');
                    }

                    // Use the final like and dislike counts from the maps
                    const likeCountMarker = likeCountMapMarker.get(timestamp) || 0;
                    const dislikeCountMarker = dislikeCountMapMarker.get(timestamp) || 0;

                    // Create marker popup HTML using DOM helper
                    const markerPopupHTML = createMarkerPopupHTML({
                      markernumber,
                      topicId,
                      loadedTopicName,
                      profileUrl,
                      payer: message.payer,
                      payerInfo,
                      username,
                      click2link,
                      title: parsedMessage.marker.data.title,
                      image: parsedMessage.marker.data.image,
                      msg: parsedMessage.marker.data.msg,
                      timestamp,
                      likeCountMarker,
                      dislikeCountMarker,
                      comments: (commentsMapMarker.get(timestamp) || []).map((c) => ({
                        ...c,
                        likeCount: likeCountMapMarker.get(c.created) || 0,
                        dislikeCount: dislikeCountMapMarker.get(c.created) || 0,
                        replies: buildReplyTree(c, repliesMapMarker, likeCountMapMarker, dislikeCountMapMarker)
                      })),
                      coords
                    });

                    if (message.ciphertext){

                    topicGeojsonFeatures.push({
                      topicId: topicId,
                      created: parsedMessage.created,
                      msgNumber: parsedMessage.marker.data.numberOfMarker,
                      type: "Feature",
                      payer: message.payer,
                      properties: {
                        message: markerPopupHTML,
                        imageUrl: isValidUrl(parsedMessage.marker.data.coverimage) ? parsedMessage.marker.data.coverimage : profileUrl
                      },
                      geometry: {
                        type: "Point",
                        coordinates: coords
                      }
                    });
                  }
                  } catch (coordError) {
                    console.error("Error parsing marker coordinates:", coordError, "Raw coords:", parsedMessage.marker.data.cord);
                  }
                }
              }
            }

              // Handle polygon type messages
              if (parsedMessage.polygon && parsedMessage.polygon.data) {
                const polygonOwner = polygonOwnershipArray.find(owner => owner.payerId === message.payer) ;
                const polygonnumber = parsedMessage.polygon.data.numberOfPolygon;
                
                if (parsedMessage.polygon.data.deletePolygonNumber) {
                  const deletePolygonNumber = parsedMessage.polygon.data.deletePolygonNumber;
                  polygonOwner.numberOfPolygon.push(deletePolygonNumber);
                }

                if (polygonnumber === undefined || polygonnumber === null || !Number.isInteger(Number(polygonnumber))) {
                  continue;
                }

                if (!polygonOwner.numberOfPolygon.includes(polygonnumber)) {
                  polygonOwner.numberOfPolygon.push(polygonnumber);


                if (!hasRulesForPolygon || (polygonOwner && polygonOwner.numberOfMessages > 0)) {
                  if (hasRulesForPolygon) {
                    polygonOwner.numberOfMessages -= 1;
                  }

                  try {
                    const cordStr = parsedMessage.polygon.data.cord;

                    // Validate the coordinate string format
                    const validCoordPattern = /^\[-?\d+\.?\d*,\s*-?\d+\.?\d*\](,\s*\[-?\d+\.?\d*,\s*-?\d+\.?\d*\])*$/;
                    if (!validCoordPattern.test(cordStr)) {
                      continue; // Skip processing this message
                    }

                    // Parse the coordinates
                    const coordinates = JSON.parse(`[${cordStr}]`); // Wrap in brackets for valid JSON

                    if (Array.isArray(coordinates) && coordinates.length > 2) {
                      const polygonSize = hasRulesForPolygon ? loadedTopicRulesForPolygon[0].polygonSize : 1;

                      const likeCountPolygon = likeCountMapPolygon.get(timestamp) || 0;
                      const dislikeCountPolygon = dislikeCountMapPolygon.get(timestamp) || 0;

                      // Create polygon popup HTML using DOM helper
                      const polygonPopupHTML = createPolygonPopupHTML({
                        polygonnumber,
                        topicId,
                        loadedTopicName,
                        profileUrl,
                        payer: message.payer,
                        payerInfo,
                        username,
                        click2link,
                        title: parsedMessage.polygon.data.title,
                        image: parsedMessage.polygon.data.image,
                        msg: parsedMessage.polygon.data.msg,
                        timestamp,
                        likeCountPolygon,
                        dislikeCountPolygon,
                        comments: (commentsMapPolygon.get(timestamp) || []).map((c) => ({
                          ...c,
                          likeCount: likeCountMapPolygon.get(c.created) || 0,
                          dislikeCount: dislikeCountMapPolygon.get(c.created) || 0,
                          replies: buildReplyTree(c, repliesMapPolygon, likeCountMapPolygon, dislikeCountMapPolygon)
                        })),
                        coordinates
                      });


                      if(message.ciphertext){

                      topicPolygons.push({
                        topicId: topicId,
                        created: parsedMessage.created,
                        msgNumber: parsedMessage.polygon.data.numberOfPolygon,
                        id: `polygon-${message.payer}-${topicId}-${parsedMessage.polygon.data.numberOfPolygon}`,
                        payer: message.payer,
                        coordinates: [coordinates],
                        description: polygonPopupHTML,
                        imageUrl: isValidUrl(parsedMessage.polygon.data.coverimage) ? parsedMessage.polygon.data.coverimage : profileUrl
                      });
                    }
                    }
                  } catch (polygonError) {
                    console.error("Error parsing polygon data:", polygonError);
                  }
                }
              }
            }
            } catch (messageError) {
              console.error(`Error processing message ${index}:`, messageError);
            }
          }


        // At the end of the function, push the collected features to the parent arrays
        geojson.features.push(...topicGeojsonFeatures); // Push topic features to parent geojson array
        polygons.push(...topicPolygons); // Push topic polygons to parent polygons array
        return { topicGeojsonFeatures, topicPolygons };


        } catch (error) {
          console.error(`Error loading messages for topic ${topicId}:`, error);
          return { topicGeojsonFeatures: [], topicPolygons: [] }; // Return empty arrays on error
        }
      }