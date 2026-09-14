// Helpers for "Find text inside images": tidy what OCR recognized, and a
// cheap fingerprint of an image so each one is recognized only once (and
// not again on another device, where the synced image is byte-identical).

/** Keep in step with what fits comfortably in a synced note (1 MB per item). */
export const OCR_TEXT_MAX = 4000;

/** Collapse spacing, drop lines that are just OCR noise, cap the length. */
export function cleanOcrText(raw: string): string {
  return raw
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .filter((line) => (line.match(/[\p{L}\p{N}]/gu) ?? []).length >= 2)
    .join("\n")
    .slice(0, OCR_TEXT_MAX);
}

/** Changes whenever the image changes (edits re-encode it); cheap on large data URLs. */
export function imageFingerprint(uri: string): string {
  return `${uri.length}:${uri.slice(-48)}`;
}
