// A payer username opens that payer's CLICK2LINK. The address chip is on
// document.body: map popups and chats use overflow:hidden plus a transform,
// which would clip a tip drawn inside them and would also trap position:fixed.

let tip = null;
let tipFor = null;
let tracking = false;

export function safeHttpUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return text;
  } catch {
    return '';
  }
}

function ensureTip() {
  if (tip) return tip;
  tip = document.createElement('div');
  tip.className = 'payer-link-tip';
  tip.hidden = true;
  document.body.appendChild(tip);
  window.addEventListener('scroll', hidePayerLinkTip, true);
  window.addEventListener('blur', hidePayerLinkTip);
  return tip;
}

export function hidePayerLinkTip() {
  tipFor = null;
  if (tracking) {
    tracking = false;
    window.removeEventListener('mousemove', trackTip);
  }
  if (tip) tip.hidden = true;
}

function trackTip(event) {
  if (!tipFor || !tipFor.isConnected) {
    hidePayerLinkTip();
    return;
  }
  const hit = document.elementFromPoint(event.clientX, event.clientY);
  if (hit !== tipFor && !(hit && tipFor.contains(hit))) hidePayerLinkTip();
}

function showTip(el, url) {
  const node = ensureTip();
  if (node.textContent !== url) node.textContent = url;
  node.hidden = false;
  tipFor = el;
  const rect = el.getBoundingClientRect();
  const tipRect = node.getBoundingClientRect();
  const pad = 8;
  let left = rect.left + (rect.width - tipRect.width) / 2;
  let top = rect.top - tipRect.height - 8;
  const maxLeft = Math.max(pad, window.innerWidth - tipRect.width - pad);
  left = Math.max(pad, Math.min(left, maxLeft));
  if (top < pad) top = Math.min(rect.bottom + 8, Math.max(pad, window.innerHeight - tipRect.height - pad));
  node.style.left = `${Math.round(left)}px`;
  node.style.top = `${Math.round(top)}px`;
  if (!tracking) {
    tracking = true;
    window.addEventListener('mousemove', trackTip, { passive: true });
  }
}

// Makes the element open the payer's http(s) address. Hover and keyboard
// focus show that address. The click is not cancelled, so the browser still
// follows the link. Returns false when the address is missing or not http(s).
export function attachPayerLink(el, rawUrl) {
  const url = safeHttpUrl(rawUrl);
  if (!el || !url) return false;
  el.href = url;
  el.target = '_blank';
  el.rel = 'noopener noreferrer';
  el.classList.add('payer-link');
  el.style.textDecoration = 'underline';
  el.style.textUnderlineOffset = '0.12em';
  el.style.cursor = 'pointer';
  const show = () => {
    if (!el.isConnected) {
      hidePayerLinkTip();
      return;
    }
    showTip(el, url);
  };
  const hide = () => {
    if (tipFor === el) hidePayerLinkTip();
  };
  el.addEventListener('mouseenter', show);
  el.addEventListener('focus', show);
  el.addEventListener('mouseleave', hide);
  el.addEventListener('blur', hide);
  el.addEventListener('click', (event) => {
    event.stopPropagation();
    hidePayerLinkTip();
  });
  return true;
}

// An anchor when rawUrl is http(s), otherwise a span. className and cssText
// are applied first so the link underline can replace text-decoration:none.
export function payerUsernameNode(name, rawUrl, { className = '', cssText = '' } = {}) {
  const url = safeHttpUrl(rawUrl);
  const el = document.createElement(url ? 'a' : 'span');
  if (className) el.className = className;
  if (cssText) el.style.cssText = cssText;
  el.textContent = name;
  if (url) attachPayerLink(el, url);
  return el;
}
