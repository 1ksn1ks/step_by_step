// Popup stills wait in data-src. MapLibre places markers and popups with
// transforms, so a viewport IntersectionObserver (and loading="lazy") never
// reports them on phones. The feed does not use this module.

const watched = new WeakMap(); // img → { timer, io, armed }
const scrollObservers = new WeakMap(); // scroller → IntersectionObserver

function inViewport(el) {
  if (!el || !el.isConnected || typeof el.getBoundingClientRect !== 'function') return false;
  const box = el.getBoundingClientRect();
  if (!(box.width > 0) || !(box.height > 0)) return false;
  const width = window.innerWidth || document.documentElement.clientWidth || 0;
  const height = window.innerHeight || document.documentElement.clientHeight || 0;
  return box.bottom > 0 && box.right > 0 && box.top < height && box.left < width;
}

function stopWatch(el) {
  const state = watched.get(el);
  if (!state) return;
  if (state.timer) clearTimeout(state.timer);
  if (state.io) state.io.unobserve(el);
  watched.delete(el);
}

// data-src → src. Eager, so the browser does not apply its own lazy check.
export function loadMediaSrc(el) {
  if (!el) return;
  const url = el.dataset ? el.dataset.src : '';
  if (!url || el.getAttribute('src')) {
    stopWatch(el);
    return;
  }
  el.loading = 'eager';
  el.decoding = 'async';
  el.src = url;
  stopWatch(el);
}

// Once the element is in the document and its box sits in the viewport,
// one second with no src means the observer missed it. Load anyway.
function armFallback(el) {
  const state = watched.get(el);
  if (!state || state.armed) return;
  state.armed = true;
  state.visibleAt = 0;
  state.misses = 0;
  const check = () => {
    if (!watched.has(el) || el.getAttribute('src')) {
      stopWatch(el);
      return;
    }
    if (!el.isConnected) {
      if (state.seen || ++state.misses > 25) {
        stopWatch(el);
        return;
      }
      state.timer = setTimeout(check, 200);
      return;
    }
    state.seen = true;
    if (!inViewport(el)) {
      state.visibleAt = 0;
      state.timer = setTimeout(check, 400);
      return;
    }
    if (!state.visibleAt) state.visibleAt = Date.now();
    if (Date.now() - state.visibleAt < 1000) {
      state.timer = setTimeout(check, 200);
      return;
    }
    loadMediaSrc(el);
  };
  state.timer = setTimeout(check, 200);
}

// Hold the URL off src until the popup opens or the fallback fires.
// No viewport observer: that is the check phones miss.
export function holdMedia(el, url) {
  if (!el || !url) return;
  el.dataset.src = url;
  el.decoding = 'async';
  el.removeAttribute('src');
  if (watched.has(el)) stopWatch(el);
  watched.set(el, { timer: 0, io: null, armed: false });
  armFallback(el);
}

function popupScroller(root) {
  const body = root.querySelector && root.querySelector('.popup-body');
  if (!body || body.clientHeight < 1) return null;
  if (body.scrollHeight > body.clientHeight + 1) return body;
  return null;
}

function belowFold(img, scroller) {
  const box = img.getBoundingClientRect();
  if (!(box.width > 0) || !(box.height > 0)) return false;
  const port = scroller.getBoundingClientRect();
  return box.top >= port.bottom - 1;
}

function observeInScroller(img, scroller) {
  let io = scrollObservers.get(scroller);
  if (!io) {
    io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) loadMediaSrc(entry.target);
      }
    }, { root: scroller, threshold: 0 });
    scrollObservers.set(scroller, io);
  }
  const state = watched.get(img) || { timer: 0, io: null, armed: false };
  if (state.io && state.io !== io) state.io.unobserve(img);
  state.io = io;
  watched.set(img, state);
  if (!state.armed) armFallback(img);
  io.observe(img);
}

// Popup open: pictures already in the frame load now. A picture below the
// scrolling body waits on that scroller, not the viewport.
export function revealPopupMedia(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  const pass = (attempt) => {
    if (!root.isConnected) {
      if (attempt < 4) requestAnimationFrame(() => pass(attempt + 1));
      return;
    }
    const imgs = [];
    root.querySelectorAll('img[data-src]').forEach((img) => {
      if (!img.getAttribute('src')) imgs.push(img);
    });
    if (!imgs.length) return;
    const pendingLayout = imgs.some((img) => {
      const box = img.getBoundingClientRect();
      return !(box.width > 0) || !(box.height > 0);
    });
    if (pendingLayout && attempt < 4) {
      requestAnimationFrame(() => pass(attempt + 1));
      return;
    }
    const scroller = popupScroller(root);
    for (const img of imgs) {
      if (img.getAttribute('src')) continue;
      if (scroller && belowFold(img, scroller)) observeInScroller(img, scroller);
      else loadMediaSrc(img);
    }
  };
  requestAnimationFrame(() => pass(0));
}
