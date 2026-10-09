// Ask to install on every visit. Chrome will not open its install dialog
// from a refresh alone, so the visit shows a recommendation and Install
// opens that dialog. An installed window is never asked. Not now lasts
// only until the next load.

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
  if (!installCard || isInstalled()) return;
  installCard.hidden = false;
}

window.addEventListener("beforeinstallprompt", (event) => {
  if (isInstalled()) {
    event.preventDefault();
    hideRecommend();
    return;
  }
  event.preventDefault();
  deferredPrompt = event;
  let pending;
  try {
    pending = event.prompt();
  } catch (err) {
    showRecommend();
    return;
  }
  // A refresh has no click, so Chrome rejects this. The event can still
  // be used from the Install button. A real dialog resolves the promise.
  if (!pending || typeof pending.then !== "function") {
    showRecommend();
    return;
  }
  pending.then(
    () => {
      deferredPrompt = null;
      hideRecommend();
    },
    () => {
      showRecommend();
    }
  );
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
