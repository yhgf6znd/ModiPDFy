import { createPdfFixture } from "./pdf-fixture.js";
import {
  initializeWasm,
  openPdfDocument,
  WasmBridgeError,
} from "../../web/js/wasm-bridge.js";

const result = document.querySelector("#result");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function run() {
  await initializeWasm();
  const source = createPdfFixture();
  const documentHandle = await openPdfDocument(source);

  assert(documentHandle.pageCount() === 1, "expected one page");
  const page = documentHandle.pageInfo(0);
  assert(page.width === 612 && page.height === 792, "unexpected page dimensions");

  const saved = documentHandle.save();
  assert(saved instanceof Uint8Array && saved.byteLength > 0, "expected exported PDF bytes");
  documentHandle.dispose();

  let disposed = false;
  try {
    documentHandle.pageCount();
  } catch (error) {
    disposed = error instanceof WasmBridgeError && error.code === "document_disposed";
  }
  assert(disposed, "disposed document should reject operations");

  let malformed = false;
  try {
    await openPdfDocument(new Uint8Array([1, 2, 3]));
  } catch (error) {
    malformed = error instanceof WasmBridgeError && error.code === "malformed_pdf";
  }
  assert(malformed, "malformed PDF should return a structured error");

  for (let index = 0; index < 8; index += 1) {
    const repeated = await openPdfDocument(source);
    assert(repeated.pageCount() === 1, "repeated document did not load");
    repeated.dispose();
  }

  result.dataset.status = "pass";
  result.textContent = "WASM bridge integration tests passed.";
}

try {
  await run();
} catch (error) {
  result.dataset.status = "fail";
  result.textContent = error instanceof Error ? error.message : String(error);
  throw error;
}
