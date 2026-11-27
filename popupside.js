// Which side of a map point a post popup opens on.
// MapLibre's anchor is the edge of the card that sits on the point:
// 'top' puts the card below the point, 'bottom' puts it above.
// A point in the upper half of the map opens below, so the card is not
// cut off at the top. The midline and the lower half open above.
//
// A camera move that centers on the post (animateMapTo, flyTo) ends with
// that point on the map center. Projecting map.getCenter() is that screen
// position, so the side can be set before the move and does not change
// when the move ends.

export function popupSideFor(map, lngLat) {
  const height = map.getContainer().clientHeight;
  const point = map.project(lngLat);
  return point.y < height * 0.5 ? 'top' : 'bottom';
}
