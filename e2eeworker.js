// Decrypts one sealed chat blob off the main thread. The page keeps only
// the object URL and revokes it when the bubble leaves the list.
import { decryptSealedPart } from "./e2eemedia.js";

self.onmessage = async (event) => {
  const data = event.data || {};
  try {
    const blob = await decryptSealedPart(data);
    self.postMessage({ id: data.id, ok: true, blob });
  } catch {
    self.postMessage({ id: data.id, ok: false });
  }
};
