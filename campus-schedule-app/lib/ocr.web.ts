// On-device text recognition (Tesseract.js), loaded only after "Find text
// inside images" is turned on — the app doesn't carry it otherwise. Images
// never leave the device; the engine and English language data download
// from the CDN the first time.

const SCRIPT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";

type OcrWorker = {
  recognize(image: string): Promise<{ data: { text: string } }>;
  terminate(): Promise<unknown>;
};
type TesseractGlobal = { createWorker(lang: string): Promise<OcrWorker> };

let workerPromise: Promise<OcrWorker> | null = null;

function loadScript(): Promise<void> {
  if ((window as unknown as { Tesseract?: TesseractGlobal }).Tesseract) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      reject(new Error("Couldn't download text recognition. Check your connection."));
    };
    document.head.appendChild(script);
  });
}

export function ocrAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.Worker !== "undefined";
}

async function getWorker(): Promise<OcrWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      await loadScript();
      const tesseract = (window as unknown as { Tesseract?: TesseractGlobal }).Tesseract;
      if (!tesseract) throw new Error("Text recognition didn't load.");
      return tesseract.createWorker("eng");
    })();
  }
  try {
    return await workerPromise;
  } catch (e) {
    workerPromise = null;
    throw e;
  }
}

export async function recognizeText(imageUri: string): Promise<string> {
  const worker = await getWorker();
  const { data } = await worker.recognize(imageUri);
  return data.text ?? "";
}

/** Free the recognition worker (when the feature is turned off). */
export async function stopOcr(): Promise<void> {
  const pending = workerPromise;
  workerPromise = null;
  const worker = await pending?.catch(() => null);
  await worker?.terminate().catch(() => {});
}
