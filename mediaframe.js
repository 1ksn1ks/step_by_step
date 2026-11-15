// mediaframe.js — the media frame feed cards and map popups share.
//
// Every picture, GIF and video starts in one compact 16:9 frame
// (style.css .popup-media-card). The whole of it is fitted inside, and a
// blurred, darkened copy fills the rest of the frame (mountMediaBackdrop).
// A round ··· on its top right (mountMediaTools) slides out two more: one
// makes the media full size at its own shape and back, one opens it
// fullscreen. The feed and popups each have their own Show media full size
// switch (feedlayout.js, processallmessages.js), which starts every frame
// full size; a post's own size button wins for the session.
//
// The caller passes what differs between the feed and a popup:
//   key        the post's id for its size choice
//   onFull     opens the fullscreen viewer
//   video      the <video> when the ··· follows the native control bar
//   canAct     false for a tap that was really a drag (feed scrolling)
//   startsWide whether this post starts full size (its switch, its choice)
//   remember   keeps the post's size choice

import { isGifUrl, needsGifCheck, readGifCache } from './mediaurl.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgIcon(parts) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('overflow', 'visible');
  svg.setAttribute('aria-hidden', 'true');
  for (const [name, attrs] of parts) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    svg.appendChild(node);
  }
  return svg;
}

// The ··· buttons sit above the card's tap layer, so a tap on them never
// plays or pauses a video.
const MEDIA_MORE_ICON = [
  ['circle', { cx: '5', cy: '12', r: '1' }],
  ['circle', { cx: '12', cy: '12', r: '1' }],
  ['circle', { cx: '19', cy: '12', r: '1' }],
];
const MEDIA_CLOSE_ICON = [
  ['path', { d: 'M18 6 6 18' }],
  ['path', { d: 'm6 6 12 12' }],
];
const MEDIA_GROW_ICON = [
  ['path', { d: 'M15 3h6v6' }],
  ['path', { d: 'M9 21H3v-6' }],
  ['path', { d: 'm21 3-7 7' }],
  ['path', { d: 'm3 21 7-7' }],
];
const MEDIA_SHRINK_ICON = [
  ['path', { d: 'M4 14h6v6' }],
  ['path', { d: 'M20 10h-6V4' }],
  ['path', { d: 'm14 10 7-7' }],
  ['path', { d: 'm3 21 7-7' }],
];
const MEDIA_FULL_ICON = [
  ['path', { d: 'M8 3H5a2 2 0 0 0-2 2v3' }],
  ['path', { d: 'M21 8V5a2 2 0 0 0-2-2h-3' }],
  ['path', { d: 'M3 16v3a2 2 0 0 0 2 2h3' }],
  ['path', { d: 'M16 21h3a2 2 0 0 0 2-2v-3' }],
];

// Longest side of a GIF's still fill. The fill is blurred and dimmed, so a
// small copy looks the same as a full one.
const BACKDROP_PX = 96;

// Blur fill, as most feeds do it: the picture is fitted whole in the
// compact frame and a blurred copy of it fills the rest (style.css
// .feed-media-backdrop). It goes after the media, so a lookup of the
// card's first img still finds the picture.
//   Picture: an img with the same address. The browser decodes it off the
//   main thread (the file is already cached) and draws the blur once with
//   the card, so a scroll only moves it. It follows the picture's src, so
//   a gateway retry carries over.
//   GIF: it plays in the feed, and an img copy would decode it a second
//   time and blur every frame. Its fill is one still frame on a small
//   canvas instead, drawn when the page is idle after the GIF has loaded.
//   An address with no picture extension (IPFS) that is not yet known to
//   be a still is treated as a GIF: the feed paints it without checking,
//   and a gateway retry changes the address the check was saved under.
//   Video: an img that follows the poster, so a late poster carries over.
function backdropImg() {
  const back = document.createElement('img');
  back.className = 'feed-media-backdrop';
  back.alt = '';
  back.setAttribute('aria-hidden', 'true');
  back.draggable = false;
  back.decoding = 'async';
  back.loading = 'lazy';
  back.hidden = true;
  back.addEventListener('error', () => {
    back.hidden = true;
  });
  return back;
}

export function mountMediaBackdrop(media, source) {
  if (source.tagName !== 'VIDEO') {
    mountPictureBackdrop(source);
    return;
  }
  const back = backdropImg();
  const sync = () => {
    const url = source.getAttribute('poster') || '';
    if (!url) {
      back.hidden = true;
      back.removeAttribute('src');
      return;
    }
    if (back.getAttribute('src') !== url) back.src = url;
    back.hidden = false;
  };
  new MutationObserver(sync).observe(source, { attributes: true, attributeFilter: ['poster'] });
  source.after(back);
  sync();
}

// A GIF by its address, or an extensionless file not already checked as a
// still. Only a known still gets the img copy.
function gifBackdropSource(url) {
  if (isGifUrl(url) || /^data:image\/gif/i.test(url)) return true;
  return needsGifCheck(url) && readGifCache(url) !== false;
}

function mountPictureBackdrop(source) {
  const back = backdropImg();
  let still = null;
  let seq = 0;
  const hideStill = () => {
    if (still) still.hidden = true;
  };
  const dropImg = () => {
    back.hidden = true;
    if (back.hasAttribute('src')) back.removeAttribute('src');
  };
  const paintStill = (run) => {
    const w = source.naturalWidth;
    const h = source.naturalHeight;
    if (run !== seq || !w || !h || !source.getAttribute('src')) return;
    if (!still) {
      still = document.createElement('canvas');
      still.className = 'feed-media-backdrop';
      still.setAttribute('aria-hidden', 'true');
      still.hidden = true;
      back.after(still);
    }
    const scale = Math.min(1, BACKDROP_PX / Math.max(w, h));
    try {
      still.width = Math.max(1, Math.round(w * scale));
      still.height = Math.max(1, Math.round(h * scale));
      // A cross-origin GIF taints the canvas, which only stops reading it
      // back. A canvas draw of an animated image takes one frame.
      still.getContext('2d').drawImage(source, 0, 0, still.width, still.height);
      still.hidden = false;
    } catch {
      still.hidden = true;
    }
  };
  const sync = () => {
    const run = ++seq;
    const url = source.getAttribute('src') || '';
    if (!url) {
      dropImg();
      hideStill();
      return;
    }
    if (!gifBackdropSource(url)) {
      hideStill();
      if (back.getAttribute('src') !== url) back.src = url;
      back.hidden = false;
      return;
    }
    dropImg();
    hideStill();
    const loaded = () => {
      if (run !== seq) return;
      const idle = typeof requestIdleCallback === 'function'
        ? (fn) => requestIdleCallback(fn, { timeout: 1500 })
        : (fn) => setTimeout(fn, 200);
      // decode() finishes off the main thread, so the draw reads a frame
      // that is already decoded.
      const ready = typeof source.decode === 'function' ? source.decode().catch(() => {}) : Promise.resolve();
      ready.then(() => idle(() => paintStill(run)));
    };
    if (source.complete && source.naturalWidth) loaded();
    else source.addEventListener('load', loaded, { once: true });
  };
  source.addEventListener('error', () => {
    seq++;
    dropImg();
    hideStill();
  });
  new MutationObserver(sync).observe(source, { attributes: true, attributeFilter: ['src'] });
  source.after(back);
  sync();
}

// How long the ··· stays after the last touch or mouse move. Chrome's own
// video control bar hides after the same 2.5 s, so on a video the two
// come and go together, and a picture keeps the same rhythm.
const MEDIA_TOOLS_IDLE_MS = 2500;

// The ··· is hidden at rest (.is-tools-shown on the media shows it).
//   Picture: a tap shows it (a second tap hides it); a mouse shows it while
//     it moves over the picture. It hides 2.5 s after the last of those.
//   Video: it follows the native control bar. It shows while that bar is
//     on and the video is paused, or for 2.5 s after a touch or mouse move
//     while it plays. A tap still plays or pauses.
//   Open (the ··· turned ×): it stays until × or Escape, then hides after
//     the same 2.5 s. Make bigger keeps it open.
// Returns tap(event) for the picture's tap layer.
// Every media type starts full size when startsWide(key) says so (Settings >
// Show media full size, unless the post's own size button chose otherwise).
export function mountMediaTools(media, {
  key = '',
  onFull,
  video = null,
  canAct = () => true,
  startsWide = () => false,
  remember = () => {},
} = {}) {
  const tools = document.createElement('div');
  tools.className = 'feed-media-tools';
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'feed-media-tool feed-media-more';
  more.setAttribute('aria-haspopup', 'true');
  const size = document.createElement('button');
  size.type = 'button';
  size.className = 'feed-media-tool feed-media-size';
  const full = document.createElement('button');
  full.type = 'button';
  full.className = 'feed-media-tool feed-media-full';
  full.setAttribute('aria-label', 'Fullscreen');
  full.title = 'Fullscreen';
  full.appendChild(svgIcon(MEDIA_FULL_ICON));
  const paint = () => {
    const wide = media.classList.contains('is-wide');
    const label = wide ? 'Make smaller' : 'Make bigger';
    size.setAttribute('aria-pressed', wide ? 'true' : 'false');
    size.setAttribute('aria-label', label);
    size.title = label;
    size.replaceChildren(svgIcon(wide ? MEDIA_SHRINK_ICON : MEDIA_GROW_ICON));
  };
  // data-picture marks a card the feed's size switch resizes (it looks only
  // inside the feed).
  media.dataset.picture = '1';
  if (key) media.dataset.mediaKey = key;
  media._paintSize = paint;
  if (startsWide(key)) media.classList.add('is-wide');
  paint();
  tools.append(size, full, more);

  let recent = false;
  let idleTimer = 0;
  const isOpen = () => tools.classList.contains('is-open');
  const paintShown = () => {
    let shown = recent;
    if (isOpen()) shown = true;
    else if (video) shown = !!video.controls && (video.paused || recent);
    media.classList.toggle('is-tools-shown', shown);
  };
  // Shown now, hidden MEDIA_TOOLS_IDLE_MS after the last call.
  const wake = () => {
    recent = true;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = 0;
      recent = false;
      paintShown();
    }, MEDIA_TOOLS_IDLE_MS);
    paintShown();
  };
  const sleepNow = () => {
    clearTimeout(idleTimer);
    idleTimer = 0;
    recent = false;
    paintShown();
  };
  const setOpen = (open) => {
    tools.classList.toggle('is-open', open);
    more.setAttribute('aria-expanded', open ? 'true' : 'false');
    more.setAttribute('aria-label', open ? 'Hide media options' : 'Media options');
    more.title = open ? 'Hide' : 'Media options';
    more.replaceChildren(svgIcon(open ? MEDIA_CLOSE_ICON : MEDIA_MORE_ICON));
    // Closing starts the countdown; open keeps it in view.
    if (open) paintShown();
    else wake();
  };
  setOpen(false);
  sleepNow();

  // A keyboard click has detail 0 and no pointer, so only a tap is checked
  // for a drag.
  more.addEventListener('click', (event) => {
    event.stopPropagation();
    if (event.detail > 0 && !canAct(event)) return;
    setOpen(!isOpen());
  });
  size.addEventListener('click', (event) => {
    event.stopPropagation();
    if (event.detail > 0 && !canAct(event)) return;
    const wide = !media.classList.contains('is-wide');
    media.classList.toggle('is-wide', wide);
    if (key) remember(key, wide);
    paint();
  });
  full.addEventListener('click', (event) => {
    event.stopPropagation();
    if (event.detail > 0 && !canAct(event)) return;
    setOpen(false);
    onFull();
  });
  tools.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !isOpen()) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    more.focus();
  });
  // A mouse shows it while it moves over the media and drops it on leave,
  // as the native video bar does.
  media.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'mouse') wake();
  });
  media.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'mouse') sleepNow();
  });
  if (video) {
    // Any touch on a video (the tap layer or the native bar) counts as use.
    media.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'mouse') wake();
    });
    video.addEventListener('play', paintShown);
    video.addEventListener('pause', paintShown);
    // The poster face turns the native bar off until the first play.
    new MutationObserver(paintShown).observe(video, { attributes: true, attributeFilter: ['controls'] });
  }
  media.appendChild(tools);
  paintShown();
  return {
    // The picture's tap: show or hide the ···; a click only shows it.
    tap(event) {
      if (isOpen()) return;
      if (event && event.pointerType === 'mouse') {
        wake();
        return;
      }
      if (recent) sleepNow();
      else wake();
    },
  };
}
