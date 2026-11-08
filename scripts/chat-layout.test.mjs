// Chat layout: day keys and labels, the short / full time. Minimal DOM stub.
import test from "node:test";
import assert from "node:assert/strict";

class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.className = "";
    this.textContent = "";
    this.dataset = {};
    this.attrs = {};
    this.title = "";
  }
  setAttribute(k, v) { this.attrs[k] = v; }
  appendChild(c) { this.children.push(c); return c; }
  replaceChildren(...kids) { this.children = kids; }
}
globalThis.document = { createElement: (tag) => new El(tag) };

const { chatDayKey, chatDayLabel, makeChatDay, fillChatTime } = await import("../chatlayout.js");

test("day keys are local calendar days", () => {
  assert.equal(chatDayKey(new Date(2026, 7, 20, 23, 59)), "2026-08-20");
  assert.equal(chatDayKey(new Date(2026, 7, 21, 0, 1)), "2026-08-21");
  assert.equal(chatDayKey(""), "");
  assert.equal(chatDayKey("not a date"), "");
});

test("day labels say Today, Yesterday, or the date", () => {
  const now = new Date(2026, 10, 8, 12, 0);
  assert.equal(chatDayLabel(new Date(2026, 10, 8, 1, 0), now), "Today");
  assert.equal(chatDayLabel(new Date(2026, 10, 7, 23, 0), now), "Yesterday");
  assert.equal(chatDayLabel(new Date(2026, 7, 20, 9, 0), now), "Aug 20");
  assert.equal(chatDayLabel(new Date(2025, 11, 31, 9, 0), now), "Dec 31, 2025");
  assert.equal(chatDayLabel(null, now), "");
});

test("a divider carries its day", () => {
  const el = makeChatDay(new Date(2026, 7, 20, 9, 0));
  assert.equal(el.className, "chat-day");
  assert.equal(el.dataset.day, "2026-08-20");
  assert.equal(el.attrs.role, "separator");
  assert.equal(el.children.length, 1);
});

test("the time shows short and keeps the full text", () => {
  const span = new El("span");
  fillChatTime(span, new Date(2026, 7, 20, 14, 3, 53), "08/20/2026, 14:03:53");
  assert.equal(span.children[0].className, "chat-time-short");
  assert.equal(span.children[0].textContent, "14:03");
  assert.equal(span.children[1].className, "chat-time-full");
  assert.equal(span.children[1].textContent, "08/20/2026, 14:03:53");
  assert.equal(span.title, "08/20/2026, 14:03:53");
  // No usable time: the short slot repeats the text it was given.
  const odd = new El("span");
  fillChatTime(odd, "", "Invalid Date");
  assert.equal(odd.children[0].textContent, "Invalid Date");
});
