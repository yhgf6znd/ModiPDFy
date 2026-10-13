import { pdfBoundsToCssRect, pdfToCssPoint } from "./coordinates.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function rgb(color) {
  return `rgb(${Math.round(color.red * 255)} ${Math.round(color.green * 255)} ${Math.round(color.blue * 255)})`;
}

function cssRect(rect) {
  return {
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  };
}

function setRectStyle(element, rect) {
  Object.assign(element.style, cssRect(rect));
}

function annotationClass(annotation) {
  return `editor-annotation editor-${annotation.annotationType.toLowerCase()}`;
}

/** Renders editor-state annotations above PDF.js without painting into its canvas. */
export class AnnotationOverlay {
  constructor({ viewer, store }) {
    this.viewer = viewer;
    this.store = store;
    this.selectedId = null;
    this.tool = "select";
    this.transient = null;
  }

  setTool(tool) {
    this.tool = tool;
    for (const { editorLayer } of this.viewer.getRenderedPageStates()) {
      editorLayer.dataset.tool = tool;
    }
  }

  setSelected(editorId) {
    this.selectedId = editorId;
    this.renderAll();
  }

  setTransient(transient) {
    this.transient = transient;
    this.renderPage(transient.pageIndex);
  }

  clearTransient() {
    const pageIndex = this.transient?.pageIndex;
    this.transient = null;
    if (pageIndex !== undefined) this.renderPage(pageIndex);
  }

  renderAll() {
    for (const { index, ...state } of this.viewer.getRenderedPageStates()) {
      this.renderPage(index, state);
    }
  }

  renderPage(pageIndex, state = this.viewer.getPageState(pageIndex)) {
    if (!state?.viewport || !state.editorLayer) {
      return;
    }
    const { editorLayer, viewport } = state;
    editorLayer.replaceChildren();
    editorLayer.dataset.tool = this.tool;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.classList.add("editor-svg");
    svg.setAttribute("viewBox", `0 0 ${viewport.width} ${viewport.height}`);
    svg.setAttribute("width", String(viewport.width));
    svg.setAttribute("height", String(viewport.height));
    svg.setAttribute("aria-hidden", "true");
    editorLayer.append(svg);
    for (const annotation of this.store.valuesForPage(pageIndex)) {
      this.#renderAnnotation(svg, annotation, viewport);
      if (annotation.editorId === this.selectedId) {
        this.#renderSelection(editorLayer, annotation, viewport);
      }
    }
    if (this.transient?.pageIndex === pageIndex) {
      this.#renderTransient(svg, this.transient, viewport);
    }
  }

  #renderAnnotation(svg, annotation, viewport) {
    if (annotation.annotationType === "Text") {
      const element = document.createElement("div");
      element.className = annotationClass(annotation);
      element.dataset.editorId = annotation.editorId;
      element.textContent = annotation.content.text;
      setRectStyle(element, pdfBoundsToCssRect(viewport, annotation.bounds));
      element.style.color = rgb(annotation.style.color);
      element.style.opacity = String(annotation.style.opacity);
      element.style.fontSize = `${annotation.style.fontSize * viewport.scale}px`;
      element.setAttribute("role", "button");
      element.setAttribute("tabindex", "0");
      element.setAttribute("aria-label", `Text annotation: ${annotation.content.text}`);
      svg.parentElement.append(element);
      return;
    }
    if (annotation.annotationType === "Ink") {
      for (const path of annotation.content.paths) {
        if (path.length < 2) continue;
        const element = document.createElementNS(SVG_NS, "path");
        element.setAttribute("class", annotationClass(annotation));
        element.dataset.editorId = annotation.editorId;
        element.setAttribute("d", this.#pathData(path, viewport));
        element.setAttribute("fill", "none");
        element.setAttribute("stroke", rgb(annotation.style.color));
        element.setAttribute("stroke-width", String(annotation.style.strokeWidth * viewport.scale));
        element.setAttribute("stroke-linecap", "round");
        element.setAttribute("stroke-linejoin", "round");
        element.setAttribute("opacity", String(annotation.style.opacity));
        element.setAttribute("pointer-events", "stroke");
        svg.append(element);
      }
      return;
    }
    for (const quad of annotation.content.quads) {
      const polygon = document.createElementNS(SVG_NS, "polygon");
      polygon.setAttribute("class", annotationClass(annotation));
      polygon.dataset.editorId = annotation.editorId;
      polygon.setAttribute("points", [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft].map((point) => {
        const converted = pdfToCssPoint(viewport, point);
        return `${converted.x},${converted.y}`;
      }).join(" "));
      polygon.setAttribute("fill", rgb(annotation.style.color));
      polygon.setAttribute("fill-opacity", String(annotation.style.opacity));
      polygon.setAttribute("pointer-events", "all");
      svg.append(polygon);
    }
  }

  #renderSelection(editorLayer, annotation, viewport) {
    const selection = document.createElement("div");
    selection.className = "annotation-selection";
    selection.dataset.selectionId = annotation.editorId;
    setRectStyle(selection, pdfBoundsToCssRect(viewport, annotation.bounds));
    selection.setAttribute("aria-label", "Selected annotation");
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "annotation-resize-handle";
    handle.dataset.resizeId = annotation.editorId;
    handle.setAttribute("aria-label", "Resize selected annotation");
    selection.append(handle);
    editorLayer.append(selection);
  }

  #pathData(path, viewport) {
    return path.map((point, index) => {
      const converted = pdfToCssPoint(viewport, point);
      return `${index === 0 ? "M" : "L"} ${converted.x} ${converted.y}`;
    }).join(" ");
  }

  #renderTransient(svg, transient, viewport) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("class", "interaction-preview");
    path.setAttribute("d", this.#pathData(transient.points, viewport));
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", rgb(transient.style.color));
    path.setAttribute("stroke-width", String(transient.style.strokeWidth * viewport.scale));
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("opacity", String(transient.style.opacity));
    path.setAttribute("pointer-events", "none");
    svg.append(path);
  }
}
