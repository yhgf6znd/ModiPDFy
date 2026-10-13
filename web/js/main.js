import { loadWasm } from "./wasm-client.js";

const statusElement = document.querySelector("#status");
const versionElement = document.querySelector("#version");

function setStatus(message, state = "ready") {
  statusElement.textContent = message;
  statusElement.dataset.state = state;
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    await navigator.serviceWorker.register(new URL("../sw.js", import.meta.url));
  } catch {
    // Offline caching is an enhancement; the local application remains usable if registration fails.
  }
}

async function boot() {
  try {
    const wasm = await loadWasm();
    versionElement.textContent = wasm.getVersion();
    setStatus("Rust/WASM core loaded. PDF editing modules will be added next.");
    await registerServiceWorker();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown startup error";
    setStatus(`The Rust/WASM core could not load: ${message}`, "error");
    versionElement.textContent = "Unavailable";
  }
}

void boot();
