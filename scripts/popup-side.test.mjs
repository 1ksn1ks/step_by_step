import test from "node:test";
import assert from "node:assert/strict";
import { popupSideFor } from "../popupside.js";

function mapAt(y, height = 100) {
  return {
    getContainer: () => ({ clientHeight: height }),
    project: () => ({ x: 0, y }),
  };
}

test("popupSideFor opens below in the upper half and above from the midline down", () => {
  assert.equal(popupSideFor(mapAt(0), [0, 0]), "top");
  assert.equal(popupSideFor(mapAt(49), [0, 0]), "top");
  assert.equal(popupSideFor(mapAt(50), [0, 0]), "bottom");
  assert.equal(popupSideFor(mapAt(51), [0, 0]), "bottom");
  assert.equal(popupSideFor(mapAt(100, 200), [0, 0]), "bottom");
  assert.equal(popupSideFor(mapAt(99, 200), [0, 0]), "top");
});
