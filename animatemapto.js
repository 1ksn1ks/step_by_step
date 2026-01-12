export function animateMapTo(map, targetLngLat, targetZoom = null, duration = 1000) {
    const start = map.getCenter(); // Current map center
    let startLng = start.lng;
    let startLat = start.lat;
    let targetLng = targetLngLat[0];
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
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1); // Normalize to 0-1
  
      // Linear interpolation for smooth movement and zoom
      const currentLng = startLng + lngDiff * progress;
      const currentLat = startLat + (targetLat - startLat) * progress;
      const currentZoom = targetZoom !== null ? startZoom + (finalZoom - startZoom) * progress : startZoom;
  
      // Update map center and zoom separately
      map.setCenter([currentLng, currentLat]);
      if (targetZoom !== null) {
        map.setZoom(currentZoom);
      }
  
      // Continue animation until complete
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        // Ensure final position and zoom are exact
        map.setCenter([targetLng, targetLat]);
        if (targetZoom !== null) {
          map.setZoom(finalZoom);
        }
      }
    }
  
    requestAnimationFrame(animate);
  }