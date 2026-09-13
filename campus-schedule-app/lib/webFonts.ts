import type { FontId } from "@/constants/theme";

// Native: system fonts (SF / Roboto) — nothing to load. The web build uses
// webFonts.web.ts instead.
export function ensureFonts(_font: FontId, _serifHeadings: boolean) {}
