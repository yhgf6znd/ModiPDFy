import { AnnotationOverlay } from "./annotation-overlay.js";
import { AnnotationInteraction } from "./annotation-interaction.js";
import { AnnotationStore, Tool, makeStyle } from "./annotation-model.js";
import { PdfViewer } from "./pdf-viewer.js";
import { colorFromHex } from "./annotation-interaction.js";
import { loadWasm, openPdfDocument } from "./wasm-client.js";
import { downloadPdf, exportPdfBytes, suggestedFilename } from "./pdf-export.js";
import { SignaturePad } from "./signature-pad.js";
import { deleteStoredSignature, listStoredSignatures, saveStoredSignature } from "./signature-storage.js";

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
  duplicateSelected: document.querySelector("#duplicate-selected"),
  createSignature: document.querySelector("#create-signature"),
  undo: document.querySelector("#undo"),
  redo: document.querySelector("#redo"),
  exportPdf: document.querySelector("#export-pdf"),
  toolButtons: [...document.querySelectorAll("[data-tool]")],
  signatureDialog: document.querySelector("#signature-dialog"),
  signatureCanvas: document.querySelector("#signature-canvas"),
  signatureColor: document.querySelector("#signature-color"),
  signatureStrokeWidth: document.querySelector("#signature-stroke-width"),
  signatureClear: document.querySelector("#signature-clear"),
  signatureCancel: document.querySelector("#signature-cancel"),
  signatureSaved: document.querySelector("#signature-saved"),
  signatureSaveLocal: document.querySelector("#signature-save-local"),
  signatureDeleteSaved: document.querySelector("#signature-delete-saved"),
};

let currentPageCount = 0;
let currentPage = 0;
let documentHandle = null;
let selectedAnnotation = null;
let overlay;
let interaction;
let signaturePad;
let storedSignatures = [];

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
    elements.duplicateSelected,
    elements.createSignature,
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
  elements.duplicateSelected.disabled = !hasDocument || selectedAnnotation?.annotationType !== "Signature";
  elements.undo.disabled = !hasDocument || !store.canUndo;
  elements.redo.disabled = !hasDocument || !store.canRedo;
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
    return interaction?.persistCommand(command);
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
signaturePad = new SignaturePad({ canvas: elements.signatureCanvas, colorInput: elements.signatureColor, widthInput: elements.signatureStrokeWidth });
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
    let nextDocument = await openPdfDocument(wasmBytes);
    try {
      await viewer.openBytes(viewerBytes, { name: file.name });
      const annotations = nextDocument.listAnnotations();
      const metadata = nextDocument.metadata();
      documentHandle?.dispose();
      documentHandle = nextDocument;
      nextDocument = null;
      interaction.setDocument(documentHandle);
      store.replaceAll(annotations);
      selectedAnnotation = null;
      interaction.setSelected(null);
      elements.documentName.textContent = file.name;
      const warning = metadata.warnings?.[0];
      setStatus(warning ? `Opened with warning: ${warning}` : "Ready. Select a tool to annotate this local document.", warning ? "warning" : "ready");
      updateDocumentControls();
    } finally {
      nextDocument?.dispose();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown PDF error";
    setStatus(`Could not open PDF: ${message}`, "error");
  }
}

async function exportPdf() {
  if (!documentHandle) return;
  try {
    await interaction?.flush();
    const bytes = await exportPdfBytes({
      documentHandle,
      annotations: store.committedValues(),
      reopen: openPdfDocument,
    });
    downloadPdf(bytes, suggestedFilename(elements.documentName.textContent));
    setStatus("Modified PDF exported to your device.");
  } catch (error) {
    setStatus(`Could not export PDF: ${error instanceof Error ? error.message : String(error)}`, "error");
  }
}

async function refreshStoredSignatures() {
  try {
    storedSignatures = await listStoredSignatures();
    elements.signatureSaved.replaceChildren(new Option("None", ""));
    for (const signature of storedSignatures) {
      elements.signatureSaved.append(new Option(signature.name || "Saved signature", signature.id));
    }
    elements.signatureDeleteSaved.disabled = !elements.signatureSaved.value;
  } catch (error) {
    storedSignatures = [];
    setStatus(error instanceof Error ? error.message : "Local signature storage is unavailable.", "error");
  }
}

function openSignatureDialog() {
  signaturePad.clear();
  elements.signatureSaveLocal.checked = false;
  elements.signatureSaved.value = "";
  elements.signatureDeleteSaved.disabled = true;
  if (typeof elements.signatureDialog.showModal === "function") elements.signatureDialog.showModal();
  else elements.signatureDialog.setAttribute("open", "");
  void refreshStoredSignatures();
}

async function confirmSignature() {
  const signature = signaturePad.toSignature();
  if (!signature) {
    setStatus("Draw a signature with at least one complete stroke.", "error");
    return;
  }
  if (elements.signatureSaveLocal.checked) {
    const id = `saved-signature-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
    try {
      await saveStoredSignature({ id, name: `Signature ${storedSignatures.length + 1}`, ...signature });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The signature could not be saved locally.", "error");
      return;
    }
  }
  elements.signatureDialog.close();
  interaction.beginSignaturePlacement(signature);
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
elements.duplicateSelected.addEventListener("click", () => interaction.duplicateSelected());
elements.createSignature.addEventListener("click", openSignatureDialog);
elements.signatureClear.addEventListener("click", () => signaturePad.clear());
elements.signatureCancel.addEventListener("click", () => interaction.cancelSignaturePlacement());
elements.signatureDialog.addEventListener("close", () => interaction.cancelSignaturePlacement());
elements.signatureSaved.addEventListener("change", () => {
  const signature = storedSignatures.find((item) => item.id === elements.signatureSaved.value);
  elements.signatureDeleteSaved.disabled = !signature;
  if (signature) signaturePad.load(signature);
});
elements.signatureDeleteSaved.addEventListener("click", async () => {
  if (!elements.signatureSaved.value) return;
  try {
    await deleteStoredSignature(elements.signatureSaved.value);
    await refreshStoredSignatures();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "The saved signature could not be deleted.", "error");
  }
});
elements.signatureDialog.querySelector("form").addEventListener("submit", (event) => {
  event.preventDefault();
  void confirmSignature();
});
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
  if (selectedAnnotation && ["Ink", "Signature"].includes(selectedAnnotation.annotationType)) interaction.updateSelectedStyle({ strokeWidth: Number(elements.width.value) });
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
