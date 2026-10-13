// PDF.js 3.x ships a browser UMD bundle. Keep that compatibility detail in one
// ES-module adapter so the rest of the application uses ordinary imports.
import "../pdfjs/pdf.js";

const globalKey = "pdfjs-dist/build/pdf";
const pdfjsLib = globalThis[globalKey];

if (!pdfjsLib) {
  throw new Error("The local PDF.js runtime did not load.");
}

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("../pdfjs/pdf.worker.js", import.meta.url).href;

export { pdfjsLib };
