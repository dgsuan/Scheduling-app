// Text recognition in images is web-only for now; see ocr.web.ts.

export function ocrAvailable(): boolean {
  return false;
}

export async function recognizeText(_imageUri: string): Promise<string> {
  throw new Error("Text recognition isn't available in this version of the app.");
}

export async function stopOcr(): Promise<void> {}
