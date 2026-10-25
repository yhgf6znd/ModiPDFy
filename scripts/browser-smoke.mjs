import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "@playwright/test";

import { createPdfFixture } from "../tests/browser/pdf-fixture.js";

const projectRoot = resolve(new URL("..", import.meta.url).pathname);
const temporaryRoot = mkdtempSync(join(tmpdir(), "modipdfy-browser-smoke-"));
const hostedRoot = join(temporaryRoot, "modipdfy");
const fixturePath = join(temporaryRoot, "smoke-fixture.pdf");
const baseUrl = "http://127.0.0.1:8080/modipdfy/";
const serverScript = resolve(projectRoot, "scripts", "serve.mjs");

cpSync(resolve(projectRoot, "dist"), hostedRoot, { recursive: true });
writeFileSync(fixturePath, createPdfFixture());

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function startServer() {
  const server = spawn(process.execPath, [serverScript, temporaryRoot], {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "inherit"],
  });
  const ready = new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error("browser smoke server did not start")), 10_000);
    server.stdout.on("data", (chunk) => {
      if (String(chunk).includes("Serving")) {
        clearTimeout(timeout);
        resolveReady();
      }
    });
    server.once("error", reject);
  });
  return { server, ready };
}

const { server, ready } = startServer();
let serverStopped = false;
function stopServer() {
  if (!serverStopped && server.exitCode === null) {
    serverStopped = true;
    server.kill("SIGINT");
  }
}

let browser;
try {
  await ready;
  browser = await chromium.launch({ headless: true, args: ["--enable-precise-memory-info"] });
  const context = await browser.newContext({ hasTouch: true });
  const page = await context.newPage();
  const externalRequests = [];
  const timings = {};
  page.on("request", (request) => {
    if (request.url().startsWith("http") && !request.url().startsWith("http://127.0.0.1:8080/")) externalRequests.push(request.url());
  });

  const initialLoadStart = Date.now();
  await page.goto(baseUrl);
  await page.waitForFunction(() => document.querySelector("#status")?.textContent !== "Loading the Rust/WASM core…");
  timings.initialLoadMs = Date.now() - initialLoadStart;
  timings.wasmInitMs = await page.evaluate(() => performance.getEntriesByName("modipdfy-wasm-init")[0]?.duration ?? null);
  await page.setViewportSize({ width: 1280, height: 900 });
  assert(await page.locator("#page-sidebar").isVisible(), "desktop page sidebar is not visible");
  assert(await page.locator("#properties-panel").isVisible(), "desktop properties panel is not visible");
  assert(await page.locator("#secondary-toolbar").isVisible(), "desktop secondary annotation toolbar is not visible");
  assert(await page.locator("#toggle-pages").isHidden(), "mobile page toggle is visible on desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.locator("#toggle-pages").isVisible(), "mobile page toggle is not visible");
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "mobile layout has horizontal overflow");
  await page.setViewportSize({ width: 320, height: 700 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "320px layout has horizontal overflow");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#toggle-pages").tap();
  assert(await page.locator("#page-sidebar").evaluate((element) => element.classList.contains("is-open")), "touch page panel did not open");
  await page.locator("#close-pages").tap();
  assert(!(await page.locator("#page-sidebar").evaluate((element) => element.classList.contains("is-open"))), "touch page panel did not close");
  await page.locator("#toggle-tools").tap();
  assert(await page.locator("#properties-panel").evaluate((element) => element.classList.contains("is-open")), "touch properties panel did not open");
  await page.locator("#close-tools").tap();
  assert(!(await page.locator("#properties-panel").evaluate((element) => element.classList.contains("is-open"))), "touch properties panel did not close");
  await page.locator("#theme-select").selectOption("dark");
  assert(await page.locator("html").evaluate((element) => element.dataset.theme === "dark"), "dark theme was not applied");
  await page.locator("#theme-select").selectOption("system");
  const onlineChecks = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const cacheName = (await caches.keys()).find((key) => key.startsWith("modipdfy-shell-"));
    const cache = cacheName ? await caches.open(cacheName) : null;
    const assets = ["./index.html", "./js/main.js", "./pkg/modipdfy_wasm_bg.wasm", "./pdfjs/pdf.worker.mjs", "./manifest.webmanifest", "./icons/icon-192.png"];
    return {
      cacheName,
      controller: Boolean(navigator.serviceWorker.controller),
      manifest: (await fetch("./manifest.webmanifest")).ok,
      pdfWorker: (await fetch("./pdfjs/pdf.worker.mjs")).ok,
      scope: registration.scope,
      assets: await Promise.all(assets.map(async (asset) => Boolean(cache && await cache.match(new URL(asset, registration.scope))))),
    };
  });
  assert(onlineChecks.controller, "production page was not controlled by its service worker");
  assert(onlineChecks.scope === baseUrl, `unexpected service-worker scope: ${onlineChecks.scope}`);
  assert(onlineChecks.manifest && onlineChecks.pdfWorker, "manifest or PDF.js worker did not load");
  assert(onlineChecks.cacheName && onlineChecks.assets.every(Boolean), "required offline assets were not cached");
  assert(externalRequests.length === 0, `runtime requested external URLs: ${externalRequests.join(", ")}`);

  stopServer();
  await context.setOffline(true);
  const offlineReloadStart = Date.now();
  await page.goto(baseUrl);
  await page.waitForFunction(() => document.querySelector("#status")?.textContent !== "Loading the Rust/WASM core…");
  timings.offlineReloadMs = Date.now() - offlineReloadStart;
  assert((await page.locator("#connectivity-status").textContent()).startsWith("Offline"), "offline status was not reported");

  const pdfOpenStart = Date.now();
  await page.locator("#file-input").setInputFiles(fixturePath);
  await page.waitForFunction(() => document.querySelector("#page-count")?.textContent === "1");
  await page.waitForFunction(() => document.querySelector(".pdf-page[data-ready=\"true\"]"));
  timings.pdfOpenAndFirstRenderMs = Date.now() - pdfOpenStart;
  timings.heapAfterFirstRenderMb = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1024 / 1024 * 10) / 10 : null);
  assert(await page.locator(".thumbnail-button").count() === 1, "page thumbnail was not created");
  await page.waitForFunction(() => !document.querySelector('[data-tool="pen"]')?.disabled);
  await page.locator("#viewer-viewport").focus();
  await page.keyboard.press("p");
  assert(await page.locator('[data-tool="pen"][aria-pressed="true"]').count() === 1, "keyboard tool shortcut did not update the active tool");
  await page.locator('[data-tool="text"]').click();
  await page.evaluate(() => {
    const pageElement = document.querySelector(".pdf-page");
    const bounds = pageElement.getBoundingClientRect();
    const event = { bubbles: true, button: 0, pointerId: 1, pointerType: "mouse", clientX: bounds.left + 80, clientY: bounds.top + 100 };
    pageElement.dispatchEvent(new PointerEvent("pointerdown", event));
    pageElement.dispatchEvent(new PointerEvent("pointerup", event));
  });
  await page.locator(".annotation-text-draft").fill("CI offline annotation");
  await page.locator(".annotation-text-draft").press("Control+Enter");
  await page.waitForFunction(() => !document.querySelector(".annotation-text-draft") && !document.querySelector("#export-pdf").disabled);
  assert((await page.locator("#save-state").textContent()) === "Unsaved changes", "unsaved indicator was not shown after editing");

  const exportStart = Date.now();
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#export-pdf").click();
  const download = await downloadPromise;
  timings.exportMs = Date.now() - exportStart;
  assert((await page.locator("#save-state").textContent()) === "Saved", "save indicator was not restored after export");
  assert(download.suggestedFilename().endsWith("-modified.pdf"), `unexpected export filename: ${download.suggestedFilename()}`);
  const annotationStart = Date.now();
  await page.locator("button[data-tool=\"text\"]").click();
  await page.evaluate(() => {
    const pageElement = document.querySelector(".pdf-page");
    const bounds = pageElement.getBoundingClientRect();
    const event = { bubbles: true, button: 0, pointerId: 2, pointerType: "mouse", clientX: bounds.left + 100, clientY: bounds.top + 120 };
    pageElement.dispatchEvent(new PointerEvent("pointerdown", event));
    pageElement.dispatchEvent(new PointerEvent("pointerup", event));
  });
  await page.locator(".annotation-text-draft").fill("Refresh guard");
  await page.locator(".annotation-text-draft").press("Control+Enter");
  await page.waitForFunction(() => document.querySelector("#save-state")?.textContent === "Unsaved changes");
  timings.annotationInteractionMs = Date.now() - annotationStart;
  let refreshWarning = false;
  page.once("dialog", async (dialog) => {
    refreshWarning = dialog.type() === "beforeunload";
    await dialog.accept();
  });
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#status")?.textContent !== "Loading the Rust/WASM core…");
  assert(refreshWarning, "refresh during editing did not show an unsaved-changes warning");
  assert(await page.locator("#page-count").textContent() === "0", "refresh retained a stale PDF session");

  for (let index = 0; index < 5; index += 1) {
    await page.locator("#file-input").setInputFiles(fixturePath);
    await page.waitForFunction(() => document.querySelector("#page-count")?.textContent === "1");
    await page.waitForFunction(() => document.querySelector(".pdf-page[data-ready=\"true\"]"));
    assert(await page.locator(".pdf-page").count() === 1, "repeated load left stale page shells at iteration " + index);
    assert(await page.locator(".thumbnail-button").count() === 1, "repeated load left stale thumbnails at iteration " + index);
  }
  timings.heapAfterRepeatedLoadsMb = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1024 / 1024 * 10) / 10 : null);
  console.log(`Browser smoke passed for ${baseUrl}: ${JSON.stringify(timings)}; offline open, annotation, export, refresh warning, repeated-load cleanup, WASM, PDF.js, manifest, and service worker checks.`);
} finally {
  stopServer();
  await browser?.close();
  rmSync(temporaryRoot, { recursive: true, force: true });
}
