// Reads which topics the feed shows for an open topic: the shared stack rule
// (loadcurrenttopic.js topicsToLoad: the open topic first, then at most
// STACK_MAX stacked topics, newest adds first, one level deep). Both reads
// go through the app's shared layers: getTopicData keeps the session cache,
// the saved copy on the phone and in-flight sharing, so the map's own load
// of the same topic is reused, not fetched twice.
import { getTopicInfo } from './hedera';
import { cachedLatestTs, getTopicData } from './topicdata';
import { adminsFromMemo, feedTopics } from './loadcurrenttopic.js';
import { isStale } from './timefilter.js';

// With a time range, a stacked topic whose newest message (as this device
// already knows it) is older than the range is left out: "Today" on a year
// topic reads the current month. A topic this device never read is kept;
// its range read is one short request. The open topic always stays.
export async function readFeedTopics(topicId, { range = null } = {}) {
  try {
    const [info, data] = await Promise.all([getTopicInfo(topicId), getTopicData(topicId)]);
    // Without the memo the admin rule cannot be checked, so no stack counts.
    if (!info) return [topicId];
    const topics = feedTopics(topicId, data && data.messages, adminsFromMemo(info.memo));
    if (!range) return topics;
    const latest = await Promise.all(topics.map((topic) => (topic === topicId ? '' : cachedLatestTs(topic))));
    return topics.filter((topic, i) => topic === topicId || !isStale(latest[i], range));
  } catch (error) {
    console.warn('feed stack read failed', error);
    return [topicId];
  }
}
