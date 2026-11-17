// Reads which topics the feed shows for an open topic (loadcurrenttopic.js
// feedTopics, the map's stack rule). Both reads go through the app's
// shared layers: getTopicData keeps the session cache, the saved copy on
// the phone and in-flight sharing, so the map's own load of the same
// topic is reused, not fetched twice.
import { getTopicInfo } from './hedera';
import { getTopicData } from './topicdata';
import { adminsFromMemo, feedTopics } from './loadcurrenttopic.js';
import { FEED_TOPIC_MAX, capTopics } from './feedmerge.js';

// The feed reads at most FEED_TOPIC_MAX topics, the open one first; a
// longer stack keeps its first ones, in stack order. The map is not capped.
export async function readFeedTopics(topicId) {
  try {
    const [info, data] = await Promise.all([getTopicInfo(topicId), getTopicData(topicId)]);
    // Without the memo the admin rule cannot be checked, so no stack counts.
    if (!info) return [topicId];
    const all = feedTopics(topicId, data && data.messages, adminsFromMemo(info.memo));
    const topics = capTopics(all, topicId, FEED_TOPIC_MAX);
    if (topics.length < all.length) {
      console.info(`feed reads ${topics.length} of ${all.length} stacked topics`);
    }
    return topics;
  } catch (error) {
    console.warn('feed stack read failed', error);
    return [topicId];
  }
}
