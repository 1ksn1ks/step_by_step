// Comment threads in the X / Instagram shape: a row for every comment and
// every reply (its avatar, then @username and the account id, a short time
// and "edited", the text, the media, and Reply · heart · replies · ⋯), a
// Top / Newest switch over the list, a "Comment deleted" placeholder where
// a removed comment still has replies, and the composer at the foot (your
// avatar, attach, the box, Send; the reply, edit and media chips; the
// character count).
//
// processallmessages.js buildCommentsSection mounts these in all three
// shells: the feed page, the landscape card and the popup card. DOM only:
// the app's own heart, reply count, avatar, media, upload and send come in
// as functions, so this file imports nothing from the popup code.

import { COMMENT_TEXT_MAX, commentImageValue, commentMediaShownUrl } from './commentops.js';
import { HCS_CHUNK_SIZE, formatHcsUsage, messageLimitLength } from './hcschunks.js';

export const COMMENT_SORTS = Object.freeze([['top', 'Top'], ['newest', 'Newest']]);
export const DEFAULT_COMMENT_SORT = 'newest';
export const COMMENT_DELETED_TEXT = 'Comment deleted';
export const COMMENT_PLACEHOLDER = 'Leave a comment...';
// The count shows from 80% of the cap.
export const COMMENT_COUNTER_FROM = Math.floor(COMMENT_TEXT_MAX * 0.8);

const LOCALE_TIME = {
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
};

function timeOf(iso) {
  const when = new Date(iso);
  return Number.isNaN(when.getTime()) ? null : when;
}

// The exact time, as the thread always wrote it: 11/24/2026, 21:36:10.
export function fullCommentTime(iso) {
  const when = timeOf(iso);
  return when ? when.toLocaleString('en-US', LOCALE_TIME) : '';
}

// How long ago, as X writes it: now, 5m, 2h, 3d, then a short date
// (Nov 3; Nov 3, 2025 in another year).
export function relativeCommentTime(iso, now = Date.now()) {
  const when = timeOf(iso);
  if (!when) return '';
  const seconds = Math.floor((now - when.getTime()) / 1000);
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const sameYear = when.getFullYear() === new Date(now).getFullYear();
  return when.toLocaleDateString('en-US', sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
}

// "n / 1000" from 80% of the cap, "" below it. length is the cap's own
// measure (hcschunks.js messageLimitLength: a newline counts 2).
export function commentCounterText(length) {
  const n = Math.max(0, Math.floor(Number(length) || 0));
  return n >= COMMENT_COUNTER_FROM ? `${n} / ${COMMENT_TEXT_MAX}` : '';
}

// The name line: "@username" then the account id, or the account id
// alone when there is no username (or it is the id itself), so a name
// never shows twice. A username written with its own "@" keeps one.
export function commentNameParts(payer, username) {
  const id = String(payer == null ? '' : payer).trim();
  let name = String(username == null ? '' : username).replace(/\s+/g, ' ').trim();
  if (name.startsWith('@')) name = name.slice(1).trim();
  if (!name || name === id) return { name: id, handle: '' };
  return { name: '@' + name, handle: id };
}

function make(doc, tag, className, text) {
  const el = doc.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

function button(doc, className, text) {
  const el = make(doc, 'button', className, text);
  el.type = 'button';
  return el;
}

function stop(event) {
  if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function icon(doc, parts, filled) {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', filled ? 'currentColor' : 'none');
  if (!filled) {
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
  }
  svg.setAttribute('aria-hidden', 'true');
  for (const [name, attrs] of parts) {
    const node = doc.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    svg.appendChild(node);
  }
  return svg;
}

const DOTS = [
  ['circle', { cx: '5', cy: '12', r: '1.6' }],
  ['circle', { cx: '12', cy: '12', r: '1.6' }],
  ['circle', { cx: '19', cy: '12', r: '1.6' }],
];
const REPLY = [
  ['path', { d: 'M9 17 4 12l5-5' }],
  ['path', { d: 'M20 18v-2a4 4 0 0 0-4-4H4' }],
];
// A picture frame: attach media.
export const ATTACH_ICON = [
  ['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2' }],
  ['circle', { cx: '9', cy: '9', r: '2' }],
  ['path', { d: 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21' }],
];

// ── Top / Newest ───────────────────────────────────────────────────────

// Two radio buttons; Newest is on. onChange(mode) after a change.
export function buildSortToggle({ value = DEFAULT_COMMENT_SORT, onChange, doc = globalThis.document } = {}) {
  const bar = make(doc, 'div', 'comments-sort');
  bar.setAttribute('role', 'radiogroup');
  bar.setAttribute('aria-label', 'Sort comments');
  let current = COMMENT_SORTS.some(([mode]) => mode === value) ? value : DEFAULT_COMMENT_SORT;
  const buttons = COMMENT_SORTS.map(([mode, label]) => {
    const btn = button(doc, 'comments-sort-btn', label);
    btn.setAttribute('role', 'radio');
    btn.dataset.sort = mode;
    return btn;
  });
  const paint = () => {
    for (const btn of buttons) {
      const on = btn.dataset.sort === current;
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
      btn.classList.toggle('is-on', on);
      btn.tabIndex = on ? 0 : -1;
    }
  };
  const choose = (mode, focus) => {
    const changed = mode !== current;
    current = mode;
    paint();
    if (focus) {
      const target = buttons.find((btn) => btn.dataset.sort === mode);
      if (target) target.focus();
    }
    if (changed && typeof onChange === 'function') onChange(mode);
  };
  buttons.forEach((btn, index) => {
    btn.addEventListener('click', (event) => {
      stop(event);
      choose(btn.dataset.sort, false);
    });
    btn.addEventListener('keydown', (event) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      if (!step) return;
      event.preventDefault();
      choose(buttons[(index + step + buttons.length) % buttons.length].dataset.sort, true);
    });
  });
  bar.append(...buttons);
  paint();
  bar.sortMode = () => current;
  // Set from outside (the view closed): paints, no onChange.
  bar.setSortMode = (mode) => {
    if (!COMMENT_SORTS.some(([known]) => known === mode)) return;
    current = mode;
    paint();
  };
  return bar;
}

// ── ⋯ on your own comment: Edit, Delete ────────────────────────────────
// postmenu.js's menu, for a comment: the same list (fixed to the screen,
// so no card clips it), the same open and close (a tap elsewhere, Escape,
// a scroll, the button again), the same roles and arrow keys. No Follow,
// Swap or Donate here.

let openMenu = null;
let menuGlobals = false;
let menuSeq = 0;

function installMenuGlobals(doc) {
  if (menuGlobals) return;
  menuGlobals = true;
  doc.addEventListener('pointerdown', (event) => {
    if (!openMenu || openMenu.containsEvent(event)) return;
    openMenu.close();
  }, true);
  doc.addEventListener('keydown', (event) => {
    if (!openMenu || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    openMenu.close({ focus: true });
  }, true);
  const view = doc.defaultView || globalThis.window;
  if (view && typeof view.addEventListener === 'function') {
    view.addEventListener('scroll', () => {
      if (!openMenu || openMenu.settling()) return;
      openMenu.close();
    }, true);
    view.addEventListener('resize', () => {
      if (openMenu) openMenu.place();
    });
  }
}

export function createCommentMenu({ onEdit, onDelete, doc = globalThis.document } = {}) {
  installMenuGlobals(doc);
  const id = 'comment-menu-' + (++menuSeq);
  const root = make(doc, 'div', 'comment-menu');
  const btn = button(doc, 'comment-action comment-menu-btn');
  btn.setAttribute('aria-label', 'More');
  btn.setAttribute('aria-haspopup', 'menu');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', id);
  btn.appendChild(icon(doc, DOTS, true));

  const pop = make(doc, 'div', 'post-menu-pop comment-menu-pop');
  pop.id = id;
  pop.dataset.style = 'glass';
  pop.setAttribute('role', 'menu');
  pop.setAttribute('aria-label', 'Comment');
  pop.hidden = true;
  const editItem = button(doc, 'post-menu-item comment-menu-edit', 'Edit');
  const deleteItem = button(doc, 'post-menu-item comment-menu-delete', 'Delete');
  for (const item of [editItem, deleteItem]) item.setAttribute('role', 'menuitem');
  pop.append(editItem, deleteItem);
  const home = make(doc, 'span');
  home.hidden = true;
  root.append(btn, pop, home);

  let openedAt = 0;
  const view = () => doc.defaultView || globalThis.window || {};

  function place() {
    const win = view();
    const anchor = btn.getBoundingClientRect();
    const padX = win.innerWidth * 0.02;
    const padY = win.innerHeight * 0.02;
    const gap = win.innerHeight * 0.006;
    const rect = pop.getBoundingClientRect();
    let left = anchor.right - rect.width;
    let top = anchor.bottom + gap;
    if (top + rect.height > win.innerHeight - padY) top = anchor.top - gap - rect.height;
    if (top < padY) top = padY;
    if (left < padX) left = padX;
    if (left + rect.width > win.innerWidth - padX) left = Math.max(padX, win.innerWidth - padX - rect.width);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }

  function close(options) {
    if (pop.hidden && openMenu !== panel) return;
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (pop.parentNode !== root) root.insertBefore(pop, home);
    if (openMenu === panel) openMenu = null;
    if (options && options.focus) btn.focus();
  }

  function open() {
    if (openMenu && openMenu !== panel) openMenu.close();
    pop.hidden = false;
    pop.style.visibility = 'hidden';
    doc.body.appendChild(pop);
    place();
    pop.style.visibility = '';
    btn.setAttribute('aria-expanded', 'true');
    openMenu = panel;
    openedAt = Date.now();
    editItem.focus({ preventScroll: true });
  }

  const panel = {
    containsEvent(event) {
      const target = event.target;
      return !!(target && (btn.contains(target) || pop.contains(target)));
    },
    close,
    place,
    settling: () => Date.now() - openedAt < 120,
  };

  btn.addEventListener('click', (event) => {
    event.preventDefault();
    stop(event);
    if (openMenu === panel) close();
    else open();
  });
  pop.addEventListener('keydown', (event) => {
    const items = [editItem, deleteItem];
    const index = items.indexOf(doc.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      items[(index + step + items.length) % items.length].focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0].focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1].focus();
    } else if (event.key === 'Tab') {
      close({ focus: true });
    }
  });
  const pick = (item, run) => {
    item.addEventListener('click', (event) => {
      event.preventDefault();
      stop(event);
      close();
      if (typeof run === 'function') run();
    });
  };
  pick(editItem, onEdit);
  pick(deleteItem, onDelete);
  root.closeMenu = close;
  return root;
}

// ── A row ──────────────────────────────────────────────────────────────

// opts:
//   me            the connected account ("" when none): ⋯ on its own rows
//   now           Date.now() for the short times
//   avatar(payer) the profile picture element
//   openProfile(payer, el)   the avatar's tap; watchFace(el, payer) its prefetch
//   username(payer)          the payer's username ("" for none)
//   usernameNode(text, payer)  the "@username" element (its link), optional
//   accountHref(payer)       where the account id links, optional
//   textStyle     the topic chat's text size and colour (cssText)
//   heart(node)   the mini heart (likes, with its count)
//   replyCount(node, count, onToggle, open)  the mini reply bubble
//   isOpen(node), onThread(node, open)  which reply threads stay open
//   media(image, box)  paints the media into box; false when nothing shows
//   onReply(node), onEdit(node, parent), onDelete(node, parent, row)
//   countAll(nodes)    every message in a tree
export function buildCommentRow(node, opts = {}, depth = 0, parent = null) {
  const doc = opts.doc || globalThis.document;
  const row = make(doc, 'div', 'comment-row');
  row.dataset.created = node.created || '';
  row.dataset.depth = String(depth);
  if (depth > 0) row.classList.add('is-reply');

  const main = make(doc, 'div', 'comment-main');
  const replies = Array.isArray(node.replies) ? node.replies : [];

  if (node.deleted) {
    // Only here because a reply is still shown: no name, text, media,
    // likes, Reply or ⋯. Its replies stay under it, open.
    row.classList.add('is-deleted');
    const stand = make(doc, 'span', 'comment-avatar is-stand-in');
    stand.setAttribute('aria-hidden', 'true');
    row.appendChild(stand);
    main.appendChild(make(doc, 'p', 'comment-deleted', COMMENT_DELETED_TEXT));
  } else {
    const face = button(doc, 'comment-avatar');
    face.setAttribute('aria-label', `Open ${node.payer}'s profile`);
    const pic = typeof opts.avatar === 'function' ? opts.avatar(node.payer) : null;
    if (pic) {
      pic.setAttribute('aria-hidden', 'true');
      face.appendChild(pic);
    }
    face.addEventListener('click', (event) => {
      stop(event);
      if (typeof opts.openProfile === 'function') opts.openProfile(node.payer, pic || face);
    });
    if (typeof opts.watchFace === 'function') opts.watchFace(pic || face, node.payer);
    row.appendChild(face);

    // @username then the account id, or the id alone. Then the time.
    const head = make(doc, 'div', 'comment-head');
    const parts = commentNameParts(node.payer, typeof opts.username === 'function' ? opts.username(node.payer) : '');
    const account = (text, className) => {
      const href = typeof opts.accountHref === 'function' ? opts.accountHref(node.payer) : '';
      const el = make(doc, href ? 'a' : 'span', className, text);
      if (href) {
        el.href = href;
        el.target = '_blank';
        el.rel = 'noopener noreferrer';
        el.addEventListener('click', stop);
      }
      return el;
    };
    if (parts.handle) {
      const name = typeof opts.usernameNode === 'function'
        ? opts.usernameNode(parts.name, node.payer)
        : make(doc, 'span', '', parts.name);
      name.classList.add('comment-name');
      head.append(name, account(parts.handle, 'comment-handle'));
    } else {
      head.appendChild(account(parts.name, 'comment-name'));
    }
    head.appendChild(make(doc, 'span', 'comment-dot', '·'));
    if (node.pending) {
      head.appendChild(make(doc, 'span', 'comment-time', 'Posting…'));
    } else {
      const time = make(doc, 'time', 'comment-time', relativeCommentTime(node.created, opts.now));
      const full = fullCommentTime(node.created);
      time.dateTime = node.created || '';
      if (full) {
        time.title = full;
        time.setAttribute('aria-label', full);
      }
      head.appendChild(time);
    }
    if (node.edited) {
      head.append(make(doc, 'span', 'comment-dot', '·'), make(doc, 'span', 'popup-edited-mark comment-edited', 'edited'));
    }
    main.appendChild(head);

    if (node.text) {
      const text = make(doc, 'div', 'comment-text', node.text);
      if (opts.textStyle) text.style.cssText = opts.textStyle;
      main.appendChild(text);
    }
    // Our own uploads, IPFS and Hashinals are drawn. Any other host's
    // address is a plain link, never an <img> or <video> it would load.
    if (node.image && commentMediaShownUrl(node.image)) {
      if (typeof opts.media === 'function') {
        const box = make(doc, 'div', 'comment-media');
        if (opts.media(node.image, box) !== false) main.appendChild(box);
      }
    } else if (node.image) {
      const address = commentImageValue(node.image);
      if (address) {
        const line = make(doc, 'div', 'comment-text comment-media-link');
        const web = /^https?:\/\//i.test(address);
        const anchor = make(doc, web ? 'a' : 'span', '', address);
        if (web) {
          anchor.href = address;
          anchor.target = '_blank';
          anchor.rel = 'noopener noreferrer nofollow';
          anchor.addEventListener('click', stop);
        }
        line.appendChild(anchor);
        main.appendChild(line);
      }
    }
  }

  // Reply · heart · replies · ⋯. A placeholder keeps only the replies count.
  const actions = make(doc, 'div', 'comment-actions');
  let thread = null;
  if (replies.length) {
    // Closed until its bubble opens it. A placeholder's stays open, and
    // so does one the reader opened before this repaint.
    thread = make(doc, 'div', 'comment-replies');
    thread.hidden = !(node.deleted || (typeof opts.isOpen === 'function' && opts.isOpen(node)));
  }
  if (!node.deleted && !node.pending) {
    const reply = button(doc, 'comment-action comment-reply-btn');
    reply.setAttribute('aria-label', 'Reply');
    reply.append(icon(doc, REPLY, false), make(doc, 'span', 'comment-action-label', 'Reply'));
    reply.addEventListener('click', (event) => {
      stop(event);
      if (typeof opts.onReply === 'function') opts.onReply(node);
    });
    actions.appendChild(reply);
    if (typeof opts.heart === 'function') actions.appendChild(opts.heart(node));
  }
  if (thread && typeof opts.replyCount === 'function') {
    const count = typeof opts.countAll === 'function' ? opts.countAll(replies) : replies.length;
    const bubble = opts.replyCount(node, count, (open) => {
      thread.hidden = !open;
      if (typeof opts.onThread === 'function') opts.onThread(node, open);
    }, !thread.hidden);
    if (bubble) actions.appendChild(bubble);
  }
  if (!node.deleted && !node.pending && opts.me && node.payer === opts.me) {
    actions.appendChild(createCommentMenu({
      doc,
      onEdit: () => opts.onEdit && opts.onEdit(node, parent),
      onDelete: () => opts.onDelete && opts.onDelete(node, parent, row),
    }));
  }
  if (actions.childNodes.length) main.appendChild(actions);

  if (thread) {
    for (const child of replies) thread.appendChild(buildCommentRow(child, opts, depth + 1, node));
    main.appendChild(thread);
  }
  row.appendChild(main);
  return row;
}

// The in-row confirm before a delete: a line in place of the actions.
// Resolves true for Delete, false for Cancel (or Escape).
export function confirmInRow(row, { doc = globalThis.document } = {}) {
  return new Promise((resolve) => {
    const main = row && row.querySelector ? row.querySelector('.comment-main') : null;
    const actions = main && main.querySelector('.comment-actions');
    if (!main) {
      resolve(false);
      return;
    }
    const bar = make(doc, 'div', 'comment-confirm');
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Delete this comment?');
    const label = make(doc, 'span', 'comment-confirm-text', 'Delete this comment?');
    const no = button(doc, 'comment-confirm-no', 'Cancel');
    const yes = button(doc, 'comment-confirm-yes', 'Delete');
    bar.append(label, no, yes);
    if (actions) {
      actions.hidden = true;
      actions.after(bar);
    } else {
      main.appendChild(bar);
    }
    const done = (answer) => {
      bar.remove();
      if (actions) actions.hidden = false;
      resolve(answer);
    };
    no.addEventListener('click', (event) => {
      stop(event);
      done(false);
      const menu = actions && actions.querySelector('.comment-menu-btn');
      if (menu) menu.focus();
    });
    yes.addEventListener('click', (event) => {
      stop(event);
      done(true);
    });
    bar.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      stop(event);
      done(false);
    });
    no.focus({ preventScroll: true });
  });
}

// ── Composer pieces ────────────────────────────────────────────────────

// The attach button and its file input. onPick(file) with one file. The
// input stays in the page, only out of sight (style.css
// .comments-attach-file), and the button's own click opens it, so the
// picker opens inside the same tap: an input with display none, or one
// opened after an await, is refused on some phones.
export function buildAttachButton({ accept, onPick, doc = globalThis.document } = {}) {
  const btn = button(doc, 'comments-attach');
  btn.setAttribute('aria-label', 'Add an image, GIF or video');
  btn.title = 'Add an image, GIF or video';
  btn.appendChild(icon(doc, ATTACH_ICON, false));
  const input = make(doc, 'input', 'comments-attach-file');
  input.type = 'file';
  input.accept = accept || '';
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  // A click that reaches the document closes panels (CloseALL).
  input.addEventListener('click', stop);
  btn.addEventListener('click', (event) => {
    stop(event);
    if (btn.disabled) return;
    input.click();
  });
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    input.value = '';
    if (file && typeof onPick === 'function') onPick(file);
  });
  return { button: btn, input };
}

// The pending media over the box: a small preview, what it is, and ✕.
// show({ url, kind, busy }) paints it (paint(url, thumb, kind)); hide()
// clears it.
export function buildMediaChip({ onRemove, paint, doc = globalThis.document } = {}) {
  const chip = make(doc, 'div', 'comments-media-chip');
  chip.hidden = true;
  const thumb = make(doc, 'div', 'comments-media-thumb');
  const label = make(doc, 'span', 'comments-media-label');
  const remove = button(doc, 'comments-media-remove', '✕');
  remove.setAttribute('aria-label', 'Remove the media');
  remove.addEventListener('click', (event) => {
    stop(event);
    if (typeof onRemove === 'function') onRemove();
  });
  chip.append(thumb, label, remove);
  const names = { still: 'Image', gif: 'GIF', video: 'Video' };
  return {
    el: chip,
    show({ url = '', kind = '', busy = false, name = '' } = {}) {
      chip.hidden = false;
      chip.classList.toggle('is-busy', !!busy);
      thumb.replaceChildren();
      thumb.hidden = !url;
      // Media the row would not draw (another host's) gets no preview.
      if (url && typeof paint === 'function' && paint(url, thumb, kind) === false) thumb.hidden = true;
      const what = names[kind] || 'Media';
      const busyWhat = kind === 'gif' ? what : what.toLowerCase();
      label.textContent = busy ? `Uploading ${busyWhat}…` : (name ? `${what} · ${name}` : `${what} attached`);
      remove.hidden = !!busy;
    },
    hide() {
      chip.hidden = true;
      chip.classList.remove('is-busy');
      thumb.replaceChildren();
      label.textContent = '';
    },
  };
}

// ── The composer ───────────────────────────────────────────────────────
// At the foot of every shell: the reply chip (↩ Replying to … ✕), the edit
// chip (Editing · Cancel), the media chip, then your avatar, attach, the
// box and Send (Save while editing), then "n / 1000" from 800 characters
// and the wallet-approvals line when the message needs more than one.
//
// opts:
//   input           the textarea (its maxLength and clip come with it)
//   accept          the file input's accept
//   avatar()        your picture element (the default one with no wallet)
//   reject(file)    the refusal before any upload, or ""
//   kindOf(file)    "still" | "gif" | "video", for the uploading label
//   kindOfUrl(url)  the same for media a comment already has (edit)
//   upload(file, anchor)  → { url, kind } (uploadmedia.js uploadCommentMedia);
//                   it shows its own error, so a rejection is quiet here
//   paintThumb(url, box, kind)  the chip's small preview
//   replyLabel(node)  the reply chip's text
//   bytes(state)    the outgoing JSON's size for that state, in bytes
//   send(state)     → true once the wallet sent it. state: { mode
//                   ("comment" | "reply" | "edit"), text, image (what the
//                   message carries), media (the send helpers' last
//                   argument: a URL; on an edit undefined keeps, "" clears),
//                   replyTo, edit: { node, parent } }
//   resize(input)   grows the box with its text
//   toast(message)  an error toast
// Send stays enabled with an empty box and no media, so the send helper
// can say "Comment is empty"; it is off only while media uploads or a
// message is going out. Media alone is a comment.
export function buildCommentComposer(opts = {}) {
  const doc = opts.doc || globalThis.document;
  const input = opts.input || make(doc, 'textarea');
  input.classList.add('comments-input');
  if (!input.placeholder) input.placeholder = COMMENT_PLACEHOLDER;
  input.setAttribute('aria-label', 'Comment');
  const resize = () => {
    if (typeof opts.resize === 'function') opts.resize(input);
  };
  const say = (message) => {
    if (message && typeof opts.toast === 'function') opts.toast(message);
  };

  const el = make(doc, 'div', 'comments-compose');

  const replyChip = make(doc, 'div', 'comments-chip comments-reply-chip');
  replyChip.hidden = true;
  const replyLabel = make(doc, 'span', 'comments-chip-label');
  const replyClose = button(doc, 'comments-chip-close', '✕');
  replyClose.setAttribute('aria-label', 'Stop replying');
  replyChip.append(replyLabel, replyClose);

  const editChip = make(doc, 'div', 'comments-chip comments-edit-chip');
  editChip.hidden = true;
  const editLabel = make(doc, 'span', 'comments-chip-label', 'Editing your comment');
  const editCancel = button(doc, 'comments-chip-cancel', 'Cancel');
  editChip.append(editLabel, editCancel);

  const chip = buildMediaChip({
    doc,
    paint: opts.paintThumb,
    onRemove: () => {
      if (uploading) return;
      media = null;
      showMedia();
      paint();
    },
  });

  const row = make(doc, 'div', 'comments-input-row');
  const me = make(doc, 'span', 'comments-me');
  me.setAttribute('aria-hidden', 'true');
  const attach = buildAttachButton({ doc, accept: opts.accept, onPick: (file) => pick(file) });
  const send = button(doc, 'comments-send', 'Send');
  row.append(me, attach.button, input, send);

  const meta = make(doc, 'div', 'comments-compose-meta');
  meta.hidden = true;
  // The chats' byte counter colours (style.css .hcs-byte-counter).
  const usage = make(doc, 'span', 'comments-usage hcs-byte-counter');
  usage.hidden = true;
  const counter = make(doc, 'span', 'comments-counter');
  counter.hidden = true;
  counter.setAttribute('aria-live', 'polite');
  meta.append(usage, counter);

  el.append(replyChip, editChip, chip.el, row, meta, attach.input);

  let replyTo = null;
  let editing = null;
  let draft = null;
  let media = null;
  let uploading = false;
  let sending = false;
  let uploadSeq = 0;

  const mediaUrl = () => (media && media.url) || '';

  function mode() {
    if (editing) return 'edit';
    return replyTo ? 'reply' : 'comment';
  }

  // What Send would send now.
  function state() {
    const now = mediaUrl();
    let image = now;
    let arg = now || undefined;
    if (editing) {
      // Untouched media is kept (undefined); "" clears; a URL replaces.
      arg = now === editing.original ? undefined : now;
      image = arg;
    }
    return {
      mode: mode(),
      text: input.value,
      image,
      media: arg,
      replyTo,
      edit: editing ? { node: editing.node, parent: editing.parent } : null,
    };
  }

  function showMedia() {
    if (media && media.url) chip.show({ url: media.url, kind: media.kind });
    else chip.hide();
  }

  function paint() {
    const text = String(input.value || '');
    const length = messageLimitLength(text);
    const count = commentCounterText(length);
    counter.textContent = count;
    counter.hidden = !count;
    counter.classList.toggle('is-max', length >= COMMENT_TEXT_MAX);
    const bytes = typeof opts.bytes === 'function' ? Number(opts.bytes(state())) || 0 : 0;
    const many = bytes > HCS_CHUNK_SIZE;
    if (many) {
      const line = formatHcsUsage(bytes);
      usage.textContent = line.text;
      usage.classList.toggle('hcs-warn', line.warn);
      usage.classList.toggle('hcs-over', line.over);
    } else {
      usage.textContent = '';
    }
    usage.hidden = !many;
    meta.hidden = !count && !many;
    const empty = !text.trim() && !mediaUrl();
    send.disabled = uploading || sending;
    send.classList.toggle('is-empty', empty);
    send.classList.toggle('is-busy', sending);
    send.textContent = editing ? 'Save' : 'Send';
    send.setAttribute('aria-label', editing ? 'Save the edit' : 'Send');
    attach.button.disabled = uploading || sending;
    el.classList.toggle('is-editing', !!editing);
    el.classList.toggle('is-uploading', uploading);
  }

  function focus() {
    try {
      input.focus({ preventScroll: true });
    } catch {
      input.focus();
    }
  }

  function setText(value) {
    input.value = value || '';
    resize();
  }

  function stopReply() {
    replyTo = null;
    replyChip.hidden = true;
    replyLabel.textContent = '';
  }

  function reply(node) {
    if (!node) return;
    if (editing) leaveEdit();
    replyTo = node;
    replyLabel.textContent = typeof opts.replyLabel === 'function'
      ? opts.replyLabel(node)
      : `↩ Replying to ${node.payer}`;
    replyChip.hidden = false;
    paint();
    focus();
  }

  // The comment's text and media go into the box. Whatever was being
  // written is kept and comes back after Save or Cancel.
  function edit(node, parent) {
    if (!node) return false;
    if (uploading) {
      say('Wait for the upload to finish');
      return false;
    }
    if (!editing) draft = { text: input.value, media, replyTo };
    stopReply();
    const original = String(node.image || '');
    editing = { node, parent: parent || null, original };
    setText(node.text || '');
    media = original
      ? { url: original, kind: typeof opts.kindOfUrl === 'function' ? opts.kindOfUrl(original) : '' }
      : null;
    showMedia();
    editChip.hidden = false;
    paint();
    focus();
    return true;
  }

  // Out of edit mode, back to what was being written before it.
  function leaveEdit() {
    const back = draft;
    editing = null;
    draft = null;
    editChip.hidden = true;
    setText(back ? back.text : '');
    media = back ? back.media : null;
    showMedia();
    if (back && back.replyTo) reply(back.replyTo);
    else stopReply();
    paint();
  }

  // After a send: the box, the media and the reply chip clear. After a
  // save, the draft from before the edit comes back.
  function finish() {
    if (editing) {
      leaveEdit();
      return;
    }
    stopReply();
    media = null;
    showMedia();
    setText('');
    paint();
  }

  async function submit() {
    if (sending || uploading) return false;
    const now = state();
    sending = true;
    paint();
    let ok = false;
    try {
      ok = typeof opts.send === 'function' ? !!(await opts.send(now)) : false;
    } catch {
      ok = false;
    } finally {
      sending = false;
    }
    if (ok) finish();
    else paint();
    return ok;
  }

  async function pick(file) {
    if (!file || uploading || sending) return;
    const reason = typeof opts.reject === 'function' ? opts.reject(file) : '';
    if (reason) {
      say(reason);
      return;
    }
    const kind = typeof opts.kindOf === 'function' ? opts.kindOf(file) : '';
    const before = media;
    const seq = ++uploadSeq;
    uploading = true;
    chip.show({ kind, busy: true });
    paint();
    try {
      const got = typeof opts.upload === 'function' ? await opts.upload(file, attach.button) : null;
      if (seq !== uploadSeq) return;
      const url = got && typeof got.url === 'string' ? got.url : '';
      media = url ? { url, kind: (got && got.kind) || kind } : before;
    } catch {
      if (seq !== uploadSeq) return;
      media = before;
    } finally {
      if (seq === uploadSeq) {
        uploading = false;
        showMedia();
        paint();
      }
    }
  }

  // A comment that is gone (deleted) is no longer edited or replied to.
  function forget(created) {
    if (!created) return;
    if (editing && editing.node && editing.node.created === created) leaveEdit();
    if (replyTo && replyTo.created === created) {
      stopReply();
      paint();
    }
  }

  function refresh() {
    const face = typeof opts.avatar === 'function' ? opts.avatar() : null;
    me.replaceChildren();
    if (face) me.appendChild(face);
    paint();
  }

  replyClose.addEventListener('click', (event) => {
    stop(event);
    stopReply();
    paint();
  });
  editCancel.addEventListener('click', (event) => {
    stop(event);
    leaveEdit();
  });
  send.addEventListener('click', (event) => {
    stop(event);
    submit();
  });
  input.addEventListener('input', () => paint());

  refresh();

  return {
    el,
    input,
    send,
    attach: attach.button,
    file: attach.input,
    reply,
    edit,
    cancelEdit: leaveEdit,
    forget,
    refresh,
    paint,
    submit,
    pick,
    state,
    get editing() { return !!editing; },
    get uploading() { return uploading; },
  };
}
