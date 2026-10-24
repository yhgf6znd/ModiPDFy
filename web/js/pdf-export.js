import { WasmBridgeError } from "./wasm-bridge.js";

const EPSILON = 1e-7;
const MAX_TEXT_BYTES = 64 * 1024;
const MAX_STROKE_POINTS = 100_000;
const MAX_EDITOR_ID_BYTES = 128;
const HIGHLIGHT_POINT_KEYS = ["topLeft", "topRight", "bottomLeft", "bottomRight"];

function fail(message) {
  throw new WasmBridgeError("invalid_export_state", message, true);
}

function finite(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${label} must be finite.`);
}

function validateBounds(bounds, pageInfo, label) {
  for (const key of ["left", "bottom", "right", "top"]) finite(bounds?.[key], `${label} bounds.${key}`);
  if (bounds.left >= bounds.right || bounds.bottom >= bounds.top) fail(`${label} bounds must be ordered.`);
  const crop = pageInfo.cropBox;
  if (bounds.left < crop.left - EPSILON || bounds.bottom < crop.bottom - EPSILON || bounds.right > crop.right + EPSILON || bounds.top > crop.top + EPSILON) {
    fail(`${label} bounds lie outside the page crop box.`);
  }
}

function validateStyle(style, label) {
  for (const key of ["red", "green", "blue"]) {
    finite(style?.color?.[key], `${label} color.${key}`);
    if (style.color[key] < 0 || style.color[key] > 1) fail(`${label} color is outside the supported range.`);
  }
  finite(style.opacity, `${label} opacity`);
  finite(style.strokeWidth, `${label} stroke width`);
  finite(style.fontSize, `${label} font size`);
  if (style.opacity < 0 || style.opacity > 1 || style.strokeWidth < 0.01 || style.strokeWidth > 100 || style.fontSize < 1 || style.fontSize > 200) fail(`${label} style is outside the supported range.`);
}

function validatePoint(point, bounds, pageInfo, label) {
  finite(point?.x, `${label}.x`);
  finite(point?.y, `${label}.y`);
  if (point.x < bounds.left - EPSILON || point.x > bounds.right + EPSILON || point.y < bounds.bottom - EPSILON || point.y > bounds.top + EPSILON) fail(`${label} lies outside annotation bounds.`);
  const crop = pageInfo.cropBox;
  if (point.x < crop.left - EPSILON || point.x > crop.right + EPSILON || point.y < crop.bottom - EPSILON || point.y > crop.top + EPSILON) fail(`${label} lies outside the page crop box.`);
}

function validatePaths(paths, bounds, pageInfo, label) {
  if (!Array.isArray(paths) || paths.length === 0) fail(`${label} must contain paths.`);
  let count = 0;
  for (const [pathIndex, path] of paths.entries()) {
    if (!Array.isArray(path) || path.length < 2) fail(`${label} path ${pathIndex} must contain at least two points.`);
    count += path.length;
    if (count > MAX_STROKE_POINTS) fail(`${label} exceeds the stroke point limit.`);
    path.forEach((point, pointIndex) => validatePoint(point, bounds, pageInfo, `${label} path ${pathIndex} point ${pointIndex}`));
  }
}

function samePageInfo(before, after) {
  for (const key of ["width", "height", "rotationDegrees"]) {
    if (Math.abs(before[key] - after[key]) > EPSILON) return false;
  }
  for (const box of ["mediaBox", "cropBox"]) {
    for (const key of ["left", "bottom", "right", "top"]) {
      if (Math.abs(before[box][key] - after[box][key]) > EPSILON) return false;
    }
  }
  return true;
}

function validateAnnotation(annotation, pageInfo) {
  if (!annotation || typeof annotation !== "object") fail("Annotation record is invalid.");
  if (!Number.isSafeInteger(annotation.pageIndex) || annotation.pageIndex < 0) fail("Annotation page reference is invalid.");
  validateEditorId(annotation.editorId, annotation.editorId || "Annotation");
  if (!pageInfo?.cropBox) fail(`${annotation.editorId} has no usable page geometry.`);
  validateBounds(annotation.bounds, pageInfo, annotation.editorId);
  validatePoint(annotation.position, annotation.bounds, pageInfo, `${annotation.editorId} position`);
  validateStyle(annotation.style, annotation.editorId);
  if (annotation.annotationType === "Text") {
    if (typeof annotation.content?.text !== "string" || annotation.content.text.length === 0 || new TextEncoder().encode(annotation.content.text).byteLength > MAX_TEXT_BYTES) fail(`${annotation.editorId} text is invalid or too large.`);
  } else if (annotation.annotationType === "Ink") {
    validatePaths(annotation.content?.paths, annotation.bounds, pageInfo, annotation.editorId);
  } else if (annotation.annotationType === "Signature") {
    const strokes = annotation.content?.strokes;
    if (!Array.isArray(strokes) || strokes.length === 0) fail(`${annotation.editorId} must contain strokes.`);
    const paths = strokes.map((stroke, index) => {
      if (!stroke || typeof stroke !== "object") fail(`${annotation.editorId} stroke ${index} is invalid.`);
      return stroke.points;
    });
    validatePaths(paths, annotation.bounds, pageInfo, annotation.editorId);
    if (!Array.isArray(annotation.content.paths) || annotation.content.paths.length !== paths.length) {
      fail(`${annotation.editorId} signature paths do not match its strokes.`);
    }
    for (const [index, path] of annotation.content.paths.entries()) {
      if (!Array.isArray(path) || path.length !== paths[index].length) fail(`${annotation.editorId} signature paths do not match its strokes.`);
      path.forEach((point, pointIndex) => {
        const strokePoint = paths[index][pointIndex];
        finite(point?.x, `${annotation.editorId} path ${index} point ${pointIndex}.x`);
        finite(point?.y, `${annotation.editorId} path ${index} point ${pointIndex}.y`);
        if (Math.abs(point.x - strokePoint.x) > EPSILON || Math.abs(point.y - strokePoint.y) > EPSILON) {
          fail(`${annotation.editorId} signature paths do not match its strokes.`);
        }
      });
    }
    strokes.forEach((stroke, index) => validateStyle({ ...annotation.style, color: stroke.color, opacity: stroke.opacity, strokeWidth: stroke.strokeWidth }, `${annotation.editorId} stroke ${index}`));
  } else if (annotation.annotationType === "Highlight") {
    const quads = annotation.content?.quads;
    if (!Array.isArray(quads) || quads.length === 0) fail(`${annotation.editorId} highlight geometry is empty.`);
    for (const [index, quad] of quads.entries()) {
      if (!quad || typeof quad !== "object" || Object.keys(quad).length !== HIGHLIGHT_POINT_KEYS.length || HIGHLIGHT_POINT_KEYS.some((key) => !(key in quad))) {
        fail(`${annotation.editorId} quad ${index} is invalid.`);
      }
      for (const name of HIGHLIGHT_POINT_KEYS) validatePoint(quad[name], annotation.bounds, pageInfo, `${annotation.editorId} quad ${index} ${name}`);
    }
  } else {
    fail(`${annotation.editorId} uses an unsupported annotation type.`);
  }
}

/** Validate committed editor state against the Rust document before serialization. */
export function validateExportState(documentHandle, annotations) {
  if (!documentHandle || !Array.isArray(annotations)) fail("No committed document state is available for export.");
  const pageCount = documentHandle.pageCount();
  const ids = new Set();
  for (const annotation of annotations) {
    if (!annotation || typeof annotation !== "object" || Array.isArray(annotation)) fail("Annotation record is invalid.");
    if (!Number.isSafeInteger(annotation.pageIndex) || annotation.pageIndex < 0 || annotation.pageIndex >= pageCount) fail(`${annotation.editorId || "Annotation"} refers to an invalid page.`);
    if (ids.has(annotation.editorId)) fail(`Duplicate annotation ID: ${annotation.editorId}.`);
    ids.add(annotation.editorId);
    validateAnnotation(annotation, documentHandle.pageInfo(annotation.pageIndex));
  }
  const rustAnnotations = documentHandle.listAnnotations();
  if (!Array.isArray(rustAnnotations)) fail("Rust returned an invalid annotation list.");
  const rustById = new Map(rustAnnotations.map((annotation) => [annotation.editorId, annotation]));
  if (rustById.size !== rustAnnotations.length) fail("Rust returned duplicate annotation IDs.");
  if (rustById.size !== ids.size) fail("Committed editor state does not match the Rust document.");
  for (const annotation of annotations) {
    const rustAnnotation = rustById.get(annotation.editorId);
    if (!rustAnnotation) fail(`${annotation.editorId} is not committed to the Rust document.`);
    if (!sameAnnotation(annotation, rustAnnotation)) fail(`${annotation.editorId} differs from the Rust document state (${annotationDifferences(annotation, rustAnnotation).join(", ")}).`);
  }
  return true;
}

/** Serialize, reopen, and semantically verify a new PDF byte buffer. */
export async function exportPdfBytes({ documentHandle, annotations, reopen }) {
  validateExportState(documentHandle, annotations);
  if (typeof reopen !== "function") throw new WasmBridgeError("serialization_failed", "The exported PDF could not be verified.", false);
  const bytes = documentHandle.save();
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new WasmBridgeError("serialization_failed", "Rust returned no PDF bytes.", false);
  let reopened;
  try {
    reopened = await reopen(bytes);
  } catch {
    throw new WasmBridgeError("serialization_failed", "The exported PDF could not be reopened after serialization.", false);
  }
  if (!reopened || typeof reopened.pageCount !== "function" || typeof reopened.listAnnotations !== "function" || typeof reopened.dispose !== "function") {
    throw new WasmBridgeError("serialization_failed", "The exported PDF verification handle is invalid.", false);
  }
  try {
    if (reopened.pageCount() !== documentHandle.pageCount()) throw new WasmBridgeError("serialization_failed", "Exported PDF page count changed.", false);
    for (let pageIndex = 0; pageIndex < documentHandle.pageCount(); pageIndex += 1) {
      if (!samePageInfo(documentHandle.pageInfo(pageIndex), reopened.pageInfo(pageIndex))) throw new WasmBridgeError("serialization_failed", `Exported PDF page ${pageIndex + 1} dimensions or order changed.`, false);
    }
    const exportedAnnotations = reopened.listAnnotations();
    if (!Array.isArray(exportedAnnotations) || exportedAnnotations.length !== annotations.length) throw new WasmBridgeError("serialization_failed", "Exported PDF annotation count changed.", false);
    const exportedById = new Map(exportedAnnotations.map((annotation) => [annotation.editorId, annotation]));
    for (const annotation of annotations) {
      const exported = exportedById.get(annotation.editorId);
      if (!exported) throw new WasmBridgeError("serialization_failed", `Exported PDF lost annotation ${annotation.editorId}.`, false);
      if (!sameAnnotation(annotation, exported)) throw new WasmBridgeError("serialization_failed", `Exported PDF changed annotation ${annotation.editorId} (${annotationDifferences(annotation, exported).join(", ")}).`, false);
    }
  } finally {
    reopened.dispose();
  }
  return bytes;
}

export function suggestedFilename(originalName) {
  const safeName = String(originalName || "document.pdf").split(/[\\/]/).pop().replace(/[^\w.()\- ]/g, "_").replace(/\.pdf$/i, "").trim() || "document";
  return `${safeName}-modified.pdf`;
}

export function downloadPdf(bytes, filename, browser = globalThis) {
  const blob = new browser.Blob([bytes], { type: "application/pdf" });
  const url = browser.URL.createObjectURL(blob);
  const link = browser.document.createElement("a");
  link.href = url;
  link.download = filename;
  browser.document.body.append(link);
  try {
    link.click();
  } finally {
    browser.setTimeout(() => {
      link.remove();
      browser.URL.revokeObjectURL(url);
    }, 1000);
  }
}
function validateEditorId(editorId, label) {
  if (typeof editorId !== "string" || editorId.length === 0) fail(`${label} editor ID is invalid.`);
  const byteLength = new TextEncoder().encode(editorId).byteLength;
  if (byteLength > MAX_EDITOR_ID_BYTES || !/^[\x21-\x7e]+$/.test(editorId) || /[()\\]/.test(editorId)) {
    fail(`${label} editor ID contains unsupported characters or is too long.`);
  }
}
function closeEnough(left, right) {
  return typeof left === "number" && typeof right === "number" && Math.abs(left - right) <= 1e-6 * Math.max(1, Math.abs(left), Math.abs(right));
}
function samePoint(left, right) {
  return closeEnough(left?.x, right?.x) && closeEnough(left?.y, right?.y);
}
function sameBounds(left, right) {
  return ["left", "bottom", "right", "top"].every((key) => closeEnough(left?.[key], right?.[key]));
}
function sameColor(left, right) {
  return ["red", "green", "blue"].every((key) => closeEnough(left?.[key], right?.[key]));
}
function sameStyle(left, right, annotationType) {
  if (!sameColor(left?.color, right?.color) || !closeEnough(left?.opacity, right?.opacity)) return false;
  if (["Ink", "Signature"].includes(annotationType) && !closeEnough(left?.strokeWidth, right?.strokeWidth)) return false;
  return annotationType !== "Text" || closeEnough(left?.fontSize, right?.fontSize);
}
function samePath(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((point, index) => samePoint(point, right[index]));
}
function sameContent(left, right, annotationType) {
  if (annotationType === "Text") return left?.text === right?.text;
  if (annotationType === "Ink") return Array.isArray(left?.paths) && Array.isArray(right?.paths) && left.paths.length === right.paths.length && left.paths.every((path, index) => samePath(path, right.paths[index]));
  if (annotationType === "Highlight") return Array.isArray(left?.quads) && Array.isArray(right?.quads) && left.quads.length === right.quads.length && left.quads.every((quad, index) => HIGHLIGHT_POINT_KEYS.every((key) => samePoint(quad?.[key], right.quads[index]?.[key])));
  if (annotationType === "Signature") return Array.isArray(left?.strokes) && Array.isArray(right?.strokes) && left.strokes.length === right.strokes.length && left.strokes.every((stroke, index) => samePath(stroke?.points, right.strokes[index]?.points) && sameStyle(stroke?.style ?? stroke, right.strokes[index]?.style ?? right.strokes[index], "Ink"));
  return false;
}
function annotationDifferences(left, right) {
  return [
    ["editorId", left?.editorId === right?.editorId],
    ["pageIndex", left?.pageIndex === right?.pageIndex],
    ["annotationType", left?.annotationType === right?.annotationType],
    ["position", samePoint(left?.position, right?.position)],
    ["bounds", sameBounds(left?.bounds, right?.bounds)],
    ["style", sameStyle(left?.style, right?.style, left?.annotationType)],
    ["content", sameContent(left?.content, right?.content, left?.annotationType)],
  ].filter(([, equal]) => !equal).map(([name]) => name);
}
function sameAnnotation(left, right) {
  return annotationDifferences(left, right).length === 0;
}
