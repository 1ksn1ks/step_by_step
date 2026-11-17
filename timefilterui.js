// timefilterui.js — the time filter chip (feed toolbar, map top bar).
//
// A chip shows the open topic's filter ("All", "Today", "Week", "Month");
// a tap opens a short menu of the four choices. Picking one calls onPick;
// timefilter.js remembers it per topic and the feed and the map reload.
// The menu closes on a pick, Escape, or a press anywhere else.

import { TIME_FILTERS, filterLabel } from './timefilter.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function calendarIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ['M8 2v4', 'M16 2v4', 'M3 10h18']) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  const rect = document.createElementNS(SVG_NS, 'rect');
  for (const [k, v] of Object.entries({ x: '3', y: '4', width: '18', height: '18', rx: '2' })) rect.setAttribute(k, v);
  svg.appendChild(rect);
  return svg;
}

// variant: 'feed' | 'map' (style.css sizes each to its bar).
export function createTimeChip({ id, variant, onPick }) {
  const wrap = document.createElement('div');
  wrap.className = `time-filter is-${variant}`;
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.id = id;
  chip.className = 'time-filter-chip';
  chip.setAttribute('aria-haspopup', 'menu');
  chip.setAttribute('aria-expanded', 'false');
  const label = document.createElement('span');
  label.className = 'time-filter-label';
  chip.append(calendarIcon(), label);
  const menu = document.createElement('div');
  menu.className = 'time-filter-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  const items = TIME_FILTERS.map((filter) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'time-filter-item';
    item.setAttribute('role', 'menuitemradio');
    item.dataset.key = filter.key;
    item.textContent = filter.label;
    item.addEventListener('click', (event) => {
      event.stopPropagation();
      close(true);
      onPick(filter.key);
    });
    menu.appendChild(item);
    return item;
  });
  wrap.append(chip, menu);
  let current = 'all';

  const outside = (event) => {
    if (!wrap.contains(event.target)) close(false);
  };
  function open() {
    menu.hidden = false;
    chip.setAttribute('aria-expanded', 'true');
    wrap.classList.add('is-open');
    document.addEventListener('pointerdown', outside, true);
    const on = items.find((item) => item.dataset.key === current) || items[0];
    on.focus({ preventScroll: true });
  }
  function close(refocus) {
    if (menu.hidden) return;
    menu.hidden = true;
    chip.setAttribute('aria-expanded', 'false');
    wrap.classList.remove('is-open');
    document.removeEventListener('pointerdown', outside, true);
    if (refocus) chip.focus({ preventScroll: true });
  }
  chip.addEventListener('click', (event) => {
    event.stopPropagation();
    if (menu.hidden) open();
    else close(false);
  });
  menu.addEventListener('keydown', (event) => {
    const at = items.indexOf(document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      items[(Math.max(0, at) + step + items.length) % items.length].focus();
    }
  });
  // A press inside never reaches the page behind (the map, a feed card).
  wrap.addEventListener('click', (event) => event.stopPropagation());

  function paint(key) {
    current = key;
    label.textContent = filterLabel(key, true);
    const on = key !== 'all';
    chip.classList.toggle('is-on', on);
    const spoken = `Time: ${filterLabel(key)}`;
    chip.setAttribute('aria-label', spoken);
    chip.title = spoken;
    for (const item of items) item.setAttribute('aria-checked', item.dataset.key === key ? 'true' : 'false');
  }
  paint('all');
  return { el: wrap, paint, close: () => close(false) };
}
