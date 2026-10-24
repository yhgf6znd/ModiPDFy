import {
  AnnotationType,
  Tool,
  cloneAnnotation,
  createEditorId,
  makeBounds,
  makeStyle,
} from "./annotation-model.js";
import { pdfBoundsToCssRect } from "./coordinates.js";
import { CommandOperation } from "./history.js";

const MIN_TEXT_WIDTH = 24;
const MIN_TEXT_HEIGHT = 18;
const MIN_RESIZE_WIDTH = 8;
const MIN_RESIZE_HEIGHT = 8;
const MAX_INK_POINTS = 100_000;

function colorFromHex(value) {
  const normalized = value.replace(/^#/, "");
  const number = Number.parseInt(normalized, 16);
  if (!Number.isFinite(number)) {
    return { red: 0, green: 0, blue: 0 };
  }
  return {
    red: ((number >> 16) & 0xff) / 255,
    green: ((number >> 8) & 0xff) / 255,
    blue: (number & 0xff) / 255,
  };
}

function hexFromColor(color) {
  return `#${[color.red, color.green, color.blue].map((component) => Math.round(component * 255).toString(16).padStart(2, "0")).join("")}`;
}

function pointBounds(points, padding = 0) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return makeBounds(Math.min(...xs) - padding, Math.min(...ys) - padding, Math.max(...xs) + padding, Math.max(...ys) + padding);
}

function mapPoint(point, oldBounds, newBounds) {
  const width = Math.max(oldBounds.right - oldBounds.left, 0.0001);
  const height = Math.max(oldBounds.top - oldBounds.bottom, 0.0001);
  return {
    x: newBounds.left + ((point.x - oldBounds.left) / width) * (newBounds.right - newBounds.left),
    y: newBounds.bottom + ((point.y - oldBounds.bottom) / height) * (newBounds.top - newBounds.bottom),
  };
}

function translateAnnotation(annotation, delta) {
  const next = cloneAnnotation(annotation);
  next.position.x += delta.x;
  next.position.y += delta.y;
  next.bounds = {
    left: next.bounds.left + delta.x,
    bottom: next.bounds.bottom + delta.y,
    right: next.bounds.right + delta.x,
    top: next.bounds.top + delta.y,
  };
  if (next.annotationType === AnnotationType.INK || next.annotationType === AnnotationType.SIGNATURE) {
    next.content.paths = next.content.paths.map((path) => path.map((point) => ({ x: point.x + delta.x, y: point.y + delta.y })));
    if (next.annotationType === AnnotationType.SIGNATURE && next.content.strokes) {
      next.content.strokes = next.content.strokes.map((stroke) => ({ ...stroke, points: stroke.points.map((point) => ({ x: point.x + delta.x, y: point.y + delta.y })) }));
    }
  } else if (next.annotationType === AnnotationType.HIGHLIGHT) {
    next.content.quads = next.content.quads.map((quad) => Object.fromEntries(Object.entries(quad).map(([key, point]) => [key, { x: point.x + delta.x, y: point.y + delta.y }])));
  }
  return next;
}

function resizeAnnotation(annotation, newBounds) {
  const next = cloneAnnotation(annotation);
  next.position = mapPoint(annotation.position, annotation.bounds, newBounds);
  next.bounds = newBounds;
  const scaleX = (newBounds.right - newBounds.left) / Math.max(annotation.bounds.right - annotation.bounds.left, 0.0001);
  const scaleY = (newBounds.top - newBounds.bottom) / Math.max(annotation.bounds.top - annotation.bounds.bottom, 0.0001);
  if (next.annotationType === AnnotationType.SIGNATURE) {
    next.style.strokeWidth = annotation.style.strokeWidth * Math.min(scaleX, scaleY);
  }
  if (next.annotationType === AnnotationType.INK || next.annotationType === AnnotationType.SIGNATURE) {
    next.content.paths = next.content.paths.map((path) => path.map((point) => mapPoint(point, annotation.bounds, newBounds)));
    if (next.annotationType === AnnotationType.SIGNATURE && next.content.strokes) {
      next.content.strokes = next.content.strokes.map((stroke) => ({ ...stroke, points: stroke.points.map((point) => mapPoint(point, annotation.bounds, newBounds)), strokeWidth: stroke.strokeWidth * Math.min(scaleX, scaleY) }));
    }
  } else if (next.annotationType === AnnotationType.HIGHLIGHT) {
    next.content.quads = next.content.quads.map((quad) => Object.fromEntries(Object.entries(quad).map(([key, point]) => [key, mapPoint(point, annotation.bounds, newBounds)])));
  }
  return next;
}

function clampToPage(annotation, pageInfo) {
  if (!pageInfo) return annotation;
  const { cropBox } = pageInfo;
  const dx = Math.max(cropBox.left - annotation.bounds.left, 0) - Math.max(annotation.bounds.right - cropBox.right, 0);
  const dy = Math.max(cropBox.bottom - annotation.bounds.bottom, 0) - Math.max(annotation.bounds.top - cropBox.top, 0);
  return dx || dy ? translateAnnotation(annotation, { x: dx, y: dy }) : annotation;
}

function clampBounds(bounds, pageInfo) {
  if (!pageInfo) return bounds;
  const { cropBox } = pageInfo;
  const dx = Math.max(cropBox.left - bounds.left, 0) - Math.max(bounds.right - cropBox.right, 0);
  const dy = Math.max(cropBox.bottom - bounds.bottom, 0) - Math.max(bounds.top - cropBox.top, 0);
  return dx || dy
    ? makeBounds(bounds.left + dx, bounds.bottom + dy, bounds.right + dx, bounds.top + dy)
    : bounds;
}
function signatureAnnotationAt(signature, pageIndex, point, pageInfo) {
  const crop = pageInfo?.cropBox ?? { left: 0, bottom: 0, right: 612, top: 792 };
  const maxWidth = Math.min(220, crop.right - crop.left - 8);
  const maxHeight = Math.min(120, crop.top - crop.bottom - 8);
  const scale = Math.min(maxWidth / signature.width, maxHeight / signature.height);
  const width = Math.max(8, signature.width * scale);
  const height = Math.max(8, signature.height * scale);
  const bounds = makeBounds(point.x - width / 2, point.y - height / 2, point.x + width / 2, point.y + height / 2);
  const strokes = signature.strokes.map((stroke) => ({
    ...stroke,
    strokeWidth: stroke.strokeWidth * scale,
    points: stroke.points.map((item) => ({
    x: bounds.left + item.x * scale,
    y: bounds.bottom + (signature.height - item.y) * scale,
    })),
  }));
  const paths = strokes.map((stroke) => stroke.points);
  return clampToPage({
    editorId: `signature-${createEditorId().slice("editor-".length)}`,
    pageIndex,
    annotationType: AnnotationType.SIGNATURE,
    position: paths[0][0],
    bounds,
    style: makeStyle({ color: signature.color, opacity: 1, strokeWidth: signature.strokeWidth * scale, fontSize: 14 }),
    content: { paths, strokes },
  }, pageInfo);
}

function isEditableTarget(target) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable;
}

/** Pointer-event controller for temporary overlays and completed Rust-backed commands. */
export class AnnotationInteraction {
  constructor({ viewer, pagesElement, viewportElement, store, overlay, controls, onStatus = () => {}, onSelectionChange = () => {}, getPageInfo = () => null }) {
    this.viewer = viewer;
    this.pagesElement = pagesElement;
    this.viewportElement = viewportElement;
    this.store = store;
    this.overlay = overlay;
    this.controls = controls;
    this.onStatus = onStatus;
    this.onSelectionChange = onSelectionChange;
    this.getPageInfo = getPageInfo;
    this.tool = Tool.SELECT;
    this.documentHandle = null;
    this.selectedId = null;
    this.gesture = null;
    this.textDraft = null;
    this.pendingSignature = null;
    this.commandQueue = Promise.resolve();
    this.commandError = null;
    this.pagesElement.addEventListener("pointerdown", (event) => this.#pointerDown(event));
    this.pagesElement.addEventListener("pointermove", (event) => this.#pointerMove(event));
    this.pagesElement.addEventListener("pointerup", (event) => this.#pointerUp(event));
    this.pagesElement.addEventListener("pointercancel", (event) => this.#cancelGesture(event));
    this.viewportElement.addEventListener("keydown", (event) => this.#keyDown(event));
  }
  setDocument(documentHandle) {
    this.documentHandle = documentHandle;
  }

  beginSignaturePlacement(signature) {
    this.pendingSignature = cloneAnnotation(signature);
    this.setTool(Tool.SIGNATURE);
    this.onStatus("Move the signature over the page, then click or tap to place it.");
  }

  cancelSignaturePlacement() {
    this.pendingSignature = null;
    this.overlay.clearTransient();
    this.setTool(Tool.SELECT);
  }

  flush() {
    return this.commandQueue.then(() => {
      if (this.commandError) throw this.commandError;
    });
  }

  setTool(tool) {
    if (tool !== Tool.SIGNATURE && this.pendingSignature) {
      this.pendingSignature = null;
      this.overlay.clearTransient();
    }
    this.tool = tool;
    this.overlay.setTool(tool);
    this.pagesElement.dataset.tool = tool;
    if (tool !== Tool.TEXT) this.#finishTextDraft(false);
  }

  setSelected(editorId) {
    this.selectedId = editorId;
    this.overlay.setSelected(editorId);
    this.onSelectionChange(editorId, editorId ? this.store.get(editorId) : null);
  }

  async deleteSelected() {
    if (!this.selectedId) return;
    const annotation = this.store.get(this.selectedId);
    if (!annotation) return;
    this.setSelected(null);
    this.store.commitRemove(annotation, annotation.annotationType === AnnotationType.SIGNATURE ? CommandOperation.DELETE_SIGNATURE : CommandOperation.DELETE_ANNOTATION);
  }
  duplicateSelected() {
    const annotation = this.selectedId ? this.store.get(this.selectedId) : null;
    if (!annotation || annotation.annotationType !== AnnotationType.SIGNATURE) return;
    const duplicate = translateAnnotation(annotation, { x: 12, y: -12 });
    duplicate.editorId = `signature-${createEditorId().slice("editor-".length)}`;
    const clamped = clampToPage(duplicate, this.getPageInfo(annotation.pageIndex));
    this.store.commitAdd(clamped, CommandOperation.ADD_SIGNATURE);
    this.setSelected(clamped.editorId);
  }


  async undo() {
    const result = this.store.undo();
    if (!result) return;
    this.setSelected(result.inverse.annotation?.editorId ?? result.inverse.after?.editorId ?? null);
    try {
      await this.#persistCommand(result.inverse, result.command);
    } catch {
      this.store.restoreUndo(result.command);
    }
  }

  async redo() {
    const command = this.store.redo();
    if (!command) return;
    this.setSelected(command.annotation?.editorId ?? command.after?.editorId ?? null);
    try {
      await this.#persistCommand(command, invertCommandForRestore(command));
    } catch {
      this.store.restoreRedo(command);
    }
  }

  editSelected() {
    const annotation = this.selectedId ? this.store.get(this.selectedId) : null;
    if (annotation?.annotationType === AnnotationType.TEXT) {
      this.#startTextDraft(annotation.pageIndex, annotation.position, annotation);
    }
  }

  updateSelectedStyle(style) {
    const annotation = this.selectedId ? this.store.get(this.selectedId) : null;
    if (!annotation) return;
    const next = cloneAnnotation(annotation);
    next.style = { ...next.style, ...style, color: style.color ?? next.style.color };
    this.store.commitUpdate(annotation, next, CommandOperation.CHANGE_PROPERTIES);
  }

  #pointerDown(event) {
    if (event.button !== 0 || this.textDraft) return;
    const pageElement = event.target.closest?.(".pdf-page");
    if (!pageElement) return;
    const pageIndex = Number(pageElement.dataset.pageIndex);
    const annotationTarget = event.target.closest?.("[data-editor-id]");
    const resizeTarget = event.target.closest?.("[data-resize-id]");
    if (this.tool === Tool.SIGNATURE) {
      const pagePoint = this.#pointFromEvent(event, pageElement);
      if (this.pendingSignature) {
        event.preventDefault();
        const annotation = signatureAnnotationAt(this.pendingSignature, pageIndex, pagePoint, this.getPageInfo(pageIndex));
        this.pendingSignature = null;
        this.overlay.clearTransient();
        this.store.commitAdd(annotation, CommandOperation.ADD_SIGNATURE);
        this.setSelected(annotation.editorId);
        this.setTool(Tool.SELECT);
      }
      return;
    }
    if (this.tool === Tool.PEN) {
      event.preventDefault();
      this.#startDrawing(event, pageIndex, pageElement);
      return;
    }
    if (this.tool === Tool.TEXT) {
      event.preventDefault();
      if (annotationTarget) {
        this.setSelected(annotationTarget.dataset.editorId);
        this.#startTextDraft(pageIndex, this.#pointFromEvent(event, pageElement), this.store.get(annotationTarget.dataset.editorId));
      } else {
        this.#startTextDraft(pageIndex, this.#pointFromEvent(event, pageElement));
      }
      return;
    }
    if (this.tool === Tool.ERASER) {
      if (annotationTarget) {
        event.preventDefault();
        this.setSelected(annotationTarget.dataset.editorId);
        void this.deleteSelected();
      }
      return;
    }
    if (this.tool === Tool.HIGHLIGHT) {
      return;
    }
    if (resizeTarget) {
      event.preventDefault();
      const annotation = this.store.get(resizeTarget.dataset.resizeId);
      if (annotation) this.#startResize(event, pageIndex, pageElement, annotation);
      return;
    }
    if (annotationTarget) {
      event.preventDefault();
      const annotation = this.store.get(annotationTarget.dataset.editorId);
      if (annotation) {
        this.setSelected(annotation.editorId);
        this.#startDrag(event, pageIndex, pageElement, annotation);
      }
      return;
    }
    if (!event.target.closest?.(".text-layer")) {
      this.setSelected(null);
    }
  }

  #pointerMove(event) {
    if (!this.gesture) {
      if (this.tool === Tool.SIGNATURE && this.pendingSignature) {
        const pageElement = event.target.closest?.(".pdf-page");
        if (!pageElement) return;
        const pageIndex = Number(pageElement.dataset.pageIndex);
        const point = this.#pointFromEvent(event, pageElement);
        this.overlay.setTransient({ pageIndex, annotation: signatureAnnotationAt(this.pendingSignature, pageIndex, point, this.getPageInfo(pageIndex)) });
      }
      return;
    }
    if (event.pointerId !== this.gesture.pointerId) return;
    event.preventDefault();
    const point = this.#pointFromEvent(event, this.gesture.pageElement);
    if (this.gesture.type === "draw") {
      if (this.gesture.points.length < MAX_INK_POINTS) this.gesture.points.push(point);
      this.overlay.setTransient({ pageIndex: this.gesture.pageIndex, points: this.gesture.points, style: this.gesture.style });
      return;
    }
    if (this.gesture.type === "drag") {
      const delta = { x: point.x - this.gesture.startPoint.x, y: point.y - this.gesture.startPoint.y };
      const next = clampToPage(translateAnnotation(this.gesture.original, delta), this.getPageInfo(this.gesture.pageIndex));
      this.store.setPreview(this.gesture.original.editorId, next);
      return;
    }
    if (this.gesture.type === "resize") {
      const old = this.gesture.original.bounds;
      const pageInfo = this.getPageInfo(this.gesture.pageIndex);
      const crop = pageInfo?.cropBox;
      let newBounds;
      if (this.gesture.original.annotationType === AnnotationType.SIGNATURE) {
        const ratio = (old.right - old.left) / Math.max(old.top - old.bottom, 0.0001);
        const width = Math.max(MIN_RESIZE_WIDTH, point.x - old.left);
        const height = Math.max(MIN_RESIZE_HEIGHT, point.y - old.bottom);
        const requestedWidth = Math.max(width, height * ratio);
        const maxWidth = crop ? Math.max(MIN_RESIZE_WIDTH, Math.min(crop.right - old.left, (crop.top - old.bottom) * ratio)) : requestedWidth;
        const proportionalWidth = Math.min(requestedWidth, maxWidth);
        newBounds = makeBounds(old.left, old.bottom, old.left + proportionalWidth, old.bottom + proportionalWidth / ratio);
      } else {
        const right = Math.max(old.left + MIN_RESIZE_WIDTH, point.x);
        const top = Math.max(old.bottom + MIN_RESIZE_HEIGHT, point.y);
        newBounds = makeBounds(old.left, old.bottom, crop ? Math.min(right, crop.right) : right, crop ? Math.min(top, crop.top) : top);
      }
      const next = resizeAnnotation(this.gesture.original, newBounds);
      this.store.setPreview(this.gesture.original.editorId, next);
    }
  }

  #pointerUp(event) {
    if (this.tool === Tool.HIGHLIGHT && !this.gesture) {
      setTimeout(() => void this.#createHighlightFromSelection(), 0);
      return;
    }
    if (!this.gesture || event.pointerId !== this.gesture.pointerId) return;
    event.preventDefault();
    const gesture = this.gesture;
    this.gesture = null;
    if (this.pagesElement.hasPointerCapture?.(event.pointerId)) {
      try { this.pagesElement.releasePointerCapture(event.pointerId); } catch { /* synthetic test events may not be capturable */ }
    }
    if (gesture.type === "draw") {
      this.overlay.clearTransient();
      if (gesture.points.length >= 2) {
        const padding = gesture.style.strokeWidth / 2 + 1;
        const bounds = pointBounds(gesture.points, padding);
        const annotation = clampToPage({
          editorId: createEditorId(),
          pageIndex: gesture.pageIndex,
          annotationType: AnnotationType.INK,
          position: gesture.points[0],
          bounds,
          style: gesture.style,
          content: { paths: [gesture.points] },
        }, this.getPageInfo(gesture.pageIndex));
        this.store.commitAdd(annotation, CommandOperation.ADD_ANNOTATION);
        this.setSelected(annotation.editorId);
      }
      return;
    }
    const current = this.store.get(gesture.original.editorId);
    this.store.clearPreview(gesture.original.editorId);
    if (current && JSON.stringify(current) !== JSON.stringify(gesture.original)) {
      const operation = gesture.type === "resize"
        ? (gesture.original.annotationType === AnnotationType.SIGNATURE ? CommandOperation.RESIZE_SIGNATURE : CommandOperation.RESIZE_ANNOTATION)
        : (gesture.original.annotationType === AnnotationType.SIGNATURE ? CommandOperation.MOVE_SIGNATURE : CommandOperation.MOVE_ANNOTATION);
      this.store.commitUpdate(gesture.original, current, operation);
    }
  }

  #cancelGesture(event) {
    if (!this.gesture || event.pointerId !== this.gesture.pointerId) return;
    if (this.gesture.type === "draw") this.overlay.clearTransient();
    if (this.gesture.type !== "draw") this.store.clearPreview(this.gesture.original.editorId);
    if (this.pagesElement.hasPointerCapture?.(event.pointerId)) {
      try { this.pagesElement.releasePointerCapture(event.pointerId); } catch { /* synthetic test events may not be capturable */ }
    }
    this.gesture = null;
  }

  #startDrawing(event, pageIndex, pageElement) {
    const point = this.#pointFromEvent(event, pageElement);
    const style = this.#styleForTool();
    this.gesture = { type: "draw", pointerId: event.pointerId, pageIndex, pageElement, points: [point], style };
    try { this.pagesElement.setPointerCapture(event.pointerId); } catch { /* retain event delegation fallback */ }
    this.overlay.setTransient({ pageIndex, points: [point], style });
  }

  #startDrag(event, pageIndex, pageElement, annotation) {
    this.gesture = { type: "drag", pointerId: event.pointerId, pageIndex, pageElement, original: cloneAnnotation(annotation), startPoint: this.#pointFromEvent(event, pageElement) };
    try { this.pagesElement.setPointerCapture(event.pointerId); } catch { /* retain event delegation fallback */ }
  }

  #startResize(event, pageIndex, pageElement, annotation) {
    this.gesture = { type: "resize", pointerId: event.pointerId, pageIndex, pageElement, original: cloneAnnotation(annotation) };
    try { this.pagesElement.setPointerCapture(event.pointerId); } catch { /* retain event delegation fallback */ }
  }

  #pointFromEvent(event, pageElement) {
    const stage = pageElement.querySelector(".page-stage");
    const rect = stage.getBoundingClientRect();
    return this.viewer.cssToPdfPoint(Number(pageElement.dataset.pageIndex), { x: event.clientX - rect.left, y: event.clientY - rect.top });
  }

  #styleForTool() {
    if (this.tool === Tool.PEN) return this.controls.penStyle();
    if (this.tool === Tool.HIGHLIGHT) return this.controls.highlightStyle();
    return this.controls.textStyle();
  }

  #startTextDraft(pageIndex, point, existing = null) {
    if (!point) return;
    const state = this.viewer.getPageState(pageIndex);
    if (!state?.viewport) return;
    const source = existing ? cloneAnnotation(existing) : null;
    const cropBox = this.getPageInfo(pageIndex)?.cropBox;
    const defaultWidth = Math.min(180, Math.max(MIN_TEXT_WIDTH, (cropBox?.right ?? point.x + 180) - (cropBox?.left ?? point.x) - 8));
    const defaultHeight = Math.min(54, Math.max(MIN_TEXT_HEIGHT, (cropBox?.top ?? point.y + 54) - (cropBox?.bottom ?? point.y) - 8));
    const bounds = source?.bounds ?? makeBounds(point.x, point.y - defaultHeight + 12, point.x + defaultWidth, point.y + 12);
    const annotation = source ?? {
      editorId: createEditorId(),
      pageIndex,
      annotationType: AnnotationType.TEXT,
      position: { x: bounds.left, y: bounds.top },
      bounds,
      style: this.controls.textStyle(),
      content: { text: "" },
    };
    const input = document.createElement("textarea");
    input.className = "annotation-text-draft";
    input.value = annotation.content.text;
    input.setAttribute("aria-label", "Annotation text");
    Object.assign(input.style, cssRectStyle(pdfBoundsToCssRect(state.viewport, bounds)));
    input.style.fontSize = `${annotation.style.fontSize * state.viewport.scale}px`;
    input.style.color = hexFromColor(annotation.style.color);
    state.editorLayer.append(input);
    input.focus();
    input.select();
    this.textDraft = { input, pageIndex, annotation };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.#finishTextDraft(false);
      } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        this.#finishTextDraft(true);
      }
    });
    input.addEventListener("blur", () => setTimeout(() => this.#finishTextDraft(true), 0));
  }

  #finishTextDraft(commit) {
    const draft = this.textDraft;
    if (!draft) return;
    this.textDraft = null;
    draft.input.remove();
    if (!commit) return;
    const text = draft.input.value.trim();
    if (!text) return;
    const annotation = cloneAnnotation(draft.annotation);
    annotation.content.text = text;
    annotation.style = this.controls.textStyle(annotation.style);
    annotation.bounds = clampBounds(annotation.bounds, this.getPageInfo(annotation.pageIndex));
    annotation.position = { x: annotation.bounds.left, y: annotation.bounds.top };
    if (this.store.get(annotation.editorId)) {
      this.store.commitUpdate(draft.annotation, annotation, CommandOperation.EDIT_TEXT);
    } else {
      this.store.commitAdd(annotation, CommandOperation.ADD_ANNOTATION);
    }
    this.setSelected(annotation.editorId);
  }

  async #createHighlightFromSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    const grouped = new Map();
    for (const clientRect of range.getClientRects()) {
      if (clientRect.width < 1 || clientRect.height < 1) continue;
      const pageState = this.viewer.getRenderedPageStates().find(({ state }) => {
        const pageRect = state.stage.getBoundingClientRect();
        return clientRect.left < pageRect.right && clientRect.right > pageRect.left && clientRect.top < pageRect.bottom && clientRect.bottom > pageRect.top;
      });
      if (!pageState) continue;
      const stageRect = pageState.stage.getBoundingClientRect();
      const left = Math.max(clientRect.left, stageRect.left);
      const right = Math.min(clientRect.right, stageRect.right);
      const top = Math.max(clientRect.top, stageRect.top);
      const bottom = Math.min(clientRect.bottom, stageRect.bottom);
      const cssRect = { x: left - stageRect.left, y: top - stageRect.top, width: right - left, height: bottom - top };
      const points = [
        this.viewer.cssToPdfPoint(pageState.index, { x: cssRect.x, y: cssRect.y }),
        this.viewer.cssToPdfPoint(pageState.index, { x: cssRect.x + cssRect.width, y: cssRect.y }),
        this.viewer.cssToPdfPoint(pageState.index, { x: cssRect.x, y: cssRect.y + cssRect.height }),
        this.viewer.cssToPdfPoint(pageState.index, { x: cssRect.x + cssRect.width, y: cssRect.y + cssRect.height }),
      ];
      const quad = { topLeft: points[0], topRight: points[1], bottomLeft: points[2], bottomRight: points[3] };
      if (!grouped.has(pageState.index)) grouped.set(pageState.index, []);
      grouped.get(pageState.index).push(quad);
    }
    for (const [pageIndex, quads] of grouped) {
      const allPoints = quads.flatMap((quad) => Object.values(quad));
      const annotation = clampToPage({
        editorId: createEditorId(),
        pageIndex,
        annotationType: AnnotationType.HIGHLIGHT,
        position: quads[0].bottomLeft,
        bounds: pointBounds(allPoints),
        style: this.controls.highlightStyle(),
        content: { quads },
      }, this.getPageInfo(pageIndex));
      this.store.commitAdd(annotation, CommandOperation.ADD_ANNOTATION);
      this.setSelected(annotation.editorId);
    }
    selection.removeAllRanges();
  }

  #keyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      this.#finishTextDraft(false);
      this.#cancelGesture({ pointerId: this.gesture?.pointerId });
      return;
    }
    if (isEditableTarget(event.target)) return;
    const annotationTarget = event.target.closest?.("[data-editor-id]");
    if (annotationTarget && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      this.setSelected(annotationTarget.dataset.editorId);
      if (event.key === "Enter" && this.store.get(annotationTarget.dataset.editorId)?.annotationType === AnnotationType.TEXT) {
        this.editSelected();
      }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      void (event.shiftKey ? this.redo() : this.undo());
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      void this.redo();
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      void this.deleteSelected();
      return;
    }
    const shortcuts = { v: Tool.SELECT, t: Tool.TEXT, p: Tool.PEN, h: Tool.HIGHLIGHT, e: Tool.ERASER };
    const tool = shortcuts[event.key.toLowerCase()];
    if (tool) {
      event.preventDefault();
      this.setTool(tool);
    }
  }

  #persistCommand(command, restoreCommand = null) {
    const operation = this.commandQueue.then(async () => {
      this.commandError = null;
      if (!this.documentHandle) throw new Error("No Rust document is open.");
      if (command.type === "add") {
        this.#addToRust(command.annotation);
      } else if (command.type === "remove") {
        this.documentHandle.removeAnnotation(command.annotation.editorId);
      } else if (command.type === "update") {
        let removed = false;
        try {
          this.documentHandle.removeAnnotation(command.before.editorId);
          removed = true;
          this.#addToRust(command.after);
        } catch (error) {
          if (removed) {
            try {
              this.#addToRust(command.before);
            } catch {
              this.onStatus("Annotation rollback failed; reload the document before continuing.", "error");
            }
          }
          throw error;
        }
      }
    });
    this.commandQueue = operation.catch((error) => {
      this.commandError = error;
      if (restoreCommand) {
        this.store.restoreCommand(restoreCommand);
        if (restoreCommand.type === "add") {
          this.setSelected(restoreCommand.annotation.editorId);
        } else if (restoreCommand.type === "update") {
          this.setSelected(restoreCommand.after.editorId);
        } else if (this.selectedId === restoreCommand.annotation.editorId) {
          this.setSelected(null);
        }
      }
      this.onStatus(`Annotation operation failed: ${error instanceof Error ? error.message : String(error)}`, "error");
    });
    return operation;
  }

  persistCommand(command) {
    return this.#persistCommand(command, invertCommandForRestore(command));
  }

  #addToRust(annotation) {
    if (annotation.annotationType === AnnotationType.TEXT) this.documentHandle.addTextAnnotation(annotation);
    else if (annotation.annotationType === AnnotationType.INK) this.documentHandle.addInkAnnotation(annotation);
    else if (annotation.annotationType === AnnotationType.SIGNATURE) this.documentHandle.addSignatureAnnotation(annotation);
    else this.documentHandle.addHighlightAnnotation(annotation);
  }
}

function invertCommandForRestore(command) {
  if (command.type === "add") return { type: "remove", annotation: cloneAnnotation(command.annotation) };
  if (command.type === "remove") return { type: "add", annotation: cloneAnnotation(command.annotation) };
  return { type: "update", before: cloneAnnotation(command.after), after: cloneAnnotation(command.before) };
}

function cssRectStyle(rect) {
  return { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` };
}

export { colorFromHex, hexFromColor };
