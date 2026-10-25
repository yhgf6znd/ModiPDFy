# ModiPDFy

ModiPDFy is a free, open-source, privacy-first PDF editor that runs entirely in the browser. It is designed for GitHub Pages and offline use: PDF files are opened from local browser APIs, rendered with Mozilla PDF.js, modified by a Rust/WASM core, and saved back to the user’s device.

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

## Local development and build

Install the pinned Rust toolchain, `wasm-pack`, Node.js 20 or newer, and npm. Then install the locked JavaScript dependencies:

```sh
npm ci
```

Build the complete static application with:

```sh
npm run build
```

The deployable files are written to `dist/`. The command builds the Rust/WASM package, vendors the pinned PDF.js runtime and worker, copies the framework-free frontend, and keeps all asset references relative so the result works at a GitHub Pages project subpath or domain root. Run `npm run dev` for a local development server or `npm run preview` to serve the production build.

## Tests

Run the full Rust, WASM, JavaScript, PDF interoperability, and static-build suite with:

```sh
npm test
npm run validate:build
```

The browser harnesses in `tests/browser/` should also be opened over the local HTTP server for viewer, annotation, and service-worker smoke testing.

## GitHub Pages deployment

`.github/workflows/ci.yml` runs on every push and pull request. It installs Rust, the `wasm32-unknown-unknown` target, `wasm-pack`, Node.js dependencies, PDF verification tools, and validates the generated static application.

`.github/workflows/deploy.yml` builds and deploys `dist/` to GitHub Pages when `main` changes. The workflow obtains the Pages base path from `actions/configure-pages`; the application itself uses relative asset URLs, so the same build works at `/modipdfy/` and at a domain root without hardcoding a GitHub username.

To enable deployment, set the repository’s Pages “Build and deployment” source to “GitHub Actions”. The deployment job requires the standard `github-pages` environment and the workflow permissions for `pages: write` and `id-token: write`; no secrets or backend service are required.

## Offline installation

Open the HTTPS or localhost site once while online and wait for the shell cache to finish. Supported browsers may show an “Install app” prompt. After caching, the application can open local PDFs, render them, add annotations or signatures, and export without network access. The service worker never caches user documents. Updates wait for explicit approval so an open document is not unexpectedly reloaded.

## Troubleshooting

- If `npm ci` fails, use a supported Node.js version and remove only the local `node_modules/` directory before retrying.
- If the WASM build fails, install the pinned Rust target and `wasm-pack 0.14.0`; native Rust tests do not require the WASM target.
- If the service worker does not install, serve the app over HTTPS or `localhost`, reload once online, and inspect the browser’s Application/Storage panel for failed precache assets.
- If a Pages deployment is missing assets, confirm the Pages source is “GitHub Actions” and inspect the workflow’s generated base path and `dist/` validation output.
- To recover from stale application assets, use the browser’s site-data controls or ModiPDFy’s “Clear saved data” action, then reload online.

## Planned technology

- Rust with `lopdf` for PDF parsing and modification.
- `wasm-bindgen` and `wasm-pack` for the browser boundary.
- HTML5, CSS, and native JavaScript ES modules.
- Mozilla PDF.js for rendering and text selection geometry.
- GitHub Pages with a service worker and web app manifest for offline-capable static hosting. The install prompt is optional browser enhancement; the app remains usable through the browser and local download path.
- MIT license for the project, subject to the notices and license terms of bundled dependencies and assets.

## Privacy promise

The application has no document server. A release must not send PDF bytes, annotation data, or document-derived metadata to a remote service. Network access is limited to installation/update of static application assets when the browser is online; after those assets are cached, core workflows must work offline.

## Status

Initial Rust/WASM and framework-free web viewer with a native lopdf-backed document engine and browser annotation tools for Text, Ink, Highlight, and visual Signature PDFs.
