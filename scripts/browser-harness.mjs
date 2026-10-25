import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const projectRoot = resolve(new URL("..", import.meta.url).pathname);
const serverScript = resolve(projectRoot, "scripts", "serve.mjs");
const baseUrl = "http://127.0.0.1:8081";
const pages = ["viewer.html", "index.html", "annotations.html"];

function startServer() {
  const server = spawn(process.execPath, [serverScript, "."], {
    cwd: projectRoot,
    env: { ...process.env, PORT: "8081" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const ready = new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error("browser harness server did not start")), 10000);
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
let browser;
try {
  await ready;
  browser = await chromium.launch({ headless: true });
  for (const pageName of pages) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(baseUrl + "/tests/browser/" + pageName, { waitUntil: "networkidle" });
    await page.waitForSelector("#result[data-status=\"pass\"]", { timeout: 120000 });
    if (errors.length) throw new Error(pageName + " reported browser errors: " + errors.join("; "));
    console.log("Browser harness passed: " + pageName);
    await page.close();
  }
} finally {
  await browser?.close();
  if (server.exitCode === null) server.kill("SIGINT");
}
