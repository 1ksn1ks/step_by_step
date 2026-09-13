import { map } from './map.js';

// The byte/file counters run in the inline <head> script (index.html) so the
// numbers start the moment the page begins loading; this module only fades
// the overlay once the map has really loaded.
function finish() {
  if (window.__loaderProgress) window.__loaderProgress.finish();
}

if (map.loaded()) {
  finish();
} else {
  map.on('load', finish);
}

// Safety net: never keep the loading screen up longer than 30 s
setTimeout(finish, 30000);
