import { loadedDomains } from "./loaddomains";
import { handleAllMessages } from './handleallmessages.js'
import { getAccountNFTs } from "./hedera";
import { someFunction } from "./P2PModel.js";
import { initialTopicId } from "./extracttopic.js";

let BetaNFTScaleFactor = 1;
let scaleForModel = 1;
let finalScaleForModel = 1;

export let hasRulesForModelNFT = false;
export let loadedNFTsForModel = [];
export let loadedNFTScaleForModel = [];

loadedNFTScaleForModel.sort((a, b) => b.scale - a.scale);

export function updateRulesForModelNFTState() {
  if (loadedNFTsForModel.length > 0) {
    hasRulesForModelNFT = true;
  } else {
    hasRulesForModelNFT = false;
  }
}

export async function confirmNFTFunction(accountId) {
  let tokenIdForModel = "0.0.9605689";
  let tokenIDForBeta = "0.0.9606654";
  let userInput = document.getElementById("input-field").value.toLowerCase();
  let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
  let topicId;

  if (domainEntry && domainEntry.lastMessage) {
    topicId = domainEntry.lastMessage.topic;
  } else {
    topicId = userInput || initialTopicId;
  }
  await handleAllMessages();

  loadedNFTsForModel.length = 0;
  hasRulesForModelNFT = false;


  const NFTForModel = await getAccountNFTs(accountId, tokenIdForModel);
  const NFTForBeta = await getAccountNFTs(accountId, tokenIDForBeta);

  if (NFTForBeta.length > 0) {
    BetaNFTScaleFactor = 1.5;
    finalScaleForModel = BetaNFTScaleFactor*scaleForModel;
  } else {
    BetaNFTScaleFactor = 1;
  }



  if (loadedNFTScaleForModel.length > 0) {
    for (const item of loadedNFTScaleForModel) {
      const checkIfUserHasNFT = await getAccountNFTs(accountId, item.NFT);
      if (checkIfUserHasNFT.length > 0) {
        scaleForModel = item.scale;
        finalScaleForModel = BetaNFTScaleFactor*scaleForModel;
        break;
      }
      else {
        scaleForModel = 1;
      }
    }
  }


  if (NFTForModel.length > 0) {
    try {
      if (hasRulesForModelNFT === true) {
        for (const nft of loadedNFTsForModel) {
          const checkIfUserHasNFT = await getAccountNFTs(accountId, nft);
          if (checkIfUserHasNFT.length > 0) {
            await someFunction(accountId, topicId);
            return true;
          }
        }
        return false;
      }

      if (hasRulesForModelNFT === false) {
        await someFunction(accountId, topicId);
      }

    } catch (error) {
    }
  } else {
    return false;
  }
}

