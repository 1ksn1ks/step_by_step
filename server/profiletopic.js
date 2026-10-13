// The topic linked to an account lives on the bio topic, beside topic_bio.
// Connect and remove are different messages. An old topic2pic message is
// still read so a link saved before this split is not dropped.
const TOPIC_ID = /^\d+\.\d+\.\d+$/;

export function profileTopicAction(data) {
  if (!data || typeof data !== "object") return null;
  if (Object.prototype.hasOwnProperty.call(data, "clearProfileTopic")) {
    return { action: "clear" };
  }
  if (Object.prototype.hasOwnProperty.call(data, "profileTopic")) {
    const topic = typeof data.profileTopic === "string" ? data.profileTopic.trim() : "";
    if (TOPIC_ID.test(topic)) return { action: "set", topic };
    if (!topic) return { action: "clear" };
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(data, "topic2pic")) {
    const raw = Array.isArray(data.topic2pic) ? data.topic2pic[0] : data.topic2pic;
    const topic = typeof raw === "string" ? raw.trim() : "";
    if (TOPIC_ID.test(topic)) return { action: "set", topic };
    if (!topic) return { action: "clear" };
  }
  return null;
}
