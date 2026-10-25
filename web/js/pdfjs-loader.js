// PDF.js is vendored as a same-origin native ES module. Keep its API isolated
// here so the rest of the application has no dependency on package layout.
import * as pdfjsLib from "../pdfjs/pdf.mjs";

if (!pdfjsLib?.getDocument) {
  throw new Error("The local PDF.js runtime did not load.");
}

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("../pdfjs/pdf.worker.mjs", import.meta.url).href;

export { pdfjsLib };
