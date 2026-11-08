// chathead.js — on the chat pages (topic chat and E2EE chat in the feed
// shell), the rows above the messages (the E2EE password, the topic and
// Load, and search while it is open) slide away as you scroll up into
// older messages and come back as you scroll down; at the newest message
// they are fully shown. It is the chat side of the feed's All / Following
// row (newest at the bottom here, at the top there). The message list
// runs under the rows, padded by their height (style.css), so it never
// resizes while they move. The rows stay put while search is open or a
// field in them has focus.

const PANELS = [
  ['topic-chat-container', 'messages-from-topic-chat'],
  ['encrypted-chat-container', 'messages-from-encrypted-chat'],
];
const ROWS = ':scope > :is(#encrypted-chat-private-key-container, .feed-chat-room, .loaded-topics-controls)';

function setup(panelId, listId) {
  const panel = document.getElementById(panelId);
  const list = document.getElementById(listId);
  const box = list && list.closest('.chat-topic-chat-container');
  const wrap = list && list.closest('.chat-messages-wrap');
  if (!panel || !list || !box || !wrap) return;
  const state = { panel, list, box, wrap, h: 0, y: 0, last: list.scrollTop, frame: 0, measureFrame: 0 };

  const shellOn = () => panel.classList.contains('is-feed-shell');

  const write = (y) => {
    const next = state.h > 0 ? Math.max(-state.h, Math.min(0, y)) : 0;
    if (next === state.y && box.style.getPropertyValue('--chat-head-y')) return;
    state.y = next;
    box.style.setProperty('--chat-head-y', next.toFixed(1) + 'px');
    box.classList.toggle('is-head-hidden', state.h > 0 && next <= -state.h + 0.5);
  };

  // Kept in view: search open, typing in one of the rows, or the newest
  // message reached.
  const held = () => {
    if (panel.classList.contains('is-search')) return true;
    const active = document.activeElement;
    if (active && active !== document.body && box.contains(active) && !wrap.contains(active)) {
      for (const row of box.querySelectorAll(ROWS)) if (row.contains(active)) return true;
    }
    return false;
  };

  // The rows' height is where the message box would start without the
  // pull-up: its offset now plus the pull-up applied.
  const measure = () => {
    state.measureFrame = 0;
    if (!shellOn()) {
      state.h = 0;
      box.style.setProperty('--chat-head-h', '0px');
      write(0);
      return;
    }
    const h = Math.max(0, wrap.offsetTop + state.h);
    if (Math.abs(h - state.h) > 0.5) {
      state.h = h;
      box.style.setProperty('--chat-head-h', h.toFixed(1) + 'px');
    }
    write(held() ? 0 : state.y);
  };
  const queueMeasure = () => {
    if (!state.measureFrame) state.measureFrame = requestAnimationFrame(measure);
  };

  const follow = () => {
    state.frame = 0;
    const top = list.scrollTop;
    const delta = top - state.last;
    state.last = top;
    if (!shellOn() || state.h <= 0) return;
    const atNewest = list.scrollHeight - list.clientHeight - top < 2;
    if (atNewest || held()) {
      write(0);
      return;
    }
    // Up into older messages (delta < 0) slides the rows away.
    write(state.y + delta);
  };
  list.addEventListener('scroll', () => {
    if (!state.frame) state.frame = requestAnimationFrame(follow);
  }, { passive: true });

  // Rows come and go (lock, search, the page opening): measure again.
  if (typeof ResizeObserver === 'function') {
    const sizes = new ResizeObserver(queueMeasure);
    sizes.observe(box);
    sizes.observe(wrap);
  }
  new MutationObserver(queueMeasure).observe(panel, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(queueMeasure).observe(box, { childList: true });
  box.addEventListener('focusin', () => { if (held()) write(0); });
  queueMeasure();
}

for (const [panelId, listId] of PANELS) setup(panelId, listId);
