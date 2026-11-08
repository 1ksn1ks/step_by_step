// chatlayout.js — the look shared by topic chat and E2EE chat messages
// (topicchat.js, encryptedtopicchat.js; style.css "Chat messages").
//   Day dividers: "Today", "Yesterday", "Aug 20" between days, and a new
//                 run of bubbles after each one.
//   Times:        a short time (14:53) under the last bubble of a run; a
//                 tap on any bubble shows its full date and time.
//   Pending:      a faded bubble with a small clock, until it is sent.

const pad = (n) => String(n).padStart(2, '0');

function asDate(created) {
  if (created == null || created === '') return null;
  const d = created instanceof Date ? created : new Date(created);
  return Number.isNaN(d.getTime()) ? null : d;
}

// "2026-08-20" in local time; '' for a message without a time.
export function chatDayKey(created) {
  const d = asDate(created);
  return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '';
}

export function chatDayLabel(created, now = new Date()) {
  const d = asDate(created);
  if (!d) return '';
  const key = chatDayKey(d);
  if (key === chatDayKey(now)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (key === chatDayKey(yesterday)) return 'Yesterday';
  const opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-US', opts);
}

export function makeChatDay(created) {
  const el = document.createElement('div');
  el.className = 'chat-day';
  el.setAttribute('role', 'separator');
  el.dataset.day = chatDayKey(created);
  const label = document.createElement('span');
  label.textContent = chatDayLabel(created);
  el.appendChild(label);
  return el;
}

// The time under a bubble: the short time shows, the full one (the text
// the chats always wrote) shows when the bubble is tapped. An "edited"
// mark is appended after both by the chat code.
export function fillChatTime(span, created, fullText) {
  const d = asDate(created);
  const full = String(fullText == null ? '' : fullText);
  const shortEl = document.createElement('span');
  shortEl.className = 'chat-time-short';
  shortEl.textContent = d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : full;
  const fullEl = document.createElement('span');
  fullEl.className = 'chat-time-full';
  fullEl.textContent = full;
  span.replaceChildren(shortEl, fullEl);
  if (full) span.title = full;
}

export function markChatPending(wrapper, pending) {
  if (wrapper) wrapper.classList.toggle('is-pending', !!pending);
}

// A tap on a bubble (not on a link, button, picture or video in it, and
// not the end of a text selection) shows or hides its full time and, on
// your own bubbles, the edit control.
const bound = new WeakSet();
export function bindChatTimeTap(container) {
  if (!container || bound.has(container)) return;
  bound.add(container);
  container.addEventListener('click', (event) => {
    const target = event.target;
    if (!target || !target.closest) return;
    const bubble = target.closest('.chat-msg-text');
    if (!bubble || !container.contains(bubble)) return;
    if (target.closest('a, button, img, video, canvas, .chat-sealed, .post-hashtag')) return;
    const selection = window.getSelection ? window.getSelection() : null;
    if (selection && !selection.isCollapsed && bubble.contains(selection.anchorNode)) return;
    const wrapper = bubble.parentElement;
    if (wrapper) wrapper.classList.toggle('is-time-open');
  });
}

// Day dividers sit between runs in time order. Searching or sorting by
// name moves and hides runs, so the dividers step aside meanwhile.
export function markChatSorted(container, sorted) {
  if (container) container.classList.toggle('is-chat-sorted', !!sorted);
}
