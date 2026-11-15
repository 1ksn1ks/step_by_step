// readingring.js — a box's own border, lit clockwise as you read what
// scrolls inside it: a map popup's text (popuptext.js) and the Swap
// sheet's bio (swapsheet.js).
//
// The ring is one rounded rect on the border's centre line with the box's
// own corners, in an SVG sized to the box's border box. An SVG rect's
// outline starts where the top-left curve ends and runs clockwise, so a
// dash that grows with the reading goes once round the box; the whole
// loop is the end of the text. It reads as the border lighting up, not a
// line added to it. style.css .reading-ring draws it; the box must not
// clip (the ring and its glow sit on and past the border).
//
// No app imports, so any module can use it without an import cycle.

const SVG_NS = 'http://www.w3.org/2000/svg';
let ringIds = 0;

// className: what the caller's CSS shows or places it by.
export function createRing(className = '') {
  const id = `reading-ring-grad-${++ringIds}`;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', ['reading-ring', className].filter(Boolean).join(' '));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const defs = document.createElementNS(SVG_NS, 'defs');
  const grad = document.createElementNS(SVG_NS, 'linearGradient');
  grad.setAttribute('id', id);
  grad.setAttribute('x1', '0');
  grad.setAttribute('y1', '0');
  grad.setAttribute('x2', '1');
  grad.setAttribute('y2', '1');
  for (const [offset, name] of [['0', 'reading-ring-stop-a'], ['1', 'reading-ring-stop-b']]) {
    const stop = document.createElementNS(SVG_NS, 'stop');
    stop.setAttribute('offset', offset);
    stop.setAttribute('class', name);
    grad.appendChild(stop);
  }
  defs.appendChild(grad);
  const line = document.createElementNS(SVG_NS, 'rect');
  line.setAttribute('class', 'reading-ring-line');
  line.setAttribute('stroke', `url(#${id})`);
  svg.append(defs, line);
  return { svg, line, key: '', perim: 0, lit: -1 };
}

// Size the ring to the box's border box, on the border line, with the
// border's corners. Call it when the box may have resized; it writes only
// on a change, and the dash is repainted for the new length.
export function fitRing(ring, box) {
  const w = box.offsetWidth;
  const h = box.offsetHeight;
  if (!w || !h) return;
  const cs = getComputedStyle(box);
  const bw = parseFloat(cs.borderTopWidth) || 0;
  const radius = parseFloat(cs.borderTopLeftRadius) || 0;
  const key = `${w}:${h}:${bw}:${radius}`;
  if (ring.key === key) return;
  ring.key = key;
  const half = bw / 2;
  const rw = Math.max(0, w - bw);
  const rh = Math.max(0, h - bw);
  const rx = Math.max(0, Math.min(radius - half, rw / 2, rh / 2));
  const { svg, line } = ring;
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  // Absolute in the box's padding box: back out over the border.
  svg.style.left = `${-bw}px`;
  svg.style.top = `${-bw}px`;
  line.setAttribute('x', String(half));
  line.setAttribute('y', String(half));
  line.setAttribute('width', String(rw));
  line.setAttribute('height', String(rh));
  line.setAttribute('rx', String(rx));
  line.setAttribute('ry', String(rx));
  ring.perim = 2 * (rw + rh) - (8 - 2 * Math.PI) * rx;
  ring.lit = -1;
}

// fraction: 0 at the top of the text, 1 at its end.
export function paintRing(ring, fraction) {
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  const lit = Math.round(f * ring.perim * 100) / 100;
  if (lit === ring.lit) return;
  ring.lit = lit;
  ring.line.style.strokeDasharray = `${lit} ${ring.perim + 1}`;
  // A zero-length dash still draws its round cap as a dot.
  ring.line.style.visibility = lit > 0 ? 'visible' : 'hidden';
}

// How long the ring stays bright after the text last moved.
export const RING_SETTLE_MS = 900;

// The ring brightens while the text moves and settles once it stops.
export function brightenRing(ring) {
  if (!ring.svg.classList.contains('is-scrolling')) ring.svg.classList.add('is-scrolling');
  clearTimeout(ring.settle);
  ring.settle = setTimeout(() => ring.svg.classList.remove('is-scrolling'), RING_SETTLE_MS);
}

// The whole thing for a box whose child scrolls: the ring on the box, the
// edge fades on the scroller (.is-above / .is-below: more text past that
// edge), and onOverflow(over) when the text starts or stops being longer
// than the scroller. refresh() after the text changes.
export function watchReadingRing(box, scroller, { className = '', onOverflow } = {}) {
  const ring = createRing(className);
  box.appendChild(ring.svg);
  let frame = 0;
  let over = null;
  const paint = () => {
    frame = 0;
    fitRing(ring, box);
    const room = scroller.scrollHeight - scroller.clientHeight;
    const now = room > 1;
    if (now !== over) {
      over = now;
      box.classList.toggle('has-reading-ring', now);
      if (typeof onOverflow === 'function') onOverflow(now);
    }
    const top = scroller.scrollTop;
    const above = now && top > 1;
    const below = now && top < room - 1;
    if (scroller.classList.contains('is-above') !== above) scroller.classList.toggle('is-above', above);
    if (scroller.classList.contains('is-below') !== below) scroller.classList.toggle('is-below', below);
    paintRing(ring, now ? top / room : 0);
  };
  const queue = () => {
    if (!frame) frame = requestAnimationFrame(paint);
  };
  scroller.addEventListener('scroll', () => {
    queue();
    brightenRing(ring);
  }, { passive: true });
  if (typeof ResizeObserver === 'function') {
    const sizes = new ResizeObserver(queue);
    sizes.observe(box);
    sizes.observe(scroller);
  }
  return {
    ring,
    refresh() {
      ring.key = '';
      queue();
    },
  };
}
