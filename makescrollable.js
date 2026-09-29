export function makeScrollable(el) {
  // Custom scroll layer for panels above the map: the map canvas eats native
  // gestures, so scrolling is driven by hand — but through a target + rAF
  // pipeline with release momentum, so it glides like a native app instead
  // of raw finger-following.
  const DRAG_THRESHOLD = 5;      // mouse: px before a press becomes a drag
  const AXIS_LOCK_PX = 8;        // finger lead on one axis before the gesture locks
  const SCROLL_DAMPENING = 0.5;  // leftover motion handed to the next scrollable
  const BUFFER = 2;              // edge buffer (px) for "at top/bottom" checks
  const BLEND = 0.25;            // how fast scrollTop chases the target per frame
  const FRICTION = 0.95;         // momentum decay per frame
  const MIN_MOMENTUM = 0.5;      // px/frame — below this, the glide stops

  let startY = 0, startX = 0, startScroll = 0;
  let isDragging = false;
  let hasMoved = false;
  let mouseDownTarget = null;
  let startTime = 0;
  let startedOnControl = false;  // gesture began on an input/slider — fully ignored
  let axis = null;               // 'v' | 'h' — direction lock
  let lastY = 0, lastT = 0;
  let velocity = 0;              // px per 16ms frame (release momentum)
  let target = 0;                // smoothed target scrollTop
  let rafId = null;

  const clamp = (v) => Math.max(0, Math.min(v, el.scrollHeight - el.clientHeight));

  // ------------------------------------------------- Next scrollable
  const getNextScrollable = () => {
    let parent = el.parentElement;
    while (parent) {
      if (parent.scrollHeight > parent.clientHeight) {
        return parent;
      }
      parent = parent.parentElement;
    }
    const siblings = el.parentElement ? Array.from(el.parentElement.children) : [];
    const index = siblings.indexOf(el);
    for (let i = index + 1; i < siblings.length; i++) {
      if (siblings[i].scrollHeight > siblings[i].clientHeight) {
        return siblings[i];
      }
    }
    for (let i = index - 1; i >= 0; i--) {
      if (siblings[i].scrollHeight > siblings[i].clientHeight) {
        return siblings[i];
      }
    }
    return null;
  };

  // ------------------------------------------------- Selection
  const disableSelection = () => {
    el.style.userSelect = 'none';
    el.style.webkitUserSelect = 'none';
    el.style.touchAction = 'none';
  };
  const enableSelection = () => {
    el.style.userSelect = '';
    el.style.webkitUserSelect = '';
    el.style.touchAction = '';
  };

  // ------------------------------------------------- Smooth engine
  // One rAF loop per element, alive only while something is moving:
  //   dragging -> chase the target set by the finger (glides behind it)
  //   flicking -> advance by velocity, decay it (iOS-style glide)
  //   settling -> chase the target, then stop
  const tick = () => {
    rafId = null;
    const current = el.scrollTop;
    const max = el.scrollHeight - el.clientHeight;

    if (!isDragging && Math.abs(velocity) > MIN_MOMENTUM) {
      target = clamp(target + velocity);
      velocity *= FRICTION;
      if (target <= 0 || target >= max) {
        target = clamp(target);
        velocity = 0; // hit the edge — no bounce, just stop
      }
    }

    const diff = target - current;
    if (Math.abs(diff) < 0.5) {
      if (current !== target) el.scrollTop = target; // sub-pixel: snap, don't spin
      return;
    }
    el.scrollTop = current + diff * BLEND;
    rafId = requestAnimationFrame(tick);
  };

  const kick = () => {
    if (rafId === null) rafId = requestAnimationFrame(tick);
  };

  const stopMotion = () => {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
    velocity = 0;
    target = el.scrollTop;
  };

  // Public: programmatic jumps (chat ⬆⬇ arrows) must kill a running
  // wheel/flick glide, or the glide overwrites the jump on the next frame
  el.stopSmoothScroll = stopMotion;

  // ------------------------------------------------- START
  const start = (e, clientY, isTouch = false) => {
    // Native controls (sliders, color pickers, inputs) keep 100% of their
    // own touch/mouse behavior — the scroll logic ignores the whole gesture
    if (e.target !== el && e.target.closest('input, textarea, select')) {
      startedOnControl = true;
      return;
    }
    startedOnControl = false;
    mouseDownTarget = e.target;
    startY = clientY;
    startScroll = el.scrollTop;
    target = el.scrollTop;
    startTime = performance.now();
    isDragging = false;
    hasMoved = false;
    axis = null;
    velocity = 0;
    stopMotion(); // a new gesture kills any running momentum
    e.stopPropagation();
    if (isTouch) disableSelection();
  };

  // ------------------------------------------------- MOVE
  const move = (e, isTouch = false) => {
    if (startedOnControl) return; // the slider owns this whole gesture
    if (isTouch && !e.touches[0]) return;
    if (!isTouch && mouseDownTarget === null) return;

    const clientX = isTouch ? e.touches[0].clientX : e.clientX;
    const clientY = isTouch ? e.touches[0].clientY : e.clientY;

    // Direction lock: the first clear movement decides the gesture's axis.
    // Sideways gestures never scroll — that's what keeps sliders draggable.
    if (axis === null) {
      const dx = Math.abs(clientX - startX);
      const dy = Math.abs(clientY - startY);
      if (Math.max(dx, dy) < AXIS_LOCK_PX) return;
      axis = dy >= dx ? 'v' : 'h';
      hasMoved = true;
      if (axis === 'h') return;
    }
    if (axis === 'h') return;

    if (!isDragging) {
      const dy = Math.abs(clientY - startY);
      const threshold = isTouch ? 0 : DRAG_THRESHOLD;
      if (dy <= threshold) return;
      isDragging = true;
      hasMoved = true;
      if (!isTouch) disableSelection();
      startScroll = el.scrollTop;
      lastY = clientY;
      lastT = performance.now();
    }

    // Velocity sample (px per 16ms frame) for the release momentum
    const dY = lastY - clientY; // >0 when the finger moves up
    const now = performance.now();
    const dt = Math.max(1, now - lastT);
    velocity = velocity * 0.6 + ((dY * 16) / dt) * 0.4;
    lastY = clientY;
    lastT = now;

    target = clamp(startScroll + (startY - clientY)); // 1:1, like native

    // Past the edge: hand the leftover motion to the next scrollable
    const atTop = target <= BUFFER && dY > 0;
    const atBottom = target >= el.scrollHeight - el.clientHeight - BUFFER && dY < 0;
    if (atTop || atBottom) {
      const nextEl = getNextScrollable();
      if (nextEl) {
        target = atTop ? 0 : el.scrollHeight - el.clientHeight;
        nextEl.scrollTop += dY * SCROLL_DAMPENING;
      }
    }
    kick();
  };

  // ------------------------------------------------- END
  const end = (e, isTouch = false) => {
    if (isDragging || startedOnControl) enableSelection();

    // Click synthesis: a mouse press that never moved, held 300ms+
    if (!isTouch && !hasMoved && mouseDownTarget) {
      const timeSinceStart = performance.now() - startTime;
      if (timeSinceStart > 300) {
        mouseDownTarget.click();
      }
    }

    // Touch release: hand the velocity to the momentum glide
    isDragging = false;
    if (isTouch) kick();

    cleanup();
  };

  const cleanup = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);

    mouseDownTarget = null;
    isDragging = false;
    hasMoved = false;
    axis = null;
    startedOnControl = false;
    enableSelection();
  };

  // ==================== TOUCH ====================
  el.addEventListener('touchstart', e => {
    const t = e.touches[0];
    startX = t.clientX;
    start(e, t.clientY, true);
  }, { passive: true });

  el.addEventListener('touchmove', e => {
    move(e, true);
    // Only a locked vertical drag blocks the browser (pan/refresh);
    // anything else keeps native behavior
    if (axis === 'v' && isDragging) e.preventDefault();
  }, { passive: false });

  el.addEventListener('touchend', e => end(e, true));
  el.addEventListener('touchcancel', cleanup);

  // ==================== MOUSE ====================
  const onMouseMove = e => move(e, false);
  const onMouseUp = e => end(e, false);

  el.addEventListener('mousedown', e => {
    startX = e.clientX;
    start(e, e.clientY, false);
    if (!startedOnControl) {
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    }
  });

  el.addEventListener('mouseleave', () => {
    if (isDragging || mouseDownTarget) cleanup();
  });

  // ==================== WHEEL ====================
  el.addEventListener('wheel', e => {
    const delta = e.deltaY;
    const atTop = el.scrollTop <= BUFFER && delta < 0;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - BUFFER && delta > 0;

    if (atTop || atBottom) {
      const nextEl = getNextScrollable();
      if (nextEl) {
        // Clamp current element to its bounds, feed the rest downstream
        el.scrollTop = atTop ? 0 : el.scrollHeight - el.clientHeight;
        stopMotion();
        target = el.scrollTop;
        nextEl.scrollTop += delta * SCROLL_DAMPENING;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }

    // Feed the wheel into the same smoothed pipeline — flicks glide
    stopMotion();
    target = clamp(target + delta);
    kick();
    if (el.scrollHeight > el.clientHeight) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, { passive: false });

  // Initial state
  target = el.scrollTop;
  enableSelection();
}

  makeScrollable(document.getElementById('messages-from-topic-chat'));  // inner container
  makeScrollable(document.getElementById('messages-from-encrypted-chat'));  // inner container
  makeScrollable(document.getElementById('Edit_Profile-column-container'));
  makeScrollable(document.getElementById('load-column-container'));
  makeScrollable(document.getElementById('loaded-topics'));
  makeScrollable(document.getElementById('create-column-container'));
  makeScrollable(document.getElementById('marker-column-container'));
  makeScrollable(document.getElementById('polygon-column-container'));
  makeScrollable(document.getElementById('rules-column-container'));
  makeScrollable(document.getElementById('utility-column-container'));
  makeScrollable(document.getElementById('memo-column-container'));
  makeScrollable(document.getElementById('domain-column-container'));
  makeScrollable(document.getElementById('stack-topic-ids-container'));
  makeScrollable(document.getElementById('input-field-3-2'));
  makeScrollable(document.getElementById('input-field-2-2'));
  makeScrollable(document.getElementById('loaded-topic-rules-for-marker'));
  makeScrollable(document.getElementById('loaded-topic-rules-for-polygon'));
  makeScrollable(document.getElementById('loaded-topic-rules-for-topic'));
  makeScrollable(document.getElementById('loaded-topic-rules-for-utility'));

  // Settings panels (glass mb-panel cards)
  makeScrollable(document.getElementById('main-button-column-container'));
  makeScrollable(document.getElementById('button-input-column-container'));
  makeScrollable(document.getElementById('topic-chat-column-container'));
  makeScrollable(document.getElementById('marker-options-column-container'));
  makeScrollable(document.getElementById('visibility-controls-container'));
