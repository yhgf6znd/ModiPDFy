# ModiPDFy architecture

## 1. Goals and boundaries

ModiPDFy is a static, client-only web application. Its trusted editing path is:

1. The user selects a local file through a browser API.
2. JavaScript supplies the bytes to the Rust/WASM adapter.
3. Rust parses the PDF, exposes page metadata and text geometry needed by the UI, and applies annotation operations.
4. PDF.js renders the original or current document for viewing. It does not own the editable PDF model.
5. Rust exports PDF bytes, which JavaScript offers as a local download or File System Access API save.

There is no application backend, account system, document sync, remote conversion service, or telemetry pipeline. GitHub Pages serves immutable static assets only.

The core release must preserve existing page content. A simple annotation must be represented as a PDF annotation object or an equivalent object-preserving PDF update; rasterizing a whole page is not an acceptable shortcut.

## 2. Layered system design

```text
┌───────────────────────────────────────────────────────────────┐
│ Browser shell: HTML/CSS, native ES modules, service worker   │
│ file APIs, keyboard/pointer input, accessibility, downloads   │
└───────────────┬───────────────────────────────┬───────────────┘
                │ viewport/text metadata        │ commands/bytes
                v                               v
┌───────────────────────────────┐   ┌───────────────────────────┐
│ PDF.js viewing adapter         │   │ modipdfy-wasm              │
│ rendering, page/text geometry  │   │ wasm-bindgen boundary      │
└───────────────────────────────┘   └─────────────┬─────────────┘
                                                  v
                                  ┌──────────────────────────────┐
                                  │ modipdfy-core                 │
                                  │ domain model, lopdf engine,   │
                                  │ inspection, and serialization │
                                  └──────────────────────────────┘
```

The browser shell owns interaction state and rendering lifecycle. The Rust layers own document state that affects export and all PDF modification decisions.

## 3. Rust crate boundaries

The planned Cargo workspace has these crates. The current implementation places the reusable lopdf-backed document engine in `modipdfy-core`; a separate higher-level PDF adapter remains optional and is not required for the initial engine.

### `modipdfy-core`

Pure Rust domain and PDF engine layer. It defines page identifiers, points and rectangles, annotation kinds, stroke paths, signatures, document/session metadata, commands, validation rules, and the byte-oriented lopdf document engine. It is usable in native tests without a browser, `wasm-bindgen`, or filesystem access.

The document engine owns loading, page inspection, metadata extraction, object inspection, and serialization. Higher-level editing operations should express intent such as “add this highlight to page 2” without leaking browser concerns into the crate.

### Future higher-level PDF adapter

If a separate `modipdfy-pdf` crate is introduced, it must depend on the core engine and add workflows rather than reimplement parsing, metadata, object inspection, or serialization. It must define an explicit capability matrix and preserve unsupported objects rather than silently deleting or flattening them.

### `modipdfy-wasm`

Thin `wasm-bindgen` adapter. It owns JavaScript-compatible input/output types, session handles if needed, byte transfer, JSON serialization, and conversion of Rust errors into a stable error envelope. It must not implement annotation geometry, PDF object manipulation, or UI policy.

The native workspace must build and test without this crate. WASM-specific tests belong at this boundary and may use `wasm-bindgen-test`.

## 4. WASM interface strategy

The initial interface should favor coarse, explicit operations over exposing Rust internals:

```text
open_document(pdf_bytes, options) -> document_descriptor
get_page_info(document, page_index) -> page_info
apply_operations(document, operations_json) -> operation_report
export_document(document, export_options) -> pdf_bytes
close_document(document)
```

The exact function names may change during implementation, but the rules are stable:

- Input PDF bytes cross the boundary once where practical; output bytes cross it once on export.
- Commands and reports use versioned JSON with integer page indices and PDF-space coordinates.
- Binary data uses `Uint8Array`/`ArrayBuffer`; do not base64-encode full PDFs unless a browser API requires it.
- Rust owns document validity and operation ordering. JavaScript may optimistically render interaction feedback but must reconcile with the Rust operation report.
- Avoid returning live Rust object graphs or passing DOM objects into WASM.
- Keep the boundary small enough that it can be tested with malformed JSON, missing fields, large values, and stale annotation IDs.

Suggested error envelope:

```json
{
  "version": 1,
  "code": "invalid_annotation_geometry",
  "message": "The annotation geometry is outside the page bounds.",
  "operation_index": 3,
  "recoverable": true
}
```

`message` is safe for display. Parser details, stack traces, and document contents belong in developer diagnostics only and must not be assumed available in production.

## 5. JavaScript module boundaries

The frontend uses native ES modules and should keep modules narrow:

- `app.js`: composition root; bootstraps the application and wires dependencies.
- `state/store.js`: immutable-ish application/session state, selection, active tool, and dirty status.
- `pdf/document-session.js`: local file lifecycle, WASM document handle, operation queue, export requests, and cleanup.
- `pdf/pdfjs-viewer.js`: PDF.js loading, page rendering, text-layer integration, viewport transforms, and visible-page management.
- `pdf/wasm-client.js`: the only module that knows the WASM public API and error envelope.
- `annotations/model.js`: UI projections of Rust annotation data; no PDF byte mutation.
- `annotations/interaction.js`: pointer, keyboard, selection, drag, resize, and freehand capture.
- `annotations/overlay.js`: SVG/canvas/HTML overlay rendering above PDF.js pages.
- `ui/toolbar.js`, `ui/panels.js`, `ui/dialogs.js`: accessible controls and presentation state.
- `platform/file-io.js`: File, Blob, download, optional File System Access API, and browser capability checks.
- `platform/storage.js`: optional local preferences only; never persist document bytes or telemetry without a future, explicit design decision.
- `pwa/register-service-worker.js`: service-worker registration and update UX.

No module other than `wasm-client.js` calls the WASM exports directly. No module other than `pdfjs-viewer.js` depends on PDF.js internals. The UI overlay is a view of the Rust-backed annotation state, not a replacement source of truth.

## 6. PDF coordinate conventions

Canonical coordinates are PDF user-space points: 1/72 inch, origin at the lower-left of the page’s effective media/crop coordinate space. A page’s crop box and rotation are part of page metadata and must not be ignored.

The UI normally receives viewport coordinates from PDF.js: origin at the top-left, y increasing downward, and dimensions in CSS/device pixels after scale and rotation. Conversion is centralized in one tested module and must use the PDF.js viewport transform rather than duplicated ad-hoc formulas.

For an unrotated page with effective width `W`, height `H`, and scale `s`:

```text
pdf_x = viewport_x / s
pdf_y = H - (viewport_y / s)
```

That simplified formula is only valid for the unrotated case. For 90/180/270-degree rotations, crop-box offsets, and non-default view boxes, use the page’s forward/inverse transform supplied by the viewer adapter. Store annotation geometry in canonical PDF coordinates; store the viewport transform and zoom as ephemeral UI state.

Page indices are zero-based internally and are never inferred from visible DOM order. Annotation IDs are opaque, stable within a document session, and must not be reused after deletion. Geometry validation rejects NaN, infinity, unbounded values, and coordinates exceeding configured limits.

## 7. Annotation data model

The model separates intent from PDF serialization. A representative domain shape is:

```text
Annotation {
  id: AnnotationId
  page_index: u32
  kind: Highlight | Ink | Signature | Note | Shape
  bounds: Rect<PdfPoint>
  geometry: KindSpecificGeometry
  style: AnnotationStyle
  created_at: optional opaque session value
  updated_at: optional opaque session value
}
```

The first release needs these concrete geometries:

- `Highlight`: one or more quadrilaterals or text-selection rectangles in PDF coordinates, with color and opacity.
- `Ink`: ordered point paths with stroke width, color, opacity, line cap, and line join.
- `Signature`: an ink path or a user-provided signature bitmap reference handled locally; export policy must define whether it is embedded as an image XObject or represented as ink.
- `Note`: a page anchor and text payload, with a bounded length and explicit display style.

`bounds` is a derived/validated envelope, not permission to flatten the page. Style values are bounded and use explicit units. Text payloads are plain text; HTML is never accepted as annotation content.

The persisted/export model must distinguish:

1. existing PDF objects loaded from the source;
2. user operations applied during the session; and
3. the exported PDF result.

This distinction allows undo/redo, conflict checks, object preservation, and future editing of existing annotations without conflating UI state with PDF object numbers.

## 8. Error handling

Errors are typed by layer:

- core validation errors: invalid page, geometry, style, ID, or operation ordering;
- PDF errors: malformed/truncated/encrypted/unsupported PDF structures, missing page data, and export failures;
- resource errors: configured limits exceeded for bytes, pages, objects, paths, text, or output size;
- boundary errors: invalid JSON, WASM memory/argument failure, or unsupported browser capability.

Expected user mistakes are recoverable and actionable. A malformed or unsupported PDF should produce a clear message and leave the original bytes untouched. An operation batch should be atomic by default: either all validated operations apply to the in-memory document state or none apply. If a future best-effort mode is added, it must be explicit and return per-operation status.

No panic may cross the WASM boundary. Native code may use assertions for impossible programmer invariants, but not for input-controlled values. Logging is opt-in developer diagnostics and must not include document text, file names, or raw PDF bytes by default.

## 9. Testing strategy

Testing is layered:

- Core unit tests for geometry, coordinate transforms, operation validation, ID handling, and undo/redo semantics.
- PDF integration tests using small committed fixtures for load, annotation export, page rotation, crop boxes, existing annotations, malformed input, and reopenability.
- Property-based tests for coordinate round trips, bounded styles, path simplification, and operation sequencing.
- Fuzz tests for PDF parsing and annotation command decoding, with strict time/memory/output limits.
- WASM boundary tests for JSON compatibility, typed errors, byte transfer, and native-vs-WASM parity.
- Browser tests for local file loading, PDF.js rendering, pointer/keyboard interaction, service-worker cache behavior, and export/download.
- Accessibility checks for keyboard operation, focus management, labels, contrast, reduced motion, and screen-reader names.

Every export feature needs a round-trip test: export, reopen through `modipdfy-pdf`, render with PDF.js where feasible, and compare the expected annotation/content properties. Fixtures must be legally redistributable and contain no personal documents.

## 10. Offline PWA strategy

The app is a static site with a web app manifest and service worker. The service worker precaches the shell, CSS, JavaScript, pinned PDF.js assets, WASM binary, icons, and manifest. Cache names are versioned and old caches are removed only during an explicit activate step.

The service worker must use the GitHub Pages repository base path correctly; asset URLs are generated from the deployed base path, not assumed to be rooted at `/`. Navigation falls back to the cached shell. The application must show a meaningful update/offline status and must not block document editing on an update check.

Core document flows must work after a successful first online load with the network disabled. Remote fonts, remote scripts, CDN PDF.js, runtime package fetches, and API calls are not allowed in the offline path. Source PDFs, temporary WASM state, and exports remain in memory or are explicitly saved by the user; they are not silently uploaded.

## 11. Security principles

- Assume every PDF, embedded image, string, annotation, and metadata field is hostile.
- Apply size, page-count, object-count, path-point, text-length, recursion, and output limits before expensive work where possible.
- Keep parser and exporter code memory-safe Rust, but still handle denial-of-service inputs and malformed structures.
- Treat PDF.js as a separate parsing/rendering attack surface and pin/review its version.
- Render document-derived text as text nodes, not `innerHTML`; validate URLs and never execute document-provided scripts.
- Keep WASM and service-worker assets same-origin and integrity-pinned where the deployment permits it.
- Do not grant unnecessary browser permissions. File access is user initiated; clipboard, camera, and File System Access API features are optional and must have visible consent.
- Do not expose document bytes in URLs, logs, crash reports, analytics, or error messages.
- Preserve the original input immutably until a successful export is available.

## 12. Licensing

Project source is MIT-licensed. New source files should include the project’s standard MIT notice when the repository establishes one. Every dependency and bundled asset must have a compatible permissive license or an explicit legal review before inclusion. Record licenses for Rust crates, PDF.js, fonts, icons, examples, and test fixtures in a machine-readable notice file when implementation begins.

License compatibility does not authorize copying code or assets without attribution. Avoid dependencies with copyleft, field-of-use restrictions, undisclosed telemetry, or a runtime service requirement unless the project owner explicitly approves a revised licensing plan.

## 13. Current document-engine limitations

The initial `modipdfy-core` engine intentionally supports inspection and unchanged save/reopen, not annotations or other edits:

- Encrypted documents are detected and reported. Documents that lopdf can open with no password may be inspected; password-protected documents are not given a browser password flow yet.
- Malformed input is rejected with a typed error when lopdf cannot recover it. Lenient parsing may accept some non-conforming PDFs, so successful loading is not a promise that every producer or reader will accept the file.
- An input-size limit and lopdf per-stream decompression limit reduce denial-of-service exposure, but they are not a complete PDF security boundary.
- A `/Prev` trailer entry is reported as an incremental-update warning. Untouched saves return the original bytes, while any future rewrite must be treated as potentially changing incremental-history semantics.
- Signature dictionaries, signature fields, and `/ByteRange` markers are detected when present. Untouched saves preserve the original bytes; any future rewrite must not claim that a cryptographic signature remains valid.
- `save_to_bytes` currently avoids rewriting an unmodified document. Future mutation APIs must mark the document dirty and route serialization through lopdf while preserving unrelated objects.
