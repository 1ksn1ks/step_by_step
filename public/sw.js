// Install service worker for Meritocracy. v1
// The fetch listener is what the install prompt looks for. It does not
// cache: /api streams, map tiles, WalletConnect, and uploaded media stay
// on the network. A cached shell would pin an old Vite build.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api")) return;
});
