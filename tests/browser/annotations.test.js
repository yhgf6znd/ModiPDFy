import { AnnotationOverlay } from "../../web/js/annotation-overlay.js";
import { AnnotationInteraction } from "../../web/js/annotation-interaction.js";
import { AnnotationStore, Tool } from "../../web/js/annotation-model.js";
import { PdfViewer } from "../../web/js/pdf-viewer.js";
import { openPdfDocument } from "../../web/js/wasm-bridge.js";
import { exportPdfBytes, suggestedFilename } from "../../web/js/pdf-export.js";
import { SignaturePad } from "../../web/js/signature-pad.js";
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
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId, pointerType, isPrimary: true, button: 0 }));
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
  const signaturePad = new SignaturePad({
    canvas: document.querySelector("#signature-canvas"),
    colorInput: document.querySelector("#signature-color"),
    widthInput: document.querySelector("#signature-width"),
  });
  const signatureCanvas = document.querySelector("#signature-canvas");
  pointer("pointerdown", signatureCanvas, 20, 40, 31, "mouse");
  pointer("pointermove", signatureCanvas, 80, 70, 31, "mouse");
  pointer("pointerup", signatureCanvas, 140, 35, 31, "mouse");
  document.querySelector("#signature-color").value = "#aa2233";
  pointer("pointerdown", signatureCanvas, 170, 80, 32, "touch");
  pointer("pointermove", signatureCanvas, 220, 50, 32, "touch");
  pointer("pointerup", signatureCanvas, 280, 85, 32, "touch");
  pointer("pointerdown", signatureCanvas, 300, 30, 36, "pen");
  pointer("pointermove", signatureCanvas, 340, 65, 36, "pen");
  pointer("pointerup", signatureCanvas, 390, 25, 36, "pen");
  const signature = signaturePad.toSignature();
  assert(signature?.strokes.length === 3 && signature.paths.length === 3, "signature pad did not preserve ordered vector strokes");
  assert(signature.strokes[1].color.red > signature.strokes[0].color.red, "signature stroke color was not captured");
  interaction.beginSignaturePlacement(signature);
  const signaturePoint = stagePoint(stage, 180, 140);
  pointer("pointermove", stage, signaturePoint.x, signaturePoint.y, 33, "mouse");
  assert(document.querySelector(".interaction-preview"), "signature placement preview was not rendered");
  pointer("pointerdown", stage, signaturePoint.x, signaturePoint.y, 33, "mouse");
  await interaction.flush();
  const placedSignature = store.values().find((annotation) => annotation.annotationType === "Signature");
  assert(placedSignature, "signature placement did not create an annotation");
  await waitFor(() => documentHandle.listAnnotations().some((annotation) => annotation.annotationType === "Signature"), "signature was not persisted");
  const originalSignatureBounds = { ...placedSignature.bounds };
  const signaturePath = document.querySelector(`[data-editor-id="${placedSignature.editorId}"]`);
  pointer("pointerdown", signaturePath, signaturePoint.x, signaturePoint.y, 34, "mouse");
  pointer("pointermove", document.querySelector("#pages"), signaturePoint.x + 20, signaturePoint.y + 12, 34, "mouse");
  pointer("pointerup", document.querySelector("#pages"), signaturePoint.x + 20, signaturePoint.y + 12, 34, "mouse");
  await interaction.flush();
  const movedSignature = documentHandle.listAnnotations().find((annotation) => annotation.editorId === placedSignature.editorId);
  assert(movedSignature.bounds.left !== originalSignatureBounds.left, "signature drag did not move the annotation");
  await interaction.undo();
  await interaction.flush();
  assert(documentHandle.listAnnotations().find((annotation) => annotation.editorId === placedSignature.editorId).bounds.left === originalSignatureBounds.left, "undo did not restore signature movement");
  await interaction.redo();
  await interaction.flush();
  assert(documentHandle.listAnnotations().find((annotation) => annotation.editorId === placedSignature.editorId).bounds.left === movedSignature.bounds.left, "redo did not restore signature movement");
  const selectionHandle = document.querySelector(`[data-resize-id="${placedSignature.editorId}"]`);
  const currentSignature = documentHandle.listAnnotations().find((annotation) => annotation.editorId === placedSignature.editorId);
  const ratio = (currentSignature.bounds.right - currentSignature.bounds.left) / (currentSignature.bounds.top - currentSignature.bounds.bottom);
  const handlePoint = stagePoint(stage, 300, 250);
  pointer("pointerdown", selectionHandle, handlePoint.x, handlePoint.y, 35, "mouse");
  pointer("pointermove", document.querySelector("#pages"), handlePoint.x + 60, handlePoint.y + 40, 35, "mouse");
  pointer("pointerup", document.querySelector("#pages"), handlePoint.x + 60, handlePoint.y + 40, 35, "mouse");
  await interaction.flush();
  const resizedSignature = documentHandle.listAnnotations().find((annotation) => annotation.editorId === placedSignature.editorId);
  const resizedRatio = (resizedSignature.bounds.right - resizedSignature.bounds.left) / (resizedSignature.bounds.top - resizedSignature.bounds.bottom);
  assert(Math.abs(resizedRatio - ratio) < 0.05, "signature resize was not proportional");
  await interaction.undo();
  await interaction.flush();
  assert(Math.abs(((documentHandle.listAnnotations().find((annotation) => annotation.editorId === placedSignature.editorId).bounds.right - documentHandle.listAnnotations().find((annotation) => annotation.editorId === placedSignature.editorId).bounds.left) / (documentHandle.listAnnotations().find((annotation) => annotation.editorId === placedSignature.editorId).bounds.top - documentHandle.listAnnotations().find((annotation) => annotation.editorId === placedSignature.editorId).bounds.bottom)) - ratio) < 0.05, "undo did not restore signature resize");
  await interaction.redo();
  await interaction.flush();
  interaction.setSelected(placedSignature.editorId);
  interaction.duplicateSelected();
  await interaction.flush();
  assert(documentHandle.listAnnotations().filter((annotation) => annotation.annotationType === "Signature").length === 2, "signature duplicate did not persist");
  await interaction.deleteSelected();
  await interaction.flush();
  assert(documentHandle.listAnnotations().filter((annotation) => annotation.annotationType === "Signature").length === 1, "signature delete did not persist");
  await interaction.undo();
  await interaction.flush();
  assert(documentHandle.listAnnotations().filter((annotation) => annotation.annotationType === "Signature").length === 2, "undo did not restore deleted signature");
  await interaction.redo();
  await interaction.flush();
  assert(documentHandle.listAnnotations().filter((annotation) => annotation.annotationType === "Signature").length === 1, "redo did not delete signature again");
  const exported = await exportPdfBytes({ documentHandle, annotations: store.committedValues(), reopen: openPdfDocument });
  assert(suggestedFilename("contract.pdf") === "contract-modified.pdf", "export filename was not derived safely");
  const reopenedSignatureDocument = await openPdfDocument(exported);
  assert(reopenedSignatureDocument.listAnnotations().filter((annotation) => annotation.annotationType === "Signature").length === 1, "exported signatures did not reopen");
  reopenedSignatureDocument.dispose();
  interaction.setSelected(placedSignature.editorId);
  document.querySelector("#viewer").dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
  await interaction.flush();
  assert(documentHandle.listAnnotations().filter((annotation) => annotation.annotationType === "Signature").length === 0, "Delete shortcut did not remove signature");
  document.querySelector("#viewer").dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
  await interaction.flush();
  assert(documentHandle.listAnnotations().filter((annotation) => annotation.annotationType === "Signature").length === 1, "Ctrl+Z did not restore signature");
  document.querySelector("#viewer").dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, shiftKey: true, bubbles: true }));
  await interaction.flush();
  assert(documentHandle.listAnnotations().filter((annotation) => annotation.annotationType === "Signature").length === 0, "Ctrl+Shift+Z did not redo signature deletion");
  document.querySelector("#viewer").dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
  await interaction.flush();
  document.querySelector("#viewer").dispatchEvent(new KeyboardEvent("keydown", { key: "y", ctrlKey: true, bubbles: true }));
  await interaction.flush();
  assert(documentHandle.listAnnotations().filter((annotation) => annotation.annotationType === "Signature").length === 0, "Ctrl+Y did not redo signature deletion");
  const historyBeforePen = store.history.length;
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
  assert(store.history.length === historyBeforePen + 1, "completed pen command was not recorded in history");
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
