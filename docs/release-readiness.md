# Release readiness report

Date: 2026-10-25

This report covers the current ModiPDFy annotation milestone and the security, reliability, and performance review performed in the local repository. Measurements are from a headless Chromium run using the pinned Playwright 1.55.1 dependency, a one-page generated PDF fixture, localhost static hosting under a GitHub Pages-style /modipdfy/ path, and an offline browser context. They are smoke measurements, not broad device benchmarks.

## Features verified

- Local PDF open through the browser file API.
- PDF.js rendering and text-layer selection.
- Rust/WASM loading, page inspection, and native Text, Ink, Highlight, and visual Signature-as-Ink annotations.
- Annotation selection, movement, resizing where supported, deletion, undo/redo, and export/reopen validation.
- Object-preserving export; the automated fixture checks unchanged source bytes, page structure, unaffected-page pixels, and rendered annotation regions with Poppler and Ghostscript.
- Static PWA shell, GitHub Pages subpath resolution, service-worker precache, offline reload, offline open, annotation, and export.
- Unsaved-change warning on browser refresh and cleanup checks across five repeated document loads.

## Tests executed

- npm test: passed. This ran cargo fmt check, clippy with warnings denied, cargo test for the workspace, wasm-pack build, the Node WASM/PDF regression suite, JavaScript syntax checks, coordinate/history tests, PDF.js vendoring, and the static build.
- npm run validate:build: passed after the final build.
- npm run test:browser: passed in Chromium. It verified CSP-compatible boot, no external runtime requests, the service-worker cache and scope, offline reload, local annotation/export, refresh warning, repeated-load DOM cleanup, and precise JavaScript heap readings.
- npm run test:browser:harness: passed in Chromium for viewer.html, index.html (WASM bridge), and annotations.html.
- npm audit --omit=optional --audit-level=moderate: passed with 0 vulnerabilities after upgrading the vendored PDF.js source to 4.2.67.
- cargo-audit: unavailable on this environment; the exact command to run in CI or a release workstation is cargo audit.

## Security findings and fixes

- High severity PDF.js advisory: fixed by moving from 3.11.174 to the smallest compatible patched release, 4.2.67, and switching the vendored loader to same-origin native ESM.
- Embedded PDF JavaScript/actions: PDF.js is configured with isEvalSupported=false; annotation rendering passes enableScripting=false and hasJSActions=false. The application does not execute imported PDF scripts.
- External links: imported link annotations are handled by a small local link service. Only http and https URLs become links, they open in a new tab with noopener/noreferrer/nofollow, and executable or invalid schemes remain inert. Links are not fetched automatically.
- HTML injection: document-derived names, warnings, and annotation text use textContent or form values. No document-derived HTML is inserted.
- CSP: the static shell includes a same-origin CSP with no object/plugin execution, same-origin scripts/connectivity, local workers, and no remote fonts or images. GitHub Pages cannot provide a response-header frame-ancestors policy, so clickjacking protection from headers remains a deployment limitation.
- Resource limits: the Rust core limits input bytes, decompressed streams, pages, objects, annotation payloads, and output bytes. The browser additionally limits input to 128 MiB, editor pages to 2,000, and canvas backing allocation to 16,777,216 pixels.
- Service worker: only same-origin GET requests are handled; user PDFs are never added to Cache Storage. The cache is versioned and the offline path was verified with the server stopped.
- Dependencies: npm audit is clean for the locked JavaScript graph. A deterministic CycloneDX inventory is checked in at docs/sbom.json. Cargo dependency licenses were collected through cargo metadata; cargo-audit remains to be run where installed.

## Reliability results

Verified by native or browser tests: empty input rejection, malformed PDF rejection without a parser panic crossing the boundary, mixed page dimensions, rotated/cropped pages, existing supported annotations, encrypted-document edit rejection, digitally signed-document edit rejection, source-byte preservation, export reopenability, and repeated handle/document cleanup.

Explicitly unsupported or not fully verified: password entry/decryption, cryptographic signature validation, OCR/scanned-document text extraction, arbitrary unsupported fonts, broad non-Latin text rendering, hostile PDFs with extreme CPU behavior, and full large-document/device memory behavior. Scanned PDFs remain viewable when PDF.js can render their image content, but OCR is not implemented. Existing unsupported annotations and actions are preserved where lopdf can round-trip them; they are not editable by this milestone.

## Performance measurements

One verified Chromium smoke sample: initial app readiness 165 ms; WASM initialization 11.5 ms; offline reload 51 ms; one-page PDF open plus first render 147 ms; annotation interaction 58 ms; export 45 ms; JavaScript heap 9.4 MiB after first render and 12.4 MiB after five repeated loads. The heap delta is not evidence of a leak by itself because browser garbage collection is nondeterministic. The new repeated-load assertions did verify that stale page shells, thumbnails, viewer page state, and disposed WASM handles were not retained through the tested path.

Optimizations made in this review are limit-based and measured against failure risk: lazy thumbnail canvases were already present, the browser now caps render backing pixels, and the patched PDF.js runtime is loaded as native ESM. No speculative rendering or PDF flattening was added.

## Known limitations

- The current browser viewer still creates a page shell and thumbnail control for every page up to the browser limit; very large documents may need virtualization in a future milestone.
- PDF parsing remains an in-memory operation. Compressed-stream, object-count, output-size, and page-count limits reduce exposure but do not provide a CPU time budget or fuzzing guarantee.
- Export rewrites edited PDFs through lopdf and rejects edits to encrypted or signed documents. Untouched encrypted/signed bytes can be returned, but the application does not claim cryptographic validity.
- Native Acrobat/Reader testing was not rerun in this audit. The repository contains historical local Wine/Acrobat notes, but native Windows/macOS Acrobat coverage and complete visual regression across readers remain open. No document was uploaded to Adobe or another remote service.
- The current test profile is Chromium-only for automated Playwright execution; Firefox and deployed GitHub Pages verification remain environment-specific follow-up work.

## Unresolved issues

1. Install and run cargo-audit in CI, then review Rust advisories for the locked graph.
2. Add PDF parser and annotation-command fuzzing with CPU, memory, and output budgets.
3. Add legally redistributable scanned, non-Latin, unsupported-font, password-protected, digitally signed, embedded-action, and external-link fixtures.
4. Profile multi-page, large-stream, high-DPI, rotated, and image-heavy documents on supported desktop and mobile browsers.
5. Decide whether large-page/page-count virtualization is required before stable publication.
6. Add deployment-header controls, if the hosting platform permits them, for frame-ancestors and other response-header-only policies.

## Readiness decision

The milestone is ready for the next development milestone as a hardened development slice, not as a final stable release. The implemented scope passes the available automated checks and keeps the browser-only, MIT, Rust-first, framework-free, and offline constraints. The unresolved issues above must remain visible in the roadmap before a stable public release claim.
