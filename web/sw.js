const CACHE_NAME = "modipdfy-shell-v9";
const CACHE_PREFIX = "modipdfy-shell-";
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./css/main.css",
  "./js/main.js",
  "./js/pwa.js",
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
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./pkg/modipdfy_wasm.js",
  "./pkg/modipdfy_wasm_bg.wasm",
];

async function precacheAssets() {
  const scope = self.registration.scope;
  const manifestResponse = await fetch(new URL("./pdfjs/asset-manifest.json", scope), { cache: "no-store" });
  if (!manifestResponse.ok) throw new Error("PDF.js asset manifest could not be loaded");
  const pdfjsAssets = await manifestResponse.json();
  if (!Array.isArray(pdfjsAssets)) throw new Error("PDF.js asset manifest is invalid");
  const urls = [...new Set([...STATIC_ASSETS, ...pdfjsAssets])].map((asset) => new URL(asset, scope));
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(urls);
}

self.addEventListener("install", (event) => {
  // Do not activate a partial update. The old worker/cache remains in control if this fails.
  event.waitUntil(precacheAssets());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key)),
    )).then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch {
        return (await caches.match(new URL("./index.html", self.registration.scope))) || Response.error();
      }
    })());
    return;
  }

  // Only precached same-origin assets are served from Cache Storage. User PDFs are never added.
  event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request)));
});
