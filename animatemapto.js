// ONE generation token guards the animation loop: a new animateMapTo or a
// cancel increments it, and the running loop dies on its next frame.
// MapLibre aborts any in-flight camera animation (flyTo / easeTo /
// fitBounds) the moment another camera command arrives — so the
// per-frame setCenter/setZoom here would kill a flyTo started while this
// loop is still running (e.g. tapping a popup number right after opening
// the popup: 1st tap dies, 2nd works). Anything that starts its own
// camera animation calls cancelAnimateMapTo() first.
let generation = 0;

export function cancelAnimateMapTo() {
  generation++;
}

// Map listeners (the local clock) throw if longitude leaves -180..180, and
// that throw happens inside setCenter, which kills this frame before the
// next one is scheduled. The camera then sits in the ocean (around -240)
// instead of arriving. Keep every center inside the valid range.
function wrapLng(lng) {
  const wrapped = ((lng + 180) % 360 + 360) % 360 - 180;
  return wrapped === -180 ? 180 : wrapped;
}

export function animateMapTo(map, targetLngLat, targetZoom = null, duration = 1000) {
    const myGeneration = ++generation;
    const start = map.getCenter(); // Current map center
    const startLng = wrapLng(start.lng);
    const startLat = start.lat;
    const targetLng = wrapLng(targetLngLat[0]);
    const targetLat = targetLngLat[1];
    const startZoom = map.getZoom(); // Current zoom level
    const finalZoom = targetZoom !== null ? targetZoom : startZoom; // Use current zoom if targetZoom is null
    const startTime = performance.now();

    // Normalize longitude difference for shortest path
    let lngDiff = targetLng - startLng;
    if (lngDiff > 180) {
      lngDiff -= 360; // Go left across antimeridian
    } else if (lngDiff < -180) {
      lngDiff += 360; // Go right across antimeridian
    }

    function animate(currentTime) {
      if (myGeneration !== generation) return; // cancelled or replaced
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1); // Normalize to 0-1
      const done = progress >= 1;

      // Linear interpolation for smooth movement and zoom.
      // Wrap before setCenter so the short path across the date line stays
      // a real longitude the rest of the app can read.
      const currentLng = done ? targetLng : wrapLng(startLng + lngDiff * progress);
      const currentLat = done ? targetLat : startLat + (targetLat - startLat) * progress;
      const currentZoom = targetZoom !== null
        ? (done ? finalZoom : startZoom + (finalZoom - startZoom) * progress)
        : startZoom;

      try {
        map.setCenter([currentLng, currentLat]);
        if (targetZoom !== null) map.setZoom(currentZoom);
      } catch {
        // Keep flying. A move listener must not freeze the globe halfway.
      }

      if (!done) requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);
  }
