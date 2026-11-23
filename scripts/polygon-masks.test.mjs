// Polygon tap masks leave the zoom range while the camera moves and come
// back once it has been still. Visibility stays whatever the toggle set.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mock } from "node:test";

const source = fs.readFileSync(new URL("../polygons.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");

function fakeMap() {
  const layers = new Map();
  let zoomSets = 0;
  const map = {
    zoomSets: () => zoomSets,
    add(id, visibility = "visible") {
      layers.set(id, { min: 0, max: 24, visibility, boom: false });
    },
    drop(id) {
      layers.delete(id);
    },
    boom(id) {
      layers.get(id).boom = true;
    },
    getLayer(id) {
      return layers.has(id) ? { id } : undefined;
    },
    setLayerZoomRange(id, min, max) {
      zoomSets += 1;
      const layer = layers.get(id);
      if (!layer || layer.boom) throw new Error("gone");
      layer.min = min;
      layer.max = max;
    },
    setLayoutProperty(id, key, value) {
      layers.get(id)[key] = value;
    },
    getLayoutProperty(id, key) {
      return layers.get(id)[key];
    },
    range(id) {
      const layer = layers.get(id);
      return [layer.min, layer.max];
    },
  };
  return map;
}

function loadApi(map, polygonTipLayers) {
  const start = source.indexOf("let masksParked = false;");
  const end = source.indexOf('map.on("movestart", onMaskMoveStart);');
  assert.ok(start !== -1 && end > start);
  const body = source.slice(start, end);
  assert.doesNotMatch(body, /visibility|fill-opacity|setLayoutProperty|setPaintProperty/);
  return new Function(
    "map",
    "polygonTipLayers",
    `${body}\nreturn { onMaskMoveStart, onMaskMoveEnd, parkFreshMask, get parked() { return masksParked; } };`,
  )(map, polygonTipLayers);
}

test("polygon tap masks park while the camera moves and come back after it rests", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const map = fakeMap();
    const polygonTipLayers = new Map();
    map.add("a-mask-layer");
    map.add("b-mask-layer");
    map.add("gone-mask-layer");
    map.boom("gone-mask-layer");
    polygonTipLayers.set("a-mask-layer", {});
    polygonTipLayers.set("b-mask-layer", {});
    polygonTipLayers.set("missing-mask-layer", {});
    polygonTipLayers.set("gone-mask-layer", {});
    const api = loadApi(map, polygonTipLayers);

    map.add("fresh-mask-layer");
    api.parkFreshMask(map, "fresh-mask-layer");
    assert.deepEqual(map.range("fresh-mask-layer"), [0, 24], "a mask added while still stays in range");

    api.onMaskMoveStart();
    assert.equal(api.parked, true);
    assert.deepEqual(map.range("a-mask-layer"), [24, 24]);
    assert.deepEqual(map.range("b-mask-layer"), [24, 24]);
    const parkedSets = map.zoomSets();

    api.onMaskMoveEnd();
    mock.timers.tick(100);
    api.onMaskMoveStart();
    assert.equal(map.zoomSets(), parkedSets, "a second movestart does not touch masks already parked");
    mock.timers.tick(280);
    assert.equal(api.parked, true);
    assert.deepEqual(map.range("a-mask-layer"), [24, 24]);

    map.setLayoutProperty("b-mask-layer", "visibility", "none");
    api.onMaskMoveEnd();
    mock.timers.tick(279);
    assert.equal(api.parked, true);
    mock.timers.tick(1);
    assert.equal(api.parked, false);
    assert.deepEqual(map.range("a-mask-layer"), [0, 24]);
    assert.deepEqual(map.range("b-mask-layer"), [0, 24]);
    assert.equal(map.getLayoutProperty("b-mask-layer", "visibility"), "none");

    api.onMaskMoveStart();
    map.add("mid-mask-layer");
    api.parkFreshMask(map, "mid-mask-layer");
    assert.deepEqual(map.range("mid-mask-layer"), [24, 24]);

    const maskAt = source.indexOf("id: maskLayerId,");
    const parkedAt = source.indexOf("parkFreshMask(map, maskLayerId);", maskAt);
    const listedAt = source.indexOf("polygonTipLayers.set(maskLayerId, polygon);", maskAt);
    assert.ok(parkedAt !== -1 && parkedAt < listedAt);
    assert.match(source, /const MASK_REST_MS = 280;/);
    assert.match(source, /map\.on\("movestart", onMaskMoveStart\);/);
    assert.match(source, /map\.on\("moveend", onMaskMoveEnd\);/);
  } finally {
    mock.timers.reset();
  }
});
