import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = resolve(projectRoot, "node_modules", "pdfjs-dist");
const sourceBuild = resolve(packageRoot, "build");
const sourceWeb = resolve(packageRoot, "web");
const sourceCmaps = resolve(packageRoot, "cmaps");
const sourceStandardFonts = resolve(packageRoot, "standard_fonts");
const destination = resolve(projectRoot, "web", "pdfjs");

if (!existsSync(sourceBuild)) {
  throw new Error("pdfjs-dist is not installed. Run `npm install` before building.");
}

rmSync(destination, { force: true, recursive: true });
mkdirSync(destination, { recursive: true });

for (const file of ["pdf.mjs", "pdf.worker.mjs"]) {
  cpSync(resolve(sourceBuild, file), resolve(destination, file));
}

cpSync(resolve(sourceWeb, "pdf_viewer.css"), resolve(destination, "pdf_viewer.css"));
cpSync(sourceCmaps, resolve(destination, "cmaps"), { recursive: true });
cpSync(sourceStandardFonts, resolve(destination, "standard_fonts"), { recursive: true });
cpSync(resolve(packageRoot, "LICENSE"), resolve(destination, "LICENSE"));
writeFileSync(
  resolve(destination, "NOTICE.txt"),
  "PDF.js is distributed under the Apache License, Version 2.0. See LICENSE.\n",
  "utf8",
);

const packageMetadata = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));
function collectFiles(directory, prefix = "") {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      return collectFiles(resolve(directory, entry.name), relativePath);
    }
    return [`./pdfjs/${relativePath}`];
  });
}

writeFileSync(
  resolve(destination, "asset-manifest.json"),
  `${JSON.stringify(collectFiles(destination), null, 2)}\n`,
  "utf8",
);
console.log(`Vendored PDF.js ${packageMetadata.version} into ${destination}`);
