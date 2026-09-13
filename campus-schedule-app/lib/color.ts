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

/** "#AABBCC" → [h 0–360, s 0–100, l 0–100]. */
export function hexToHsl(hex: string): [number, number, number] {
  const n = normalizeHex(hex) ?? "#000000";
  const r = parseInt(n.slice(1, 3), 16) / 255;
  const g = parseInt(n.slice(3, 5), 16) / 255;
  const b = parseInt(n.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 1000) / 10];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [Math.round(h * 60), Math.round(s * 1000) / 10, Math.round(l * 1000) / 10];
}

/** WCAG relative luminance (0–1). */
export function relativeLuminance(hex: string): number {
  const n = normalizeHex(hex) ?? "#000000";
  const channel = (i: number) => {
    const c = parseInt(n.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG contrast ratio between two colors (1–21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
