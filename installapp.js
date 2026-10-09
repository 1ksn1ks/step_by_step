// Each visit lets the browser offer install. The old Options button
// cancelled that offer and waited for a click. An installed window
// suppresses the offer. A dismissal is not stored here, so the next
// visit can offer again until the app is installed.

function isInstalled() {
  return window.matchMedia("(display-mode: standalone)").matches
    || window.matchMedia("(display-mode: fullscreen)").matches
    || window.navigator.standalone === true;
}

window.addEventListener("beforeinstallprompt", (event) => {
  if (isInstalled()) {
    event.preventDefault();
    return;
  }
  // prompt() is the dialog the button used to open. Chrome only allows
  // it from a click, so a plain load leaves the event alone and the
  // browser shows its own install offer for this visit.
  const activation = navigator.userActivation;
  if (!activation || !activation.isActive) return;
  event.preventDefault();
  const show = event.prompt();
  if (show && typeof show.catch === "function") show.catch(() => {});
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
      console.warn("Service worker registration failed", err);
    });
  });
}
