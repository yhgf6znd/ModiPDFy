# Roadmap

The roadmap is ordered to reduce architectural risk early. A milestone is complete only when its behavior is tested at the relevant Rust/WASM/browser boundaries and works offline where applicable.

## Phase 0 — architecture baseline

Status: documented.

- Establish repository conventions, crate/module boundaries, coordinate rules, data contracts, security principles, and test strategy.
- Confirm MIT licensing policy and dependency review process.

## Phase 1 — browser shell and PDF viewing

Status: in progress — browser viewer and installable offline shell delivered; cross-browser offline evidence remains to be recorded.

Deliver a minimal offline-capable static app:

- Cargo workspace with native-testable core, PDF adapter, and thin WASM adapter.
- Local file open and explicit local save/download.
- PDF.js rendering with local file/drop open, multipage scrolling, page navigation, zoom/fit controls, lazy visible-page rendering, rotation-aware viewport metadata, DPR-aware canvases, and text-layer selection geometry.
- Native lopdf-backed document loading, metadata, page inspection, object inspection, and unchanged save/reopen are implemented in `modipdfy-core`.
- PWA manifest with icons, service worker with versioned cache and user-approved updates, online/offline status, explicit local-signature clearing, and GitHub Pages base-path support.
- Resource limits and safe errors for malformed/oversized PDFs.

Exit evidence: a cached app opens and renders single/multipage fixtures with the network disabled, and the source file never leaves the browser. Browser integration coverage for offline reload, large documents, and device-specific memory behavior remains open.

## Phase 2 — annotation foundation

Status: complete — native annotation engine and initial browser tools delivered and reviewed.

- Core annotation model, stable IDs, validation, and ID-based removal/listing for Text/FreeText, Ink, and Highlight.
- Object-preserving PDF annotation export infrastructure using `lopdf`, including native appearance streams and opacity states.
- SVG/HTML overlay rendering, canonical PDF-to-viewport transforms, and native pointer-event interaction tests.
- Export/reopen fixtures for unrotated and rotated/cropped pages.

Exit evidence: native tests add, save, reopen, and inspect all three annotation types, preserve page content and existing annotations, and block signed-document mutation. Browser tests cover the WASM bridge, PDF.js viewer lifecycle, pen, text, top-edge geometry, keyboard activation, highlight selection, selection/move, deletion, Rust persistence, and zoom stability. Queue rollback and bounded annotation input are covered. Handwritten signatures, offline reload, and fuzzing remain open. Adobe Acrobat Reader 32-bit under Wine opened the current local export in an isolated nested display and recorded the expected three-page document; the isolated X11 capture visibly showed Acrobat's PDF text and signature appearance. Wine did not provide reliable full-page pixel capture for every annotation subtype, so native Windows/macOS Acrobat coverage remains open.

## Phase 3 — initial annotation tools

Status: in progress — visual signature and validated export slices delivered.

Complete and harden the initial release tools:

- text highlights based on PDF.js selection rectangles;
- freehand ink with smoothing/point limits;
- visual handwritten signatures as ordered local vector strokes, exported as native PDF Ink without cryptographic claims;
- bounded Command Pattern undo/redo for annotation add/delete/move/resize/text/style/signature operations;
- notes and basic annotation styling;
- selecting, moving, resizing where applicable, editing, deleting, and undoing annotation operations.

Exit evidence: keyboard and pointer workflows are accessible; committed-state exports reopen through Rust/WASM, PDF.js, and the local independent-reader checks; page count, rotation, annotation IDs, annotation geometry/content, and source text are preserved; and annotation-only changes preserve unrelated page content. Chromium WebDriver passed the WASM, viewer, annotation, and production download flows. Native Firefox's built-in PDF viewer and Evince previewer also loaded a generated export over localhost. Adobe Acrobat Reader 32-bit under Wine accepted the generated three-page export as a local file, and the isolated capture visibly showed PDF text and signature appearance; native Windows/macOS Acrobat and complete visual regression coverage for every annotation subtype remain open.

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
6. **Signature interoperability.** Visual signatures use standard `/Ink` geometry and appearance plus a private per-stroke style array. Independent-reader verification is still needed; the UI must never imply cryptographic or legal authenticity.
7. **PDF.js and Rust/WASM packaging.** Worker paths, cross-origin isolation assumptions, asset pinning, CMap/font precaching, and GitHub Pages subpaths need deployment tests.
8. **Browser API variability.** File System Access API and persistent storage are not universal. Download via `Blob` must remain the portable baseline.
9. **Undo/redo and export state.** The browser history is capped and export waits for queued commands, but repeated add/remove edits leave unreachable appearance-support objects in the lopdf object table until a future compaction policy is designed. The design must not retain unbounded full-document copies or confuse PDF object identity with session annotation IDs.
10. **Independent-reader and offline evidence.** Semantic reopenability is covered by lopdf and PDF.js, and the automated export fixture is checked with Poppler and Ghostscript. Adobe Reader acceptance is covered through an isolated Wine installation, but native Windows/macOS Acrobat visual regression, deployed GitHub Pages offline reload, and cross-browser PWA update behavior still need environment-specific verification; Chromium WebDriver, native Firefox, Evince, Poppler, and Ghostscript coverage is recorded locally.
