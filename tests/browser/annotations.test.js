import { AnnotationOverlay } from "../../web/js/annotation-overlay.js";
import { AnnotationInteraction } from "../../web/js/annotation-interaction.js";
import { AnnotationStore, Tool } from "../../web/js/annotation-model.js";
import { PdfViewer } from "../../web/js/pdf-viewer.js";
import { openPdfDocument } from "../../web/js/wasm-bridge.js";
import { createPdfFixture } from "./pdf-fixture.js";

const result = document.querySelector("#result");
const viewer = new PdfViewer({
  viewportElement: document.querySelector("#viewer"),
  pagesElement: document.querySelector("#pages"),
});
const store = new AnnotationStore();
const overlay = new AnnotationOverlay({ viewer, store });
const style = { color: { red: 0.1, green: 0.3, blue: 0.7 }, opacity: 1, strokeWidth: 3, fontSize: 14 };
const controls = {
  textStyle: () => style,
  penStyle: () => style,
  highlightStyle: () => ({ ...style, opacity: 0.35 }),
};
const interaction = new AnnotationInteraction({
  viewer,
  pagesElement: document.querySelector("#pages"),
  viewportElement: document.querySelector("#viewer"),
  store,
  overlay,
  controls,
  getPageInfo: () => ({ cropBox: { left: 0, bottom: 0, right: 612, top: 792 } }),
});
store.onChange = () => overlay.renderAll();
store.onCommand = (command) => void interaction.persistCommand(command);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitFor(predicate, message, timeout = 1000) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(message);
}

function pointer(type, target, x, y, pointerId = 1) {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId, pointerType: "pen", button: 0 }));
}

function stagePoint(stage, x, y) {
  const rect = stage.getBoundingClientRect();
  return { x: rect.left + x, y: rect.top + y };
}

async function run() {
  const source = createPdfFixture();
  const documentHandle = await openPdfDocument(source);
  interaction.setDocument(documentHandle);
  await viewer.openBytes(source);
  await new Promise((resolve) => setTimeout(resolve, 80));
  const page = document.querySelector(".pdf-page");
  const stage = page.querySelector(".page-stage");
  interaction.setTool(Tool.PEN);
  const penStart = stagePoint(stage, 120, 120);
  const penMiddle = stagePoint(stage, 150, 145);
  const penEnd = stagePoint(stage, 180, 130);
  pointer("pointerdown", stage, penStart.x, penStart.y, 11);
  pointer("pointermove", stage, penMiddle.x, penMiddle.y, 11);
  pointer("pointerup", stage, penEnd.x, penEnd.y, 11);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert(store.values().some((annotation) => annotation.annotationType === "Ink"), "pen gesture did not create ink");
  await waitFor(() => documentHandle.listAnnotations().some((annotation) => annotation.annotationType === "Ink"), "pen annotation was not persisted");
  const ink = store.values()[0];
  const beforeZoom = documentHandle.listAnnotations()[0].bounds;

  interaction.setTool(Tool.TEXT);
  const textPoint = stagePoint(stage, 220, 180);
  pointer("pointerdown", stage, textPoint.x, textPoint.y, 12);
  pointer("pointerup", stage, textPoint.x, textPoint.y, 12);
  const draft = document.querySelector(".annotation-text-draft");
  assert(draft, "text tool did not create an editor");
  draft.value = "Browser text";
  draft.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert(store.values().some((annotation) => annotation.annotationType === "Text"), "text tool did not commit");
  await waitFor(() => documentHandle.listAnnotations().some((annotation) => annotation.annotationType === "Text"), "text annotation was not persisted");

  const text = store.values().find((annotation) => annotation.annotationType === "Text");
  interaction.setTool(Tool.SELECT);
  const textElement = document.querySelector(`[data-editor-id="${text.editorId}"]`);
  pointer("pointerdown", textElement, textPoint.x, textPoint.y, 13);
  const movedTextPoint = stagePoint(stage, 240, 200);
  pointer("pointermove", document.querySelector("#pages"), movedTextPoint.x, movedTextPoint.y, 13);
  pointer("pointerup", document.querySelector("#pages"), movedTextPoint.x, movedTextPoint.y, 13);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert(documentHandle.listAnnotations().some((annotation) => annotation.editorId === text.editorId), "selected text was not retained");

  await waitFor(() => Boolean(document.querySelector(".text-layer span")), "PDF text layer did not render");
  const textSpan = document.querySelector(".text-layer span");
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(textSpan);
  selection.removeAllRanges();
  selection.addRange(range);
  interaction.setTool(Tool.HIGHLIGHT);
  const highlightRect = textSpan.getBoundingClientRect();
  pointer("pointerup", textSpan, highlightRect.left + 2, highlightRect.top + 2, 14);
  await waitFor(() => store.values().some((annotation) => annotation.annotationType === "Highlight"), "highlight tool did not create an annotation");
  await waitFor(() => documentHandle.listAnnotations().some((annotation) => annotation.annotationType === "Highlight"), "highlight annotation was not persisted");

  await viewer.setZoom(1.5);
  const afterZoom = documentHandle.listAnnotations().find((annotation) => annotation.editorId === ink.editorId).bounds;
  assert(JSON.stringify(beforeZoom) === JSON.stringify(afterZoom), "PDF coordinates changed during zoom");
  interaction.setSelected(text.editorId);
  await interaction.deleteSelected();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert(!documentHandle.listAnnotations().some((annotation) => annotation.editorId === text.editorId), "delete did not reach Rust");
  documentHandle.dispose();
  result.dataset.status = "pass";
  result.textContent = "Annotation interaction tests passed.";
}

try {
  await run();
} catch (error) {
  result.dataset.status = "fail";
  result.textContent = error instanceof Error ? error.message : String(error);
  throw error;
}
