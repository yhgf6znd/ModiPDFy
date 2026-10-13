/**
 * The only browser module that knows the generated wasm-pack API.
 */
export async function loadWasm() {
  const wasmModule = await import("../pkg/modipdfy_wasm.js");
  await wasmModule.default();

  return {
    getVersion: wasmModule.get_version,
  };
}
