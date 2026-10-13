import { PdfViewer } from "../../web/js/pdf-viewer.js";
import { createMultipagePdfFixture } from "./pdf-fixture.js";

const result = document.querySelector("#result");
const viewer = new PdfViewer({
  viewportElement: document.querySelector("#viewer"),
  pagesElement: document.querySelector("#pages"),
});

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function run() {
  await viewer.openBytes(createMultipagePdfFixture(4), { name: "viewer-fixture.pdf" });
  assert(viewer.pageCount === 4, "expected four pages");
  assert(document.querySelectorAll(".pdf-page").length === 4, "expected four page shells");
  await viewer.goToPage(3, { smooth: false });
  assert(viewer.pageNumber === 3, "page navigation did not update current page");
  await viewer.setZoom(1.5);
  assert(viewer.zoomPercent === 150, "zoom did not update");
  await viewer.fitWidth();
  assert(viewer.zoomPercent > 0, "fit width produced an invalid zoom");
  assert(document.querySelectorAll(".textLayer").length === 4, "text layers are missing");
  assert(document.querySelectorAll(".annotationLayer").length === 4, "annotation layers are missing");
  await viewer.close();
  assert(viewer.pageCount === 0, "close did not release the document");
  result.dataset.status = "pass";
  result.textContent = "PDF.js viewer integration tests passed.";
}

try {
  await run();
} catch (error) {
  result.dataset.status = "fail";
  result.textContent = error instanceof Error ? error.message : String(error);
  throw error;
}
