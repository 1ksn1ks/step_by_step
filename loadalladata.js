import { getMessages } from "./hedera";

export let profilePictures = [];
export let usernames = [];
export let click2url = [];
export let topic2pic = [];

export async function loadAllData() {
   profilePictures = await loadProfilePicture();
   usernames       = await loadUsername();
   click2url       = await loadCLICK2URL();
   topic2pic       = await loadTOPIC2PIC();

  return { profilePictures, usernames, click2url, topic2pic };
}

loadAllData();

export async function loadProfilePicture() {
const topicId = "0.0.9609881";
const accountUrls = {}; // Dictionary to store account IDs and their URLs

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

    

    if (!rawResult || !Array.isArray(rawResult.messages)) {
      console.log("No profile pictures found, using defaults");
      return {};
    }

    rawResult.messages.forEach(message => {
      if (message.payer && message.data && message.data.urls && message.data.urls.length > 0) {
        accountUrls[message.payer] = {
        url: message.data.urls[0],
        timestamp: message.timestamp
        };
      }
    });

    return accountUrls;

    } catch (error) {
      console.log("Error in loadProfilePicture:", error);
      return {};
    }
}
  

export async function loadUsername() {
const topicId = "0.0.9609904";
const accountUsernames = {};

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


  

  // Check if rawResult exists and has messages
  if (!rawResult || !Array.isArray(rawResult.messages)) {
    console.log("No usernames found, using defaults");
    return {};
  }

  // Process all messages to build the accountUsernames dictionary
  rawResult.messages.forEach(message => {
    if (message.payer && message.data && message.data.username) {
      // Only store usernames with less than 20 characters
      if (message.data.username.length < 20) {
        accountUsernames[message.payer] = {
          username: message.data.username,
          timestamp: message.timestamp
        };
      }
    }
  });

  return accountUsernames;

} catch (error) {
  console.log("Error in loadUsername:", error);
  return {}; // Return empty object instead of throwing error
}
}

export async function loadCLICK2URL() {
const topicId = "0.0.9752486";
const accountCLICK2URL = {};

try {
  const rawResult = await getMessages(topicId);

  // Check if rawResult exists and has messages
  if (!rawResult || !Array.isArray(rawResult.messages)) {
    console.log("No CLICK2URL found, using defaults");
    return {};
  }

  // Process all messages to build the accountUsernames dictionary
  rawResult.messages.forEach(message => {
    if (message.payer && message.data && message.data.click2url && message.data.click2url.length > 0) {
      // Only store usernames with less than 20 characters
        accountCLICK2URL[message.payer] = {
          click2url: message.data.click2url[0],
          timestamp: message.timestamp
        };
      }
  });

  return accountCLICK2URL;

} catch (error) {
  console.log("Error in loadCLICK2URL:", error);
  return {}; // Return empty object instead of throwing error
}
}


export async function loadTOPIC2PIC() {
const topicId = "0.0.9759201";
const accountTOPIC2PIC = {}; // Dictionary to store account IDs and their topics2pic

try {
  const rawResult = await getMessages(topicId);

  // Check if rawResult exists and has messages
  if (!rawResult || !Array.isArray(rawResult.messages)) {
    console.log("No TOPIC2PIC found, using defaults");
    return {};
  }

  // Process all messages to build the accountTOPIC2PIC dictionary
  rawResult.messages.forEach(message => {
    if (message.payer && message.data && message.data.topic2pic) {
      // Only store topics2pic with less than 20 characters
      if (message.data.topic2pic.length < 20) {
        accountTOPIC2PIC[message.payer] = {
          topic2pic: message.data.topic2pic,
          timestamp: message.timestamp
        };
      }
    }
  });

  return accountTOPIC2PIC;

} catch (error) {
  console.log("Error in loadTOPIC2PIC:", error);
  return {}; // Return empty object instead of throwing error
}
}

