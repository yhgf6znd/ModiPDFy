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
store.onCommand = (command) => interaction.persistCommand(command);

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

function pointer(type, target, x, y, pointerId = 1, pointerType = "pen") {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId, pointerType, button: 0 }));
}

function stagePoint(stage, x, y) {
  const rect = stage.getBoundingClientRect();
  return { x: rect.left + x, y: rect.top + y };
}

async function run() {
  const source = createPdfFixture({ rotations: [90] });
  const documentHandle = await openPdfDocument(source);
  interaction.setDocument(documentHandle);
  await viewer.openBytes(source);
  await new Promise((resolve) => setTimeout(resolve, 80));
  const page = document.querySelector(".pdf-page");
  const stage = page.querySelector(".page-stage");
  interaction.setTool(Tool.PEN);
  const penStart = stagePoint(stage, 2, 2);
  const penMiddle = stagePoint(stage, 15, 8);
  const penEnd = stagePoint(stage, 28, 4);
  pointer("pointerdown", stage, penStart.x, penStart.y, 11, "pen");
  pointer("pointermove", stage, penMiddle.x, penMiddle.y, 11, "pen");
  pointer("pointerup", stage, penEnd.x, penEnd.y, 11, "pen");
  await interaction.flush();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert(store.values().some((annotation) => annotation.annotationType === "Ink"), "pen gesture did not create ink");
  await waitFor(() => documentHandle.listAnnotations().some((annotation) => annotation.annotationType === "Ink"), "pen annotation was not persisted");
  assert(store.history.length === 1, "completed pen command was not recorded in history");
  const ink = store.values()[0];
  const inkPdf = documentHandle.listAnnotations().find((annotation) => annotation.annotationType === "Ink");
  const cropBox = documentHandle.pageInfo(0).cropBox;
  assert(inkPdf.content.paths.flat().every((point) => point.x >= cropBox.left && point.x <= cropBox.right && point.y >= cropBox.bottom && point.y <= cropBox.top), "edge ink points escaped the page crop box");
  interaction.setTool(Tool.PEN);
  const touchStart = stagePoint(stage, 40, 40);
  const touchMiddle = stagePoint(stage, 55, 52);
  const touchEnd = stagePoint(stage, 70, 44);
  pointer("pointerdown", stage, touchStart.x, touchStart.y, 16, "touch");
  pointer("pointermove", stage, touchMiddle.x, touchMiddle.y, 16, "touch");
  pointer("pointerup", stage, touchEnd.x, touchEnd.y, 16, "touch");
  await interaction.flush();
  assert(documentHandle.listAnnotations().filter((annotation) => annotation.annotationType === "Ink").length === 2, "touch gesture did not create ink");

  const beforeZoom = documentHandle.listAnnotations()[0].bounds;
  const mouseStart = stagePoint(stage, 90, 90);
  const mouseMiddle = stagePoint(stage, 105, 102);
  const mouseEnd = stagePoint(stage, 120, 94);
  pointer("pointerdown", stage, mouseStart.x, mouseStart.y, 17, "mouse");
  pointer("pointermove", stage, mouseMiddle.x, mouseMiddle.y, 17, "mouse");
  pointer("pointerup", stage, mouseEnd.x, mouseEnd.y, 17, "mouse");
  await interaction.flush();
  assert(documentHandle.listAnnotations().filter((annotation) => annotation.annotationType === "Ink").length === 3, "mouse gesture did not create ink");


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
  await interaction.flush();
  await waitFor(() => documentHandle.listAnnotations().some((annotation) => annotation.annotationType === "Text"), "text annotation was not persisted");

  interaction.setTool(Tool.TEXT);
  const edgeTextPoint = stagePoint(stage, 300, 5);
  pointer("pointerdown", stage, edgeTextPoint.x, edgeTextPoint.y, 15);
  pointer("pointerup", stage, edgeTextPoint.x, edgeTextPoint.y, 15);
  const edgeDraft = document.querySelector(".annotation-text-draft");
  assert(edgeDraft, "top-edge text tool did not create an editor");
  edgeDraft.value = "Top edge text";
  edgeDraft.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
  await interaction.flush();
  const edgeText = documentHandle.listAnnotations().find((annotation) => annotation.content?.text === "Top edge text");
  assert(edgeText && edgeText.position.y <= edgeText.bounds.top && edgeText.position.y >= edgeText.bounds.bottom, "top-edge text position was not clamped into its bounds");

  const text = store.values().find((annotation) => annotation.annotationType === "Text");
  interaction.setTool(Tool.SELECT);
  const textElement = document.querySelector(`[data-editor-id="${text.editorId}"]`);
  textElement.focus();
  textElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert(document.querySelector(".annotation-text-draft"), "focused text annotation did not activate");
  document.querySelector(".annotation-text-draft").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert(!document.querySelector(".annotation-text-draft"), "text editor did not close with Escape");
  const selectedTextElement = document.querySelector(`[data-editor-id="${text.editorId}"]`);
  pointer("pointerdown", selectedTextElement, textPoint.x, textPoint.y, 13);
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
  const viewerElement = document.querySelector("#viewer");
  viewerElement.style.width = "520px";
  await viewer.fitWidth();
  const afterResize = documentHandle.listAnnotations().find((annotation) => annotation.editorId === ink.editorId).bounds;
  assert(JSON.stringify(beforeZoom) === JSON.stringify(afterResize), "PDF coordinates changed during viewer resize");
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
