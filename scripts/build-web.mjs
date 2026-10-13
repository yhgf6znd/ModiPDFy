import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = resolve(projectRoot, "web");
const wasmEntry = resolve(sourceDirectory, "pkg", "modipdfy_wasm.js");
const outputDirectory = resolve(projectRoot, "dist");

if (!existsSync(wasmEntry)) {
  throw new Error("WASM output is missing. Run `npm run build:wasm` before `npm run build:web`.");
}

rmSync(outputDirectory, { force: true, recursive: true });
mkdirSync(outputDirectory, { recursive: true });
cpSync(sourceDirectory, outputDirectory, { recursive: true });

// GitHub Pages serves files directly, and this marker prevents Jekyll from transforming them.
writeFileSync(resolve(outputDirectory, ".nojekyll"), "", "utf8");

console.log(`Static web build written to ${outputDirectory}`);
