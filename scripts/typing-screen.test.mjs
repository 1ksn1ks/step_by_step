import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  activationDecision,
  enterPolicy,
  isTypingCandidate,
  planDismiss,
  planSync,
  typingEnabled,
} from "../typingscreen.js";

function source(rel) {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

test("a typing candidate is a text control, not a picker or a readonly field", () => {
  const no = ["file", "checkbox", "radio", "range", "color", "date", "time", "month", "hidden"];
  for (const type of no) {
    assert.equal(isTypingCandidate({ tagName: "INPUT", type }), false, type);
  }
  assert.equal(isTypingCandidate({ tagName: "INPUT", type: "text", readOnly: true }), false);
  const yes = ["text", "search", "email", "url", "tel", "number", "password"];
  for (const type of yes) {
    assert.equal(isTypingCandidate({ tagName: "INPUT", type }), true, type);
  }
  assert.equal(isTypingCandidate({ tagName: "TEXTAREA" }), true);
  assert.equal(isTypingCandidate({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(isTypingCandidate({
    tagName: "SPAN",
    isContentEditable: true,
    parentElement: { isContentEditable: true },
  }), false);
});

test("activation opens on a touch, stays inline for a physical keyboard, and confirms an unknown coarse tap", () => {
  assert.equal(activationDecision({
    candidate: true, pointerType: "touch", coarse: true, hoverNone: true, fineHover: false, session: "unknown",
  }), "confirm");
  assert.equal(activationDecision({
    candidate: true, pointerType: "mouse", coarse: false, hoverNone: false, fineHover: true, session: "unknown",
  }), "inline");
  assert.equal(activationDecision({
    candidate: true, pointerType: "touch", session: "physical",
  }), "inline");
  assert.equal(activationDecision({
    candidate: true, pointerType: "mouse", session: "software", trustedFocus: false,
  }), "typing");
  assert.equal(activationDecision({
    candidate: true, suppressed: true, pointerType: "touch",
  }), "inline");
  assert.equal(activationDecision({
    candidate: true, session: "unknown", trustedFocus: false, pointerType: "",
  }), "inline");
});

test("an edit writes beforeinput, then the value, then input, and Escape is not a key", () => {
  const edit = planSync({ value: "" }, { value: "a", selectionStart: 1, selectionEnd: 1 });
  assert.deepEqual(edit.events, ["beforeinput", "write", "input"]);
  assert.equal(edit.isComposing, false);
  const end = planSync({ value: "a" }, { phase: "compositionend", value: "ab" });
  assert.deepEqual(end.events, ["compositionend"]);
  assert.equal(end.trailingInput, false);
  assert.equal(end.isComposing, false);
  const composing = planSync({ value: "a" }, { value: "ab", isComposing: true });
  assert.equal(composing.isComposing, true);
  const escape = planSync({}, { phase: "keydown", key: "Escape" });
  assert.deepEqual(escape.events, []);
});

test("cancel puts the snapshot back, and commit fires change only when the text changed", () => {
  const cancel = planDismiss("cancel", "Name", "Nameless");
  assert.equal(cancel.value, "Name");
  assert.deepEqual(cancel.events, ["input", "change"]);
  const commit = planDismiss("commit", "Name", "Nameless");
  assert.equal(commit.value, "Nameless");
  assert.deepEqual(commit.events, ["change"]);
  assert.deepEqual(planDismiss("commit", "Name", "Name").events, []);
});

test("Enter does not send, a prevented or multi-picker Enter stays open, and Escape is not dispatched", () => {
  const multi = enterPolicy({ multiline: true, key: "Enter" });
  assert.equal(multi.close, false);
  assert.equal(multi.send, false);
  assert.deepEqual(enterPolicy({
    multiline: false, key: "Enter", defaultPrevented: false, pickerMulti: false,
  }), { close: "commit", send: false, keys: ["keydown"] });
  assert.equal(enterPolicy({ multiline: false, key: "Enter", defaultPrevented: true }).close, false);
  const picker = enterPolicy({ multiline: false, key: "Enter", pickerMulti: true });
  assert.equal(picker.send, false);
  assert.equal(picker.close, false);
  const escape = enterPolicy({ key: "Escape" });
  assert.equal(escape.close, "commit");
  assert.deepEqual(escape.keys, []);
});

test("the flag is off unless a query or a stored value turns it on", () => {
  assert.equal(typingEnabled({ fallback: false }), false);
  assert.equal(typingEnabled({ query: "1", stored: "0", fallback: false }), true);
  assert.equal(typingEnabled({ query: "0", stored: "1", fallback: true }), false);
  assert.equal(typingEnabled({ stored: "1", fallback: false }), true);
});

test("open returns before history.open for the same field, and the core imports nothing", () => {
  const file = source("../typingscreen.js");
  assert.doesNotMatch(file, /^import /m);
  assert.doesNotMatch(file, /from ['"]\.\/(rest|search|map|topicchat|encryptedtopicchat|feedlayout|processallmessages)\.js['"]/);
  const openAt = file.indexOf("function open(el)");
  const histAt = file.indexOf("history.open", openAt);
  const sameAt = file.indexOf("current.el.id === nextId", openAt);
  assert.ok(openAt >= 0 && sameAt > openAt && histAt > sameAt);
  assert.match(file.slice(openAt, histAt), /return;/);
});

test("the page wires forms only, skips the mirror scroll, and keeps the flag off", () => {
  const main = source("../main.js");
  const historyAt = main.indexOf("import './historyLayers.js'");
  const bindAt = main.indexOf("import './typingscreen-bind.js'");
  assert.ok(historyAt >= 0 && bindAt > historyAt);
  const bind = source("../typingscreen-bind.js");
  assert.match(bind, /install-choice-input/);
  assert.match(bind, /fallback: false/);
  assert.doesNotMatch(bind, /from ['"]\.\/(search|markerstack|cssLogic)\.js['"]/);
  const layout = source("../keyboardlayout.js");
  assert.match(layout, /closest\('#typing-screen, \[data-kb-skip\]'\)/);
  const preview = source("../profilepreview.js");
  assert.match(preview, /data-typing-live/);
  const follow = source("../followsuggest.js");
  assert.match(follow, /data-typing-live/);
  assert.match(follow, /#typing-screen/);
});
