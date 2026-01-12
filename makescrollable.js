function makeScrollable(el) {
    let startY = 0, startScroll = 0;
    let isDragging = false;
    let hasMoved = false;
    let mouseDownTarget = null;
    let startTime = 0;
    const DRAG_THRESHOLD = 5;
    const SCROLL_DAMPENING = 0.5; // Reduce scroll speed for next element
    const BUFFER = 2; // Small buffer to ensure scroll limit is reached
  
    // Find the next scrollable element (parent or sibling)
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
  
    // ------------------------------------------------- START
    const start = (e, clientY, isTouch = false) => {
      mouseDownTarget = e.target;
      startY = clientY;
      startScroll = el.scrollTop;
      startTime = performance.now();
      isDragging = false;
      hasMoved = false;
  
      e.stopPropagation();
  
      if (isTouch) disableSelection();
    };
  
    // ------------------------------------------------- MOVE
    const move = (e, clientY, isTouch = false) => {
      if (!mouseDownTarget && !isTouch) return;
  
      const walk = (startY - clientY) * 2;
      const newScrollTop = startScroll + walk;
  
      // Check if at top or bottom with buffer
      const atTop = el.scrollTop <= BUFFER && walk < 0;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - BUFFER && walk > 0;
  
      if (isDragging) {
        if (atTop || atBottom) {
          const nextEl = getNextScrollable();
          if (nextEl) {
            // Clamp current element to its bounds
            el.scrollTop = atTop ? 0 : el.scrollHeight - el.clientHeight;
            // Apply dampened scroll to next element
            nextEl.scrollTop += walk * SCROLL_DAMPENING;
            e.preventDefault();
            return;
          }
        }
        el.scrollTop = newScrollTop;
        e.preventDefault();
        return;
      }
  
      const dy = Math.abs(clientY - startY);
      const threshold = isTouch ? 0 : DRAG_THRESHOLD;
  
      if (dy > threshold) {
        isDragging = true;
        hasMoved = true;
        disableSelection();
        startScroll = el.scrollTop; // re-base
      }
    };
  
    // ------------------------------------------------- END
    const end = (e, isTouch = false) => {
      if (isDragging) enableSelection();
  
      if (!isTouch && !hasMoved && mouseDownTarget) {
        const timeSinceStart = performance.now() - startTime;
        if (timeSinceStart > 300) {
          mouseDownTarget.click();
        }
      }
  
      cleanup();
    };
  
    const cleanup = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
  
      mouseDownTarget = null;
      isDragging = false;
      hasMoved = false;
      enableSelection();
    };
  
    // ==================== TOUCH ====================
    el.addEventListener('touchstart', e => {
      const t = e.touches[0];
      start(e, t.clientY, true);
    }, { passive: true });
  
    el.addEventListener('touchmove', e => {
      if (!e.touches[0]) return;
      move(e, e.touches[0].clientY, true);
      if (isDragging) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, { passive: false });
  
    el.addEventListener('touchend', e => end(e, true));
    el.addEventListener('touchcancel', cleanup);
  
    // ==================== MOUSE ====================
    const onMouseMove = e => move(e, e.clientY, false);
    const onMouseUp = e => end(e, false);
  
    el.addEventListener('mousedown', e => {
      start(e, e.clientY, false);
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
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
          // Clamp current element to its bounds
          el.scrollTop = atTop ? 0 : el.scrollHeight - el.clientHeight;
          // Apply dampened scroll to next element
          nextEl.scrollTop += delta * SCROLL_DAMPENING;
          e.preventDefault();
          return;
        }
      }
  
      el.scrollTop += delta;
      if (el.scrollHeight > el.clientHeight) e.stopPropagation();
    }, { passive: false });
  
    // Initial state
    enableSelection();
  }
  
  makeScrollable(document.getElementById('topic-chat-container'));      // outer container
  makeScrollable(document.getElementById('messages-from-topic-chat'));  // inner container
  makeScrollable(document.getElementById('encrypted-chat-container'));      // outer container
  makeScrollable(document.getElementById('messages-from-encrypted-chat'));  // inner container
  makeScrollable(document.getElementById('Edit_Profile-column-container'));
  makeScrollable(document.getElementById('load-column-container'));
  makeScrollable(document.getElementById('upload-to-ipfs-column-container'));
  makeScrollable(document.getElementById('create-column-container'));
  makeScrollable(document.getElementById('marker-column-container'));
  makeScrollable(document.getElementById('polygon-column-container'));
  makeScrollable(document.getElementById('rules-column-container'));
  makeScrollable(document.getElementById('utility-column-container'));
  makeScrollable(document.getElementById('memo-column-container'));
  makeScrollable(document.getElementById('stack-topic-ids-container'));
  makeScrollable(document.getElementById('input-field-3-2'));
  makeScrollable(document.getElementById('input-field-2-2'));
  makeScrollable(document.getElementById('loaded-topic-rules-for-marker'));
  makeScrollable(document.getElementById('loaded-topic-rules-for-polygon'));
  makeScrollable(document.getElementById('loaded-topic-rules-for-topic'));
  makeScrollable(document.getElementById('loaded-topic-rules-for-utility'));
  