// ?perf=1 — on-screen performance diagnostics, for finding phone lag.
// Shows: worst frame delta over the last second, long main-thread tasks
// (last 10s), input echo (input event -> next painted frame), JS heap,
// and the named job (perfJob) that is running or last took over 300ms.
// Costs nothing when the flag is off. This module imports no app module,
// so it is safe to import anywhere (no circular-init risk).

function perfEnabled() {
  try {
    return (
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('perf') === '1'
    );
  } catch {
    return false;
  }
}

const state = perfEnabled()
  ? {
      frameWorst: 0,
      frameWorstReset: performance.now(),
      frame: 0,
      long: 0,
      longWorst: 0,
      longReset: performance.now(),
      key: null,
      keyAt: 0,
      job: null,
      lastSlow: null,
    }
  : null;

// Name a sync or async job. With ?perf=1 the overlay attributes any stall
// to the job that was running (and keeps the slowest finished one).
export function perfJob(name, fn) {
  if (!state) return fn();
  const t0 = performance.now();
  const mark = { name, t0 };
  state.job = mark;
  let result;
  try {
    result = fn();
  } catch (err) {
    if (state.job === mark) state.job = null;
    throw err;
  }
  const finish = () => {
    if (state.job !== mark) return; // a newer job took over the slot
    state.job = null;
    const ms = performance.now() - t0;
    if (ms > 300) state.lastSlow = { name, ms: Math.round(ms), at: Date.now() };
  };
  if (result && typeof result.then === 'function') result.then(finish, finish);
  else finish();
  return result;
}

if (state) {
  const el = document.createElement('div');
  el.id = 'perf-debug';
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText =
    'position:fixed;left:0.4rem;bottom:0.4rem;z-index:2147483647;margin:0;padding:0.35rem 0.5rem;background:rgba(0,0,0,0.82);color:#7CFFB2;font:600 0.7rem/1.35 ui-monospace,monospace;pointer-events:none;white-space:pre;border-radius:0.4rem;max-width:72vw;overflow:hidden;';
  document.documentElement.appendChild(el);

  let last = performance.now();
  const loop = (now) => {
    const d = now - last;
    last = now;
    if (d > state.frameWorst) state.frameWorst = d;
    if (now - state.frameWorstReset > 1000) {
      state.frame = state.frameWorst;
      state.frameWorst = d;
      state.frameWorstReset = now;
      if (now - state.longReset > 10000) {
        state.long = 0;
        state.longWorst = 0;
        state.longReset = now;
      }
    }
    paint();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // Any main-thread task over 50ms. Chrome only; ignored elsewhere.
  if ('PerformanceObserver' in window) {
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          state.long += 1;
          if (entry.duration > state.longWorst) state.longWorst = Math.round(entry.duration);
        }
      }).observe({ entryTypes: ['longtask'] });
    } catch {
      /* longtask not supported */
    }
  }

  // Input echo: from the input event to the next frame, i.e. how long a
  // typed character waits before it is painted.
  document.addEventListener(
    'input',
    () => {
      state.keyAt = performance.now();
      requestAnimationFrame(() => {
        state.key = Math.round(performance.now() - state.keyAt);
      });
    },
    true
  );

  function paint() {
    const mem =
      performance.memory && performance.memory.usedJSHeapSize
        ? Math.round(performance.memory.usedJSHeapSize / 1048576) + 'MB'
        : '';
    const job = state.job;
    const slow = state.lastSlow
      ? state.lastSlow.name + ' ' + state.lastSlow.ms + 'ms'
      : '—';
    el.textContent =
      'frame ' + Math.round(state.frame) + 'ms' +
      (mem ? '  mem ' + mem : '') + '\n' +
      'long ' + state.long + ' (worst ' + state.longWorst + 'ms)\n' +
      'key ' + (state.key == null ? '—' : state.key + 'ms') + '\n' +
      'now ' + (job ? job.name + ' ' + Math.round(performance.now() - job.t0) + 'ms' : '—') + '\n' +
      'slow ' + slow;
  }
}
