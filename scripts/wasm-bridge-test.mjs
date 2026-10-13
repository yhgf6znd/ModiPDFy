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

const saved = documentHandle.save();
assert(saved instanceof Uint8Array);
assert(saved.byteLength > 0);
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
