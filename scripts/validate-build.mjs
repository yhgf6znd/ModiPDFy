import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(new URL("..", import.meta.url).pathname);
const outputDirectory = resolve(projectRoot, "dist");

function normalizeBasePath(value) {
  const raw = String(value ?? "/").trim() || "/";
  if (!raw.startsWith("/") || raw.includes("..")) {
    throw new Error(`PUBLIC_BASE_PATH must be an absolute URL path without '..': ${raw}`);
  }
  return raw.endsWith("/") ? raw : `${raw}/`;
}

function requireFile(relativePath) {
  const path = resolve(outputDirectory, relativePath);
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Missing generated asset: ${relativePath}`);
  return path;
}

function read(relativePath) {
  return readFileSync(requireFile(relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const publicBasePath = normalizeBasePath(process.env.PUBLIC_BASE_PATH);
assert(existsSync(outputDirectory), "The dist directory does not exist. Run the production build first.");

for (const asset of [
  ".nojekyll",
  "index.html",
  "css/main.css",
  "js/main.js",
  "js/pwa.js",
  "js/wasm-client.js",
  "js/pdf-viewer.js",
  "pdfjs/pdf.js",
  "pdfjs/pdf.worker.js",
  "pdfjs/pdf_viewer.css",
  "pdfjs/asset-manifest.json",
  "manifest.webmanifest",
  "sw.js",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "pkg/modipdfy_wasm.js",
  "pkg/modipdfy_wasm_bg.wasm",
]) requireFile(asset);

const manifest = JSON.parse(read("manifest.webmanifest"));
assert(manifest.start_url === "./", "The manifest start_url must remain relative for root and project Pages deployments.");
assert(manifest.scope === "./", "The manifest scope must remain relative for root and project Pages deployments.");
for (const icon of manifest.icons ?? []) requireFile(icon.src.replace(/^\.\//, ""));

const assetManifest = JSON.parse(read("pdfjs/asset-manifest.json"));
assert(Array.isArray(assetManifest) && assetManifest.length > 0, "The PDF.js asset manifest is empty or invalid.");
for (const asset of assetManifest) requireFile(asset.replace(/^\.\//, ""));

const index = read("index.html");
for (const match of index.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
  const reference = match[1];
  if (reference.startsWith("./")) requireFile(reference.slice(2));
  assert(!reference.startsWith("/"), `Generated HTML contains a root-relative path: ${reference}`);
  assert(!/^https?:\/\//i.test(reference), `Generated HTML contains a runtime remote URL: ${reference}`);
}

const runtimeSources = ["index.html", "manifest.webmanifest", "sw.js", ...readdirSync(resolve(outputDirectory, "js"), { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
  .map((entry) => `js/${entry.name}`)];
for (const relativePath of runtimeSources) {
  const source = read(relativePath);
  assert(!/https?:\/\/(?!www\.w3\.org\/2000\/svg)/i.test(source), `Runtime asset contains a remote URL: ${relativePath}`);
}

const serviceWorker = read("sw.js");
assert(serviceWorker.includes("./pkg/modipdfy_wasm_bg.wasm"), "The service worker does not precache the WASM binary.");
assert(serviceWorker.includes("./pdfjs/pdf.worker.js"), "The service worker does not precache the PDF.js worker.");
assert(serviceWorker.includes("./icons/icon-192.png"), "The service worker does not precache the PWA icons.");

console.log(`Validated ${outputDirectory} for public base path ${publicBasePath}.`);
