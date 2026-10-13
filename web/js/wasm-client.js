import {
  getVersion,
  initializeWasm,
  openPdfDocument,
  translateWasmError,
  WasmBridgeError,
} from "./wasm-bridge.js";

export { getVersion, initializeWasm, openPdfDocument, translateWasmError, WasmBridgeError };

/** Backward-compatible loader used by the current application shell. */
export async function loadWasm() {
  await initializeWasm();
  return { getVersion };
}
