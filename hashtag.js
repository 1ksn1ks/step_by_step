// X-style hashtags. A tag starts with #, then a letter or underscore,
// then letters, numbers, or underscores. A tag cannot start mid-word,
// and a run of digits alone (#123) is not a tag. Matching is lowercase.

const TAG = /#([\p{L}_][\p{L}\p{N}_]{0,49})/gu;

function atWordBoundary(text, index) {
  if (index <= 0) return true;
  return !/^[\p{L}\p{N}_]$/u.test(text[index - 1]);
}

export function hashtagsIn(text) {
  const source = String(text || "");
  const tags = [];
  const seen = new Set();
  for (const match of source.matchAll(TAG)) {
    if (!atWordBoundary(source, match.index)) continue;
    const key = match[1].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(key);
  }
  return tags;
}

// The search box is a hashtag search when the query starts with #.
// Returns the first tag, or "" while the user is still typing it.
export function hashtagQuery(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed.startsWith("#")) return "";
  return hashtagsIn(trimmed)[0] || "";
}

// Titles, names, and topic pills stay one line. A newline is a space.
export function singleLineText(text) {
  return String(text == null ? "" : text).replace(/\r\n/g, "\n").replace(/\n/g, " ");
}

// Posted title and message. Buttons stay out of the saved text.
// Newlines stay in text nodes. The bubble's white-space shows them.
export function paintHashtags(el, text) {
  const source = String(text || "");
  el.replaceChildren();
  let last = 0;
  for (const match of source.matchAll(TAG)) {
    if (!atWordBoundary(source, match.index)) continue;
    if (match.index > last) el.append(document.createTextNode(source.slice(last, match.index)));
    const raw = match[1];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "post-hashtag";
    button.textContent = `#${raw}`;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      event.preventDefault();
      document.dispatchEvent(new CustomEvent("hashtag-search", { detail: raw.toLowerCase() }));
    });
    el.append(button);
    last = match.index + match[0].length;
  }
  if (last < source.length) el.append(document.createTextNode(source.slice(last)));
}
