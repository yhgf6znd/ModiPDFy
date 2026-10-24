import initializeWasmModule, {
  ModiPdfDocument as WasmModiPdfDocument,
  get_version as getWasmVersion,
} from "../pkg/modipdfy_wasm.js";

const MAX_PDF_INPUT_BYTES = 128 * 1024 * 1024;
let initializationPromise;

/** Error shape exposed by the browser-side WASM bridge. */
export class WasmBridgeError extends Error {
  constructor(code, message, recoverable = false) {
    super(message);
    this.name = "WasmBridgeError";
    this.code = code;
    this.recoverable = recoverable;
  }
}

/** Initialize the generated WASM module once. An optional initializer is useful for tests. */
export async function initializeWasm(initializer) {
  if (!initializationPromise) {
    initializationPromise = initializeWasmModule(initializer).catch((error) => {
      initializationPromise = undefined;
      throw translateWasmError(error);
    });
  }
  await initializationPromise;
}

/** Return the initialized Rust/WASM application version. */
export function getVersion() {
  if (!initializationPromise) {
    throw new WasmBridgeError("wasm_not_initialized", "The WASM module is not initialized.", true);
  }
  return getWasmVersion();
}

/** Open one PDF document from a Uint8Array. */
export async function openPdfDocument(bytes) {
  validatePdfBytes(bytes);
  await initializeWasm();

  try {
    return new PdfDocumentHandle(WasmModiPdfDocument.open(bytes));
  } catch (error) {
    throw translateWasmError(error);
  }
}

/** Translate Rust structured errors and JavaScript validation failures into a stable Error type. */
export function translateWasmError(error) {
  if (error instanceof WasmBridgeError) {
    return error;
  }

  if (error instanceof RangeError || (typeof WebAssembly !== "undefined" && error instanceof WebAssembly.RuntimeError && /memory|out of bounds/i.test(error.message))) {
    return new WasmBridgeError("memory_exhausted", "The browser could not process this PDF because it ran out of memory.", true);
  }

  if (error && typeof error === "object" && typeof error.code === "string") {
    return new WasmBridgeError(
      error.code,
      typeof error.message === "string" ? error.message : "The WASM operation failed.",
      error.recoverable === true,
    );
  }

  const message = error instanceof Error ? error.message : "The WASM operation failed.";
  return new WasmBridgeError("wasm_error", message, false);
}

class PdfDocumentHandle {
  #document;

  constructor(document) {
    this.#document = document;
  }

  /** Return the zero-based number of pages. */
  pageCount() {
    const document = this.#requireDocument();
    try {
      return document.pageCount();
    } catch (error) {
      throw translateWasmError(error);
    }
  }

  /** Return plain JavaScript page data and release the temporary WASM page-info object. */
  pageInfo(pageIndex) {
    validatePageIndex(pageIndex);
    const document = this.#requireDocument();
    let wasmPageInfo;
    try {
      wasmPageInfo = document.pageInfo(pageIndex);
      return {
        pageIndex: wasmPageInfo.pageIndex,
        width: wasmPageInfo.width,
        height: wasmPageInfo.height,
        rotationDegrees: wasmPageInfo.rotationDegrees,
        mediaBox: {
          left: wasmPageInfo.mediaLeft,
          bottom: wasmPageInfo.mediaBottom,
          right: wasmPageInfo.mediaRight,
          top: wasmPageInfo.mediaTop,
        },
        cropBox: {
          left: wasmPageInfo.cropLeft,
          bottom: wasmPageInfo.cropBottom,
          right: wasmPageInfo.cropRight,
          top: wasmPageInfo.cropTop,
        },
      };
    } catch (error) {
      throw translateWasmError(error);
    } finally {
      wasmPageInfo?.free();
    }
  }

  /** Export the current document as a new Uint8Array. */
  save() {
    const document = this.#requireDocument();
    try {
      const bytes = document.save();
      if (!(bytes instanceof Uint8Array)) {
        throw new WasmBridgeError("invalid_wasm_result", "WASM returned invalid PDF bytes.", false);
      }
      return bytes;
    } catch (error) {
      throw translateWasmError(error);
    }
  }

  /** Return Rust-reported document safety and export metadata. */
  metadata() {
    const document = this.#requireDocument();
    try {
      const metadata = document.documentMetadata();
      if (!metadata || typeof metadata !== "object") throw new WasmBridgeError("invalid_wasm_result", "WASM returned invalid document metadata.", false);
      return metadata;
    } catch (error) {
      throw translateWasmError(error);
    }
  }

  /** Return the Rust-backed supported annotation projection. */
  listAnnotations() {
    const document = this.#requireDocument();
    try {
      const annotations = document.listAnnotations();
      if (!Array.isArray(annotations)) {
        throw new WasmBridgeError("invalid_wasm_result", "WASM returned invalid annotations.", false);
      }
      return annotations;
    } catch (error) {
      throw translateWasmError(error);
    }
  }

  /** Commit one completed text annotation through Rust. */
  addTextAnnotation(annotation) {
    const document = this.#requireDocument();
    try {
      const { editorId, pageIndex, position, bounds, style, content } = annotation;
      return document.addTextAnnotation(
        editorId,
        pageIndex,
        position.x,
        position.y,
        bounds.left,
        bounds.bottom,
        bounds.right,
        bounds.top,
        content.text,
        style.color.red,
        style.color.green,
        style.color.blue,
        style.opacity,
        style.strokeWidth,
        style.fontSize,
      );
    } catch (error) {
      throw translateWasmError(error);
    }
  }

  /** Commit one completed ink annotation through Rust. */
  addInkAnnotation(annotation) {
    const document = this.#requireDocument();
    try {
      const { editorId, pageIndex, position, bounds, style, content } = annotation;
      return document.addInkAnnotation(
        editorId,
        pageIndex,
        position.x,
        position.y,
        bounds.left,
        bounds.bottom,
        bounds.right,
        bounds.top,
        content.paths,
        style.color.red,
        style.color.green,
        style.color.blue,
        style.opacity,
        style.strokeWidth,
        style.fontSize,
      );
    } catch (error) {
      throw translateWasmError(error);
    }
  }

  /** Commit one visual handwritten signature as a native Ink annotation through Rust. */
  addSignatureAnnotation(annotation) {
    const document = this.#requireDocument();
    try {
      const { editorId, pageIndex, position, bounds, style, content } = annotation;
      return document.addSignatureAnnotation(
        editorId, pageIndex, position.x, position.y, bounds.left, bounds.bottom, bounds.right, bounds.top,
        content.strokes, style.color.red, style.color.green, style.color.blue, style.opacity, style.strokeWidth, style.fontSize,
      );
    } catch (error) {
      throw translateWasmError(error);
    }
  }

  /** Commit one completed highlight annotation through Rust. */
  addHighlightAnnotation(annotation) {
    const document = this.#requireDocument();
    try {
      const { editorId, pageIndex, position, bounds, style, content } = annotation;
      return document.addHighlightAnnotation(
        editorId,
        pageIndex,
        position.x,
        position.y,
        bounds.left,
        bounds.bottom,
        bounds.right,
        bounds.top,
        content.quads,
        style.color.red,
        style.color.green,
        style.color.blue,
        style.opacity,
        style.strokeWidth,
        style.fontSize,
      );
    } catch (error) {
      throw translateWasmError(error);
    }
  }

  /** Remove one completed annotation through Rust. */
  removeAnnotation(editorId) {
    const document = this.#requireDocument();
    try {
      document.removeAnnotation(editorId);
    } catch (error) {
      throw translateWasmError(error);
    }
  }

  /** Release Rust and generated WASM resources. Repeated calls are safe. */
  dispose() {
    const document = this.#document;
    if (!document) return;
    this.#document = undefined;
    try {
      document.dispose();
    } finally {
      document.free();
    }
  }

  #requireDocument() {
    if (!this.#document) {
      throw new WasmBridgeError("document_disposed", "The PDF document has been disposed.", true);
    }
    return this.#document;
  }
}

function validatePdfBytes(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new WasmBridgeError("invalid_input", "PDF input must be a Uint8Array.", true);
  }
  if (bytes.byteLength === 0) {
    throw new WasmBridgeError("invalid_input", "PDF input is empty.", true);
  }
  if (bytes.byteLength > MAX_PDF_INPUT_BYTES) {
    throw new WasmBridgeError("input_too_large", "PDF input exceeds the browser limit.", true);
  }
}

function validatePageIndex(pageIndex) {
  if (!Number.isSafeInteger(pageIndex) || pageIndex < 0 || pageIndex > 0xffffffff) {
    throw new WasmBridgeError("invalid_page_index", "Page index must be a non-negative integer.", true);
  }
}
