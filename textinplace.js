// Change an element's text by editing its one text node, not by swapping
// it (textContent removes the old node and inserts a new one). The style
// sheet has many :has() rules; Chrome answers any child added or removed
// under them by restyling all of body and #feed-layout, which in the feed
// is thousands of elements. Editing a text node's data is not a child
// change, so a counter or a clock that ticks restyles nothing.
//
//   setTextInPlace(counter, '18 B / 18 KB')
export function setTextInPlace(el, text) {
  if (!el) return;
  const value = String(text);
  const node = el.firstChild;
  if (node && node.nodeType === 3 && !node.nextSibling) {
    if (node.data !== value) node.data = value;
    return;
  }
  el.textContent = value;
}
