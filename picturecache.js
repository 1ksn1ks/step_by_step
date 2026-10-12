// Profile picture files saved on this phone, one file per link.
// The service worker serves a saved file to every image tag. A new link
// downloads once. Old links stay on this phone.

export const DEFAULT_PROFILE_PIC = 'https://kiloscribe.com/api/inscription-cdn/0.0.4819119';

function worker() {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) return null;
  return navigator.serviceWorker.controller || null;
}

export function publishProfilePictures(urls) {
  const list = [DEFAULT_PROFILE_PIC];
  const seen = new Set(list);
  for (const url of urls || []) {
    if (typeof url !== 'string' || !url || seen.has(url)) continue;
    seen.add(url);
    list.push(url);
  }
  const active = worker();
  if (!active) return Promise.resolve();
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(resolve, 500);
    channel.port1.onmessage = () => {
      clearTimeout(timer);
      resolve();
    };
    try {
      active.postMessage({ type: 'profile-pictures', urls: list }, [channel.port2]);
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (!event.data || event.data.type !== 'picture-cache-full') return;
    window.dispatchEvent(new CustomEvent('topic-cache-full'));
  });
}
