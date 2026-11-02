// Map search rows are a listbox: arrows move, Enter and Space pick.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../search.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");

function readFn(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, name);
  let depth = 0;
  let started = false;
  for (let end = start; end < source.length; end++) {
    const ch = source[end];
    if (ch === "{") {
      depth += 1;
      started = true;
    } else if (ch === "}") {
      depth -= 1;
      if (started && depth === 0) return source.slice(start, end + 1);
    }
  }
  assert.fail(`${name} did not close`);
}

function createEl(tag, sink) {
  const attrs = new Map();
  const listeners = new Map();
  const el = {
    tag,
    className: "",
    title: "",
    style: {},
    textContent: "",
    children: [],
    tabIndex: -1,
    focused: false,
    focusOpts: null,
    picks: 0,
    setAttribute(name, value) {
      attrs.set(name, String(value));
      if (name === "tabindex") el.tabIndex = Number(value);
    },
    getAttribute(name) {
      return attrs.has(name) ? attrs.get(name) : null;
    },
    removeAttribute(name) {
      attrs.delete(name);
      if (name === "tabindex") el.tabIndex = -1;
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    click() {
      el.picks += 1;
      for (const fn of listeners.get("click") || []) fn({ stopPropagation() {} });
    },
    dispatch(type, event) {
      for (const fn of listeners.get(type) || []) fn(event);
    },
    focus(opts) {
      el.focused = true;
      el.focusOpts = opts || null;
      if (sink) sink.current = el;
    },
    replaceChildren(...nodes) {
      el.children = nodes.filter(Boolean);
      el.textContent = el.children.map((child) => child.textContent || "").join("");
    },
    appendChild(child) {
      el.children.push(child);
    },
    querySelectorAll(selector) {
      assert.equal(selector, '.search-result-item[role="option"]');
      return el.children.filter((child) => (
        String(child.className).split(/\s+/).includes("search-result-item")
        && child.getAttribute("role") === "option"
      ));
    },
  };
  return el;
}

function loadApi() {
  const sink = { current: null };
  const searchResults = createEl("div", sink);
  searchResults.style.display = "block";
  const searchInput = createEl("input", sink);
  let closed = 0;
  const api = new Function(
    "document",
    "searchResults",
    "searchInput",
    "closeSearchBar",
    `${["paintResultItem", "resultOptions", "markActiveOption", "onResultKey", "bindResultKeys", "focusFirstResult"].map(readFn).join("\n")}\nreturn { paintResultItem, resultOptions, markActiveOption, onResultKey, bindResultKeys, focusFirstResult, searchResults, searchInput };`,
  )(
    { createElement: createEl },
    searchResults,
    searchInput,
    () => { closed += 1; },
  );
  api.closed = () => closed;
  api.sink = sink;
  api.el = (tag) => createEl(tag, sink);
  return api;
}

function key(name) {
  return {
    key: name,
    prevented: false,
    preventDefault() { this.prevented = true; },
  };
}

function addRow(api, label) {
  const item = api.el("div");
  api.paintResultItem(item, label, "place");
  item.addEventListener("click", () => {});
  api.bindResultKeys(item);
  api.searchResults.appendChild(item);
  return item;
}

test("result rows are options and the empty row is not", () => {
  assert.match(source, /searchResults\.setAttribute\('role', 'listbox'\)/);
  const api = loadApi();
  const place = addRow(api, "Athens");
  assert.equal(place.getAttribute("role"), "option");
  assert.equal(place.getAttribute("tabindex"), "0");
  assert.equal(place.tabIndex, 0);
  assert.equal(place.textContent, "Athens");

  const empty = api.el("div");
  api.paintResultItem(empty, 'No results for "zz"', "place", false);
  api.searchResults.appendChild(empty);
  assert.equal(empty.getAttribute("role"), null);
  assert.equal(empty.getAttribute("tabindex"), null);
  assert.equal(empty.tabIndex, -1);
  assert.deepEqual(api.resultOptions(), [place]);
  assert.match(source, /No results for "\$\{query\}"[\s\S]{0,180}false\)/);
});

test("arrows move from the field through the rows and back", () => {
  const api = loadApi();
  const first = addRow(api, "Athens");
  const second = addRow(api, "Atlanta");
  const down = key("ArrowDown");
  assert.equal(api.focusFirstResult(down), true);
  assert.equal(down.prevented, true);
  assert.equal(api.sink.current, first);

  const next = key("ArrowDown");
  api.onResultKey(next, first);
  assert.equal(next.prevented, true);
  assert.equal(api.sink.current, second);

  const stay = key("ArrowDown");
  api.onResultKey(stay, second);
  assert.equal(stay.prevented, true);
  assert.equal(api.sink.current, second);

  const up = key("ArrowUp");
  api.onResultKey(up, second);
  assert.equal(api.sink.current, first);

  const home = key("ArrowUp");
  api.onResultKey(home, first);
  assert.equal(home.prevented, true);
  assert.equal(api.sink.current, api.searchInput);
  assert.equal(api.searchInput.focusOpts.preventScroll, true);
});

test("Enter and Space pick the row and Escape closes the page", () => {
  const api = loadApi();
  const row = addRow(api, "Athens");
  let clicks = 0;
  row.addEventListener("click", () => { clicks += 1; });

  const enter = key("Enter");
  row.dispatch("keydown", enter);
  assert.equal(enter.prevented, true);
  assert.equal(clicks, 1);
  assert.equal(row.picks, 1);

  const space = key(" ");
  api.onResultKey(space, row);
  assert.equal(space.prevented, true);
  assert.equal(clicks, 2);

  const esc = key("Escape");
  api.onResultKey(esc, row);
  assert.equal(esc.prevented, true);
  assert.equal(api.closed(), 1);
});

test("ArrowDown does nothing when there is no selectable row", () => {
  const api = loadApi();
  const empty = api.el("div");
  api.paintResultItem(empty, 'No results for "zz"', "tag", false);
  api.searchResults.appendChild(empty);
  const hidden = key("ArrowDown");
  assert.equal(api.focusFirstResult(hidden), false);
  assert.equal(hidden.prevented, false);

  api.searchResults.style.display = "none";
  const place = addRow(api, "Athens");
  const down = key("ArrowDown");
  assert.equal(api.focusFirstResult(down), false);
  assert.equal(down.prevented, false);
  assert.equal(place.focused, false);
});

function loadPlaceApi() {
  const sink = { current: null };
  return new Function(
    "document",
    `${["foldPlaceName", "placeSuggestion", "fillPlaceLabel"].map(readFn).join("\n")}\nreturn { placeSuggestion, fillPlaceLabel };`,
  )({ createElement: (tag) => createEl(tag, sink) });
}

test("a different native name is shown and an identical one is not", () => {
  const api = loadPlaceApi();
  const different = api.placeSuggestion({
    display_name: "Munich, Bavaria, Germany",
    namedetails: { name: "München" },
  });
  assert.equal(different.native, "München");
  assert.equal(different.text, "Munich München, Bavaria, Germany");
  assert.ok(different.text.length > "Munich, Bavaria, Germany".length);

  const label = createEl("span");
  api.fillPlaceLabel(label, different);
  const mark = label.children.find((child) => String(child.className).includes("search-result-native"));
  assert.ok(mark);
  assert.equal(mark.textContent, "München");
  assert.equal(label.textContent, "Munich München, Bavaria, Germany");

  const same = api.placeSuggestion({
    display_name: "Munich, Bavaria, Germany",
    namedetails: { name: "Munich" },
  });
  assert.equal(same.native, "");
  assert.equal(same.text, "Munich, Bavaria, Germany");
  const plain = createEl("span");
  api.fillPlaceLabel(plain, same);
  assert.equal(plain.textContent, "Munich, Bavaria, Germany");
  assert.equal(plain.children.some((child) => String(child.className).includes("search-result-native")), false);

  const accent = api.placeSuggestion({
    display_name: "Zurich, Switzerland",
    namedetails: { name: "Zürich" },
  });
  assert.equal(accent.native, "");
  const capital = api.placeSuggestion({
    display_name: "Zagreb, Croatia",
    namedetails: { name: "ZAGREB" },
  });
  assert.equal(capital.native, "");

  assert.match(source, /namedetails=1/);
  assert.match(source, /accept-language=en/);
  assert.match(source, /addressdetails=1/);
  assert.match(source, /suggestion\.text\.length/);
  assert.match(source, /fillPlaceLabel\(label, suggestion\)/);
  assert.match(source, /r\.display_name\.split\(','\)\[0\]/);
  assert.match(source, /r\.address && r\.address\.country/);
  const nativeAt = css.indexOf(".search-result-native");
  assert.notEqual(nativeAt, -1);
  assert.match(css.slice(nativeAt, nativeAt + 80), /color:\s*rgba\(255,\s*255,\s*255,\s*0\.45\)/);
  const emptyAt = css.indexOf(".search-empty");
  assert.match(css.slice(emptyAt, emptyAt + 180), /color:\s*rgba\(255,\s*255,\s*255,\s*0\.45\)/);
});

test("result rows keep their size and use the cyan focus ring", () => {
  assert.match(css, /#search-bar \.search-result-item \{[\s\S]*?height: 56px;\s*min-height: 56px;/);
  const ringAt = css.indexOf("#search-bar .search-result-item:focus-visible");
  assert.notEqual(ringAt, -1);
  const ring = css.slice(ringAt, ringAt + 180);
  assert.match(ring, /outline: 2px solid #22D3EE;/);
  assert.match(ring, /outline-offset: 2px;/);
  assert.equal(ring.includes("background"), false);
});
