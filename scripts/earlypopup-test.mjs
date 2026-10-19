// Early Hashinal popup lock. No network and no DOM.
import assert from "node:assert/strict";
import {
  EARLY_POPUP_CHROME,
  LOCKED_STYLE_KEYS,
  earlyBadgeLabel,
  earlyLockNote,
  resolvePopupStyle,
} from "../earlypopup.js";

const SAVED = {
  colorBorder: "#112233",
  colorNumber: "#abcdef",
  colorClose: "#010101",
  colorUsername: "#ff9933",
  colorAccid: "#800080",
  colorText: "#ffffff",
  colorTitles: "#eeeeee",
  popupFontSize: 2.4,
  earlyHashinal: 9,
  locked: true,
  number: 9,
  owners: { "0.0.5": 9 },
};

function testEarlyHolderIgnoresSavedColors() {
  const saved = { ...SAVED };
  const before = JSON.stringify(saved);
  const decision = resolvePopupStyle("0.0.5", { "0.0.5": 12 }, saved);
  assert.equal(decision.locked, true);
  assert.equal(decision.number, 12);
  assert.equal(decision.applied, EARLY_POPUP_CHROME);
  assert.equal(decision.applied.kind, "early-holder");
  assert.equal(decision.saved, saved);
  assert.equal(JSON.stringify(saved), before);
  for (const key of LOCKED_STYLE_KEYS) {
    assert.equal(decision.applied[key], undefined);
    assert.equal(saved[key], SAVED[key]);
  }
  assert.equal(earlyBadgeLabel(decision.number), "Early Hashinal #12");
  assert.equal(earlyLockNote(decision.number), "Locked by your Early Hashinal #12");
}

function testHoldersShareOneChrome() {
  const owners = new Map([["0.0.1", 1], ["0.0.2", "4"]]);
  const first = resolvePopupStyle("0.0.1", owners, { colorBorder: "#111111" });
  const second = resolvePopupStyle("0.0.2", owners, { colorBorder: "#222222" });
  assert.equal(first.locked, true);
  assert.equal(second.locked, true);
  assert.equal(second.number, 4);
  assert.equal(first.applied, second.applied);
  assert.notEqual(first.saved, second.saved);
}

function testProfileFieldsCannotLock() {
  const saved = { ...SAVED };
  const decision = resolvePopupStyle("0.0.5", {}, saved);
  assert.equal(decision.locked, false);
  assert.equal(decision.number, 0);
  assert.equal(decision.applied, saved);
  assert.equal(decision.saved, saved);
  assert.equal(earlyBadgeLabel(0), "");
  assert.equal(earlyLockNote(0), "");
}

function testDroppingTheHashinalRestoresSavedStyle() {
  const saved = { ...SAVED };
  const owners = { "0.0.5": 3 };
  const locked = resolvePopupStyle("0.0.5", owners, saved);
  assert.equal(locked.locked, true);
  assert.equal(locked.applied, EARLY_POPUP_CHROME);
  delete owners["0.0.5"];
  const open = resolvePopupStyle("0.0.5", owners, saved);
  assert.equal(open.locked, false);
  assert.equal(open.number, 0);
  assert.equal(open.applied, saved);
  assert.equal(open.saved, saved);
  assert.equal(open.applied.colorBorder, "#112233");
  assert.equal(open.applied.popupFontSize, 2.4);
}

function testBadMapEntriesStayUnlocked() {
  const saved = { colorBorder: "#445566" };
  const owners = {
    "0.0.1": 0,
    "0.0.2": -3,
    "0.0.3": 1.5,
    "0.0.4": "nope",
    "not-an-account": 8,
  };
  for (const id of ["0.0.1", "0.0.2", "0.0.3", "0.0.4", "not-an-account", ""]) {
    const decision = resolvePopupStyle(id, owners, saved);
    assert.equal(decision.locked, false, id);
    assert.equal(decision.applied, saved, id);
  }
  assert.equal(resolvePopupStyle("0.0.1", null, saved).locked, false);
  assert.equal(resolvePopupStyle("0.0.1", ["0.0.1"], saved).locked, false);
  assert.equal(resolvePopupStyle(12, { "0.0.1": 1 }, saved).applied, saved);
}

export async function runEarlyPopupTests() {
  testEarlyHolderIgnoresSavedColors();
  testHoldersShareOneChrome();
  testProfileFieldsCannotLock();
  testDroppingTheHashinalRestoresSavedStyle();
  testBadMapEntriesStayUnlocked();
}
