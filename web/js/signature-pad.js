import { colorFromHex } from "./annotation-interaction.js";

const MAX_POINTS = 100_000;

/** A browser-only vector signature capture surface. It never receives document bytes. */
export class SignaturePad {
  constructor({ canvas, colorInput, widthInput, onChange = () => {} }) {
    this.canvas = canvas;
    this.colorInput = colorInput;
    this.widthInput = widthInput;
    this.onChange = onChange;
    this.strokes = [];
    this.active = null;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    canvas.style.touchAction = "none";
    this.pointerDown = (event) => this.#pointerDown(event);
    this.pointerMove = (event) => this.#pointerMove(event);
    this.pointerUp = (event) => this.#pointerUp(event);
    this.pointerCancel = (event) => this.#pointerCancel(event);
    canvas.addEventListener("pointerdown", this.pointerDown);
    canvas.addEventListener("pointermove", this.pointerMove);
    canvas.addEventListener("pointerup", this.pointerUp);
    canvas.addEventListener("pointercancel", this.pointerCancel);
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || 420));
    const height = Math.max(1, Math.round(rect.height || 180));
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 3);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.dataset.dpr = String(dpr);
    this.canvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
    this.redraw();
  }

  clear() {
    this.strokes = [];
    this.active = null;
    this.redraw();
    this.onChange();
  }

  dispose() {
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener("pointerdown", this.pointerDown);
    this.canvas.removeEventListener("pointermove", this.pointerMove);
    this.canvas.removeEventListener("pointerup", this.pointerUp);
    this.canvas.removeEventListener("pointercancel", this.pointerCancel);
    this.active = null;
  }

  load(signature) {
    this.strokes = signature.strokes.map((stroke) => ({
      color: { ...stroke.color },
      strokeWidth: stroke.strokeWidth,
      points: stroke.points.map((point) => ({ ...point })),
    }));
    this.redraw();
    this.onChange();
  }

  toSignature() {
    if (!this.strokes.length || this.strokes.some((stroke) => stroke.points.length < 2)) return null;
    const points = this.strokes.flatMap((stroke) => stroke.points);
    const left = Math.min(...points.map((point) => point.x));
    const top = Math.min(...points.map((point) => point.y));
    const right = Math.max(...points.map((point) => point.x));
    const bottom = Math.max(...points.map((point) => point.y));
    const padding = Math.max(4, Number(this.widthInput.value) || 3);
    const width = Math.max(1, right - left + padding * 2);
    const height = Math.max(1, bottom - top + padding * 2);
    const strokes = this.strokes.map((stroke) => ({
      color: { ...stroke.color },
      opacity: 1,
      strokeWidth: stroke.strokeWidth,
      points: stroke.points.map((point) => ({ x: point.x - left + padding, y: point.y - top + padding })),
    }));
    return {
      width,
      height,
      color: { ...strokes[0].color },
      strokeWidth: strokes[0].strokeWidth,
      strokes,
      paths: strokes.map((stroke) => stroke.points),
    };
  }

  redraw() {
    const context = this.canvas.getContext("2d");
    const dpr = Number(this.canvas.dataset.dpr || 1);
    const rect = this.canvas.getBoundingClientRect();
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);
    for (const stroke of this.strokes) this.#drawStroke(context, stroke);
    if (this.active) this.#drawStroke(context, this.active);
  }

  #point(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  #pointerDown(event) {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    this.active = { pointerId: event.pointerId, color: colorFromHex(this.colorInput.value), strokeWidth: Math.max(0.01, Number(this.widthInput.value) || 3), points: [this.#point(event)] };
    try { this.canvas.setPointerCapture(event.pointerId); } catch { /* synthetic test events may not be capturable */ }
    this.redraw();
  }

  #pointerMove(event) {
    if (!this.active || event.pointerId !== this.active.pointerId) return;
    event.preventDefault();
    if (this.active.points.length < MAX_POINTS) this.active.points.push(this.#point(event));
    this.redraw();
  }

  #pointerUp(event) {
    if (!this.active || event.pointerId !== this.active.pointerId) return;
    event.preventDefault();
    this.active.points.push(this.#point(event));
    this.strokes.push(this.active);
    this.active = null;
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    this.redraw();
    this.onChange();
  }

  #pointerCancel(event) {
    if (!this.active || event.pointerId !== this.active.pointerId) return;
    this.active = null;
    this.redraw();
  }

  #drawStroke(context, stroke) {
    if (stroke.points.length < 2) return;
    context.beginPath();
    context.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (const point of stroke.points.slice(1)) context.lineTo(point.x, point.y);
    context.strokeStyle = `rgb(${Math.round(stroke.color.red * 255)} ${Math.round(stroke.color.green * 255)} ${Math.round(stroke.color.blue * 255)})`;
    context.lineWidth = stroke.strokeWidth;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.stroke();
  }
}
