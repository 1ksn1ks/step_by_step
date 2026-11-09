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

// Safari 26 hides Share behind ⋯ next to the address. Its user agent
// freezes the OS at 18_x, so Version/26 is the tell.
function safariMajor(ua) {
  const m = /Version\/(\d+)/.exec(ua);
  return m ? Number(m[1]) : 0;
}

// Said under every guide, so adding an icon does not feel like a risk.
// store: the store this device would otherwise send you to.
const reassure = (store) => `Just a shortcut to onlyonhbar.com. Free, no ${store}, and you can remove it any time like any app.`;

// When there is no install dialog to open: how this browser installs, for
// the intro's steps page (onboarding.js draws it). Each step is
// { icon, verb, key, note }: the icon looks like the button to tap and
// key is that button's label, shown as a pill. Read off the user agent;
// a wrong guess still points at the right menu.
export function installSteps() {
  const ua = navigator.userAgent || '';
  if (isIOS(ua)) {
    if (IN_APP_BROWSER.test(ua)) {
      return {
        title: 'Open in Safari first',
        body: 'This app\'s built-in browser can\'t add to the Home Screen.',
        steps: [
          { icon: 'more', verb: 'Tap', key: '⋯', note: 'Or the compass, wherever this app puts its browser menu.' },
          { icon: 'safari', verb: 'Choose', key: 'Open in Safari', note: 'Some apps call it Open in Browser.' },
          { icon: 'install', verb: 'Tap', key: 'Install', note: 'Here again, and the steps for Safari show.' },
        ],
        footer: reassure('App Store'),
      };
    }
    const safari = !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|YaBrowser|GSA\//.test(ua);
    if (safari && safariMajor(ua) >= 26) {
      return {
        title: 'Add to Home Screen',
        body: 'Four taps in Safari, about ten seconds.',
        steps: [
          { icon: 'more', verb: 'Tap', key: '⋯', note: 'Next to onlyonhbar.com in the address bar.' },
          { icon: 'share', verb: 'Tap', key: 'Share', note: 'In the menu that opens.' },
          { icon: 'showmore', verb: 'Tap', key: 'Show More', note: 'Under the first few options.' },
          { icon: 'addhome', verb: 'Tap', key: 'Add to Home Screen', note: 'Then confirm at the top right.' },
        ],
        footer: reassure('App Store'),
      };
    }
    if (safari) {
      return {
        title: 'Add to Home Screen',
        body: 'Three taps in Safari, about ten seconds.',
        steps: [
          { icon: 'share', verb: 'Tap', key: 'Share', note: 'The square with the arrow, in Safari\'s toolbar.' },
          { icon: 'addhome', verb: 'Tap', key: 'Add to Home Screen', note: 'Scroll down the list if you don\'t see it.' },
          { icon: 'confirm', verb: 'Tap', key: 'Add', note: 'At the top right.' },
        ],
        footer: reassure('App Store'),
      };
    }
    return {
      title: 'Add to Home Screen',
      body: 'A few taps in your browser, about ten seconds.',
      steps: [
        { icon: 'share', verb: 'Tap', key: 'Share', note: 'By the address, or in the browser\'s ⋯ menu.' },
        { icon: 'addhome', verb: 'Tap', key: 'Add to Home Screen', note: 'If it isn\'t listed, tap Show More first.' },
        { icon: 'confirm', verb: 'Confirm', key: 'Add', note: 'At the top right.' },
      ],
      footer: reassure('App Store'),
    };
  }
  if (/Android/i.test(ua)) {
    if (/SamsungBrowser/i.test(ua)) {
      return {
        title: 'Add to Home screen',
        body: 'Three taps in Samsung Internet.',
        steps: [
          { icon: 'menu', verb: 'Tap', key: '≡', note: 'At the bottom right.' },
          { icon: 'addhome', verb: 'Tap', key: 'Add page to', note: 'Then choose Home screen.' },
          { icon: 'confirm', verb: 'Tap', key: 'Add', note: 'The icon lands on your Home screen.' },
        ],
        footer: reassure('Play Store'),
      };
    }
    return {
      title: 'Add to Home screen',
      body: 'Three taps in your browser.',
      steps: [
        { icon: 'dots', verb: 'Tap', key: '⋮', note: 'At the top or bottom right.' },
        { icon: 'install', verb: 'Tap', key: 'Install app', note: 'Some browsers call it Add to Home screen.' },
        { icon: 'confirm', verb: 'Confirm', key: 'Install', note: 'Or Add. The icon lands on your Home screen.' },
      ],
      footer: reassure('Play Store'),
    };
  }
  if (/Firefox\//.test(ua)) {
    return {
      title: 'Install from Chrome or Edge',
      body: 'Firefox on a computer can\'t install web apps.',
      steps: [
        { icon: 'install', verb: 'Open', key: 'onlyonhbar.com', note: 'In Chrome or Edge, then click Install here again.' },
      ],
      footer: reassure('app store'),
    };
  }
  if (/Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)) {
    return {
      title: 'Add to Dock',
      body: 'Two clicks in Safari on a Mac.',
      steps: [
        { icon: 'menu', verb: 'Open', key: 'File', note: 'In the menu bar at the top of the screen.' },
        { icon: 'addhome', verb: 'Click', key: 'Add to Dock', note: 'Then Add. Meritocracy opens from the Dock.' },
      ],
      footer: reassure('App Store'),
    };
  }
  return {
    title: 'Install from the address bar',
    body: 'Your browser didn\'t offer its install window here.',
    steps: [
      { icon: 'install', verb: 'Click', key: 'Install', note: 'The screen with a ↓ at the right end of the address bar.' },
      { icon: 'dots', verb: 'Or open', key: '⋮', note: 'Then Install Meritocracy (under Save and share, or Apps).' },
    ],
    footer: reassure('app store'),
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
