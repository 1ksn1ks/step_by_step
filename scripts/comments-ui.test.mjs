// The comment rows, the Top / Newest switch and the composer
// (commentsui.js) that processallmessages.js buildCommentsSection mounts
// in all three comment shells: the feed page, the landscape card and the
// popup card.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

// Just enough DOM for commentsui.js.
class ClassList {
  constructor(el) { this.el = el; }
  get list() { return String(this.el.className || "").split(/\s+/).filter(Boolean); }
  contains(name) { return this.list.includes(name); }
  add(...names) {
    const next = this.list;
    for (const name of names) if (!next.includes(name)) next.push(name);
    this.el.className = next.join(" ");
  }
  remove(...names) { this.el.className = this.list.filter((name) => !names.includes(name)).join(" "); }
  toggle(name, force) {
    const on = force === undefined ? !this.contains(name) : !!force;
    if (on) this.add(name);
    else this.remove(name);
    return on;
  }
}

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attrs = {};
    this.dataset = {};
    this.style = { cssText: "" };
    this.className = "";
    this.classList = new ClassList(this);
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.text = "";
    this.listeners = {};
  }
  set textContent(value) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this.text = value == null ? "" : String(value);
  }
  get textContent() {
    return this.text + this.children.map((child) => child.textContent).join("");
  }
  get childNodes() { return this.children; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; }
  removeAttribute(name) { delete this.attrs[name]; }
  appendChild(node) {
    if (node.parentNode) node.remove();
    this.children.push(node);
    node.parentNode = this;
    return node;
  }
  append(...nodes) { for (const node of nodes) this.appendChild(node); }
  insertBefore(node, ref) {
    if (node.parentNode) node.remove();
    const at = ref ? this.children.indexOf(ref) : -1;
    if (at < 0) this.children.push(node);
    else this.children.splice(at, 0, node);
    node.parentNode = this;
    return node;
  }
  replaceChildren(...nodes) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this.text = "";
    this.append(...nodes);
  }
  remove() {
    const parent = this.parentNode;
    if (!parent) return;
    parent.children = parent.children.filter((child) => child !== this);
    this.parentNode = null;
  }
  after(node) {
    const parent = this.parentNode;
    const at = parent.children.indexOf(this);
    if (node.parentNode) node.remove();
    parent.children.splice(at + 1, 0, node);
    node.parentNode = parent;
  }
  contains(node) {
    for (let at = node; at; at = at.parentNode) if (at === this) return true;
    return false;
  }
  matches(selector) {
    if (selector.startsWith(".")) return selector.slice(1).split(".").every((name) => this.classList.contains(name));
    return this.tagName === selector.toUpperCase();
  }
  querySelectorAll(selector) {
    const out = [];
    const walk = (el) => {
      for (const child of el.children) {
        if (child.matches(selector)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatch(type, extra = {}) {
    const event = { type, target: this, stopPropagation() {}, preventDefault() {}, ...extra };
    for (const fn of this.listeners[type] || []) fn(event);
    return event;
  }
  click() {
    if (this.disabled) return;
    this.dispatch("click");
  }
  focus() { doc.activeElement = this; }
  getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
}

const view = { innerWidth: 390, innerHeight: 844, addEventListener() {} };
const doc = {
  activeElement: null,
  body: new El("body"),
  defaultView: view,
  createElement: (tag) => new El(tag),
  createElementNS: (ns, tag) => Object.assign(new El(tag), { ns }),
  addEventListener() {},
};
globalThis.document = doc;

const ui = await import("../commentsui.js");
const { COMMENT_TEXT_MAX, filterCommentTree, sortCommentTree } = await import("../commentops.js");
const {
  DEFAULT_COMMENT_SORT,
  buildCommentComposer,
  buildCommentRow,
  buildSortToggle,
  commentCounterText,
  commentNameParts,
  confirmInRow,
  relativeCommentTime,
} = ui;

const find = (root, selector) => root.querySelector(selector);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const me = "0.0.7";
const other = "0.0.9";
const t = (minute) => `2026-11-24T10:${String(minute).padStart(2, "0")}:00.000Z`;
const comment = (fields) => ({
  created: t(1),
  payer: other,
  text: "hello",
  image: "",
  likeCount: 0,
  edited: false,
  deleted: false,
  replies: [],
  ...fields,
});

test("the switch starts at Newest, and Top re-sorts the same tree by likes", () => {
  assert.equal(DEFAULT_COMMENT_SORT, "newest");
  const changes = [];
  const bar = buildSortToggle({ onChange: (mode) => changes.push(mode) });
  const [top, newest] = bar.children;
  assert.equal(top.textContent, "Top");
  assert.equal(newest.textContent, "Newest");
  assert.equal(newest.getAttribute("aria-checked"), "true");
  assert.ok(newest.classList.contains("is-on"));
  assert.equal(top.getAttribute("aria-checked"), "false");
  assert.equal(bar.sortMode(), "newest");
  top.click();
  assert.deepEqual(changes, ["top"]);
  assert.equal(bar.sortMode(), "top");
  // Tapping the one already on is not a change.
  top.click();
  assert.deepEqual(changes, ["top"]);
  // Closing the view sets it back without a change event.
  bar.setSortMode("newest");
  assert.equal(bar.sortMode(), "newest");
  assert.deepEqual(changes, ["top"]);

  const tree = [
    comment({ created: t(1), likeCount: 5 }),
    comment({ created: t(3), likeCount: 0 }),
    comment({ created: t(2), likeCount: 2 }),
  ];
  assert.deepEqual(sortCommentTree(tree, DEFAULT_COMMENT_SORT).map((node) => node.created), [t(3), t(2), t(1)]);
  assert.deepEqual(sortCommentTree(tree, "top").map((node) => node.created), [t(1), t(2), t(3)]);

  // The section paints with its own mode, starts at Newest, and a switch
  // repaints the tree it holds: nothing is fetched.
  const client = read("../processallmessages.js");
  const build = client.slice(client.indexOf("function buildCommentsSection("), client.indexOf("// One comments modal at a time"));
  assert.match(build, /section\._sortMode = DEFAULT_COMMENT_SORT;/);
  assert.match(build, /sortCommentTree\(filterCommentTree\(items \|\| \[\]\), section\._sortMode\)/);
  const change = build.slice(build.indexOf("onChange: (mode) =>"), build.indexOf("const list = document.createElement"));
  assert.match(change, /paintList\(section\._tree \|\| \[\]\)/);
  assert.doesNotMatch(change, /fetch|getMessages|_setComments/);
});

test("a reply to a reply names the reply it answers, between its head and text; top-level, direct and deleted rows do not", () => {
  const names = { "0.0.21": "alice", "0.0.22": "", "0.0.23": "@bob" };
  const opts = { username: (payer) => names[payer] || "" };
  // The row's own .comment-main children (not its thread's).
  const own = (row) => row.children.find((child) => child.classList.contains("comment-main")).children;
  const replyTo = (row) => own(row).find((child) => child.classList.contains("comment-reply-to")) || null;
  const tree = comment({ created: t(1), payer: "0.0.20", replies: [
    comment({ created: t(2), payer: "0.0.21", replies: [
      comment({ created: t(3), payer: "0.0.22", text: "to alice", replies: [
        comment({ created: t(4), payer: "0.0.23", text: "to 0.0.22", replies: [
          comment({ created: t(5), payer: other, text: "to bob" }),
        ] }),
      ] }),
    ] }),
  ] });
  const top = buildCommentRow(tree, opts);
  // Depth first, as now: the direct reply, then 2, 3 and 4 deep.
  const [d1, d2, d3, d4] = top.querySelectorAll(".comment-row");
  assert.deepEqual([d1, d2, d3, d4].map((row) => row.dataset.depth), ["1", "2", "3", "4"]);
  assert.equal(replyTo(top), null);
  assert.equal(replyTo(d1), null);
  // The parent's @username, its id when it has none, a stored "@" not doubled.
  assert.equal(replyTo(d2).textContent, "↳ @alice");
  assert.equal(replyTo(d3).textContent, "↳ 0.0.22");
  assert.equal(replyTo(d4).textContent, "↳ @bob");
  // Between the head and the text, a plain div with no attributes of its own.
  assert.deepEqual(own(d2).slice(0, 3).map((child) => child.className), ["comment-head", "comment-reply-to", "comment-text"]);
  assert.equal(replyTo(d2).tagName, "DIV");
  assert.deepEqual(replyTo(d2).attrs, {});
  assert.equal(replyTo(d2).listeners.click, undefined);

  // A deleted row says nothing, and neither does a reply under a deleted one.
  const gone = buildCommentRow(comment({ payer: "0.0.20", replies: [
    comment({ created: t(2), payer: "0.0.21", replies: [
      comment({ created: t(3), payer: "0.0.22", deleted: true, text: "", replies: [
        comment({ created: t(4), payer: "0.0.23" }),
      ] }),
    ] }),
  ] }), opts);
  const [, deleted, underDeleted] = gone.querySelectorAll(".comment-row");
  assert.ok(deleted.classList.contains("is-deleted"));
  assert.equal(replyTo(deleted), null);
  assert.equal(underDeleted.dataset.depth, "3");
  assert.equal(replyTo(underDeleted), null);
  assert.equal(gone.querySelectorAll(".comment-reply-to").length, 0);
});

test("one level of indent: a thread inside a reply gives back the reply avatar and gap; the new rules use --u only", () => {
  const css = read("../style.css");
  const rule = (selector) => {
    const at = css.indexOf(`\n${selector} {`);
    assert.ok(at >= 0, selector);
    return css.slice(at, css.indexOf("}", at) + 1);
  };
  const nested = rule(".comment-row.is-reply .comment-replies");
  assert.match(nested, /margin-left: calc\(var\(--u\) \* -4\.1\);/);
  assert.match(nested, /padding-left: 0;/);
  assert.match(nested, /border-left: 0;/);
  // 4.1u = the reply avatar plus the row gap.
  assert.match(rule(".comment-row.is-reply > .comment-avatar"), /width: calc\(var\(--u\) \* 3\);/);
  assert.match(rule(".comment-row"), /gap: calc\(var\(--u\) \* 1\.1\);/);
  // The top-level thread keeps its indent and line.
  const top = rule(".comment-replies");
  assert.match(top, /padding-left: calc\(var\(--u\) \* 1\);/);
  assert.match(top, /border-left: calc\(var\(--u\) \* 0\.15\) solid var\(--comment-line\);/);
  const to = rule(".comment-reply-to");
  for (const line of ["font-size: calc(var(--u) * 1.4);", "color: var(--comment-muted);", "line-height: 1.3;", "min-width: 0;", "overflow: hidden;", "text-overflow: ellipsis;", "white-space: nowrap;"]) {
    assert.ok(to.includes(line), line);
  }
  for (const block of [nested, to]) assert.doesNotMatch(block, /\d(\.\d+)?(px|rem)\b/);
});

test("the composer with the shared × / ↶ and full-screen button: no avatar, one row, and a page that keeps its look", () => {
  const css = read("../style.css");
  const rule = (selector) => {
    const at = css.indexOf(`\n${selector} {`);
    assert.ok(at >= 0, selector);
    return css.slice(at, css.indexOf("}", at) + 1);
  };
  // Inline: no picture of you, the row is the controls' anchor, and the
  // full-screen button's own row never takes room beside the field.
  assert.match(rule(".comments-input-row .comments-me"), /display: none;/);
  assert.match(rule(".comments-compose .comments-input-row"), /position: relative;/);
  assert.match(rule(".popup-comments .comments-compose .field-expand-btn.is-rowless"), /display: none;/);
  // The list's own avatars are untouched.
  assert.match(rule(".comment-avatar"), /width: calc\(var\(--u\) \* 4\);/);
  assert.doesNotMatch(css, /\.comment-avatar[^{]*\{[^}]*display: none/);
  // Full screen: the comment unit and colours, hidden parts hidden, the
  // field's text colour, attach under the text, the counter row.
  const page = rule("#field-full .comments-compose");
  assert.match(page, /--u: var\(--fu\);/);
  for (const name of ["--comment-ink", "--comment-muted", "--comment-line", "--comment-glass", "--comment-glass-line", "--comment-red"]) {
    assert.ok(page.includes(`${name}:`), name);
  }
  assert.match(rule("#field-full .comments-compose.field-expand-box.is-expanded [hidden]"), /display: none !important;/);
  assert.match(rule("#field-full .comments-compose textarea.comments-input"), /color: var\(--comment-ink\);/);
  const attach = rule("#field-full .comments-compose .comments-attach");
  assert.match(attach, /order: 1;/);
  assert.match(attach, /align-self: flex-start;/);
  assert.match(rule("#field-full .comments-compose.is-expanded .comments-compose-meta"), /font-size: var\(--ui-small\);/);
  assert.match(rule("#field-full .comments-compose.field-expand-box.is-expanded .comments-compose-meta > .hcs-byte-counter"), /margin: 0 !important;/);
  // The chips' existing tap boxes reach them in full screen too.
  assert.match(css, /\.popup-comments :is\(\.comment-action, \.comments-sort-btn, \.comments-chip-close, \.comments-chip-cancel, \.comments-media-remove\)::after,\s*#field-full \.comments-compose :is\(\.comments-chip-close, \.comments-chip-cancel, \.comments-media-remove\)::after \{/);
  // Every new rule is scoped to the composer, and sized without px or rem.
  const added = [
    ".comments-input-row .comments-me",
    ".comments-compose .comments-input-row",
    ".popup-comments .comments-compose .field-expand-btn.is-rowless",
    "#field-full .comments-compose",
    "#field-full .comments-compose.field-expand-box.is-expanded [hidden]",
    "#field-full .comments-compose textarea.comments-input",
    "#field-full .comments-compose .comments-attach",
    "#field-full .comments-compose.is-expanded .comments-compose-meta",
    "#field-full .comments-compose.field-expand-box.is-expanded .comments-compose-meta > .hcs-byte-counter",
  ];
  for (const selector of added) {
    assert.match(selector, /^(\.comments-input-row |\.comments-compose |\.popup-comments \.comments-compose |#field-full \.comments-compose)/, selector);
    assert.doesNotMatch(rule(selector), /\d(\.\d+)?(px|rem)\b/, selector);
  }
});

test("the pin rule line: hidden with no collection, the text when there is one, several names included", () => {
  // processallmessages.js commentsPinLine as it is, on this file's DOM.
  const client = read("../processallmessages.js");
  const start = client.indexOf("function commentsPinLine(");
  assert.ok(start > 0);
  const source = client.slice(start, client.indexOf("\n}\n", start) + 2);
  const commentsPinLine = new Function(`${source}\nreturn commentsPinLine;`)();

  const section = new El("div");
  const line = commentsPinLine(section);
  assert.equal(line.className, "comments-pin");
  assert.equal(line.getAttribute("role"), "note");
  // Nothing shows before the first paint.
  assert.equal(line.hidden, true);
  assert.equal(typeof section._paintPin, "function");

  // No collection: hidden, no text.
  section._paintPin({ tokens: [], names: {}, text: "" });
  assert.equal(line.hidden, true);
  assert.equal(line.textContent, "");

  // One collection: the text shows.
  section._paintPin({ tokens: ["0.0.123"], names: { "0.0.123": "Cool Apes" }, text: "Holders of Cool Apes shown first" });
  assert.equal(line.hidden, false);
  assert.equal(line.textContent, "Holders of Cool Apes shown first");

  // Several names, as commentpin.js joins them.
  const several = "Holders of Cool Apes, Moon Cats, 0.0.789 shown first";
  section._paintPin({ tokens: ["0.0.123", "0.0.456", "0.0.789"], names: { "0.0.123": "Cool Apes", "0.0.456": "Moon Cats" }, text: several });
  assert.equal(line.hidden, false);
  assert.equal(line.textContent, several);

  // The pin is cleared again: hidden, and the old text is gone.
  section._paintPin({ tokens: [], names: {}, text: "" });
  assert.equal(line.hidden, true);
  assert.equal(line.textContent, "");
  section._paintPin(null);
  assert.equal(line.hidden, true);

  // The section mounts it first, above Top / Newest.
  const build = client.slice(client.indexOf("function buildCommentsSection("), client.indexOf("// One comments modal at a time"));
  assert.match(build, /const pinLine = commentsPinLine\(section\);/);
  assert.match(build, /section\.appendChild\(pinLine\);\s*section\.appendChild\(sortBar\);/);
  assert.ok(build.indexOf("commentsPinLine(section)") < build.indexOf("paintPinInfo"));
});

test("⋯ shows only on your own comment, never on someone else's, a placeholder or one still posting", () => {
  const menu = (node, account) => find(buildCommentRow(node, { me: account }), ".comment-menu-btn");
  assert.equal(menu(comment({ payer: other }), me), null);
  assert.equal(menu(comment({ payer: other }), ""), null);
  assert.ok(menu(comment({ payer: me }), me));
  assert.equal(menu(comment({ payer: me, pending: true }), me), null);
  assert.equal(menu(comment({ payer: me, deleted: true, text: "", replies: [comment({ created: t(2) })] }), me), null);
  // Reply is on every live row, yours or not.
  assert.ok(find(buildCommentRow(comment({ payer: other }), { me }), ".comment-reply-btn"));

  // A reply of yours under someone else's comment has its own ⋯.
  const row = buildCommentRow(comment({ payer: other, replies: [comment({ created: t(2), payer: me })] }), { me });
  assert.equal(row.querySelectorAll(".comment-menu-btn").length, 1);

  // Edit and Delete hand back the node and its parent.
  const calls = [];
  const parent = comment({ payer: other, replies: [comment({ created: t(2), payer: me, text: "mine" })] });
  const nested = buildCommentRow(parent, {
    me,
    onEdit: (node, up) => calls.push(["edit", node.created, up && up.created]),
    onDelete: (node, up) => calls.push(["delete", node.created, up && up.created]),
  });
  const items = doc.body.children.length;
  find(nested, ".comment-menu-btn").click();
  const pop = doc.body.children[items];
  assert.ok(pop && pop.classList.contains("comment-menu-pop"));
  assert.deepEqual(pop.children.map((item) => item.textContent), ["Edit", "Delete"]);
  find(pop, ".comment-menu-edit").click();
  assert.deepEqual(calls, [["edit", t(2), t(1)]]);
});

test("a deleted comment with replies is a \"Comment deleted\" placeholder; one without replies is hidden", () => {
  const reply = comment({ created: t(2), payer: me, text: "still here" });
  const shown = filterCommentTree([
    comment({ created: t(1), deleted: true, text: "gone", image: "https://example.com/a.png", replies: [reply] }),
    comment({ created: t(3), deleted: true, text: "gone too" }),
  ]);
  assert.equal(shown.length, 1);
  const row = buildCommentRow(shown[0], {
    me: other,
    media: () => assert.fail("a placeholder has no media"),
    heart: () => new El("div"),
  });
  assert.ok(row.classList.contains("is-deleted"));
  // The placeholder's own level, without the reply under it.
  const main = row.children.find((child) => child.classList.contains("comment-main"));
  const own = new El("div");
  own.children = main.children.filter((child) => !child.classList.contains("comment-replies"));
  assert.equal(find(own, ".comment-deleted").textContent, "Comment deleted");
  assert.equal(find(own, ".comment-media"), null);
  assert.equal(find(own, ".comment-menu-btn"), null);
  assert.equal(find(own, ".comment-reply-btn"), null);
  assert.equal(find(own, ".comment-head"), null);
  assert.equal(find(own, ".comment-text"), null);
  assert.ok(row.children[0].classList.contains("is-stand-in"));
  // Its reply stays, and stays open.
  const thread = find(row, ".comment-replies");
  assert.ok(thread);
  assert.equal(thread.hidden, false);
  assert.equal(find(thread, ".comment-text").textContent, "still here");
});

test("the name line is @username then the account id, or the id alone, never one name twice", () => {
  assert.deepEqual(commentNameParts("0.0.5", "bob"), { name: "@bob", handle: "0.0.5" });
  assert.deepEqual(commentNameParts("0.0.5", "@bob"), { name: "@bob", handle: "0.0.5" });
  assert.deepEqual(commentNameParts("0.0.5", "  "), { name: "0.0.5", handle: "" });
  assert.deepEqual(commentNameParts("0.0.5", undefined), { name: "0.0.5", handle: "" });
  assert.deepEqual(commentNameParts("0.0.5", "0.0.5"), { name: "0.0.5", handle: "" });

  const names = { "0.0.5": "bob" };
  const opts = { username: (payer) => names[payer] || "", now: Date.parse(t(4)) };
  const named = find(buildCommentRow(comment({ payer: "0.0.5" }), opts), ".comment-head");
  assert.equal(find(named, ".comment-name").textContent, "@bob");
  assert.equal(find(named, ".comment-handle").textContent, "0.0.5");
  assert.equal(named.querySelectorAll(".comment-name").length, 1);
  assert.equal(find(named, ".comment-time").textContent, "3m");

  const plain = find(buildCommentRow(comment({ payer: "0.0.6" }), opts), ".comment-head");
  assert.equal(find(plain, ".comment-name").textContent, "0.0.6");
  assert.equal(find(plain, ".comment-handle"), null);
  assert.equal(plain.textContent.split("0.0.6").length - 1, 1);

  // The app's own username link takes the "@username" text.
  const linked = find(buildCommentRow(comment({ payer: "0.0.5" }), {
    ...opts,
    usernameNode: (text) => Object.assign(new El("a"), { text }),
    accountHref: (payer) => `https://explore.hashpack.app/${payer}`,
  }), ".comment-head");
  assert.equal(find(linked, ".comment-name").tagName, "A");
  assert.equal(find(linked, ".comment-handle").href, "https://explore.hashpack.app/0.0.5");

  // An edited one says so after the time.
  const edited = find(buildCommentRow(comment({ edited: true }), opts), ".comment-edited");
  assert.equal(edited.textContent, "edited");

  const now = Date.parse("2026-11-24T12:00:00.000Z");
  assert.equal(relativeCommentTime("2026-11-24T11:57:00.000Z", now), "3m");
  assert.equal(relativeCommentTime("2026-11-24T10:00:00.000Z", now), "2h");
  assert.equal(relativeCommentTime("2026-11-19T12:00:00.000Z", now), "5d");
});

function composer(opts = {}) {
  const input = new El("textarea");
  input.maxLength = COMMENT_TEXT_MAX;
  const sent = [];
  const uploads = [];
  const toasts = [];
  const c = buildCommentComposer({
    input,
    send: async (state) => {
      sent.push(state);
      return opts.ok !== false;
    },
    upload: (file) => {
      uploads.push(file);
      return opts.upload ? opts.upload(file) : Promise.resolve({ url: "https://pub.example/c.webp", kind: "still" });
    },
    toast: (message) => toasts.push(message),
    ...opts.extra,
  });
  const type = (value) => {
    input.value = value;
    input.dispatch("input");
  };
  return { c, input, sent, uploads, toasts, type, counter: find(c.el, ".comments-counter"), meta: find(c.el, ".comments-compose-meta") };
}

test("the counter shows \"n / 1000\" from 800 characters, a newline counting two", () => {
  assert.equal(commentCounterText(799), "");
  assert.equal(commentCounterText(800), "800 / 1000");
  assert.equal(commentCounterText(1000), "1000 / 1000");

  const { type, counter, meta } = composer();
  type("x".repeat(799));
  assert.equal(counter.hidden, true);
  assert.equal(meta.hidden, true);
  type("x".repeat(800));
  assert.equal(counter.hidden, false);
  assert.equal(meta.hidden, false);
  assert.equal(counter.textContent, "800 / 1000");
  assert.equal(counter.classList.contains("is-max"), false);
  type("x".repeat(1000));
  assert.equal(counter.textContent, "1000 / 1000");
  assert.ok(counter.classList.contains("is-max"));
  // 400 lines of one character: 400 + 399 newlines counted twice.
  type(Array(400).fill("x").join("\n"));
  assert.equal(counter.textContent, "1198 / 1000");
  type("");
  assert.equal(counter.hidden, true);
});

test("media alone enables Send; an empty box with no media is still a tap that the send helper refuses", async () => {
  const { c, sent, uploads } = composer();
  const send = c.send;
  // Nothing written, nothing attached: dimmed but enabled, so the
  // helper can say "Comment is empty".
  assert.equal(send.disabled, false);
  assert.ok(send.classList.contains("is-empty"));
  await c.submit();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].mode, "comment");
  assert.equal(sent[0].image, "");
  assert.equal(sent[0].media, undefined);

  // While the upload runs, Send and attach are off and a second pick waits.
  let finish;
  const slow = composer({ upload: () => new Promise((resolve) => { finish = resolve; }) });
  slow.c.pick({ type: "image/png", size: 10 });
  assert.equal(slow.c.send.disabled, true);
  assert.equal(slow.c.attach.disabled, true);
  assert.ok(find(slow.c.el, ".comments-media-chip").classList.contains("is-busy"));
  slow.c.pick({ type: "image/png", size: 10 });
  assert.equal(slow.uploads.length, 1);
  finish({ url: "https://pub.example/a.webp", kind: "still" });
  await flush();
  assert.equal(slow.c.send.disabled, false);
  assert.equal(slow.c.attach.disabled, false);

  // Done: media only, Send on and not dimmed, and it goes out as the
  // helpers' last argument.
  await c.pick({ type: "image/png", size: 10 });
  await flush();
  assert.equal(uploads.length, 1);
  assert.equal(send.disabled, false);
  assert.equal(send.classList.contains("is-empty"), false);
  const chip = find(c.el, ".comments-media-chip");
  assert.equal(chip.hidden, false);
  assert.equal(find(chip, ".comments-media-label").textContent, "Image attached");
  await c.submit();
  assert.equal(sent[1].media, "https://pub.example/c.webp");
  assert.equal(sent[1].image, "https://pub.example/c.webp");
  // Sent: the box and the chip clear.
  assert.equal(chip.hidden, true);
  assert.equal(c.state().media, undefined);
  assert.ok(send.classList.contains("is-empty"));
});

test("a refused file never uploads, and a failed upload keeps what was attached before", async () => {
  const { c, uploads, toasts } = composer({ extra: { reject: () => "Video max 25 MB" } });
  await c.pick({ type: "video/mp4", size: 99e6 });
  assert.equal(uploads.length, 0);
  assert.deepEqual(toasts, ["Video max 25 MB"]);
  assert.equal(c.send.disabled, false);

  let fail = false;
  const flaky = composer({ upload: () => (fail ? Promise.reject(new Error("no")) : Promise.resolve({ url: "https://pub.example/1.webp", kind: "still" })) });
  await flaky.c.pick({ type: "image/png", size: 1 });
  await flush();
  fail = true;
  await flaky.c.pick({ type: "image/png", size: 1 });
  await flush();
  assert.equal(flaky.c.state().media, "https://pub.example/1.webp");
  assert.equal(flaky.c.uploading, false);
});

test("the reply chip replies to its parent until it is sent or closed", async () => {
  const { c, input, sent, type } = composer({ extra: { replyLabel: (node) => `↩ Replying to ${node.payer}` } });
  const parent = comment({ created: t(5) });
  c.reply(parent);
  const chip = find(c.el, ".comments-reply-chip");
  assert.equal(chip.hidden, false);
  assert.equal(find(chip, ".comments-chip-label").textContent, `↩ Replying to ${other}`);
  assert.equal(doc.activeElement, input);
  type("yes");
  await c.submit();
  assert.equal(sent[0].mode, "reply");
  assert.equal(sent[0].replyTo, parent);
  assert.equal(chip.hidden, true);
  assert.equal(input.value, "");

  // A failed send keeps the chip.
  const failing = composer({ ok: false });
  failing.c.reply(parent);
  failing.type("again");
  await failing.c.submit();
  assert.equal(find(failing.c.el, ".comments-reply-chip").hidden, false);
  assert.equal(failing.input.value, "again");
  find(failing.c.el, ".comments-chip-close").click();
  assert.equal(find(failing.c.el, ".comments-reply-chip").hidden, true);
  assert.equal(failing.c.state().mode, "comment");
});

test("edit puts the text and media in the box; Save keeps, replaces or clears the media; Cancel restores the draft", async () => {
  const { c, input, sent, type } = composer();
  type("half a thought");
  const own = comment({ payer: me, text: "first", image: "https://pub.example/old.webp" });
  const parent = comment({ created: t(0) });
  assert.equal(c.edit(own, parent), true);
  assert.equal(input.value, "first");
  assert.equal(c.send.textContent, "Save");
  assert.equal(find(c.el, ".comments-edit-chip").hidden, false);
  assert.equal(find(c.el, ".comments-media-chip").hidden, false);
  // Untouched media is kept.
  assert.equal(c.state().mode, "edit");
  assert.equal(c.state().media, undefined);
  assert.equal(c.state().edit.parent, parent);
  // Removed: cleared.
  find(c.el, ".comments-media-remove").click();
  assert.equal(c.state().media, "");
  // Replaced.
  await c.pick({ type: "image/png", size: 1 });
  await flush();
  assert.equal(c.state().media, "https://pub.example/c.webp");
  // Cancel: the draft is back, and Send says Send.
  find(c.el, ".comments-chip-cancel").click();
  assert.equal(input.value, "half a thought");
  assert.equal(c.send.textContent, "Send");
  assert.equal(c.state().mode, "comment");
  assert.equal(c.state().media, undefined);

  c.edit(own, null);
  type("first, fixed");
  await c.submit();
  assert.equal(sent[0].mode, "edit");
  assert.equal(sent[0].text, "first, fixed");
  assert.equal(sent[0].edit.node, own);
  assert.equal(sent[0].media, undefined);
  assert.equal(input.value, "half a thought");
  assert.equal(find(c.el, ".comments-edit-chip").hidden, true);
});

test("the composer is the full-screen box, and programmatic text tells that page to repaint", async () => {
  const seen = [];
  const { c, input, type } = composer({ extra: { afterText: (field) => seen.push(field) } });
  assert.equal(c.el.dataset.expandBox, "");
  assert.equal(c.el.dataset.expandTitle, "Comment");
  assert.equal(c.send.dataset.expandSend, "");

  const own = comment({ payer: me, text: "first" });
  assert.equal(c.edit(own), true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0], input);
  c.cancelEdit();
  assert.equal(seen.length, 2);
  assert.equal(seen[1], input);
  type("yes");
  assert.equal(seen.length, 2);
  await c.submit();
  assert.equal(seen.length, 3);
  assert.equal(seen[2], input);
  assert.equal(input.value, "");

  const failing = composer({ ok: false, extra: { afterText: (field) => seen.push(field) } });
  const before = seen.length;
  failing.type("kept");
  await failing.c.submit();
  assert.equal(seen.length, before);
  assert.equal(failing.input.value, "kept");
});

test("the approvals line shows once the message needs more than one wallet approval", () => {
  let bytes = 900;
  const { type, c } = composer({ extra: { bytes: () => bytes } });
  const usage = find(c.el, ".comments-usage");
  type("a");
  assert.equal(usage.hidden, true);
  bytes = 1500;
  type("ab");
  assert.equal(usage.hidden, false);
  assert.match(usage.textContent, /2 approvals/);
});

test("delete asks in the row first: Cancel keeps it, Delete goes ahead", async () => {
  const row = buildCommentRow(comment({ payer: me }), { me });
  const asking = confirmInRow(row);
  const bar = find(row, ".comment-confirm");
  assert.deepEqual([find(bar, ".comment-confirm-no").textContent, find(bar, ".comment-confirm-yes").textContent], ["Cancel", "Delete"]);
  assert.equal(find(row, ".comment-actions").hidden, true);
  find(bar, ".comment-confirm-no").click();
  assert.equal(await asking, false);
  assert.equal(find(row, ".comment-confirm"), null);
  assert.equal(find(row, ".comment-actions").hidden, false);

  const again = confirmInRow(row);
  find(row, ".comment-confirm-yes").click();
  assert.equal(await again, true);
});

test("the section is wired to the rows, the switch and the composer, with the post timestamp for edit and delete", () => {
  const client = read("../processallmessages.js");
  assert.match(client, /function buildCommentsSection\(id, comments, onSend, onReply, topicId, kind, syncKey, postTimestamp\)/);
  const ensure = client.slice(client.indexOf("function ensurePostComments"), client.indexOf("function adoptComments"));
  assert.match(ensure, /data\.timestamp,\n\s*\);/);
  const build = client.slice(client.indexOf("function buildCommentsSection("), client.indexOf("// One comments modal at a time"));
  assert.match(build, /buildCommentRow\(comment, options\)/);
  assert.match(build, /buildSortToggle\(/);
  assert.match(build, /buildCommentComposer\(/);
  assert.match(build, /input\.maxLength = COMMENT_TEXT_MAX;/);
  assert.match(build, /confirmInRow\(row\)/);
  for (const name of ["sendEditPolygonReply", "sendEditMarkerReply", "sendEditPolygonComment", "sendEditMarkerComment",
    "sendDeletePolygonReply", "sendDeleteMarkerReply", "sendDeletePolygonComment", "sendDeleteMarkerComment"]) {
    assert.match(build, new RegExp(`window\\.${name}\\b`));
  }
  assert.match(build, /postTimestamp, topicId, node\.created/);
  // The upload stays a runtime import (web3 must finish loading first).
  assert.match(client, /await import\('\.\/uploadmedia\.js'\);\n\s*try \{\n\s*return await upload\.uploadCommentMedia\(file, anchor\);/);
  assert.doesNotMatch(client, /^import .*uploadmedia/m);
  // The view resets to Newest when it closes.
  assert.match(client, /commentsModalSection\._resetSort\(\)/);
});

test("the comment box mounts the shared full-screen page and is home before the view moves", () => {
  const client = read("../processallmessages.js");
  const ui = read("../commentsui.js");
  assert.doesNotMatch(ui, /fieldexpand/);

  const build = client.slice(client.indexOf("function buildCommentsSection("), client.indexOf("// One comments modal at a time"));
  assert.match(build, /mountFieldExpand\(input\)/);
  assert.match(build, /input\._commentSection = section/);
  assert.match(build, /fieldExpandOf\(field\)/);

  const teardown = client.slice(client.indexOf("function teardownCommentsModal()"), client.indexOf("function closeCommentsModal()"));
  assert.match(teardown, /function teardownCommentsModal\(\) \{\n  collapseExpandedFields\(\);/);

  const close = client.slice(client.indexOf("function closeCommentsModal()"), client.indexOf("function commentsInCardHost("));
  const firstGuard = close.indexOf("if (!commentsModal) return;");
  const closingGuard = close.indexOf("if (commentsClosing && !feedFlipSkip) return;");
  const collapse = close.indexOf("collapseExpandedFields();");
  assert.ok(firstGuard >= 0 && closingGuard > firstGuard && collapse > closingGuard);
  assert.ok(collapse < close.indexOf("stopFeedCommentsHold"));

  const retarget = client.slice(client.indexOf("function retargetCommentsModal()"), client.indexOf("if (!landscapeCommentsBound)"));
  assert.ok(retarget.indexOf("collapseExpandedFields();") < retarget.indexOf("section.remove();"));

  const rememberAt = client.indexOf("function rememberSentComment(");
  const remember = client.slice(rememberAt, client.indexOf("function patchMountedComment("));
  const owned = remember.indexOf("input._commentSection");
  const closest = remember.indexOf("closest('.popup-comments')");
  assert.ok(owned >= 0 && closest > owned);

  const fieldFn = client.slice(client.indexOf("function commentField("), rememberAt);
  assert.match(fieldFn, /section\._composer && section\._composer\.input/);
  assert.match(fieldFn, /querySelector\('textarea'\)/);
  assert.match(client.slice(client.indexOf("function commentsAreOpen("), client.indexOf("function applyShareCard(")), /commentField\(section\)/);
  assert.match(client.slice(client.indexOf("function showCommentsModal("), client.indexOf("function retargetCommentsModal(")), /const input = commentField\(section\);/);
});

test("a holder lookup repaints comments only when the pinned payers change, and that repaint keeps the scroll", () => {
  const client = read("../processallmessages.js");
  const build = client.slice(client.indexOf("function buildCommentsSection("), client.indexOf("// One comments modal at a time"));
  const paint = build.slice(build.indexOf("const paintList ="), build.indexOf("const overlayMatches"));
  const saved = paint.indexOf("const savedTop = scroller ? scroller.scrollTop : 0;");
  const replaced = paint.indexOf("list.replaceChildren()");
  const restored = paint.indexOf("if (scroller) scroller.scrollTop = savedTop;");
  assert.ok(saved >= 0 && saved < replaced && restored > replaced);

  const lookup = paint.indexOf("lookupHolders(commentPinPayers(sorted, 30), tokens)");
  const recorded = paint.lastIndexOf("pinnedPayers(sorted, tokens)", lookup);
  assert.ok(recorded >= 0 && recorded < lookup);
  assert.match(build, /cachedPinned\(payer, tokens\) === true/);
  const callback = paint.slice(lookup);
  const compared = callback.indexOf("samePayers(pinned, pinnedPayers(sorted, tokens))");
  const repaint = callback.indexOf("paintList(section._tree || [], true)");
  assert.ok(compared >= 0 && callback.indexOf("return", compared) < repaint);
});

test("a row draws our own, IPFS and Hashinal media; another host's address is a plain link, javascript: is nothing", () => {
  const base = "https://pub-test.r2.dev";
  globalThis.__R2_PUBLIC_BASE = base;
  try {
    const painted = [];
    const opts = { media: (image, box) => { painted.push(image); box.appendChild(new El("img")); } };
    const mediaOf = (image) => {
      painted.length = 0;
      const row = buildCommentRow(comment({ image }), opts);
      return { row, media: find(row, ".comment-media"), link: find(row, ".comment-media-link") };
    };
    for (const ours of [`${base}/markers/1-a.webp`, `${base}/markers/1-a.mp4?gif=1`, "ipfs://bafyexample", "hcs://1/0.0.123"]) {
      const { media, link } = mediaOf(ours);
      assert.ok(media, ours);
      assert.equal(link, null, ours);
      assert.deepEqual(painted, [ours]);
    }
    const elsewhere = "https://images.example.com/cat.png";
    const { media, link } = mediaOf(elsewhere);
    assert.equal(media, null);
    assert.deepEqual(painted, []);
    assert.ok(link);
    const anchor = link.children[0];
    assert.equal(anchor.tagName, "A");
    assert.equal(anchor.href, elsewhere);
    assert.equal(anchor.textContent, elsewhere);
    assert.equal(anchor.target, "_blank");
    assert.equal(anchor.rel, "noopener noreferrer nofollow");
    assert.equal(link.querySelectorAll("img").length, 0);
    const bad = mediaOf("javascript:alert(1)");
    assert.equal(bad.media, null);
    assert.equal(bad.link, null);
    assert.deepEqual(painted, []);
  } finally {
    delete globalThis.__R2_PUBLIC_BASE;
  }
});
