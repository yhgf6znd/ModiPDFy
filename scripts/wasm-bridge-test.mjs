import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createMultipagePdfFixture } from "../tests/browser/pdf-fixture.js";
import { exportPdfBytes } from "../web/js/pdf-export.js";
import {
  initializeWasm,
  openPdfDocument,
  translateWasmError,
  WasmBridgeError,
} from "../web/js/wasm-bridge.js";

const wasmBytes = await readFile(new URL("../web/pkg/modipdfy_wasm_bg.wasm", import.meta.url));
const wasmModule = await WebAssembly.compile(wasmBytes);
await initializeWasm({ module_or_path: wasmModule });
assert.equal(translateWasmError(new RangeError("memory access out of bounds")).code, "memory_exhausted");
const serviceWorkerSource = await readFile(new URL("../web/sw.js", import.meta.url), "utf8");
assert(serviceWorkerSource.includes("modipdfy-shell-v8"), "service-worker cache version was not updated");
for (const asset of ["main.js", "pdf-export.js", "pdfjs-loader.js", "history.js", "signature-pad.js", "signature-storage.js"]) {
  assert(serviceWorkerSource.includes(`"./js/${asset}"`), `service worker does not precache ${asset}`);
}

async function readPpm(path) {
  const bytes = await readFile(path);
  let offset = 0;
  const token = () => {
    while (offset < bytes.length && (bytes[offset] === 10 || bytes[offset] === 13 || bytes[offset] === 32 || bytes[offset] === 9)) offset += 1;
    if (bytes[offset] === 35) {
      while (offset < bytes.length && bytes[offset] !== 10) offset += 1;
      return token();
    }
    const start = offset;
    while (offset < bytes.length && ![10, 13, 32, 9].includes(bytes[offset])) offset += 1;
    return bytes.subarray(start, offset).toString("ascii");
  };
  assert.equal(token(), "P6");
  const width = Number(token());
  const height = Number(token());
  assert.equal(Number(token()), 255);
  while (offset < bytes.length && (bytes[offset] === 10 || bytes[offset] === 13 || bytes[offset] === 32 || bytes[offset] === 9)) offset += 1;
  return { width, height, pixels: bytes.subarray(offset) };
}

function changedPixels(before, after, bounds) {
  assert.equal(before.width, after.width);
  assert.equal(before.height, after.height);
  let changed = 0;
  const left = Math.max(0, Math.floor(bounds.left));
  const right = Math.min(before.width, Math.ceil(bounds.right));
  const top = Math.max(0, before.height - Math.ceil(bounds.top));
  const bottom = Math.min(before.height, before.height - Math.floor(bounds.bottom));
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const pixel = (y * before.width + x) * 3;
      if (before.pixels[pixel] !== after.pixels[pixel] || before.pixels[pixel + 1] !== after.pixels[pixel + 1] || before.pixels[pixel + 2] !== after.pixels[pixel + 2]) changed += 1;
    }
  }
  return changed;
}

const source = createMultipagePdfFixture(3);
const originalSource = source.slice();
const documentHandle = await openPdfDocument(source);
assert.equal(documentHandle.pageCount(), 3);
assert.equal(documentHandle.pageInfo(1).rotationDegrees, 90);
assert.equal(documentHandle.pageInfo(2).rotationDegrees, 180);
assert.deepEqual(documentHandle.pageInfo(0), {
  pageIndex: 0,
  width: 612,
  height: 792,
  rotationDegrees: 0,
  mediaBox: { left: 0, bottom: 0, right: 612, top: 792 },
  cropBox: { left: 0, bottom: 0, right: 612, top: 792 },
});

const style = {
  color: { red: 0.2, green: 0.4, blue: 0.8 },
  opacity: 0.6,
  strokeWidth: 3,
  fontSize: 14,
};
const textAnnotation = {
  editorId: "wasm-text-1",
  pageIndex: 0,
  position: { x: 72, y: 120 },
  bounds: { left: 72, bottom: 80, right: 240, top: 140 },
  style,
  content: { text: "WASM annotation" },
};
const inkAnnotation = {
  editorId: "wasm-ink-1",
  pageIndex: 0,
  position: { x: 100, y: 160 },
  bounds: { left: 100, bottom: 160, right: 140, top: 200 },
  style,
  content: { paths: [[{ x: 100, y: 160 }, { x: 120, y: 190 }, { x: 140, y: 170 }]] },
};
const signatureAnnotation = {
  editorId: "signature-wasm-1",
  pageIndex: 0,
  position: { x: 180, y: 320 },
  bounds: { left: 180, bottom: 300, right: 260, top: 340 },
  style,
  content: {
    paths: [[{ x: 180, y: 310 }, { x: 220, y: 335 }, { x: 260, y: 315 }]],
    strokes: [{ points: [{ x: 180, y: 310 }, { x: 220, y: 335 }, { x: 260, y: 315 }], color: { red: 0.8, green: 0.1, blue: 0.2 }, opacity: 1, strokeWidth: 5, fontSize: 14 }],
  },
};
const highlightAnnotation = {
  editorId: "wasm-highlight-1",
  pageIndex: 0,
  position: { x: 80, y: 240 },
  bounds: { left: 80, bottom: 220, right: 280, top: 250 },
  style,
  content: { quads: [{ topLeft: { x: 80, y: 250 }, topRight: { x: 280, y: 250 }, bottomLeft: { x: 80, y: 220 }, bottomRight: { x: 280, y: 220 } }] },
};
assert.equal(documentHandle.addTextAnnotation(textAnnotation), "wasm-text-1");
assert.equal(documentHandle.addInkAnnotation(inkAnnotation), "wasm-ink-1");
assert.equal(documentHandle.addSignatureAnnotation(signatureAnnotation), "signature-wasm-1");
assert.equal(documentHandle.addHighlightAnnotation(highlightAnnotation), "wasm-highlight-1");
assert.equal(documentHandle.listAnnotations().length, 4);
assert.equal(documentHandle.listAnnotations().find((annotation) => annotation.annotationType === "Signature")?.editorId, "signature-wasm-1");
const oversizedInk = { ...inkAnnotation, editorId: "wasm-ink-oversized", content: { paths: [Array.from({ length: 100001 }, () => ({ x: 120, y: 180 }))] } };
assert.throws(
  () => documentHandle.addInkAnnotation(oversizedInk),
  (error) => error instanceof WasmBridgeError && error.code === "invalid_annotation",
);


const oversizedSignature = { ...signatureAnnotation, editorId: "signature-wasm-oversized", content: { strokes: [{ ...signatureAnnotation.content.strokes[0], points: Array.from({ length: 100001 }, () => ({ x: 200, y: 320 })) }] } };
assert.throws(
  () => documentHandle.addSignatureAnnotation(oversizedSignature),
  (error) => error instanceof WasmBridgeError && error.code === "invalid_annotation",
);

const malformedHighlight = structuredClone(documentHandle.listAnnotations());
malformedHighlight.find((annotation) => annotation.annotationType === "Highlight").content.quads = [{}];
await assert.rejects(
  () => exportPdfBytes({ documentHandle, annotations: malformedHighlight, reopen: openPdfDocument }),
  (error) => error instanceof WasmBridgeError && error.code === "invalid_export_state",
);
const malformedSignature = structuredClone(documentHandle.listAnnotations());
malformedSignature.find((annotation) => annotation.annotationType === "Signature").content.strokes = [null];
await assert.rejects(
  () => exportPdfBytes({ documentHandle, annotations: malformedSignature, reopen: openPdfDocument }),
  (error) => error instanceof WasmBridgeError && error.code === "invalid_export_state",
);
const saved = await exportPdfBytes({ documentHandle, annotations: documentHandle.listAnnotations(), reopen: openPdfDocument });
assert(saved instanceof Uint8Array);
assert(saved.byteLength > 0);
assert.deepEqual(source, originalSource, "export mutated the original browser-owned bytes");

const exportDirectory = await mkdtemp(join(tmpdir(), "modipdfy-export-"));
try {
  const exportPath = join(exportDirectory, "modified.pdf");
  const sourcePath = join(exportDirectory, "source.pdf");
  await writeFile(sourcePath, source);
  await writeFile(exportPath, saved);
  const pdfInfo = execFileSync("pdfinfo", [exportPath], { encoding: "utf8" });
  assert.match(pdfInfo, /Pages:\s+3/);
  const extractedText = execFileSync("pdftotext", [exportPath, "-"], { encoding: "utf8" });
  assert.match(extractedText, /ModiPDFy page 1/);
  assert.match(extractedText, /ModiPDFy page 3/);
  execFileSync("gs", ["-q", "-dSAFER", "-dBATCH", "-dNOPAUSE", "-sDEVICE=nullpage", exportPath]);
  const renderPrefix = join(exportDirectory, "page");
  execFileSync("pdftoppm", ["-f", "1", "-l", "1", "-singlefile", "-png", exportPath, renderPrefix]);
  assert((await stat(`${renderPrefix}.png`)).size > 0);
  const sourceRenderPrefix = join(exportDirectory, "source-page-1");
  const exportedRenderPrefix = join(exportDirectory, "exported-page-1");
  const sourcePage3Prefix = join(exportDirectory, "source-page-3");
  const exportedPage3Prefix = join(exportDirectory, "exported-page-3");
  for (const [path, prefix, page] of [[sourcePath, sourceRenderPrefix, 1], [exportPath, exportedRenderPrefix, 1], [sourcePath, sourcePage3Prefix, 3], [exportPath, exportedPage3Prefix, 3]]) {
    execFileSync("pdftoppm", ["-f", String(page), "-l", String(page), "-singlefile", "-r", "72", path, prefix]);
  }
  const sourcePage1 = await readPpm(`${sourceRenderPrefix}.ppm`);
  const exportedPage1 = await readPpm(`${exportedRenderPrefix}.ppm`);
  const sourcePage3 = await readPpm(`${sourcePage3Prefix}.ppm`);
  const exportedPage3 = await readPpm(`${exportedPage3Prefix}.ppm`);
  assert.deepEqual(sourcePage3.pixels, exportedPage3.pixels, "unaffected page pixels changed during export");
  assert(changedPixels(sourcePage1, exportedPage1, { left: 72, bottom: 80, right: 240, top: 140 }) > 0, "text appearance did not change rendered pixels");
  assert(changedPixels(sourcePage1, exportedPage1, { left: 100, bottom: 160, right: 140, top: 200 }) > 0, "ink appearance did not change rendered pixels");
  assert(changedPixels(sourcePage1, exportedPage1, { left: 180, bottom: 300, right: 260, top: 340 }) > 0, "signature appearance did not change rendered pixels");
  assert(changedPixels(sourcePage1, exportedPage1, { left: 80, bottom: 220, right: 280, top: 250 }) > 0, "highlight appearance did not change rendered pixels");
} finally {
  await rm(exportDirectory, { recursive: true, force: true });
}
const reopenedAnnotated = await openPdfDocument(saved);
assert.equal(reopenedAnnotated.listAnnotations().length, 4);
assert.equal(reopenedAnnotated.listAnnotations().find((annotation) => annotation.annotationType === "Signature")?.content.strokes[0].strokeWidth, 5);
const reopenedSignature = reopenedAnnotated.listAnnotations().find((annotation) => annotation.annotationType === "Signature");
assert.deepEqual(reopenedSignature.bounds, signatureAnnotation.bounds, "signature bounds changed during export");
assert(reopenedSignature.content.strokes[0].points.every((point) => point.x >= reopenedSignature.bounds.left && point.x <= reopenedSignature.bounds.right && point.y >= reopenedSignature.bounds.bottom && point.y <= reopenedSignature.bounds.top), "signature stroke escaped its exported bounds");
reopenedAnnotated.removeAnnotation("wasm-highlight-1");
assert.equal(reopenedAnnotated.listAnnotations().length, 3);
reopenedAnnotated.dispose();
documentHandle.dispose();
assert.throws(
  () => documentHandle.pageCount(),
  (error) => error instanceof WasmBridgeError && error.code === "document_disposed",
);

await assert.rejects(
  () => openPdfDocument(new Uint8Array([1, 2, 3])),
  (error) => error instanceof WasmBridgeError && error.code === "malformed_pdf" && error.message === "The PDF could not be parsed. It may be malformed or unsupported.",
);

await assert.rejects(
  () => openPdfDocument(new Uint8Array()),
  (error) => error instanceof WasmBridgeError && error.code === "invalid_input",
);

for (let index = 0; index < 8; index += 1) {
  const repeated = await openPdfDocument(source);
  assert.equal(repeated.pageCount(), 3);
  repeated.dispose();
}

console.log("WASM bridge integration tests passed.");
