// The card is the click Chrome requires. Install calls prompt() on that
// click, which opens Chrome's own install dialog. Calling prompt() during
// load is rejected, so the card waits. Not now lasts until the next load.
// An installed window is never asked. iPhone never fires
// beforeinstallprompt, so install there stays Share → Add to Home Screen.

const installCard = document.getElementById("install-recommend");
const installYes = document.getElementById("install-recommend-yes");
const installNo = document.getElementById("install-recommend-no");

let deferredPrompt = null;

function isInstalled() {
  return window.matchMedia("(display-mode: standalone)").matches
    || window.matchMedia("(display-mode: fullscreen)").matches
    || window.navigator.standalone === true;
}

function hideRecommend() {
  if (installCard) installCard.hidden = true;
}

function showRecommend() {
  if (!installCard || isInstalled() || !deferredPrompt) return;
  installCard.hidden = false;
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  if (isInstalled()) {
    deferredPrompt = null;
    hideRecommend();
    return;
  }
  deferredPrompt = event;
  showRecommend();
});

window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  hideRecommend();
});

if (installYes) {
  installYes.addEventListener("click", async (event) => {
    event.stopPropagation();
    const promptEvent = deferredPrompt;
    if (!promptEvent) return;
    deferredPrompt = null;
    hideRecommend();
    try {
      await promptEvent.prompt();
    } catch (err) {
      console.warn("Install prompt failed", err);
    }
  });
}

if (installNo) {
  installNo.addEventListener("click", (event) => {
    event.stopPropagation();
    hideRecommend();
  });
}

if (installCard) {
  installCard.addEventListener("click", (event) => event.stopPropagation());
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
    console.warn("Service worker registration failed", err);
  });
}
