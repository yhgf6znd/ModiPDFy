const CACHE_NAME = "modipdfy-shell-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./css/main.css",
  "./js/main.js",
  "./js/wasm-client.js",
  "./js/wasm-bridge.js",
  "./manifest.webmanifest",
  "./pkg/modipdfy_wasm.js",
  "./pkg/modipdfy_wasm_bg.wasm",
];

self.addEventListener("install", (event) => {
  const scope = self.registration.scope;
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS.map((asset) => new URL(asset, scope)))),
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
