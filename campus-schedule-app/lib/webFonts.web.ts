// Web typography: Figtree for the interface, Fraunces (a soft serif) for a
// few display headings via the `font-display` class. Loaded once at
// startup; if offline, the system stack takes over seamlessly.
//
// React Native Web sets font-family on every Text through class selectors,
// so these rules use `:not(#_f)` to gain ID-level specificity without
// needing !important.

const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Figtree:wght@400..700&family=Fraunces:opsz,wght@9..144,400..650&display=swap";

const RULES = `
body :not(#_f) {
  font-family: "Figtree", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
body .font-display:not(#_f), body .font-display :not(#_f) {
  font-family: "Fraunces", ui-serif, Georgia, "Times New Roman", serif;
  font-optical-sizing: auto;
  letter-spacing: -0.015em;
}
body { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
`;

if (typeof document !== "undefined" && !document.getElementById("app-fonts")) {
  const pre1 = document.createElement("link");
  pre1.rel = "preconnect";
  pre1.href = "https://fonts.googleapis.com";
  const pre2 = document.createElement("link");
  pre2.rel = "preconnect";
  pre2.href = "https://fonts.gstatic.com";
  pre2.crossOrigin = "";
  const sheet = document.createElement("link");
  sheet.id = "app-fonts";
  sheet.rel = "stylesheet";
  sheet.href = FONTS_HREF;
  const style = document.createElement("style");
  style.textContent = RULES;
  document.head.append(pre1, pre2, sheet, style);
}

export {};
