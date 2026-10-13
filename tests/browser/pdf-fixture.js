/** Build a tiny valid PDF without filesystem or network access. */
export function createPdfFixture({ pageCount = 1, rotations = [] } = {}) {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new RangeError("pageCount must be a positive integer");
  }
  const pageIds = Array.from({ length: pageCount }, (_, index) => 3 + index);
  const contentIds = Array.from({ length: pageCount }, (_, index) => 3 + pageCount + index);
  const fontId = 3 + pageCount * 2;
  const objects = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`,
    `2 0 obj\n<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>\nendobj\n`,
  ];

  for (let index = 0; index < pageCount; index += 1) {
    const rotation = rotations[index] ?? 0;
    objects.push(`${pageIds[index]} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Rotate ${rotation} /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentIds[index]} 0 R >>\nendobj\n`);
  }
  for (let index = 0; index < pageCount; index += 1) {
    const content = `BT /F1 24 Tf 72 700 Td (ModiPDFy page ${index + 1}) Tj ET\n`;
    objects.push(`${contentIds[index]} 0 obj\n<< /Length ${new TextEncoder().encode(content).byteLength} >>\nstream\n${content}endstream\nendobj\n`);
  }
  objects.push(`${fontId} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`);

  const encoder = new TextEncoder();
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(encoder.encode(pdf).byteLength);
    pdf += object;
  }
  const xrefOffset = encoder.encode(pdf).byteLength;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;
  return encoder.encode(pdf);
}

export function createMultipagePdfFixture(pageCount = 3) {
  return createPdfFixture({ pageCount, rotations: [0, 90, 180, 270] });
}
