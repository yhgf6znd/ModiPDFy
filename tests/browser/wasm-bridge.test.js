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

async function waitForActivation(registration) {
  const worker = registration.installing || registration.waiting || registration.active;
  if (!worker || worker.state === "activated") return;
  await new Promise((resolve, reject) => {
    worker.addEventListener("statechange", () => {
      if (worker.state === "activated") resolve();
      else if (worker.state === "redundant") reject(new Error("service worker became redundant"));
    });
  });
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

  const registration = await navigator.serviceWorker.register(new URL("../../web/sw.js", import.meta.url), { scope: new URL("../../web/", import.meta.url).pathname });
  await waitForActivation(registration);
  const shellCache = await caches.open("modipdfy-shell-v10");
  for (const asset of ["main.js", "pwa.js", "pdf-export.js", "pdfjs-loader.js", "history.js", "signature-pad.js", "signature-storage.js"]) {
    assert(await shellCache.match(new URL(`../../web/js/${asset}`, import.meta.url)), `offline cache is missing ${asset}`);
  }
  for (const asset of ["icon-192.png", "icon-512.png", "icon-maskable-512.png"]) {
    assert(await shellCache.match(new URL(`../../web/icons/${asset}`, import.meta.url)), `offline cache is missing ${asset}`);
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
