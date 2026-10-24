import {
  getVersion,
  initializeWasm,
  MAX_PDF_INPUT_BYTES,
  openPdfDocument,
  translateWasmError,
  WasmBridgeError,
} from "./wasm-bridge.js";

export { getVersion, initializeWasm, MAX_PDF_INPUT_BYTES, openPdfDocument, translateWasmError, WasmBridgeError };

/** Backward-compatible loader used by the current application shell. */
export async function loadWasm() {
  await initializeWasm();
  return { getVersion };
}
