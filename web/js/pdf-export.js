import { WasmBridgeError } from "./wasm-bridge.js";

const EPSILON = 1e-7;
const MAX_TEXT_BYTES = 64 * 1024;
const MAX_STROKE_POINTS = 100_000;

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
  if (!annotation || !Number.isSafeInteger(annotation.pageIndex) || annotation.pageIndex < 0) fail("Annotation page reference is invalid.");
  if (typeof annotation.editorId !== "string" || annotation.editorId.length === 0) fail("Annotation editor ID is invalid.");
  validateBounds(annotation.bounds, pageInfo, annotation.editorId);
  validatePoint(annotation.position, annotation.bounds, pageInfo, `${annotation.editorId} position`);
  validateStyle(annotation.style, annotation.editorId);
  if (annotation.annotationType === "Text") {
    if (typeof annotation.content?.text !== "string" || annotation.content.text.length === 0 || new TextEncoder().encode(annotation.content.text).byteLength > MAX_TEXT_BYTES) fail(`${annotation.editorId} text is invalid or too large.`);
  } else if (annotation.annotationType === "Ink") {
    validatePaths(annotation.content?.paths, annotation.bounds, pageInfo, annotation.editorId);
  } else if (annotation.annotationType === "Signature") {
    const paths = annotation.content?.strokes?.map((stroke) => stroke.points);
    validatePaths(paths, annotation.bounds, pageInfo, annotation.editorId);
    annotation.content.strokes.forEach((stroke, index) => validateStyle({ ...annotation.style, color: stroke.color, opacity: stroke.opacity, strokeWidth: stroke.strokeWidth }, `${annotation.editorId} stroke ${index}`));
  } else if (annotation.annotationType === "Highlight") {
    if (!Array.isArray(annotation.content?.quads) || annotation.content.quads.length === 0) fail(`${annotation.editorId} highlight geometry is empty.`);
    for (const [index, quad] of annotation.content.quads.entries()) {
      for (const [name, point] of Object.entries(quad)) validatePoint(point, annotation.bounds, pageInfo, `${annotation.editorId} quad ${index} ${name}`);
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
    if (ids.has(annotation.editorId)) fail(`Duplicate annotation ID: ${annotation.editorId}.`);
    ids.add(annotation.editorId);
    if (annotation.pageIndex >= pageCount) fail(`${annotation.editorId} refers to a missing page.`);
    validateAnnotation(annotation, documentHandle.pageInfo(annotation.pageIndex));
  }
  const rustIds = new Set(documentHandle.listAnnotations().map((annotation) => annotation.editorId));
  if (rustIds.size !== ids.size) fail("Committed editor state does not match the Rust document.");
  for (const id of ids) if (!rustIds.has(id)) fail(`${id} is not committed to the Rust document.`);
  return true;
}

/** Serialize, reopen, and semantically verify a new PDF byte buffer. */
export async function exportPdfBytes({ documentHandle, annotations, reopen }) {
  validateExportState(documentHandle, annotations);
  const bytes = documentHandle.save();
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new WasmBridgeError("serialization_failed", "Rust returned no PDF bytes.", false);
  let reopened;
  try {
    reopened = await reopen(bytes);
  } catch {
    throw new WasmBridgeError("serialization_failed", "The exported PDF could not be reopened after serialization.", false);
  }
  try {
    if (reopened.pageCount() !== documentHandle.pageCount()) throw new WasmBridgeError("serialization_failed", "Exported PDF page count changed.", false);
    for (let pageIndex = 0; pageIndex < documentHandle.pageCount(); pageIndex += 1) {
      if (!samePageInfo(documentHandle.pageInfo(pageIndex), reopened.pageInfo(pageIndex))) throw new WasmBridgeError("serialization_failed", `Exported PDF page ${pageIndex + 1} dimensions or order changed.`, false);
    }
    const exportedIds = new Set(reopened.listAnnotations().map((annotation) => annotation.editorId));
    for (const annotation of annotations) if (!exportedIds.has(annotation.editorId)) throw new WasmBridgeError("serialization_failed", `Exported PDF lost annotation ${annotation.editorId}.`, false);
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
  try {
    link.click();
  } finally {
    link.remove();
    browser.setTimeout(() => browser.URL.revokeObjectURL(url), 0);
  }
}
