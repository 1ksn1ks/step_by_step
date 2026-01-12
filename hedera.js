import {
  TopicMessageSubmitTransaction,
  TopicId,
  PrivateKey,
  TopicCreateTransaction,
  TopicUpdateTransaction,
  AccountId} from '@hashgraph/sdk';
import { signer, dAppConnector } from './web3';

export async function sendMessage(topicId, message) {
  
    const transaction = new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(topicId))
      .setMessage(message);
  
    try {
      const txResponse = await transaction.executeWithSigner(signer);
      const receipt = await txResponse.getReceiptWithSigner(signer);
  
      const txId = receipt.transactionId.toString();
  
      console.log (txId)
    } catch (err) {
      console.error(err);
    }
  }

export async function updateTopic(topicId , memo, adminKey, customFees) {


    if (!topicId) {
      throw new Error('Topic ID is required');
    }
    if (!adminKey) {
      throw new Error('Admin key is required for topic update');
    }
  
    if (!signer) {
      throw new Error('No signer found for the connected account');
    }
  
    let transaction = new TopicUpdateTransaction()
      .setTopicId(TopicId.fromString(topicId))
      .setTopicMemo(memo || '');
  
  
    let adminPrivateKey = PrivateKey || null;
    try {
      adminPrivateKey = PrivateKey.fromStringED25519(adminKey);
      transaction.setAdminKey(adminPrivateKey.publicKey);
    } catch (e) {
      throw new Error('Invalid admin key format: Admin key must be a valid private key for topic update');
    }

        if (customFees && customFees.length > 0) {
          const hederaCustomFees = customFees.map(fee => {
              if (!fee.denominatingTokenId || !fee.amount || !fee.collectorAccountId) {
                  throw new Error('Invalid custom fee: denominatingTokenId, amount, and collectorAccountId are required');
              }
              const feeAmount = parseFloat(fee.amount);
              if (isNaN(feeAmount) || feeAmount <= 0) {
                  throw new Error('Invalid amount: must be a positive number');
              }
              const customFee = new CustomFixedFee()
                  .setAmount(feeAmount)
                  .setFeeCollectorAccountId(fee.collectorAccountId)
                  .setDenominatingTokenId(fee.denominatingTokenId);
              return customFee;
          });
          transaction.setCustomFees(hederaCustomFees);
          this.logger.debug('Custom fixed fees set:', hederaCustomFees);
      }
  
    transaction = await transaction.freezeWithSigner(signer);
  
    if (adminPrivateKey) {
      transaction = await transaction.sign(adminPrivateKey);
      this.logger.debug('Transaction signed with admin private key');
    }
  
    await transaction.executeWithSigner(signer);
  
    return result.topicId.toString();
  }

export async function createTopic({memo:memo, adminkey:adminKey}) {
  console.log(memo)
  console.log(adminKey)
  console.log(signer)

  let transaction = new TopicCreateTransaction().setTopicMemo(memo);

  console.log(transaction)

  let adminPrivateKey

  if (adminKey) {
    adminPrivateKey = PrivateKey.fromString(adminKey);
    transaction.setAdminKey(adminPrivateKey.publicKey);
    transaction.setFeeScheduleKey(adminPrivateKey.publicKey);
  }

  transaction = await transaction.freezeWithSigner(signer);


  if (adminKey) {
    transaction = await transaction.sign(adminPrivateKey);
  }

  const txResponse = await transaction.executeWithSigner(signer);
  const receipt = await txResponse.getReceiptWithSigner(signer);
  return receipt.topicId.toString();
}


  async function fetchWithRetry(url, retries = 3, delay = 1000) {
    for (let i = 0; i <= retries; i++) {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response;
      } catch (err) {
        if (i === retries) throw err;
        console.warn(`Retry ${i + 1}/${retries} for ${url} failed: ${err.message}`);
        await new Promise(res => setTimeout(res, delay * Math.pow(2, i))); // exponential backoff
      }
    }
  }
  
  export async function getMessages(
    topicId,
  ) {

    const baseUrl = `https://mainnet.mirrornode.hedera.com`;
    
    let timestampQuery = '';
  
    let url = `${baseUrl}/api/v1/topics/${topicId}/messages?limit=100${timestampQuery}`;
    
    const allMessages = [];
  
    try {
      while (url) {
        const response = await fetchWithRetry(url);
        const data = await response.json();
  
        const messages = data.messages || [];
        let nextLink = data.links?.next || null;
  
        for (const msg of messages) {
          try {
            const decoded = Buffer.from(msg.message, 'base64').toString('utf-8');
            const parsedMessage = JSON.parse(decoded);
  
            allMessages.push({
              ...parsedMessage,
              payer: msg.payer_account_id,
              created: new Date(Number(msg.consensus_timestamp) * 1000),
              consensus_timestamp: msg.consensus_timestamp,
              sequence_number: msg.sequence_number,
            });
          } catch (parseError) {
            console.warn(`Skipping invalid message (sequence: ${msg.sequence_number}): ${parseError.message}`);
          }
        }
  
        if (nextLink) {
          url = `${baseUrl}${nextLink}`;
        } else {
          url = null;
        }
      }
  
      allMessages.sort((a, b) => a.sequence_number - b.sequence_number);
  
      return {
        messages: allMessages,
        error: '',
      };
    } catch (error) {
      console.error('Error fetching topic messages:', error);
      return {
        messages: [],
        error: error.message || error.toString(),
      };
    }
  }

  export async function generatePrivateAndPublicKey() {
    const privateKey = await PrivateKey.generateED25519Async();
    const publicKey = privateKey.publicKey;
    return {
      privateKey: privateKey.toString(),
      publicKey: publicKey.toString()
    };
  }

export async function getTopicInfo(topicId)
 {
      try {

      if (!topicId) {
        throw new Error('Topic ID is required');
      }
  
      const baseUrl = `https://mainnet.mirrornode.hedera.com`;
  
      const url = `${baseUrl}/api/v1/topics/${topicId}`;
  
      const response = await fetchWithRetry(url);
      if (!response.ok) {
        throw new Error(
          `Failed to make request to mirror node for topic info: ${response.status}`
        );
      }
  
      const data = await response.json();
      return data;
    } catch (error) {
        console.error('Error fetching topic messages:', error);

    }
  }

export async function getAccountNFTs(accountId, tokenId) 
{
    try {
      const tokenQuery = tokenId ? `&token.id=${tokenId}` : '';
      const url = `https://mainnet.mirrornode.hedera.com/api/v1/accounts/${accountId}/nfts?limit=200${tokenQuery}`;

      const request = await fetchWithRetry(url);
      if (!request.ok) {
        throw new Error(`Failed to fetch NFTs for account: ${request.status}`);
      }

      const response = await request.json();
      let nextLink = response.links?.next || null;
      let nfts = response.nfts || [];

      while (nextLink) {
        try {
          const nextRequest = await fetchWithRetry(
            `https://mainnet.mirrornode.hedera.com${nextLink}`
          );

          if (!nextRequest.ok) {
            throw new Error(
              `Failed to fetch next page of NFTs: ${nextRequest.status}`
            );
          }

          const nextResponse = (await nextRequest.json());
          nfts = [...nfts, ...(nextResponse?.nfts || [])];

          nextLink =
            nextResponse?.links?.next && nextLink !== nextResponse?.links?.next
              ? nextResponse.links.next
              : null;
        } catch (e) {
          break;
        }
      }

      return nfts.map((nft) => {
        try {
          nft.token_uri = Buffer.from(nft.metadata, 'base64').toString('ascii');
        } catch (e) {
        }
        return nft;
      });
    } catch (e) {
      return [];
    }
  }
