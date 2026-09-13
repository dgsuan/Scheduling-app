// Images on the web must be stored as data URLs: the picker hands back a
// `blob:` URL, which dies when the page reloads (earlier builds stored
// those, so such images can't be recovered). Photos are downscaled so a
// few of them fit comfortably in localStorage's ~5 MB.

export const MAX_IMAGE_DIMENSION = 1600;
const JPEG_QUALITY = 0.85;
/** PNGs larger than this (as data URL chars) are re-encoded as JPEG. */
const PNG_BUDGET = 1_500_000;

export type StoredImage = { uri: string; width: number; height: number };

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't read that image."));
    img.src = src;
  });
}

export function isEphemeralUri(uri: string): boolean {
  return uri.startsWith("blob:");
}

/** Encode a canvas, preferring PNG for small/transparent images. */
export function canvasToDataUrl(canvas: HTMLCanvasElement, preferPng: boolean): string {
  if (preferPng) {
    const png = canvas.toDataURL("image/png");
    if (png.length <= PNG_BUDGET) return png;
  }
  // JPEG has no alpha: flatten onto white first.
  const flat = document.createElement("canvas");
  flat.width = canvas.width;
  flat.height = canvas.height;
  const ctx = flat.getContext("2d")!;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, flat.width, flat.height);
  ctx.drawImage(canvas, 0, 0);
  return flat.toDataURL("image/jpeg", JPEG_QUALITY);
}

export async function pickedImageToStored(asset: {
  uri: string;
  mimeType?: string | null;
}): Promise<StoredImage> {
  const img = await loadImage(asset.uri);
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);
  const uri = canvasToDataUrl(canvas, asset.mimeType === "image/png" || asset.mimeType === "image/gif");
  if (isEphemeralUri(asset.uri)) URL.revokeObjectURL(asset.uri);
  return { uri, width, height };
}
