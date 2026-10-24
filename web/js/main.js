import { AnnotationOverlay } from "./annotation-overlay.js";
import { AnnotationInteraction } from "./annotation-interaction.js";
import { AnnotationStore, Tool, makeStyle } from "./annotation-model.js";
import { PdfViewer } from "./pdf-viewer.js";
import { colorFromHex } from "./annotation-interaction.js";
import { loadWasm, openPdfDocument } from "./wasm-client.js";

const elements = {
  fileInput: document.querySelector("#file-input"),
  dropzone: document.querySelector("#dropzone"),
  viewport: document.querySelector("#viewer-viewport"),
  pages: document.querySelector("#pdf-pages"),
  documentName: document.querySelector("#document-name"),
  previous: document.querySelector("#previous-page"),
  next: document.querySelector("#next-page"),
  pageInput: document.querySelector("#page-input"),
  pageCount: document.querySelector("#page-count"),
  zoomOut: document.querySelector("#zoom-out"),
  zoomIn: document.querySelector("#zoom-in"),
  fitWidth: document.querySelector("#fit-width"),
  fitPage: document.querySelector("#fit-page"),
  zoomLevel: document.querySelector("#zoom-level"),
  status: document.querySelector("#status"),
  version: document.querySelector("#version"),
  color: document.querySelector("#annotation-color"),
  width: document.querySelector("#annotation-width"),
  fontSize: document.querySelector("#annotation-font-size"),
  deleteSelected: document.querySelector("#delete-selected"),
  undo: document.querySelector("#undo"),
  redo: document.querySelector("#redo"),
  exportPdf: document.querySelector("#export-pdf"),
  toolButtons: [...document.querySelectorAll("[data-tool]")],
};

let currentPageCount = 0;
let currentPage = 0;
let documentHandle = null;
let selectedAnnotation = null;
let overlay;
let interaction;

function setStatus(message, state = "ready") {
  elements.status.textContent = message;
  elements.status.dataset.state = state;
}

function updateDocumentControls() {
  const hasDocument = currentPageCount > 0 && documentHandle;
  for (const control of [
    elements.previous,
    elements.next,
    elements.pageInput,
    elements.zoomOut,
    elements.zoomIn,
    elements.fitWidth,
    elements.fitPage,
    elements.deleteSelected,
    elements.undo,
    elements.redo,
    elements.exportPdf,
    elements.color,
    elements.width,
    elements.fontSize,
  ]) {
    control.disabled = !hasDocument;
  }
  for (const button of elements.toolButtons) button.disabled = !hasDocument;
  elements.previous.disabled = !hasDocument || currentPage <= 1;
  elements.next.disabled = !hasDocument || currentPage >= currentPageCount;
  elements.deleteSelected.disabled = !hasDocument || !selectedAnnotation;
  elements.undo.disabled = !hasDocument || !store.history.length;
  elements.redo.disabled = !hasDocument || !store.redoStack.length;
  elements.pageInput.value = currentPage || 0;
  elements.pageInput.max = String(currentPageCount || 1);
  elements.pageCount.textContent = String(currentPageCount);
  elements.dropzone.hidden = Boolean(hasDocument);
}

const controls = {
  textStyle(existing = {}) {
    return makeStyle({
      color: colorFromHex(elements.color.value),
      opacity: existing.opacity ?? 1,
      strokeWidth: existing.strokeWidth ?? 2,
      fontSize: Number(elements.fontSize.value) || existing.fontSize || 14,
    });
  },
  penStyle() {
    return makeStyle({ color: colorFromHex(elements.color.value), opacity: 1, strokeWidth: Number(elements.width.value) || 3, fontSize: 14 });
  },
  highlightStyle() {
    return makeStyle({ color: colorFromHex(elements.color.value), opacity: 0.35, strokeWidth: 1, fontSize: 14 });
  },
};

const store = new AnnotationStore({
  onChange() {
    overlay?.renderAll();
    updateDocumentControls();
  },
  onCommand(command) {
    void interaction?.persistCommand(command);
  },
});

const viewer = new PdfViewer({
  viewportElement: elements.viewport,
  pagesElement: elements.pages,
  onPageCount(pageCount) {
    currentPageCount = pageCount;
    updateDocumentControls();
  },
  onPageChange(pageNumber) {
    currentPage = pageNumber;
    updateDocumentControls();
  },
  onZoomChange(percent) {
    elements.zoomLevel.textContent = `${percent}%`;
    overlay?.renderAll();
  },
  onPageRender() {
    overlay?.renderAll();
  },
  onStatus: setStatus,
});

overlay = new AnnotationOverlay({ viewer, store });
interaction = new AnnotationInteraction({
  viewer,
  pagesElement: elements.pages,
  viewportElement: elements.viewport,
  store,
  overlay,
  controls,
  onStatus: setStatus,
  onSelectionChange(editorId, annotation) {
    selectedAnnotation = annotation;
    updateDocumentControls();
    if (annotation) {
      elements.color.value = colorToHex(annotation.style.color);
      elements.width.value = String(annotation.style.strokeWidth);
      elements.fontSize.value = String(annotation.style.fontSize);
    }
  },
  getPageInfo(pageIndex) {
    return documentHandle?.pageInfo(pageIndex);
  },
});

async function openFile(file) {
  if (!file || (!file.type && !file.name.toLowerCase().endsWith(".pdf")) || (file.type && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf"))) {
    setStatus("Please choose a PDF file.", "error");
    return;
  }
  try {
    await interaction?.flush();
    const buffer = await file.arrayBuffer();
    const wasmBytes = new Uint8Array(buffer);
    const viewerBytes = new Uint8Array(buffer.slice(0));
    const nextDocument = await openPdfDocument(wasmBytes);
    try {
      await viewer.openBytes(viewerBytes, { name: file.name });
    } catch (error) {
      nextDocument.dispose();
      throw error;
    }
    documentHandle?.dispose();
    documentHandle = nextDocument;
    interaction.setDocument(documentHandle);
    store.replaceAll(documentHandle.listAnnotations());
    selectedAnnotation = null;
    interaction.setSelected(null);
    elements.documentName.textContent = file.name;
    setStatus("Ready. Select a tool to annotate this local document.");
    updateDocumentControls();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown PDF error";
    setStatus(`Could not open PDF: ${message}`, "error");
  }
}

async function exportPdf() {
  if (!documentHandle) return;
  try {
    await interaction?.flush();
    const bytes = documentHandle.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = elements.documentName.textContent.replace(/\.pdf$/i, "") + "-annotated.pdf";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setStatus("Annotated PDF exported to your device.");
  } catch (error) {
    setStatus(`Could not export PDF: ${error instanceof Error ? error.message : String(error)}`, "error");
  }
}

elements.fileInput.addEventListener("change", () => {
  void openFile(elements.fileInput.files?.[0]);
  elements.fileInput.value = "";
});

for (const eventName of ["dragenter", "dragover"]) {
  elements.viewport.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropzone.dataset.active = "true";
  });
}
for (const eventName of ["dragleave", "drop"]) {
  elements.viewport.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropzone.dataset.active = "false";
  });
}
elements.viewport.addEventListener("drop", (event) => void openFile(event.dataTransfer?.files?.[0]));

elements.previous.addEventListener("click", () => void viewer.goToPage(currentPage - 1));
elements.next.addEventListener("click", () => void viewer.goToPage(currentPage + 1));
elements.pageInput.addEventListener("change", () => void viewer.goToPage(Number(elements.pageInput.value)));
elements.zoomOut.addEventListener("click", () => void viewer.zoomOut());
elements.zoomIn.addEventListener("click", () => void viewer.zoomIn());
elements.fitWidth.addEventListener("click", () => void viewer.fitWidth());
elements.fitPage.addEventListener("click", () => void viewer.fitPage());
elements.deleteSelected.addEventListener("click", () => void interaction.deleteSelected());
elements.undo.addEventListener("click", () => void interaction.undo());
elements.redo.addEventListener("click", () => void interaction.redo());
elements.exportPdf.addEventListener("click", () => void exportPdf());

for (const button of elements.toolButtons) {
  button.addEventListener("click", () => {
    interaction.setTool(button.dataset.tool);
    for (const candidate of elements.toolButtons) {
      const active = candidate === button;
      candidate.classList.toggle("is-active", active);
      candidate.setAttribute("aria-pressed", String(active));
    }
  });
}

elements.color.addEventListener("change", () => {
  if (selectedAnnotation) interaction.updateSelectedStyle({ color: colorFromHex(elements.color.value) });
});
elements.width.addEventListener("change", () => {
  if (selectedAnnotation && selectedAnnotation.annotationType === "Ink") interaction.updateSelectedStyle({ strokeWidth: Number(elements.width.value) });
});
elements.fontSize.addEventListener("change", () => {
  if (selectedAnnotation && selectedAnnotation.annotationType === "Text") interaction.updateSelectedStyle({ fontSize: Number(elements.fontSize.value) });
});

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register(new URL("../sw.js", import.meta.url));
  } catch {
    setStatus("PDF viewer ready; offline caching is unavailable in this browser.", "error");
  }
}

async function boot() {
  try {
    const wasm = await loadWasm();
    elements.version.textContent = wasm.getVersion();
    setStatus("Ready. Open a local PDF to begin.");
    updateDocumentControls();
    await registerServiceWorker();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown startup error";
    setStatus(`The Rust/WASM core could not load: ${message}`, "error");
    elements.version.textContent = "Unavailable";
  }
}

function colorToHex(color) {
  return `#${[color.red, color.green, color.blue].map((value) => Math.round(value * 255).toString(16).padStart(2, "0")).join("")}`;
}

void boot();
