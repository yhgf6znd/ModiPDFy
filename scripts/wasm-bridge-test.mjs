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
  WasmBridgeError,
} from "../web/js/wasm-bridge.js";

const wasmBytes = await readFile(new URL("../web/pkg/modipdfy_wasm_bg.wasm", import.meta.url));
const wasmModule = await WebAssembly.compile(wasmBytes);
await initializeWasm({ module_or_path: wasmModule });

const source = createMultipagePdfFixture(3);
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


const saved = await exportPdfBytes({ documentHandle, annotations: documentHandle.listAnnotations(), reopen: openPdfDocument });
assert(saved instanceof Uint8Array);
assert(saved.byteLength > 0);

const exportDirectory = await mkdtemp(join(tmpdir(), "modipdfy-export-"));
try {
  const exportPath = join(exportDirectory, "modified.pdf");
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
} finally {
  await rm(exportDirectory, { recursive: true, force: true });
}
const reopenedAnnotated = await openPdfDocument(saved);
assert.equal(reopenedAnnotated.listAnnotations().length, 4);
assert.equal(reopenedAnnotated.listAnnotations().find((annotation) => annotation.annotationType === "Signature")?.content.strokes[0].strokeWidth, 5);
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
  (error) => error instanceof WasmBridgeError && error.code === "malformed_pdf",
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
