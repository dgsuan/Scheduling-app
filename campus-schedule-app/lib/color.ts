// Small color helpers for the course label picker — no dependency, just
// enough to offer an HSL grid + hex entry instead of a fixed 8-swatch list.

export function hslToHex(h: number, s: number, l: number): string {
  const sN = s / 100;
  const lN = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sN * Math.min(lN, 1 - lN);
  const f = (n: number) =>
    lN - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x: number) =>
    Math.round(255 * x)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`.toUpperCase();
}

/** Accepts "#abc" or "#aabbcc" (case-insensitive), returns "#AABBCC" or null. */
export function normalizeHex(value: string): string | null {
  let v = value.trim().toUpperCase();
  if (!v.startsWith("#")) v = `#${v}`;
  if (/^#[0-9A-F]{3}$/.test(v)) {
    return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  }
  if (/^#[0-9A-F]{6}$/.test(v)) return v;
  return null;
}

/** Relative luminance check so we can pick a readable text color on a swatch. */
export function isLight(hex: string): boolean {
  const n = normalizeHex(hex);
  if (!n) return true;
  const r = parseInt(n.slice(1, 3), 16) / 255;
  const g = parseInt(n.slice(3, 5), 16) / 255;
  const b = parseInt(n.slice(5, 7), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 0.6;
}

// 12 hues around the wheel; the picker shows these, then a lightness ramp
// for whichever hue is chosen.
export const HUES = Array.from({ length: 12 }, (_, i) => i * 30);
export const LIGHTNESS_RAMP = [32, 42, 52, 62, 72];
export const HUE_SATURATION = 68;

export function hueSwatch(hue: number): string {
  return hslToHex(hue, HUE_SATURATION, 52);
}
