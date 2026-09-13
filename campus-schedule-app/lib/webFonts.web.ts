import { DISPLAY_SERIF, FONTS, type FontId } from "@/constants/theme";

// Web typography. The interface font and the display (heading) font are
// CSS variables set by context/theme.tsx from the user's Appearance; this
// module installs the rules that read them and loads only the Google Fonts
// actually in use. Offline, the system stack in each variable takes over.
//
// React Native Web sets font-family on every Text through class selectors,
// so these rules use `:not(#_f)` to gain ID-level specificity without
// needing !important.

const RULES = `
body :not(#_f) {
  font-family: var(--font-sans, ${FONTS.figtree.stack});
}
body .font-display:not(#_f), body .font-display :not(#_f) {
  font-family: var(--font-display, ${DISPLAY_SERIF.stack});
  font-optical-sizing: auto;
  letter-spacing: -0.015em;
}
body { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
`;

const loaded = new Set<string>();

function loadGoogleFamily(family: string) {
  if (loaded.has(family) || typeof document === "undefined") return;
  loaded.add(family);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${family}&display=swap`;
  link.dataset.appFont = family;
  document.head.appendChild(link);
}

if (typeof document !== "undefined" && !document.getElementById("app-font-rules")) {
  for (const origin of ["https://fonts.googleapis.com", "https://fonts.gstatic.com"]) {
    const pre = document.createElement("link");
    pre.rel = "preconnect";
    pre.href = origin;
    if (origin.includes("gstatic")) pre.crossOrigin = "";
    document.head.appendChild(pre);
  }
  const style = document.createElement("style");
  style.id = "app-font-rules";
  style.textContent = RULES;
  document.head.appendChild(style);
}

/** Load the fonts the current Appearance needs (idempotent). */
export function ensureFonts(font: FontId, serifHeadings: boolean) {
  const google = FONTS[font].google;
  if (google) loadGoogleFamily(google);
  if (serifHeadings) loadGoogleFamily(DISPLAY_SERIF.google);
}
