# ModiPDFy

ModiPDFy is a free, open-source, privacy-first PDF editor that runs entirely in the browser. It is designed for GitHub Pages and offline use: PDF files are opened from local browser APIs, rendered with Mozilla PDF.js, modified by a Rust/WASM core, and saved back to the user’s device.

The initial release is intentionally focused:

- view existing PDFs;
- add, move, edit, and remove Text, Ink, and Highlight annotations;
- highlight selectable PDF text;
- draw freehand marks with mouse, pen, or touch pointer events;
- create reusable visual handwritten signatures with mouse, pen, or touch input; and
- export a modified PDF without uploading the source document.

Editing existing PDF text and images, compression, OCR, and cryptographic signatures are future work. The current release slice provides a native object-preserving Text/FreeText, Ink, Highlight, and visual Signature-as-Ink engine, a browser editing overlay, selection/move/resize/delete interactions, keyboard shortcuts, and local export. Notes, richer undo/redo integration, and independent-reader regression coverage remain on the roadmap.

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

## Build the scaffold

After installing Rust, wasm-pack, and Node.js, build the complete static application with:

```sh
npm run build
```

The deployable files are written to `dist/`. The command builds the Rust/WASM package, vendors the pinned PDF.js runtime and worker, copies the framework-free frontend, and keeps all asset references relative so the result works at a GitHub Pages project subpath. Run `npm run dev` for a local development server or `npm run preview` to serve the production build.

## Planned technology

- Rust with `lopdf` for PDF parsing and modification.
- `wasm-bindgen` and `wasm-pack` for the browser boundary.
- HTML5, CSS, and native JavaScript ES modules.
- Mozilla PDF.js for rendering and text selection geometry.
- GitHub Pages with a service worker and web app manifest for offline-capable static hosting.
- MIT license for the project, subject to the notices and license terms of bundled dependencies and assets.

## Privacy promise

The application has no document server. A release must not send PDF bytes, annotation data, or document-derived metadata to a remote service. Network access is limited to installation/update of static application assets when the browser is online; after those assets are cached, core workflows must work offline.

## Status

Initial Rust/WASM and framework-free web viewer with a native lopdf-backed document engine and browser annotation tools for Text, Ink, Highlight, and visual Signature PDFs.
