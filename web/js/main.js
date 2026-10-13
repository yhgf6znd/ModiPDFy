import { PdfViewer } from "./pdf-viewer.js";
import { loadWasm } from "./wasm-client.js";

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
};

let currentPageCount = 0;
let currentPage = 0;

function setStatus(message, state = "ready") {
  elements.status.textContent = message;
  elements.status.dataset.state = state;
}

function updateDocumentControls() {
  const hasDocument = currentPageCount > 0;
  for (const control of [elements.previous, elements.next, elements.pageInput, elements.zoomOut, elements.zoomIn, elements.fitWidth, elements.fitPage]) {
    control.disabled = !hasDocument;
  }
  elements.previous.disabled = !hasDocument || currentPage <= 1;
  elements.next.disabled = !hasDocument || currentPage >= currentPageCount;
  elements.pageInput.value = currentPage || 0;
  elements.pageInput.max = String(currentPageCount || 1);
  elements.pageCount.textContent = String(currentPageCount);
  elements.dropzone.hidden = hasDocument;
}

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
  },
  onStatus: setStatus,
});

async function openFile(file) {
  if (!file || (!file.type && !file.name.toLowerCase().endsWith(".pdf")) || (file.type && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf"))) {
    setStatus("Please choose a PDF file.", "error");
    return;
  }
  try {
    await viewer.openFile(file);
    elements.documentName.textContent = file.name;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown PDF error";
    setStatus(`Could not open PDF: ${message}`, "error");
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
elements.viewport.addEventListener("drop", (event) => {
  void openFile(event.dataTransfer?.files?.[0]);
});

elements.previous.addEventListener("click", () => void viewer.goToPage(currentPage - 1));
elements.next.addEventListener("click", () => void viewer.goToPage(currentPage + 1));
elements.pageInput.addEventListener("change", () => void viewer.goToPage(Number(elements.pageInput.value)));
elements.zoomOut.addEventListener("click", () => void viewer.zoomOut());
elements.zoomIn.addEventListener("click", () => void viewer.zoomIn());
elements.fitWidth.addEventListener("click", () => void viewer.fitWidth());
elements.fitPage.addEventListener("click", () => void viewer.fitPage());

elements.viewport.addEventListener("keydown", (event) => {
  if (event.key === "PageDown" || event.key === "ArrowRight") {
    event.preventDefault();
    void viewer.goToPage(Math.min(currentPageCount, currentPage + 1));
  } else if (event.key === "PageUp" || event.key === "ArrowLeft") {
    event.preventDefault();
    void viewer.goToPage(Math.max(1, currentPage - 1));
  }
});

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }
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
    await registerServiceWorker();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown startup error";
    setStatus(`The Rust/WASM core could not load: ${message}`, "error");
    elements.version.textContent = "Unavailable";
  }
}

void boot();
