// The map Toolbar's Inscribe row: inscriberow.js with the app's wallet
// step (feedlayout.js ensureWallet) and inscribe flow (hcs1inscribenotice.js
// runInscribe). Map Toolbar only; the feed has no such row.

import { ensureWallet } from "./feedlayout.js";
import { runInscribe } from "./hcs1inscribenotice.js";
import { bindInscribeRow } from "./inscriberow.js";

bindInscribeRow({
  row: document.getElementById("Inscribe_Hashinal"),
  ensureWallet,
  runInscribe,
});
