# ModiPDFy engineering instructions

This file is permanent guidance for future Codex sessions and contributors. The architectural rationale and the current delivery plan live in [`docs/architecture.md`](docs/architecture.md), [`docs/development.md`](docs/development.md), and [`docs/roadmap.md`](docs/roadmap.md). Read those documents before making a change that affects the application boundary.

## Permanent working rules

- Treat [`README.md`](README.md) and the documents in `docs/` as the product and architecture source of truth. Update them when a decision or supported behavior changes; do not silently create a competing design.
- Preserve the documented browser-only privacy boundary. Do not add a server, remote document path, analytics, telemetry, or runtime CDN dependency.
- Preserve the documented Rust/PDF, WASM adapter, PDF.js viewer, and vanilla-JavaScript boundaries. The native `modipdfy-core` crate owns the reusable lopdf-backed PDF engine; do not move PDF modification logic into JavaScript or couple the core to browser APIs.
- Preserve original PDF content and appearance whenever possible. Never flatten an entire page to implement a simple annotation.
- Treat imported PDFs and document-derived strings as untrusted input. Do not use `unwrap`/`expect` on input-controlled values in production paths; enforce resource limits and return typed errors.
- Review every dependency and bundled asset for permissive licensing, native/WASM compatibility, network behavior, and unnecessary surface area.
- Maintain automated tests at the lowest layer that proves the behavior, plus boundary tests when serialization, WASM, rendering, or export is involved. Export changes require reopenability tests.

## Repository conventions

The intended layout is:

```text
crates/
  modipdfy-core/       # domain types and lopdf-backed PDF engine
  modipdfy-pdf/        # optional future higher-level PDF adapter
  modipdfy-wasm/       # wasm-bindgen adapter only
web/
  index.html
  css/
  js/
  pdfjs/               # vendored or pinned PDF.js runtime assets
  icons/
  manifest.webmanifest
  sw.js
tests/
docs/
```

Names may evolve, but responsibilities must not collapse into a single crate or a single JavaScript module. Do not create placeholder implementation files merely to satisfy this layout.

## Boundary rules

- `modipdfy-core` must not depend on `wasm-bindgen`, DOM types, PDF.js, or browser APIs. It may depend on `lopdf` and owns typed PDF loading, inspection, metadata, and serialization errors.
- A future `modipdfy-pdf` crate may provide higher-level PDF workflows, but it must build on the core engine rather than duplicate parsing or serialization logic.
- `modipdfy-wasm` converts small JSON commands and byte buffers at the boundary. It must not contain PDF business rules.
- JavaScript must not mutate PDF bytes, invent a second annotation model, or rely on private PDF.js internals for export.
- PDF.js is a renderer and inspection aid. It is not the export authority.
- Keep the canonical annotation geometry in PDF user-space points. Convert only at the UI/rendering boundary.

## Change procedure

Before editing:

1. Read the relevant sections of [`docs/architecture.md`](docs/architecture.md) and inspect the current code and tests.
2. Identify whether the change affects a public Rust API, the WASM wire contract, the JavaScript module contract, or persisted/exported data.
3. Preserve unrelated user changes in a dirty worktree.

Use Git throughout implementation. Make focused commits after coherent slices (for example, a dependency/build change, a viewer change, or a test/documentation change) so architectural work is easy to review and revert. Do not rewrite or squash existing user commits unless explicitly asked.

When implementing:

1. Prefer the smallest modular change that preserves the documented boundaries.
2. Add or update tests at the lowest layer that can prove the behavior, then add a boundary test when serialization, WASM, rendering, or export is involved.
3. Keep user-facing errors actionable without exposing parser internals or document contents.
4. Update the architecture or roadmap documentation when a decision or supported behavior changes.

Before finishing:

- Run formatting, linting, unit tests, integration tests, and the browser smoke suite that applies to the change.
- Verify that `cargo test` for the native Rust workspace remains independent of the WASM toolchain.
- Verify that a modified document can be exported and reopened by the application and by an independent PDF reader when export behavior changed.
- Check that service-worker caching still works with the GitHub Pages base path and that no network request is needed for the offline path.
- Report remaining technical risks instead of hiding them behind best-effort behavior.

## Security and privacy review checklist

For any new PDF or browser capability, ask:

- Can a malicious PDF cause excessive memory, CPU, recursion, or output size?
- Is any document-derived string inserted as HTML or used as a URL without safe handling?
- Does the feature introduce network access, a new origin, persistent storage, or a third-party dependency?
- Can malformed annotation data produce a panic, invalid PDF, or silent loss of content?
- Is the export still an incremental/object-preserving modification rather than a page screenshot?

If the answer is unclear, stop at the boundary, add a test or explicit limitation, and document the risk.

## What is not allowed

Do not add a backend, upload endpoint, remote PDF conversion service, cloud analytics, silent page rasterization, framework-based UI, or a dependency whose license or runtime behavior has not been reviewed. Do not weaken these rules to make a demo pass.
