import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createPdfFixture } from "../tests/browser/pdf-fixture.js";
import {
  initializeWasm,
  openPdfDocument,
  WasmBridgeError,
} from "../web/js/wasm-bridge.js";

const wasmBytes = await readFile(new URL("../web/pkg/modipdfy_wasm_bg.wasm", import.meta.url));
const wasmModule = await WebAssembly.compile(wasmBytes);
await initializeWasm({ module_or_path: wasmModule });

const source = createPdfFixture();
const documentHandle = await openPdfDocument(source);
assert.equal(documentHandle.pageCount(), 1);
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
assert.equal(documentHandle.addHighlightAnnotation(highlightAnnotation), "wasm-highlight-1");
assert.equal(documentHandle.listAnnotations().length, 3);

const saved = documentHandle.save();
assert(saved instanceof Uint8Array);
assert(saved.byteLength > 0);
const reopenedAnnotated = await openPdfDocument(saved);
assert.equal(reopenedAnnotated.listAnnotations().length, 3);
reopenedAnnotated.removeAnnotation("wasm-highlight-1");
assert.equal(reopenedAnnotated.listAnnotations().length, 2);
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
  assert.equal(repeated.pageCount(), 1);
  repeated.dispose();
}

console.log("WASM bridge integration tests passed.");
