// Reads which topics the feed shows for an open topic (loadcurrenttopic.js
// feedTopics, the map's stack rule). Both reads go through the app's
// shared layers: getTopicData keeps the session cache, the saved copy on
// the phone and in-flight sharing, so the map's own load of the same
// topic is reused, not fetched twice.
import { getTopicInfo } from './hedera';
import { getTopicData } from './topicdata';
import { adminsFromMemo, feedTopics } from './loadcurrenttopic.js';

export async function readFeedTopics(topicId) {
  try {
    const [info, data] = await Promise.all([getTopicInfo(topicId), getTopicData(topicId)]);
    // Without the memo the admin rule cannot be checked, so no stack counts.
    if (!info) return [topicId];
    return feedTopics(topicId, data && data.messages, adminsFromMemo(info.memo));
  } catch (error) {
    console.warn('feed stack read failed', error);
    return [topicId];
  }
}
