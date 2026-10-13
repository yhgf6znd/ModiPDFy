# Development guide

This guide describes the intended workflow while ModiPDFy is being built. The repository is currently documentation-first; implementation commands below become active as the corresponding workspace files are introduced.

## Prerequisites

Install stable Rust and Cargo, `wasm-pack`, Node.js 18.19 or newer, npm, a current browser with WebAssembly and service-worker support, and Git. Node.js is a build/development tool only; the deployed `dist/` directory contains static assets and does not require Node.js.

### Ubuntu

```sh
sudo apt update
sudo apt install build-essential curl git
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup toolchain install 1.93.0
rustup default 1.93.0
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --version 0.14.0
```

Install Node.js 18.19 or newer using the distribution’s supported method, such as the official Node.js installer or a version manager. Confirm with `node --version` and `npm --version`.

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

Do not add generated `wasm-pack` output to the source tree unless the deployment process explicitly requires checked-in artifacts. If GitHub Pages is built by CI, publish generated artifacts from the build directory and keep reproducibility metadata in the repository.

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

It runs `wasm-pack build --target web`, then copies the web shell and generated WASM files into `dist/`. The output uses relative URLs and can be uploaded directly to a static host, including a GitHub Pages project subpath.

Useful commands:

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
wasm-pack build crates/modipdfy-wasm --target web --release --out-dir ../../web/pkg --out-name modipdfy_wasm --no-pack
npm run dev
npm run preview
npm test
```

`npm run dev` builds the WASM package and serves `web/` at localhost. `npm run preview` serves the already-built `dist/` directory. `npm test` runs formatting, clippy, native tests, the WASM build, Node-executed bridge contract tests, JavaScript syntax checks, and the production static build. The scripts use only Node.js built-ins and do not add runtime frontend dependencies.

The browser integration harness is [`tests/browser/index.html`](../tests/browser/index.html). To run it in a browser, build the project, serve the repository root, and open `/tests/browser/index.html`:

```sh
npm run build
node scripts/serve.mjs .
```

It exercises initialization, typed-array PDF loading, page count, page dimensions, export, malformed-input errors, explicit disposal, and repeated open/close operations. The browser harness uses the same [`web/js/wasm-bridge.js`](../web/js/wasm-bridge.js) module used by the application.

## Test expectations

At minimum, a pull request that changes PDF behavior should include:

- native unit/integration tests for the changed Rust behavior;
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

Pin PDF.js and its worker to a reviewed version. Keep the PDF.js worker and all WASM assets same-origin and included in the PWA precache. Never load them from a CDN at runtime.

## Release checklist

- `AGENTS.md`, README, architecture, development, and roadmap agree on the current scope.
- Native tests pass without a browser or network.
- WASM build succeeds and has no accidental server dependency.
- Browser smoke tests pass with the network disabled after caching.
- Local import, render, annotation operation, export, and reopen flows work.
- Rotated pages, non-default crop boxes, malformed PDFs, and large-input limits have explicit test coverage or documented limitations.
- No PDF bytes or document-derived data leave the browser.
- Service-worker cache versioning and GitHub Pages base paths are verified.
- Third-party notices and the MIT license are present in the release artifact.
- The production bundle contains no debug logging of document data and no analytics/telemetry.
