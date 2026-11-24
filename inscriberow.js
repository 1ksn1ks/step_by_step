// The map Toolbar's Inscribe row (#Inscribe_Hashinal). Its wiring lives in
// inscribebutton.js; this file only takes what it calls, so a test can
// hand it stand-ins.
//
// A tap opens the file picker in the same gesture (a browser drops a
// picker opened after an await). A picked file goes through the wallet
// first (ensureWallet: connected already, or the connect sheet), then
// runInscribe: the too-big card or the confirm card, then the wallet's
// transactions. A cancelled picker or wallet stops quietly.

export const INSCRIBE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime,.glb,.gltf,model/gltf-binary,model/gltf+json";

// hcs1inscribenotice.js's confirm and too-big cards.
const INSCRIBE_CARD = '.onboard-overlay[aria-labelledby="inscribe-notice-title"], .onboard-overlay[aria-labelledby="inscribe-overcap-title"]';

// On <html> while the wallet step runs: the connect sheet sits over the map
// drawer (style.css), which stays open under it.
export const INSCRIBE_CONNECT_CLASS = "inscribe-connect";

// Until the card is up, or the run ends without one (an unreadable file).
function untilCardOrDone(doc, run) {
  return new Promise((resolve) => {
    let observer = null;
    const done = () => {
      if (observer) observer.disconnect();
      observer = null;
      resolve();
    };
    const Observer = globalThis.MutationObserver;
    if (typeof Observer === "function" && doc.body) {
      observer = new Observer(() => {
        if (doc.querySelector(INSCRIBE_CARD)) done();
      });
      observer.observe(doc.body, { childList: true });
    }
    Promise.resolve(run).then(done, done);
  });
}

// row: the toolbar row. ensureWallet resolves "ok", "cancel" or "fail".
// Returns the hidden file input.
export function bindInscribeRow({ row, doc = globalThis.document, ensureWallet, runInscribe }) {
  if (!row || !doc || !doc.body || typeof ensureWallet !== "function" || typeof runInscribe !== "function") return null;
  const input = doc.createElement("input");
  input.type = "file";
  input.accept = INSCRIBE_ACCEPT;
  input.hidden = true;
  input.tabIndex = -1;
  input.setAttribute("aria-hidden", "true");
  // Every click that reaches the document runs CloseALL (cssLogic.js),
  // which would close the Toolbar under the picker. The picker still opens.
  input.addEventListener("click", (event) => event.stopPropagation());
  doc.body.appendChild(input);

  // From a picked file until its card is up (the wallet, then the file is
  // read), and while the card is open, a tap opens no second picker.
  let starting = false;
  const cardOpen = () => !!doc.querySelector(INSCRIBE_CARD);

  // Enter and Space reach this too: dressNavRows clicks the row.
  row.addEventListener("click", (event) => {
    if (event && typeof event.stopPropagation === "function") event.stopPropagation();
    if (starting || cardOpen()) return;
    input.click();
  });

  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    input.value = "";
    if (!file || starting) return;
    starting = true;
    try {
      const root = doc.documentElement;
      if (root) root.classList.add(INSCRIBE_CONNECT_CLASS);
      // ensureWallet clicks the hidden Connect. That click would bubble to
      // the same CloseALL; this listener runs after web3.js's own and
      // stops it there, so the Toolbar stays open under the sheet.
      const connect = typeof doc.getElementById === "function" ? doc.getElementById("connect-wallet-btn") : null;
      const keepOpen = (event) => event.stopPropagation();
      if (connect) connect.addEventListener("click", keepOpen);
      let status = "fail";
      try {
        status = await ensureWallet();
      } catch {
        status = "fail";
      } finally {
        if (connect) connect.removeEventListener("click", keepOpen);
        if (root) root.classList.remove(INSCRIBE_CONNECT_CLASS);
      }
      if (status !== "ok") return;
      await untilCardOrDone(doc, runInscribe(file, { returnTo: row }));
    } finally {
      starting = false;
    }
  });
  return input;
}
