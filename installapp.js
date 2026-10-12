// Chrome will only open its install dialog from a click. The introduction's
// first page is that click. Calling prompt() during load is rejected.
// An installed window is never asked. iPhone never fires
// beforeinstallprompt, so install there stays Share → Add to Home Screen.

const INSTALLED_KEY = 'meritocracy-homescreen';
let deferredPrompt = null;

function displayMode(mode) {
  return window.matchMedia(`(display-mode: ${mode})`).matches;
}

// True when this window is the installed app, not a browser tab.
export function isAppInstalled() {
  return displayMode('standalone')
    || displayMode('fullscreen')
    || displayMode('minimal-ui')
    || displayMode('window-controls-overlay')
    || window.navigator.standalone === true;
}

function rememberInstalled() {
  try { localStorage.setItem(INSTALLED_KEY, '1'); } catch { /* private mode */ }
}

function rememberedInstalled() {
  try { return localStorage.getItem(INSTALLED_KEY) === '1'; } catch { return false; }
}

// Also true in a browser tab when this site is already on the homescreen.
export async function appAlreadyInstalled() {
  if (isAppInstalled()) {
    rememberInstalled();
    return true;
  }
  if (typeof navigator.getInstalledRelatedApps === 'function') {
    try {
      const apps = await navigator.getInstalledRelatedApps();
      const here = new URL('/manifest.webmanifest', window.location.href).href;
      const installed = apps.some((app) => app.platform === 'webapp' && (!app.url || app.url === here));
      if (installed) rememberInstalled();
      return installed || rememberedInstalled();
    } catch {
      return rememberedInstalled();
    }
  }
  return rememberedInstalled();
}

export async function runInstallPrompt() {
  const promptEvent = deferredPrompt;
  if (!promptEvent || isAppInstalled()) return false;
  deferredPrompt = null;
  try {
    const choice = await promptEvent.prompt();
    const accepted = !!(choice && choice.outcome === 'accepted');
    if (accepted) rememberInstalled();
    return accepted;
  } catch (err) {
    console.warn("Install prompt failed", err);
    return false;
  }
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  if (isAppInstalled()) {
    deferredPrompt = null;
    return;
  }
  try { localStorage.removeItem(INSTALLED_KEY); } catch { /* private mode */ }
  deferredPrompt = event;
});

window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  rememberInstalled();
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
    console.warn("Service worker registration failed", err);
  });
}
