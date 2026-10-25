import { pdfjsLib } from "./pdfjs-loader.js";
import {
  getCanvasPixelSize,
  cssToPdfPoint,
  pdfRectToCssRect,
} from "./coordinates.js";
import { MAX_BROWSER_PAGE_COUNT, MAX_PDF_INPUT_BYTES, MAX_RENDER_PIXELS } from "./resource-limits.js";

const DEFAULT_SCALE = 1;
const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const SCALE_STEP = 0.25;
const PAGE_MARGIN = 24;

const SAFE_LINK_SERVICE = Object.freeze({
  addLinkAttributes(link, url) {
    try {
      const parsed = new URL(url, globalThis.document.baseURI);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
      link.href = parsed.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer nofollow";
      link.referrerPolicy = "no-referrer";
    } catch {
      // Invalid or executable schemes remain inert.
    }
  },
  getDestinationHash() { return "#"; },
  getAnchorUrl() { return "#"; },
  goToDestination() {},
  executeNamedAction() {},
  executeSetOCGState() {},
});

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
    onPageRender = () => {},
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
    this.onPageRender = onPageRender;
    this.onStatus = onStatus;
    this.pdfDocument = null;
    this.pageCache = new Map();
    this.pageStates = new Map();
    this.renderGeneration = 0;
    this.renderPromises = new Map();
    this.renderTasks = new Map();
    this.currentPageIndex = 0;
    this.programmaticNavigation = 0;
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

  getPageState(pageIndex) {
    return this.pageStates.get(pageIndex);
  }

  getRenderedPageStates() {
    return [...this.pageStates.entries()].map(([index, state]) => ({ index, state, ...state }));
  }

  cssToPdfPoint(pageIndex, point) {
    const viewport = this.pageStates.get(pageIndex)?.viewport;
    if (!viewport) {
      throw new Error("The requested page has not been rendered.");
    }
    return cssToPdfPoint(viewport, point);
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
    if (bytes.byteLength === 0) {
      throw new RangeError("PDF input is empty.");
    }
    if (bytes.byteLength > MAX_PDF_INPUT_BYTES) {
      throw new RangeError("PDF input exceeds the browser limit.");
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
      if (document.numPages > MAX_BROWSER_PAGE_COUNT) {
        await document.destroy();
        throw new RangeError("This PDF contains too many pages for browser editing.");
      }
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
        try {
          await this.close();
        } catch {
          // Preserve the original load/render error for the caller.
        }
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
    const loadingTask = this.loadingTask;
    this.loadingTask = null;
    if (loadingTask) {
      try {
        await loadingTask.destroy();
      } catch {
        // PDF.js may reject destruction after a failed load; the task is no longer reachable.
      }
    }
    for (const task of this.renderTasks.values()) {
      task.render?.cancel();
      task.text?.cancel?.();
    }
    await Promise.allSettled([...this.renderPromises.values()]);
    this.renderTasks.clear();
    this.renderPromises.clear();
    this.intersectionObserver.disconnect();
    const document = this.pdfDocument;
    this.pdfDocument = null;
    this.pageCache.clear();
    this.pageStates.clear();
    this.pagesElement.replaceChildren();
    this.currentPageIndex = 0;
    this.programmaticNavigation = 0;
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
    const navigation = ++this.programmaticNavigation;
    this.currentPageIndex = index;
    this.onPageChange(pageNumber);
    try {
      state.shell.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
      await this.#renderPage(index, this.renderGeneration);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    } finally {
      if (this.programmaticNavigation === navigation) this.programmaticNavigation = 0;
    }
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
      const editorLayer = document.createElement("div");
      editorLayer.className = "editor-layer";
      editorLayer.setAttribute("aria-label", "Editable annotations");
      stage.append(canvas, textLayer, annotationLayer, editorLayer);
      shell.append(stage);
      this.pagesElement.append(shell);
      const state = { shell, stage, canvas, textLayer, annotationLayer, editorLayer, rendered: false, viewport: null };
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
    if (best && !this.programmaticNavigation) {
      const index = Number(best.target.dataset.pageIndex);
      if (index !== this.currentPageIndex) {
        this.currentPageIndex = index;
        this.onPageChange(index + 1);
      }
    }
  }

  #scheduleCurrentPageUpdate() {
    if (this.programmaticNavigation) return;
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
    const existing = this.renderPromises.get(index);
    if (existing) return existing;
    const promise = this.#renderPageInternal(index, generation);
    this.renderPromises.set(index, promise);
    try {
      return await promise;
    } finally {
      if (this.renderPromises.get(index) === promise) this.renderPromises.delete(index);
    }
  }

  async #renderPageInternal(index, generation) {
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
    const requestedDpr = globalThis.devicePixelRatio || 1;
    const area = viewport.width * viewport.height;
    const renderDpr = area > 0 ? Math.min(requestedDpr, Math.sqrt(MAX_RENDER_PIXELS / area)) : requestedDpr;
    const pixelSize = getCanvasPixelSize(viewport.width, viewport.height, Math.max(0.1, renderDpr));
    state.canvas.width = pixelSize.width;
    state.canvas.height = pixelSize.height;
    setElementSize(state.canvas, pixelSize.cssWidth, pixelSize.cssHeight);
    state.textLayer.replaceChildren();
    state.textLayer.style.setProperty("--scale-factor", String(viewport.scale));
    setElementSize(state.textLayer, viewport.width, viewport.height);
    state.annotationLayer.replaceChildren();
    setElementSize(state.annotationLayer, viewport.width, viewport.height);
    setElementSize(state.editorLayer, viewport.width, viewport.height);
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
        await layer.render({
          annotations,
          enableScripting: false,
          hasJSActions: false,
          linkService: SAFE_LINK_SERVICE,
        });
      }
      state.rendered = true;
      state.shell.dataset.ready = "true";
      this.onPageRender(index, state);
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
    await Promise.allSettled([...this.renderPromises.values()]);
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
