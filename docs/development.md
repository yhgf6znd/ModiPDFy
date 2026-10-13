# Development guide

This guide describes the intended workflow while ModiPDFy is being built. The repository is currently documentation-first; implementation commands below become active as the corresponding workspace files are introduced.

## Prerequisites

Install stable Rust and Cargo, `wasm-pack`, a current browser with WebAssembly and service-worker support, and a static local web server. Node is not required by the application architecture; if a test tool later needs Node, keep it a development-only dependency and document why.

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

Illustrative commands once the workspace exists:

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
wasm-pack build crates/modipdfy-wasm --target web
```

The actual build script may wrap these commands, but it must not hide failures or download runtime assets during an offline test.

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
