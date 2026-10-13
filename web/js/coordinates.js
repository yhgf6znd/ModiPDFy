/**
 * Coordinate helpers for the viewer boundary.
 *
 * CSS and viewport coordinates have a top-left origin and are measured in CSS
 * pixels. Canvas backing-store coordinates are physical pixels. PDF points use
 * the lower-left origin defined by the PDF.js PageViewport transform. PDF.js
 * already incorporates crop boxes and page rotation into that transform, so
 * callers must not apply a second rotation or y-axis flip.
 */

function assertPoint(point, name = "point") {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new TypeError(`${name} must contain finite x and y values.`);
  }
}

function assertViewport(viewport) {
  if (
    !viewport ||
    typeof viewport.convertToPdfPoint !== "function" ||
    typeof viewport.convertToViewportPoint !== "function"
  ) {
    throw new TypeError("viewport must provide PDF.js point conversion methods.");
  }
}

export function getDevicePixelRatio(value = globalThis.devicePixelRatio || 1) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError("devicePixelRatio must be a positive finite number.");
  }
  return value;
}

export function cssToCanvasPoint(point, devicePixelRatio) {
  assertPoint(point);
  const dpr = getDevicePixelRatio(devicePixelRatio);
  return { x: point.x * dpr, y: point.y * dpr };
}

export function canvasToCssPoint(point, devicePixelRatio) {
  assertPoint(point);
  const dpr = getDevicePixelRatio(devicePixelRatio);
  return { x: point.x / dpr, y: point.y / dpr };
}

export function cssToPdfPoint(viewport, point) {
  assertViewport(viewport);
  assertPoint(point);
  const [x, y] = viewport.convertToPdfPoint(point.x, point.y);
  return { x, y };
}

export function pdfToCssPoint(viewport, point) {
  assertViewport(viewport);
  assertPoint(point);
  const [x, y] = viewport.convertToViewportPoint(point.x, point.y);
  return { x, y };
}

export function cssRectToPdfRect(viewport, rect) {
  if (!rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y) || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width < 0 || rect.height < 0) {
    throw new TypeError("rect must contain finite non-negative x, y, width, and height values.");
  }
  const corners = [
    cssToPdfPoint(viewport, { x: rect.x, y: rect.y }),
    cssToPdfPoint(viewport, { x: rect.x + rect.width, y: rect.y }),
    cssToPdfPoint(viewport, { x: rect.x, y: rect.y + rect.height }),
    cssToPdfPoint(viewport, { x: rect.x + rect.width, y: rect.y + rect.height }),
  ];
  const xs = corners.map(({ x }) => x);
  const ys = corners.map(({ y }) => y);
  const left = Math.min(...xs);
  const bottom = Math.min(...ys);
  return { x: left, y: bottom, width: Math.max(...xs) - left, height: Math.max(...ys) - bottom };
}

export function pdfRectToCssRect(viewport, rect) {
  if (!rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y) || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width < 0 || rect.height < 0) {
    throw new TypeError("rect must contain finite non-negative x, y, width, and height values.");
  }
  const corners = [
    pdfToCssPoint(viewport, { x: rect.x, y: rect.y }),
    pdfToCssPoint(viewport, { x: rect.x + rect.width, y: rect.y }),
    pdfToCssPoint(viewport, { x: rect.x, y: rect.y + rect.height }),
    pdfToCssPoint(viewport, { x: rect.x + rect.width, y: rect.y + rect.height }),
  ];
  const xs = corners.map(({ x }) => x);
  const ys = corners.map(({ y }) => y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { x: left, y: top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

export function getCanvasPixelSize(cssWidth, cssHeight, devicePixelRatio) {
  if (!Number.isFinite(cssWidth) || !Number.isFinite(cssHeight) || cssWidth < 0 || cssHeight < 0) {
    throw new RangeError("Canvas CSS dimensions must be finite and non-negative.");
  }
  const dpr = getDevicePixelRatio(devicePixelRatio);
  return {
    width: Math.max(1, Math.ceil(cssWidth * dpr)),
    height: Math.max(1, Math.ceil(cssHeight * dpr)),
    cssWidth,
    cssHeight,
    devicePixelRatio: dpr,
  };
}
