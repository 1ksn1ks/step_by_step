// mediagrid.js — a post's pictures on a feed card, and the "+N" badge.
//
// Feed (buildMediaGrid): the X layout. Two pictures side by side, three as
// one large on the left and two small on the right, four as a 2x2 grid,
// all in one 16:9 frame the card's width. Each tile is cropped to fill
// (object-fit: cover); a tap opens the viewer at that picture
// (fullscreenmedia.js openGallery). One picture keeps the shared media
// frame (mediaframe.js), not this grid.
//
// Map popups and the draw form (mountMoreBadge): the first picture keeps
// its frame and a small "+N" in its corner opens the same viewer.
//
// Tiles load lazily (loading="lazy"): a card far down the feed fetches
// nothing until it nears the screen, the way a single picture does.

import { presentImage } from './loopmedia.js';

export function buildMediaGrid(urls, { onOpen, canTap = () => true } = {}) {
  const list = Array.isArray(urls) ? urls.slice(0, 4) : [];
  const grid = document.createElement('div');
  grid.className = 'post-gallery';
  grid.dataset.count = String(list.length);
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', `${list.length} images`);
  list.forEach((url, index) => {
    const tile = document.createElement('div');
    tile.className = 'post-gallery-tile';
    tile.setAttribute('role', 'button');
    tile.tabIndex = 0;
    tile.setAttribute('aria-label', `Open image ${index + 1} of ${list.length}`);
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    img.loading = 'lazy';
    img.decoding = 'async';
    tile.appendChild(img);
    presentImage(img, url, { play: true });
    const open = () => {
      if (typeof onOpen === 'function') onOpen(index);
    };
    // A keyboard click has detail 0; only a pointer tap is checked for a
    // drag (a feed scroll that started on the picture).
    tile.addEventListener('click', (event) => {
      event.stopPropagation();
      if (event.detail > 0 && !canTap(event)) return;
      open();
    });
    tile.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      open();
    });
    grid.appendChild(tile);
  });
  return grid;
}

// "+3" on the first picture's frame. Returns the badge, or null for a post
// with one picture. A second call on the same frame repaints it.
export function mountMoreBadge(card, more, onOpen) {
  if (!card) return null;
  let badge = card.querySelector(':scope > .post-more-badge');
  const count = Math.max(0, Math.floor(Number(more) || 0));
  if (!count) {
    if (badge) badge.remove();
    card.classList.remove('has-more-images');
    return null;
  }
  if (!badge) {
    badge = document.createElement('button');
    badge.type = 'button';
    badge.className = 'post-more-badge';
    // The popup's swipe pager and the draw card's picker leave it alone.
    badge.addEventListener('pointerdown', (event) => event.stopPropagation());
    badge.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof badge._open === 'function') badge._open();
    });
    card.appendChild(badge);
  }
  badge._open = onOpen;
  badge.textContent = `+${count}`;
  badge.setAttribute('aria-label', `Show all ${count + 1} images`);
  badge.title = `${count + 1} images`;
  card.classList.add('has-more-images');
  return badge;
}
