// Reading PDFs is web-only for now; see pdfText.web.ts.

export async function extractPdfText(_data: ArrayBuffer): Promise<string> {
  throw new Error("Reading PDFs isn't available in this version of the app. Copy the table from CRS and paste it instead.");
}
