const CACHE_NAME = "modipdfy-shell-v8";
const ASSETS = [
  "./",
  "./index.html",
  "./css/main.css",
  "./js/main.js",
  "./js/coordinates.js",
  "./js/annotation-model.js",
  "./js/annotation-overlay.js",
  "./js/annotation-interaction.js",
  "./js/pdfjs-loader.js",
  "./js/pdf-viewer.js",
  "./js/wasm-client.js",
  "./js/wasm-bridge.js",
  "./js/pdf-export.js",
  "./js/history.js",
  "./js/signature-pad.js",
  "./js/signature-storage.js",
  "./pdfjs/pdf.js",
  "./pdfjs/pdf.worker.js",
  "./pdfjs/pdf_viewer.css",
  "./pdfjs/LICENSE",
  "./pdfjs/NOTICE.txt",
  "./pdfjs/asset-manifest.json",
  "./manifest.webmanifest",
  "./pkg/modipdfy_wasm.js",
  "./pkg/modipdfy_wasm_bg.wasm",
];

self.addEventListener("install", (event) => {
  const scope = self.registration.scope;
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      const manifestResponse = await fetch(new URL("./pdfjs/asset-manifest.json", scope));
      const pdfjsAssets = await manifestResponse.json();
      await cache.addAll([...new Set([...ASSETS, ...pdfjsAssets])].map((asset) => new URL(asset, scope)));
    }),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key !== CACHE_NAME)
        .map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached ?? fetch(event.request)),
  );
});
