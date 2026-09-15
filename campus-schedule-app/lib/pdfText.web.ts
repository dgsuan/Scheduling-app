import { textFromPages, type PdfTextItem } from "@/lib/pdfLines";

// Reads the text out of a PDF (e.g. a UP Form 5) in the browser with pdf.js,
// loaded from the CDN only when someone uploads a PDF. The file never leaves
// the device.

const VERSION = "3.11.174";
const BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${VERSION}/build/`;
const MAX_PAGES = 10;

type TextContent = { items: ({ str: string; transform: number[]; width: number; height: number } | { type: string })[] };
type PdfPage = { getTextContent(): Promise<TextContent> };
type PdfDoc = { numPages: number; getPage(n: number): Promise<PdfPage>; destroy(): Promise<void> };
type PdfJs = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(src: { data: Uint8Array; isEvalSupported?: boolean; disableFontFace?: boolean }): { promise: Promise<PdfDoc> };
};

let loading: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  const existing = (window as unknown as { pdfjsLib?: PdfJs }).pdfjsLib;
  if (existing) return Promise.resolve(existing);
  loading ??= new Promise<PdfJs>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${BASE}pdf.min.js`;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onload = () => {
      const lib = (window as unknown as { pdfjsLib?: PdfJs }).pdfjsLib;
      if (!lib) return reject(new Error("The PDF reader didn't load."));
      lib.GlobalWorkerOptions.workerSrc = `${BASE}pdf.worker.min.js`;
      resolve(lib);
    };
    script.onerror = () => {
      script.remove();
      loading = null;
      reject(new Error("Couldn't load the PDF reader. Check your connection."));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export async function extractPdfText(data: ArrayBuffer): Promise<string> {
  const pdfjs = await loadPdfJs();
  let doc: PdfDoc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false, disableFontFace: true }).promise;
  } catch (e) {
    if ((e as { name?: string }).name === "PasswordException") {
      throw new Error("This PDF is password-protected. Open it, copy the table, and paste it instead.");
    }
    throw new Error("Couldn't read that PDF. Try copying the table from CRS and pasting it instead.");
  }
  try {
    const pages: PdfTextItem[][] = [];
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      pages.push(
        content.items.flatMap((item) =>
          "str" in item
            ? [{ str: item.str, x: item.transform[4], y: item.transform[5], width: item.width, height: Math.abs(item.transform[3]) || item.height }]
            : []
        )
      );
    }
    return textFromPages(pages);
  } finally {
    await doc.destroy().catch(() => {});
  }
}
