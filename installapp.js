// Chrome shows its own install banner only when the page does not call
// preventDefault() on beforeinstallprompt. A custom card replaces that
// banner, so this file only registers the service worker.
// An already-installed window gets no banner. iPhone has no automatic
// install API; install stays Share → Add to Home Screen.

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
    console.warn("Service worker registration failed", err);
  });
}
