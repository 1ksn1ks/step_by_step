// One three-dot menu per post, in the spot the Follow button used to take.
// Follow, donate, and copy link stay the actions they already were.

import { connectedAccount } from './web3.js';
import { bindDonationTarget, openDonation } from './donations.js';

const DOTS = [
  ['circle', { cx: '5', cy: '12', r: '1.6' }],
  ['circle', { cx: '12', cy: '12', r: '1.6' }],
  ['circle', { cx: '19', cy: '12', r: '1.6' }],
];

let seq = 0;
let openPanel = null;
let globals = false;

function dotsIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  for (const [name, attrs] of DOTS) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    svg.appendChild(node);
  }
  return svg;
}

function menuItem(className, label) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'post-menu-item ' + className;
  button.setAttribute('role', 'menuitem');
  button.textContent = label;
  return button;
}

function visibleItems(pop) {
  return [...pop.querySelectorAll('[role="menuitem"]')].filter((el) => !el.hidden && !el.disabled);
}

function installGlobals() {
  if (globals) return;
  globals = true;
  document.addEventListener('pointerdown', (event) => {
    if (!openPanel || openPanel.containsEvent(event)) return;
    openPanel.close();
  }, true);
  document.addEventListener('keydown', (event) => {
    if (!openPanel || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    openPanel.close({ focus: true });
  }, true);
  window.addEventListener('scroll', () => {
    if (!openPanel || openPanel.settling()) return;
    openPanel.close();
  }, true);
  window.addEventListener('resize', () => {
    if (openPanel) openPanel.place();
  });
}

export function createPostMenu({ followBtn, payer, donation, onCopy }) {
  installGlobals();
  const id = 'post-menu-' + (++seq);
  const root = document.createElement('div');
  root.className = 'post-menu';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'post-menu-btn';
  btn.setAttribute('aria-label', 'More');
  btn.setAttribute('aria-haspopup', 'menu');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', id);
  btn.appendChild(dotsIcon());

  const pop = document.createElement('div');
  pop.id = id;
  pop.className = 'post-menu-pop';
  pop.setAttribute('role', 'menu');
  pop.setAttribute('aria-label', 'Post');
  pop.hidden = true;

  const followItem = menuItem('post-menu-follow', 'Follow');
  const donateItem = menuItem('post-menu-donate', '');
  const donateLabel = document.createElement('span');
  donateLabel.className = 'post-menu-label';
  donateLabel.textContent = 'Donate HBAR';
  const donateAmount = document.createElement('span');
  donateAmount.className = 'donate-amount';
  donateAmount.hidden = true;
  donateItem.append(donateLabel, donateAmount);
  const canDonate = bindDonationTarget(donateItem, donation);
  const copyItem = menuItem('post-menu-copy', 'Copy link');
  pop.append(followItem, donateItem, copyItem);

  const home = document.createElement('span');
  home.hidden = true;
  root.append(btn, pop, home);

  function isOwn() {
    if (followBtn && followBtn.hidden) return true;
    const me = typeof connectedAccount === 'string' ? connectedAccount : '';
    return !!(payer && me && payer === me);
  }

  function syncItems() {
    const own = isOwn();
    followItem.hidden = !followBtn || own;
    donateItem.hidden = own || !canDonate;
    if (followBtn && !followItem.hidden) {
      const label = followBtn.getAttribute('aria-label') === 'Unfollow' ? 'Unfollow' : 'Follow';
      followItem.textContent = label;
      followItem.disabled = !!followBtn.disabled;
    }
  }

  function place() {
    const anchor = btn.getBoundingClientRect();
    const padX = window.innerWidth * 0.02;
    const padY = window.innerHeight * 0.02;
    const gap = window.innerHeight * 0.006;
    const rect = pop.getBoundingClientRect();
    let left = anchor.right - rect.width;
    let top = anchor.bottom + gap;
    if (top + rect.height > window.innerHeight - padY) top = anchor.top - gap - rect.height;
    if (top < padY) top = padY;
    if (left < padX) left = padX;
    if (left + rect.width > window.innerWidth - padX) left = Math.max(padX, window.innerWidth - padX - rect.width);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }

  let anchorWatch = 0;
  let anchorSig = '';
  let openedAt = 0;

  function stopWatch() {
    cancelAnimationFrame(anchorWatch);
    anchorWatch = 0;
    anchorSig = '';
  }

  function watchAnchor() {
    if (openPanel !== panel) return;
    const box = btn.getBoundingClientRect();
    const sig = box.top.toFixed(1) + '|' + box.left.toFixed(1);
    if (anchorSig && sig !== anchorSig && !panel.settling()) {
      panel.close();
      return;
    }
    anchorSig = sig;
    anchorWatch = requestAnimationFrame(watchAnchor);
  }

  function close(options) {
    if (pop.hidden && openPanel !== panel) return;
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (pop.parentNode !== root) root.insertBefore(pop, home);
    stopWatch();
    if (openPanel === panel) openPanel = null;
    if (options && options.focus) btn.focus();
  }

  function open() {
    if (openPanel && openPanel !== panel) openPanel.close();
    syncItems();
    pop.hidden = false;
    pop.style.visibility = 'hidden';
    document.body.appendChild(pop);
    place();
    pop.style.visibility = '';
    btn.setAttribute('aria-expanded', 'true');
    openPanel = panel;
    openedAt = performance.now();
    anchorSig = '';
    watchAnchor();
    const first = visibleItems(pop)[0];
    if (first) first.focus({ preventScroll: true });
  }

  const panel = {
    containsEvent(event) {
      const target = event.target;
      return !!(target && (btn.contains(target) || pop.contains(target)));
    },
    close,
    place,
    settling: () => performance.now() - openedAt < 120,
  };

  btn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (openPanel === panel) close();
    else open();
  });

  pop.addEventListener('keydown', (event) => {
    const items = visibleItems(pop);
    if (!items.length) return;
    const index = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(index + 1 + items.length) % items.length].focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(index - 1 + items.length) % items.length].focus();
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

  function pick(item, run) {
    item.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (item.hidden || item.disabled) return;
      close();
      run();
    });
  }

  pick(followItem, () => {
    if (followBtn) followBtn.click();
  });
  pick(donateItem, () => {
    openDonation(donateItem);
  });
  pick(copyItem, () => {
    if (typeof onCopy === 'function') onCopy();
  });

  syncItems();
  if (followBtn) {
    new MutationObserver(syncItems).observe(followBtn, {
      attributes: true,
      attributeFilter: ['hidden', 'aria-label', 'disabled'],
    });
  }

  return root;
}
