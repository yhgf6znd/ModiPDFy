# Development guide

This guide describes the intended workflow while ModiPDFy is being built. The repository contains the native Rust/WASM boundary, browser PDF.js viewer, and the initial Rust-backed annotation editing interface. New PDF behavior must continue to cross the documented Rust/WASM boundary rather than being implemented as a browser-only export shortcut.

## Prerequisites

Install stable Rust and Cargo, `wasm-pack`, Node.js 18.19 or newer, npm, a current browser with WebAssembly and service-worker support, and Git. Node.js is a build/development tool only; the deployed `dist/` directory contains static assets and does not require Node.js.

### Ubuntu

```sh
sudo apt update
sudo apt install build-essential curl git poppler-utils ghostscript
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup toolchain install 1.93.0
rustup default 1.93.0
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --version 0.14.0
```

Install Node.js 18.19 or newer using the distribution’s supported method, such as the official Node.js installer or a version manager. Confirm with `node --version` and `npm --version`.

Install the pinned Rust advisory scanner for release checks:

```sh
cargo install cargo-audit --version 0.22.2 --locked
```

### macOS

Install Xcode Command Line Tools, Git, Rust via rustup, and Node.js 18.19 or newer. Then run:

```sh
xcode-select --install
rustup toolchain install 1.93.0
rustup default 1.93.0
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --version 0.14.0
```

### Windows

Install Git for Windows, Node.js 18.19 or newer, and the MSVC build tools through Visual Studio or the “Desktop development with C++” workload. Install Rust with rustup using the MSVC toolchain, then run in PowerShell:

```powershell
rustup toolchain install 1.93.0
rustup default 1.93.0-msvc
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --version 0.14.0
```

The repository’s `rust-toolchain.toml` also selects Rust 1.93.0, rustfmt, clippy, and the WASM target when rustup is available.

The Rust target used for the browser build is expected to be `wasm32-unknown-unknown`. Native tests must remain runnable without that target.

## Expected repository layout

```text
Cargo.toml
Cargo.lock
crates/modipdfy-core/
crates/modipdfy-pdf/
crates/modipdfy-wasm/
web/
tests/
docs/
```

Do not add generated `wasm-pack` output to the source tree unless the deployment process explicitly requires checked-in artifacts. If the static site is built by CI or Cloudflare Pages, publish generated artifacts from the build directory and keep reproducibility metadata in the repository.

## Local workflow

1. Read `AGENTS.md` and the architecture section relevant to the change.
2. Run native Rust formatting, linting, and tests before changing behavior.
3. Implement domain behavior in `modipdfy-core`, PDF behavior in `modipdfy-pdf`, and only then update the WASM adapter or browser modules.
4. Build the WASM package with the pinned `wasm-pack` profile and serve `web/` over HTTP. A service worker will not behave correctly from `file://`.
5. Exercise a local PDF and a deliberately malformed fixture. Verify that the original file is not modified and that export is a new user-visible artifact.
6. Run browser smoke tests with the network disabled after the first successful asset load.
7. Update the relevant documentation and note any unresolved limitation in the roadmap.

The complete production build is:

```sh
npm run build
```

It runs `wasm-pack build --target web`, then copies the web shell and generated WASM files into `dist/`. The output uses relative URLs and can be uploaded directly to a static host, including a project subpath.

For Cloudflare Pages, use `bash scripts/cloudflare-build.sh` as the build command and `dist` as the output directory. Cloudflare’s Node build image does not include `wasm-pack`; the wrapper installs the pinned Rust 1.93.0 toolchain and `wasm-pack 0.14.0` when necessary, selects that toolchain, and delegates to `npm run build`. This is a build-time tool installation only; the deployed artifact remains static and browser-only.

Useful commands:

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
wasm-pack build crates/modipdfy-wasm --target web --release --out-dir ../../web/pkg --out-name modipdfy_wasm --no-pack
npm run dev
npm run preview
npm test
npm run generate:sbom
npm audit --omit=optional --audit-level=moderate
cargo audit
```

`npm run dev` builds the WASM package, vendors PDF.js, and serves the static `dist/` directory at localhost. `npm run preview` serves the already-built `dist/` directory. Both commands serve over HTTP, which is required for service workers; do not test the PWA from `file://`. `npm test` runs formatting, clippy, native tests, the WASM build, Node-executed bridge/export/coordinate tests, JavaScript syntax checks, and the production static build. The export integration test requires `pdfinfo`, `pdftotext`, `gs`, and `pdftoppm` for its pixel and corruption checks; if a workstation lacks them, run the Node test after installing Poppler and Ghostscript or record the independent-renderer check as unavailable. The build scripts use Node.js built-ins; the production browser smoke test uses the pinned Playwright development dependency. PDF.js is a pinned development dependency whose browser assets are copied into the static build.

The production browser smoke test is `npm run test:browser`; it starts an isolated static host under `/modipdfy/` by default, verifies the manifest, service-worker scope, WASM, PDF.js worker, cached assets, and absence of external runtime requests, then stops the server and checks offline open, annotation, and export. Set `PUBLIC_BASE_PATH=/` or another safe absolute path to exercise a different deployment root; the smoke host mirrors that path so the test covers the same URL shape that the static host will serve. The browser integration harness is [`tests/browser/index.html`](../tests/browser/index.html). It also checks the active versioned shell cache, PWA module, manifest icons, and cached icon files. For a true offline test, load the production app once, stop the static server or disable the network, reload the app, then open a local fixture, annotate, and export. Repeat this on Chromium and Firefox. A static-host subpath test should serve the built files below `/modipdfy/` and verify that the manifest, service worker, WASM, PDF.js worker, CMaps, fonts, and icons resolve below that path. The maintained Playwright runner for all browser harness pages is `npm run test:browser:harness`. It executes the viewer, WASM bridge, and annotation interaction pages in Chromium. The annotation interaction harness is [`tests/browser/annotations.html`](../tests/browser/annotations.html). To run them in a browser, build the project, serve the repository root, and open the relevant page:

```sh
npm run build
node scripts/serve.mjs .
```

The WASM harness exercises initialization, typed-array PDF loading, page count and rotation metadata, annotation add/list/remove for all supported kinds, committed-state export/reopen validation, malformed-input errors, explicit disposal, repeated open/close operations, and independent `pdfinfo`, `pdftotext`, Ghostscript, and `pdftoppm` checks on the exported file, including source/export pixel comparison for an unaffected page, per-annotation visual-region checks, signature geometry, and truncated-output rejection. The annotation harness exercises signature-pad mouse/touch/stylus capture, signature placement/move/proportional resize/duplicate/delete, export/reopen, signature undo/redo, pen, touch, and mouse drawing, text placement/editing, selection/move, highlight selection, deletion, keyboard activation, Rust persistence, rotated-page crop-box clamping, zoom, and viewer-resize coordinate stability. The viewer smoke page is [`tests/browser/viewer.html`](../tests/browser/viewer.html); it uses the same [`web/js/pdf-viewer.js`](../web/js/pdf-viewer.js) module used by the application and documents the browser-only rendering checks.

## Test expectations

At minimum, a pull request that changes PDF behavior should include:

- native unit/integration tests for the changed Rust behavior, including lopdf annotation dictionary inspection and reopenability;
- a fixture-based export/reopen test when PDF bytes change;
- a WASM boundary test when the wire contract changes; and
- a browser test when interaction, rendering, file I/O, or service-worker behavior changes.

Use deterministic fixtures and avoid timestamps or random identifiers in byte-for-byte assertions unless normalized. Prefer semantic PDF assertions—page count, annotation properties, preserved objects, and renderability—over brittle whole-file byte equality.

## Dependency and asset review

Before adding a dependency:

- confirm it works in the required native and WASM targets;
- inspect its license and notable transitive licenses;
- check whether it performs network access, logging, telemetry, filesystem access, or unsafe parsing;
- compare its capability with existing code to avoid unnecessary surface area; and
- record the decision in the change description and license inventory.

Pin PDF.js and its worker to a reviewed version. The current build pins `pdfjs-dist` to 4.2.67 because the repository supports Node 18, then copies the native ESM browser bundle, worker, viewer CSS, CMaps, standard fonts, and Apache-2.0 notice into `web/pdfjs/`. Keep those assets and all WASM assets same-origin and included in the PWA precache. Never load them from a CDN at runtime.

## Release checklist

- `AGENTS.md`, README, architecture, development, and roadmap agree on the current scope.
- Native tests pass without a browser or network.
- `cargo audit` and `npm audit --omit=optional --audit-level=moderate` pass for the locked dependency graphs.
- `docs/sbom.json` is regenerated and has no uncommitted changes.
- WASM build succeeds and has no accidental server dependency.
- Browser smoke tests and the Playwright browser harness pass with the network disabled after caching.
- Local import, render, annotation operation, export, and reopen flows work.
- Rotated pages, non-default crop boxes, malformed PDFs, and large-input limits have explicit test coverage or documented limitations.
- No PDF bytes or document-derived data leave the browser.
- Service-worker cache versioning, explicit update activation, cache cleanup, and static-host base paths are verified.
- Third-party notices and the MIT license are present in the release artifact.
- The production bundle contains no debug logging of document data and no analytics/telemetry.
