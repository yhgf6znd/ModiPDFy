import assert from "node:assert/strict";
import test from "node:test";

import {
  canvasToCssPoint,
  cssRectToPdfRect,
  cssToCanvasPoint,
  cssToPdfPoint,
  getCanvasPixelSize,
  pdfRectToCssRect,
  pdfToCssPoint,
} from "../../web/js/coordinates.js";

function rotatedViewport() {
  // A 90-degree page rotation represented by a PDF.js-like affine pair.
  return {
    convertToPdfPoint(x, y) {
      return [100 - y, x];
    },
    convertToViewportPoint(x, y) {
      return [y, 100 - x];
    },
  };
}

test("CSS and canvas points account for device pixel ratio", () => {
  assert.deepEqual(cssToCanvasPoint({ x: 10, y: 5 }, 2), { x: 20, y: 10 });
  assert.deepEqual(canvasToCssPoint({ x: 20, y: 10 }, 2), { x: 10, y: 5 });
  assert.deepEqual(getCanvasPixelSize(10.2, 5.1, 2), {
    width: 21,
    height: 11,
    cssWidth: 10.2,
    cssHeight: 5.1,
    devicePixelRatio: 2,
  });
});

test("viewport conversions preserve rotation and PDF origin", () => {
  const viewport = rotatedViewport();
  assert.deepEqual(cssToPdfPoint(viewport, { x: 20, y: 30 }), { x: 70, y: 20 });
  assert.deepEqual(pdfToCssPoint(viewport, { x: 70, y: 20 }), { x: 20, y: 30 });
});

test("rectangle conversion uses all four corners", () => {
  const viewport = rotatedViewport();
  const cssRect = { x: 10, y: 20, width: 30, height: 40 };
  assert.deepEqual(cssRectToPdfRect(viewport, cssRect), {
    x: 40,
    y: 10,
    width: 40,
    height: 30,
  });
  assert.deepEqual(pdfRectToCssRect(viewport, { x: 40, y: 10, width: 40, height: 30 }), {
    x: 10,
    y: 20,
    width: 30,
    height: 40,
  });
});

test("invalid geometry is rejected at the UI boundary", () => {
  assert.throws(() => cssToCanvasPoint({ x: Number.NaN, y: 1 }, 2), TypeError);
  assert.throws(() => getCanvasPixelSize(10, 10, 0), RangeError);
  assert.throws(() => cssRectToPdfRect(rotatedViewport(), { x: 0, y: 0, width: -1, height: 1 }), TypeError);
});
