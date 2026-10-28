# ModiPDFy

ModiPDFy is a free, open-source, privacy-first PDF editor that runs entirely in the browser. It is designed for Cloudflare Pages and offline use: PDF files are opened from local browser APIs, rendered with Mozilla PDF.js, modified by a Rust/WASM core, and saved back to the user’s device.

The initial release is intentionally focused:

- view existing PDFs;
- add, move, edit, and remove Text, Ink, and Highlight annotations;
- highlight selectable PDF text;
- draw freehand marks with mouse, pen, or touch pointer events;
- create reusable visual handwritten signatures with mouse, pen, or touch input; and
- export a modified PDF without uploading the source document.

Editing existing PDF text and images, compression, OCR, and cryptographic signatures are future work. The current release slice provides a native object-preserving Text/FreeText, Ink, Highlight, and visual Signature-as-Ink engine, a browser editing overlay, selection/move/resize/delete interactions, keyboard shortcuts, and local export. Notes and broader viewer interoperability remain on the roadmap. The current export path validates committed state, reopens the output through Rust/WASM, and has local independent-reader regression checks with Poppler and Ghostscript.

## Architecture at a glance

```text
Local File / File System Access API
                |
        Vanilla JS application
      (viewer, state, tools, interaction)
          |                |
       PDF.js          Rust/WASM
     (render/view)   (PDF read/write)
          |                |
       canvas/SVG      exported PDF bytes
                \      /
             local download
```

The Rust core is independent of WebAssembly. `wasm-bindgen` exposes a small, versioned adapter to JavaScript; JavaScript never edits PDF bytes directly. PDF-space points are canonical, with all viewport/CSS coordinate conversion kept at the UI boundary.

## Project documents

- [`AGENTS.md`](AGENTS.md) — permanent instructions for future engineering sessions.
- [`docs/architecture.md`](docs/architecture.md) — system design, data contracts, coordinate rules, and security model.
- [`docs/development.md`](docs/development.md) — local workflow, testing, dependency review, and release checks.
- [`docs/roadmap.md`](docs/roadmap.md) — staged delivery plan and unresolved risks.
- [`docs/release-readiness.md`](docs/release-readiness.md) — verified security, reliability, performance, and release evidence.
- [`docs/sbom.json`](docs/sbom.json) — deterministic CycloneDX dependency inventory.

## Local development and build

Install the pinned Rust toolchain, `wasm-pack`, Node.js 18.19 or newer, and npm. Then install the locked JavaScript dependencies:

```sh
npm ci
```

Build the complete static application with:

```sh
npm run build
```

The deployable files are written to `dist/`. The command bootstraps the pinned Rust/WASM build tools when needed, builds the Rust/WASM package, vendors the pinned PDF.js runtime and worker, copies the framework-free frontend, and keeps all asset references relative so the result works at a static-host subpath or domain root. Run `npm run dev` for a local development server or `npm run preview` to serve the production build.

### Cloudflare Pages

Cloudflare Pages does not provide `wasm-pack` in its Node build image. The repository’s `npm run build` command now invokes the bootstrap wrapper, so an existing Pages setting of `npm run build` is supported. You may also configure the build command explicitly as `bash scripts/cloudflare-build.sh`; both paths write the artifact to `dist/`. The wrapper installs the pinned Rust 1.93.0 toolchain and `wasm-pack 0.14.0` only when missing, then runs the static build; no Worker, backend, or document upload is involved. Set the Pages project’s production branch to `main` and leave the build environment’s Node.js version at 20 or newer.

## Tests

Run the full Rust, WASM, JavaScript, PDF interoperability, and static-build suite with:

```sh
npm test
npm run validate:build
npm run generate:sbom
```

The production smoke test can be run with Chromium after installing its browser binary:

```sh
npx playwright install chromium
npm run test:browser
npm run test:browser:harness
```

The Playwright harness command executes the viewer, WASM bridge, and annotation pages. The other browser harnesses in `tests/browser/` can also be opened over the local HTTP server for inspection.

## Cloudflare Pages deployment

`.github/workflows/ci.yml` runs on every push and pull request. It installs Rust, the `wasm32-unknown-unknown` target, `wasm-pack`, Node.js dependencies, PDF verification tools, and validates the generated static application.

Create a Cloudflare Pages project from the repository with production branch `main`, build command `npm run build` or `bash scripts/cloudflare-build.sh`, and build output directory `dist`. The bootstrap wrapper installs the pinned Rust 1.93.0 toolchain and `wasm-pack 0.14.0` when Cloudflare’s Node build image does not provide them, then builds the same static artifact. Cloudflare Pages serves the immutable frontend only; no Worker, backend, application secret, document upload, or document-processing service is required.

## Offline installation

Open the HTTPS or localhost site once while online and wait for the shell cache to finish. Supported browsers may show an “Install app” prompt. After caching, the application can open local PDFs, render them, add annotations or signatures, and export without network access. The service worker never caches user documents. Updates wait for explicit approval so an open document is not unexpectedly reloaded.

## Troubleshooting

- If `npm ci` fails, use a supported Node.js version and remove only the local `node_modules/` directory before retrying.
- If the WASM build fails, install the pinned Rust target and `wasm-pack 0.14.0`; native Rust tests do not require the WASM target.
- If the service worker does not install, serve the app over HTTPS or `localhost`, reload once online, and inspect the browser’s Application/Storage panel for failed precache assets.
- If a Cloudflare Pages deployment is missing assets, confirm the build command is `npm run build` or `bash scripts/cloudflare-build.sh`, the output directory is `dist`, and inspect the generated artifact with `npm run validate:build`.
- To recover from stale application assets, use the browser’s site-data controls or ModiPDFy’s “Clear saved data” action, then reload online.

## Planned technology

- Rust with `lopdf` for PDF parsing and modification.
- `wasm-bindgen` and `wasm-pack` for the browser boundary.
- HTML5, CSS, and native JavaScript ES modules.
- Mozilla PDF.js for rendering and text selection geometry.
- Cloudflare Pages with a service worker and web app manifest for offline-capable static hosting. The install prompt is optional browser enhancement; the app remains usable through the browser and local download path.
- MIT license for the project, subject to the notices and license terms of bundled dependencies and assets.

## Privacy promise

The application has no document server. A release must not send PDF bytes, annotation data, or document-derived metadata to a remote service. Network access is limited to installation/update of static application assets when the browser is online; after those assets are cached, core workflows must work offline.

## Status

Initial Rust/WASM and framework-free web viewer with a native lopdf-backed document engine and browser annotation tools for Text, Ink, Highlight, and visual Signature PDFs.
