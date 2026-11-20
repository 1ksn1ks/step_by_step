// App wiring for the typing layer. Imports only the core. Form fields are
// allowlisted and the flag defaults off, so search, chat, and draw stay on
// the sheet pin until their own steps. Chat Send, when it arrives, clears
// the mirror and leaves the layer open. This file's cover is for a real
// close, not for every send.

import './typingscreen.css';
import {
  activationDecision,
  isTypingCandidate,
  mountTypingHost,
  typingEnabled,
} from './typingscreen.js';

const WATCH_MS = 700;

const FORM_IDS = new Set([
  'donate-amount',
  'donate-memo',
  'edit-profile-username-input',
  'edit-profile-click2link-input',
  'Edit_Profile-bio',
  'edit-profile-topic-input',
  'edit-profile-public-key-input',
  'edit-profile-swap-token',
  'edit-profile-swap-fee',
  'edit-profile-swap-bio-input',
  'domain-name-input',
  'domain-topic-id',
  'input-field',
  'unlockkey-load',
  'load-msgs-from-ids',
  'load-blocks-from-ids',
  'input-field-5-1',
  'input-field-5-2',
  'input-field-topic-id-for-initial-xyz',
  'input-field-lng-lat-for-initial-xyz',
  'input-field-zoom-for-initial-xyz',
  'input-field-topic-id-for-utility',
  'input-field-add-remove-NFT-for-model',
  'input-field-add-remove-scale-for-model',
  'input-field-add-remove-topic-chat',
  'input-field-topic-id-for-markers',
  'input-field-messages-per-nft-for-markers',
  'input-field-topic-id-for-polygons',
  'input-field-messages-per-nft-for-polygons',
  'input-field-messages-size-for-polygons',
  'input-field-autoplay-nft',
  'update-topic-target',
  'publickkey-load',
  'encrypt-key-load',
  'change-key-load',
  'encrypted-chat-private-key',
  'encrypted-chat-public-key',
  'encrypted-chat-change-password-key',
  'encrypted-chat-new-password-key',
  'input-field-admin-key',
  'input-field-admin-key-fee',
  'input-field-topic-id-bio',
  'topic-bio-input',
  'input-field-topic-id',
  'input-field-memo',
  'input-field-topic-id-fee',
  'input-field-memo-fee',
  'input-field-fee',
  'input-field-fee-token',
  'input-field-royal-acc',
  'input-field-topic-id-name',
  'input-field-topic-name',
  'stack-topic-ids-topic',
  'stack-topic-add-remove-topic',
  'topic-chat-topic-id',
  'encrypted-chat-topic-id',
  'load-msgs-from-ids-topic-chat',
  'load-blocks-from-ids-topic-chat',
  'load-msgs-from-ids-encrypted-chat',
  'load-blocks-from-ids-encrypted-chat',
  'popup-settings-edit-text',
  'popup-length-min',
  'popup-length-max',
  'popup-radius-km',
  'draw-date-year',
  'draw-date-hour',
  'draw-date-minute',
  'input-field-2-3',
  'input-field-3-3',
  'input-field-3-5',
  'object-input',
  'rotation-x-value',
  'rotation-y-value',
  'rotation-z-value',
  'position-x-value',
  'position-y-value',
  'position-z-value',
  'scale-factor-value',
  'crosshair-before-after-value',
  'crosshair-after-before-value',
]);

const FOLLOW_IDS = new Set(['input-field', 'topic-chat-topic-id', 'encrypted-chat-topic-id']);

export function formFieldAllowed(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.classList && el.classList.contains('install-choice-input')) return true;
  return !!(el.id && FORM_IDS.has(el.id));
}

function flagOn() {
  let query = null;
  try { query = new URLSearchParams(window.location.search).get('typing'); } catch { query = null; }
  let stored = null;
  try { stored = window.localStorage.getItem('typing-screen'); } catch { stored = null; }
  return typingEnabled({ query, stored, fallback: false });
}

function fieldFromTarget(target) {
  let node = target;
  if (node && node.nodeType === 3) node = node.parentElement;
  if (!node || !node.closest) return null;
  const direct = node.closest('input, textarea, [contenteditable]');
  if (direct) return direct;
  const label = node.closest('label');
  if (!label) return null;
  if (label.htmlFor) {
    const byId = document.getElementById(label.htmlFor);
    if (byId) return byId;
  }
  return label.querySelector('input, textarea, [contenteditable]');
}

function blockedPath(event) {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  for (let i = 0; i < path.length; i += 1) {
    const node = path[i];
    if (!node || !node.tagName) continue;
    const tag = node.tagName.toLowerCase();
    if (tag === 'wcm-modal' || tag === 'w3m-modal' || tag === 'appkit-modal') return true;
    if (node.id === 'upload-turnstile') return true;
  }
  return false;
}

function visibleField(el) {
  if (!isTypingCandidate(el)) return false;
  if (el.closest && el.closest('[hidden]')) return false;
  try {
    const style = window.getComputedStyle(el);
    if (style.pointerEvents === 'none' || style.display === 'none' || style.visibility === 'hidden') return false;
  } catch { return false; }
  if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) return false;
  return true;
}

function unscaled(view) {
  if (!view) return window.innerHeight || 0;
  const scale = view.scale > 1.01 ? view.scale : 1;
  return view.height * scale;
}

let session = 'unknown';
let suppressUntil = 0;
let restHeight = 0;
let restTop = 0;
let watchGen = 0;
let lastPointer = '';

function noteRest() {
  const view = window.visualViewport;
  restHeight = unscaled(view);
  restTop = view ? view.offsetTop : 0;
}

function keyboardShrunk() {
  const view = window.visualViewport;
  if (!view || !restHeight) return false;
  return unscaled(view) < restHeight * 0.75 || Math.abs(view.offsetTop - restTop) > 40;
}

function signalsFor(el, trusted, pointerType) {
  let coarse = false;
  let hoverNone = false;
  let fineHover = false;
  try {
    coarse = window.matchMedia('(pointer: coarse)').matches;
    hoverNone = window.matchMedia('(hover: none)').matches;
    fineHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  } catch { /* matchMedia can throw in a locked down webview */ }
  return activationDecision({
    candidate: true,
    pointerType: pointerType || '',
    coarse,
    hoverNone,
    fineHover,
    session,
    trustedFocus: !!trusted,
    suppressed: Date.now() < suppressUntil,
  });
}

function boot() {
  let fromHistory = false;
  const host = mountTypingHost(document, {
    history: {
      open(data) {
        if (typeof window.layerOpened === 'function') window.layerOpened('typing', { id: data && data.id || '' });
      },
      close() {
        if (fromHistory) return;
        if (typeof window.layerClosedByUI === 'function') window.layerClosedByUI('typing');
      },
    },
    onClose() {
      watchGen += 1;
      suppressUntil = Date.now() + 400;
    },
    adapters: [{
      name: 'follow',
      match(el) { return !!(el && FOLLOW_IDS.has(el.id)); },
      mount(slot) {
        const list = document.getElementById('follow-suggest');
        if (!list) return { update() {}, unmount() {} };
        const parent = list.parentNode;
        const next = list.nextSibling;
        list.style.position = 'static';
        list.style.top = '';
        list.style.left = '';
        list.style.width = '';
        list.style.right = '';
        slot.appendChild(list);
        return {
          update() {},
          unmount() {
            list.style.position = '';
            list.style.top = '';
            list.style.left = '';
            list.style.width = '';
            list.style.right = '';
            if (parent && parent.isConnected) parent.insertBefore(list, next);
            else document.body.appendChild(list);
          },
        };
      },
    }],
  });

  if (typeof window.defineLayer === 'function') {
    window.defineLayer('typing', {
      open() {},
      close() {
        fromHistory = true;
        try { host.dismiss('back'); } finally { fromHistory = false; }
      },
    });
  }

  function armWatch() {
    const gen = ++watchGen;
    noteRest();
    window.setTimeout(() => {
      if (gen !== watchGen) return;
      if (keyboardShrunk()) {
        session = 'software';
        return;
      }
      session = 'physical';
      const field = host.field();
      host.dismiss('commit');
      if (field && typeof field.focus === 'function') {
        try { field.focus({ preventScroll: true }); } catch { field.focus(); }
      }
    }, WATCH_MS);
  }

  function maybeOpen(el, trusted, pointerType, decision) {
    if (!el || !formFieldAllowed(el) || !visibleField(el)) return false;
    const choice = decision || signalsFor(el, trusted, pointerType);
    if (choice === 'inline') return false;
    const opened = host.field() !== el;
    host.open(el);
    if (choice === 'confirm' && opened) armWatch();
    return true;
  }

  document.addEventListener('pointerdown', (event) => {
    const screen = document.getElementById('typing-screen');
    if (screen && screen.contains(event.target)) return;
    if (!flagOn() || blockedPath(event)) return;
    lastPointer = event.pointerType || '';
    const el = fieldFromTarget(event.target);
    if (!el) return;
    const choice = signalsFor(el, true, lastPointer);
    if (choice === 'inline') return;
    if (!formFieldAllowed(el) || !visibleField(el)) return;
    event.preventDefault();
    maybeOpen(el, true, lastPointer, choice);
  }, true);

  document.addEventListener('focusin', (event) => {
    const target = event.target;
    if (!target || (target.closest && target.closest('#typing-screen'))) return;
    if (target.getAttribute && target.getAttribute('data-typing-mirror') === '1') return;
    if (!flagOn() || blockedPath(event)) return;
    const el = fieldFromTarget(target);
    if (!el || el !== target) return;
    maybeOpen(el, event.isTrusted, event.isTrusted ? lastPointer : '', null);
  }, true);

  function onViewport() {
    if (session === 'physical' && keyboardShrunk()) {
      session = 'software';
      const el = document.activeElement;
      if (el && formFieldAllowed(el) && visibleField(el)) host.open(el);
      return;
    }
    if (watchGen && keyboardShrunk()) session = 'software';
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onViewport);
    window.visualViewport.addEventListener('scroll', onViewport);
  }
}

if (typeof document !== 'undefined') boot();
