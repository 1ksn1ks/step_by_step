// Chrome will only open its install dialog from a click. The introduction's
// first page is that click. Calling prompt() during load is rejected.
// An installed window is never asked. iPhone never fires
// beforeinstallprompt, so install there stays Share → Add to Home Screen;
// Install shows those steps instead (installSteps, onboarding.js).

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

// True when the browser handed over its install dialog and Install can
// open it. iPhone never does; some Android and desktop browsers don't.
export function canPromptInstall() {
  return !!deferredPrompt && !isAppInstalled();
}

function isIOS(ua) {
  // iPadOS Safari reports itself as a Mac; the touch points give it away.
  return /iPhone|iPad|iPod/.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// Social apps' built-in browsers: none of them can add to the Home Screen.
const IN_APP_BROWSER = /FBAN|FBAV|FB_IAB|Instagram|LinkedInApp|Snapchat|TikTok|musical_ly|Line\/|Twitter|MicroMessenger/i;

// When there is no install dialog to open: how this browser installs, as
// onboarding rows ({ title, body, rows }). Read off the user agent; a
// wrong guess still points at the right menu.
export function installSteps() {
  const ua = navigator.userAgent || '';
  if (isIOS(ua)) {
    if (IN_APP_BROWSER.test(ua)) {
      return {
        title: 'Open in Safari first',
        body: 'This app\'s built-in browser can\'t add to the Home Screen.',
        rows: [
          { name: '1. Open in Safari', note: 'Tap ⋯ or the compass and choose Open in Safari (or Open in Browser).' },
          { name: '2. Tap Install again', note: 'This page then shows the next steps.' },
        ],
      };
    }
    const safari = !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|YaBrowser|GSA\//.test(ua);
    return {
      title: 'Add to Home Screen',
      body: safari
        ? 'iPhone installs from Safari\'s Share menu.'
        : 'iPhone installs from the browser\'s Share menu.',
      rows: [
        safari
          ? { name: '1. Tap Share', note: 'The square with the arrow ↑. On newer iPhones it is in the ⋯ menu by the address.' }
          : { name: '1. Tap Share', note: 'The ↑ by the address, or the browser menu (⋯ or ☰) → Share.' },
        { name: '2. Add to Home Screen', note: 'Scroll down the list if you don\'t see it.' },
        { name: '3. Tap Add', note: 'Meritocracy then opens from your Home Screen like an app.' },
      ],
    };
  }
  if (/Android/i.test(ua)) {
    if (/SamsungBrowser/i.test(ua)) {
      return {
        title: 'Add to Home screen',
        body: 'Samsung Internet installs from its menu.',
        rows: [
          { name: '1. Open the menu', note: 'Tap ≡ at the bottom right.' },
          { name: '2. Add page to', note: 'Choose Home screen, then Add.' },
        ],
      };
    }
    return {
      title: 'Add to Home screen',
      body: 'Your browser installs from its menu.',
      rows: [
        { name: '1. Open the menu', note: 'Tap ⋮ at the top or bottom right.' },
        { name: '2. Install app', note: 'Or Add to Home screen, then Install or Add.' },
      ],
    };
  }
  if (/Firefox\//.test(ua)) {
    return {
      title: 'Install from Chrome or Edge',
      body: 'Firefox on a computer can\'t install web apps.',
      rows: [
        { name: 'Open this page in Chrome or Edge', note: 'Then tap Install here again.' },
      ],
    };
  }
  if (/Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)) {
    return {
      title: 'Add to Dock',
      body: 'Safari on a Mac installs from the File menu.',
      rows: [
        { name: '1. File', note: 'In the menu bar at the top of the screen.' },
        { name: '2. Add to Dock', note: 'Then Add. Meritocracy opens from the Dock.' },
      ],
    };
  }
  return {
    title: 'Install from the address bar',
    body: 'Your browser didn\'t offer its install dialog here.',
    rows: [
      { name: 'Install icon', note: 'The screen with a ↓ at the right end of the address bar.' },
      { name: 'Or the menu', note: '⋮ or ⋯ → Install Meritocracy (under Save and share, or Apps).' },
    ],
  };
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
