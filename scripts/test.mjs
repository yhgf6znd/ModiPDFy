import { spawnSync } from "node:child_process";

const useShell = process.platform === "win32";

function run(command, args) {
  console.log(`\n$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    shell: useShell,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("cargo", ["fmt", "--all", "--", "--check"]);
run("cargo", ["clippy", "--workspace", "--all-targets", "--", "-D", "warnings"]);
run("cargo", ["test", "--workspace"]);
run("wasm-pack", [
  "build",
  "crates/modipdfy-wasm",
  "--target",
  "web",
  "--release",
  "--out-dir",
  "../../web/pkg",
  "--out-name",
  "modipdfy_wasm",
  "--no-pack",
]);
run(process.execPath, ["scripts/wasm-bridge-test.mjs"]);
run(process.execPath, ["--check", "web/js/main.js"]);
run(process.execPath, ["--check", "web/js/annotation-model.js"]);
run(process.execPath, ["--check", "web/js/annotation-overlay.js"]);
run(process.execPath, ["--check", "web/js/annotation-interaction.js"]);
run(process.execPath, ["--check", "web/js/wasm-client.js"]);
run(process.execPath, ["--check", "web/js/wasm-bridge.js"]);
run(process.execPath, ["--check", "web/js/coordinates.js"]);
run(process.execPath, ["--check", "web/js/signature-pad.js"]);
run(process.execPath, ["--check", "web/js/signature-storage.js"]);
run(process.execPath, ["--check", "web/js/pdfjs-loader.js"]);
run(process.execPath, ["--check", "web/js/pdf-viewer.js"]);
run(process.execPath, ["--check", "tests/browser/pdf-fixture.js"]);
run(process.execPath, ["--check", "tests/browser/wasm-bridge.test.js"]);
run(process.execPath, ["--check", "tests/browser/viewer.test.js"]);
run(process.execPath, ["--check", "tests/browser/annotations.test.js"]);
run(process.execPath, ["--test", "tests/coordinates/coordinates.test.mjs"]);
run(process.execPath, ["--check", "web/sw.js"]);
run(process.execPath, ["--check", "scripts/build-web.mjs"]);
run(process.execPath, ["--check", "scripts/copy-pdfjs.mjs"]);
run(process.execPath, ["--check", "scripts/serve.mjs"]);
run(process.execPath, ["--check", "scripts/test.mjs"]);
run(process.execPath, ["scripts/copy-pdfjs.mjs"]);
run(process.execPath, ["scripts/build-web.mjs"]);
