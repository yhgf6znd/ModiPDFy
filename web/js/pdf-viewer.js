import { pdfjsLib } from "./pdfjs-loader.js";
import {
  getCanvasPixelSize,
  pdfRectToCssRect,
} from "./coordinates.js";

const DEFAULT_SCALE = 1;
const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const SCALE_STEP = 0.25;
const PAGE_MARGIN = 24;

function isRenderCancellation(error) {
  return error?.name === "RenderingCancelledException" || error?.name === "AbortException";
}

function clampScale(scale) {
  if (!Number.isFinite(scale)) {
    throw new TypeError("Viewer scale must be finite.");
  }
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

function setElementSize(element, width, height) {
  element.style.width = `${width}px`;
  element.style.height = `${height}px`;
}

export class PdfViewer {
  constructor({
    viewportElement,
    pagesElement,
    onPageChange = () => {},
    onPageCount = () => {},
    onZoomChange = () => {},
    onStatus = () => {},
  }) {
    if (!viewportElement || !pagesElement) {
      throw new TypeError("PdfViewer requires viewportElement and pagesElement.");
    }
    this.viewportElement = viewportElement;
    this.pagesElement = pagesElement;
    this.onPageChange = onPageChange;
    this.onPageCount = onPageCount;
    this.onZoomChange = onZoomChange;
    this.onStatus = onStatus;
    this.pdfDocument = null;
    this.pageCache = new Map();
    this.pageStates = new Map();
    this.renderGeneration = 0;
    this.renderTasks = new Map();
    this.currentPageIndex = 0;
    this.scale = DEFAULT_SCALE;
    this.scaleMode = "manual";
    this.documentName = "";
    this.loadingTask = null;
    this.intersectionObserver = new IntersectionObserver(
      (entries) => this.#handleIntersections(entries),
      { root: this.viewportElement, rootMargin: "800px 0px", threshold: [0, 0.5, 1] },
    );
    this.viewportElement.addEventListener("scroll", () => this.#scheduleCurrentPageUpdate(), { passive: true });
    this.resizeObserver = new ResizeObserver(() => {
      if (this.scaleMode === "fit-width" || this.scaleMode === "fit-page") {
        void this.#applyScaleMode();
      }
    });
    this.resizeObserver.observe(this.viewportElement);
  }

  get pageCount() {
    return this.pdfDocument?.numPages ?? 0;
  }

  get pageNumber() {
    return this.pdfDocument ? this.currentPageIndex + 1 : 0;
  }

  get zoomPercent() {
    return Math.round(this.scale * 100);
  }

  async openFile(file) {
    if (!file || typeof file.arrayBuffer !== "function") {
      throw new TypeError("A local File is required.");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    return this.openBytes(bytes, { name: file.name });
  }

  async openBytes(bytes, { name = "document.pdf" } = {}) {
    if (!(bytes instanceof Uint8Array)) {
      throw new TypeError("PDF input must be a Uint8Array.");
    }
    await this.close();
    const generation = ++this.renderGeneration;
    this.documentName = name;
    this.onStatus("Opening PDF…");
    const loadingTask = pdfjsLib.getDocument({
      data: bytes,
      cMapUrl: new URL("../pdfjs/cmaps/", import.meta.url).href,
      cMapPacked: true,
      standardFontDataUrl: new URL("../pdfjs/standard_fonts/", import.meta.url).href,
      isEvalSupported: false,
    });
    this.loadingTask = loadingTask;
    try {
      const document = await loadingTask.promise;
      if (generation !== this.renderGeneration) {
        await document.destroy();
        return;
      }
      this.pdfDocument = document;
      this.currentPageIndex = 0;
      this.scale = DEFAULT_SCALE;
      this.scaleMode = "manual";
      this.#createPageShells();
      this.onPageCount(this.pageCount);
      this.onPageChange(this.pageNumber);
      this.onZoomChange(this.zoomPercent);
      this.onStatus(`${this.pageCount} page${this.pageCount === 1 ? "" : "s"} ready.`);
      await this.#renderPage(0, generation);
    } catch (error) {
      if (generation === this.renderGeneration) {
        this.onStatus("Could not open this PDF.", "error");
      }
      throw error;
    } finally {
      if (this.loadingTask === loadingTask) {
        this.loadingTask = null;
      }
    }
  }

  async close() {
    this.renderGeneration += 1;
    this.loadingTask?.destroy();
    this.loadingTask = null;
    for (const task of this.renderTasks.values()) {
      task.render?.cancel();
      task.text?.cancel?.();
    }
    this.renderTasks.clear();
    this.intersectionObserver.disconnect();
    const document = this.pdfDocument;
    this.pdfDocument = null;
    this.pageCache.clear();
    this.pageStates.clear();
    this.pagesElement.replaceChildren();
    this.currentPageIndex = 0;
    this.onPageCount(0);
    this.onPageChange(0);
    if (document) {
      await document.destroy();
    }
  }

  async setZoom(scale) {
    this.scaleMode = "manual";
    this.scale = clampScale(scale);
    await this.#rerenderAll();
  }

  async zoomIn() {
    return this.setZoom(this.scale + SCALE_STEP);
  }

  async zoomOut() {
    return this.setZoom(this.scale - SCALE_STEP);
  }

  async fitWidth() {
    this.scaleMode = "fit-width";
    return this.#applyScaleMode();
  }

  async fitPage() {
    this.scaleMode = "fit-page";
    return this.#applyScaleMode();
  }

  async goToPage(pageNumber, { smooth = true } = {}) {
    if (!this.pdfDocument) {
      return;
    }
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > this.pageCount) {
      throw new RangeError("Page number is outside the open document.");
    }
    const index = pageNumber - 1;
    const state = this.pageStates.get(index);
    if (!state) {
      return;
    }
    this.currentPageIndex = index;
    this.onPageChange(pageNumber);
    state.shell.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    await this.#renderPage(index, this.renderGeneration);
  }

  #createPageShells() {
    this.pagesElement.replaceChildren();
    this.pageStates.clear();
    for (let index = 0; index < this.pageCount; index += 1) {
      const shell = document.createElement("section");
      shell.className = "pdf-page";
      shell.dataset.pageIndex = String(index);
      shell.setAttribute("aria-label", `Page ${index + 1}`);
      const stage = document.createElement("div");
      stage.className = "page-stage";
      const canvas = document.createElement("canvas");
      canvas.className = "pdf-canvas";
      canvas.setAttribute("aria-hidden", "true");
      const textLayer = document.createElement("div");
      textLayer.className = "text-layer textLayer";
      textLayer.setAttribute("aria-label", "Selectable PDF text");
      const annotationLayer = document.createElement("div");
      annotationLayer.className = "annotation-layer annotationLayer";
      annotationLayer.setAttribute("aria-hidden", "true");
      stage.append(canvas, textLayer, annotationLayer);
      shell.append(stage);
      this.pagesElement.append(shell);
      const state = { shell, stage, canvas, textLayer, annotationLayer, rendered: false, viewport: null };
      this.pageStates.set(index, state);
      this.intersectionObserver.observe(shell);
    }
  }

  #handleIntersections(entries) {
    let best = null;
    for (const entry of entries) {
      if (entry.isIntersecting && entry.intersectionRatio > (best?.intersectionRatio ?? 0)) {
        best = entry;
      }
      if (entry.isIntersecting) {
        const index = Number(entry.target.dataset.pageIndex);
        void this.#renderPage(index, this.renderGeneration);
      }
    }
    if (best) {
      const index = Number(best.target.dataset.pageIndex);
      if (index !== this.currentPageIndex) {
        this.currentPageIndex = index;
        this.onPageChange(index + 1);
      }
    }
  }

  #scheduleCurrentPageUpdate() {
    if (this.currentPageFrame) {
      return;
    }
    this.currentPageFrame = requestAnimationFrame(() => {
      this.currentPageFrame = null;
      const viewportRect = this.viewportElement.getBoundingClientRect();
      const center = viewportRect.top + viewportRect.height / 2;
      let nearestIndex = this.currentPageIndex;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const [index, state] of this.pageStates) {
        const rect = state.shell.getBoundingClientRect();
        const distance = Math.abs(rect.top + rect.height / 2 - center);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      }
      if (nearestIndex !== this.currentPageIndex) {
        this.currentPageIndex = nearestIndex;
        this.onPageChange(nearestIndex + 1);
      }
    });
  }

  async #getPage(index) {
    if (!this.pageCache.has(index)) {
      this.pageCache.set(index, this.pdfDocument.getPage(index + 1));
    }
    return this.pageCache.get(index);
  }

  async #renderPage(index, generation) {
    if (!this.pdfDocument || generation !== this.renderGeneration || !this.pageStates.has(index)) {
      return;
    }
    const state = this.pageStates.get(index);
    const page = await this.#getPage(index);
    if (generation !== this.renderGeneration || !this.pdfDocument) {
      return;
    }
    const viewport = page.getViewport({ scale: this.scale, rotation: page.rotate });
    state.viewport = viewport;
    setElementSize(state.stage, viewport.width, viewport.height);
    const pixelSize = getCanvasPixelSize(viewport.width, viewport.height);
    state.canvas.width = pixelSize.width;
    state.canvas.height = pixelSize.height;
    setElementSize(state.canvas, pixelSize.cssWidth, pixelSize.cssHeight);
    state.textLayer.replaceChildren();
    state.textLayer.style.setProperty("--scale-factor", String(viewport.scale));
    setElementSize(state.textLayer, viewport.width, viewport.height);
    state.annotationLayer.replaceChildren();
    setElementSize(state.annotationLayer, viewport.width, viewport.height);
    const context = state.canvas.getContext("2d", { alpha: false });
    context.setTransform(pixelSize.devicePixelRatio, 0, 0, pixelSize.devicePixelRatio, 0, 0);
    const renderTask = page.render({ canvasContext: context, viewport });
    const taskState = { render: renderTask, text: null };
    this.renderTasks.set(index, taskState);
    try {
      await renderTask.promise;
      if (generation !== this.renderGeneration) {
        return;
      }
      const textContent = await page.getTextContent();
      const textTask = pdfjsLib.renderTextLayer({
        container: state.textLayer,
        viewport,
        textContentSource: textContent,
        textDivs: [],
      });
      taskState.text = textTask;
      await textTask.promise;
      if (generation !== this.renderGeneration) {
        return;
      }
      const annotations = await page.getAnnotations({ intent: "display" });
      if (annotations.length && pdfjsLib.AnnotationLayer) {
        const layer = new pdfjsLib.AnnotationLayer({
          div: state.annotationLayer,
          page,
          viewport,
        });
        await layer.render({ annotations, enableScripting: false });
      }
      state.rendered = true;
      state.shell.dataset.ready = "true";
    } catch (error) {
      if (!isRenderCancellation(error)) {
        this.onStatus(`Could not render page ${index + 1}.`, "error");
        throw error;
      }
    } finally {
      if (this.renderTasks.get(index) === taskState) {
        this.renderTasks.delete(index);
      }
    }
  }

  async #rerenderAll() {
    if (!this.pdfDocument) {
      return;
    }
    const generation = ++this.renderGeneration;
    for (const task of this.renderTasks.values()) {
      task.render?.cancel();
      task.text?.cancel?.();
    }
    this.renderTasks.clear();
    for (const state of this.pageStates.values()) {
      state.rendered = false;
    }
    this.onZoomChange(this.zoomPercent);
    for (const [index, state] of this.pageStates) {
      if (state.shell.getBoundingClientRect().bottom >= 0 && state.shell.getBoundingClientRect().top <= this.viewportElement.clientHeight + 800) {
        await this.#renderPage(index, generation);
      }
    }
  }

  async #applyScaleMode() {
    if (!this.pdfDocument) {
      return;
    }
    const page = await this.#getPage(this.currentPageIndex);
    const baseViewport = page.getViewport({ scale: 1, rotation: page.rotate });
    const availableWidth = Math.max(1, this.viewportElement.clientWidth - PAGE_MARGIN * 2);
    if (this.scaleMode === "fit-width") {
      this.scale = clampScale(availableWidth / baseViewport.width);
    } else if (this.scaleMode === "fit-page") {
      const availableHeight = Math.max(1, this.viewportElement.clientHeight - PAGE_MARGIN * 2);
      this.scale = clampScale(Math.min(availableWidth / baseViewport.width, availableHeight / baseViewport.height));
    }
    await this.#rerenderAll();
  }

  /** Convert a PDF-space rectangle for a rendered page to CSS pixels. */
  pdfRectToCss(index, rect) {
    const viewport = this.pageStates.get(index)?.viewport;
    if (!viewport) {
      throw new Error("The requested page has not been rendered.");
    }
    return pdfRectToCssRect(viewport, rect);
  }
}
