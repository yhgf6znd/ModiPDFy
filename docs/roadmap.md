# Roadmap

The roadmap is ordered to reduce architectural risk early. A milestone is complete only when its behavior is tested at the relevant Rust/WASM/browser boundaries and works offline where applicable.

## Phase 0 — architecture baseline

Status: documented.

- Establish repository conventions, crate/module boundaries, coordinate rules, data contracts, security principles, and test strategy.
- Confirm MIT licensing policy and dependency review process.

## Phase 1 — browser shell and PDF viewing

Status: in progress — browser viewer slice delivered.

Deliver a minimal offline-capable static app:

- Cargo workspace with native-testable core, PDF adapter, and thin WASM adapter.
- Local file open and explicit local save/download.
- PDF.js rendering with local file/drop open, multipage scrolling, page navigation, zoom/fit controls, lazy visible-page rendering, rotation-aware viewport metadata, DPR-aware canvases, and text-layer selection geometry.
- Native lopdf-backed document loading, metadata, page inspection, object inspection, and unchanged save/reopen are implemented in `modipdfy-core`.
- PWA manifest, service worker, versioned cache, and GitHub Pages base-path support.
- Resource limits and safe errors for malformed/oversized PDFs.

Exit evidence: a cached app opens and renders single/multipage fixtures with the network disabled, and the source file never leaves the browser. Browser integration coverage for offline reload, large documents, and device-specific memory behavior remains open.

## Phase 2 — annotation foundation

Status: in progress — native annotation engine delivered.

- Core annotation model, stable IDs, validation, and ID-based removal/listing for Text/FreeText, Ink, and Highlight.
- Object-preserving PDF annotation export infrastructure using `lopdf`, including native appearance streams and opacity states.
- Generic overlay rendering and canonical PDF-to-viewport transform tests.
- Export/reopen fixtures for unrotated and rotated/cropped pages.

Exit evidence in progress: native tests add, save, reopen, and inspect all three annotation types, preserve page content and existing annotations, and block signed-document mutation. Operation batches, undo/redo, browser wiring, and independent-reader coverage remain open.

## Phase 3 — initial annotation tools

Implement the initial release tools:

- text highlights based on PDF.js selection rectangles;
- freehand ink with smoothing/point limits;
- handwritten signatures as local ink and/or embedded local image according to the finalized policy;
- notes and basic annotation styling;
- selecting, moving, editing, deleting, and undoing annotation operations.

Exit evidence: keyboard and pointer workflows are accessible, exports reopen in PDF.js and an independent reader, and annotation-only changes preserve unrelated page content.

## Phase 4 — hardening and publication

- Fuzz PDF parsing and command decoding.
- Add browser regression tests for offline reload, update activation, and GitHub Pages deployment paths.
- Complete dependency/asset notices and threat-model review.
- Performance testing for large page counts and long ink paths.
- Publish the first stable GitHub Pages release under the MIT license.

## Future releases

These are intentionally outside the initial release:

- editing existing PDF text and layout;
- image insertion, replacement, and manipulation;
- PDF compression and optimization;
- OCR for scanned documents; and
- cryptographic digital signatures and certificate validation.

Each future feature must preserve the same browser-only privacy boundary and must not be added by flattening pages.

## Unresolved technical risks

1. **`lopdf` feature coverage and preservation.** The exact set of PDF versions, filters, existing annotations, encrypted files, and incremental/object-preserving updates that can be handled safely needs fixture-driven validation.
2. **Annotation interoperability.** PDF viewers differ in support for highlight quadrilaterals, ink appearance streams, note popups, and signature image embedding. Export profiles and compatibility tests are needed.
3. **Rotation and crop-box transforms.** PDF.js and PDF user-space conventions can diverge around page boxes and rotation. Centralized transform code needs property tests and real fixtures.
4. **Large-document memory use.** Holding source bytes, parsed objects, rendered canvases, and WASM memory together may exceed browser limits. Streaming or page-scoped strategies may be needed without compromising export correctness.
5. **Malformed-PDF denial of service.** Memory safety does not prevent excessive CPU or allocation. Limits, time budgeting, and fuzzing must be validated before accepting arbitrary local files.
6. **Signature representation.** A handwritten visual signature is not a cryptographic digital signature. The UI and exported metadata must avoid implying legal authenticity until a separate digital-signature design exists.
7. **PDF.js and Rust/WASM packaging.** Worker paths, cross-origin isolation assumptions, asset pinning, CMap/font precaching, and GitHub Pages subpaths need deployment tests.
8. **Browser API variability.** File System Access API and persistent storage are not universal. Download via `Blob` must remain the portable baseline.
9. **Undo/redo and export state.** The design must keep operation history useful without retaining unbounded full-document copies or confusing PDF object identity with session annotation IDs.
