import { contrastRatio, hexToHsl, hslToHex, normalizeHex } from "@/lib/color";
import type { TimeOfDay } from "@/lib/timeOfDay";

// The app's color system. One identity — warm stone neutrals, a deep teal
// primary, ochre for "soon", brick for "late" — whose temperature drifts
// with the time of day. The user's Appearance settings (preset, accent,
// background, font, size, roundness) are layered on top here, so every
// component — Tailwind classes and StyleSheet palettes alike — just reads
// the resulting tokens.

// Theme-independent colors (course labels, sticky notes, holidays).
export const colors = {
  accent: "#28716A",
  danger: "#CF4A3B",

  // Calendar / holiday accents (same in both themes).
  holidayRegular: "#CF4A3B", // regular holidays
  holidaySpecial: "#C98A1B", // special non-working days
  today: "#28716A",

  // Course label palette — user picks one per course. Muted, distinct hues
  // that sit well on both paper and charcoal.
  courseColors: [
    "#2F7D6E",
    "#D0603F",
    "#4E6FC7",
    "#C99A2E",
    "#8A5CB0",
    "#C45A83",
    "#4E8F4A",
    "#5A6475",
  ],

  // Sticky-note papers for the canvas.
  noteColors: ["#FBF0C4", "#DDEFD9", "#DCE8F5", "#F7DEDD", "#E7E0F3", "#F6E4CE"],
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const radius = {
  sm: 8,
  md: 10,
  lg: 14,
};

export type ThemeScheme = "light" | "dark";

export type Palette = {
  scheme: ThemeScheme;
  bg: string;
  surface: string;
  card: string;
  cardBorder: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  danger: string;
  warning: string;
  success: string;
  onAccent: string;
  overlay: string;
  dot: string;
  inputBg: string;
};

// --- Appearance (user settings) --------------------------------------------

export type ThemeMode = "system" | "light" | "dark";
export type PresetId = "campus" | "ink" | "moss" | "plum" | "ember";
export type FontId = "figtree" | "inter" | "atkinson" | "sourceSerif" | "system";
export type RadiusId = "sharp" | "default" | "round";

export type Appearance = {
  preset: PresetId;
  mode: ThemeMode;
  /** Custom primary color (hex), overriding the preset's. */
  accent: string | null;
  /** Custom background (hex). Its lightness decides light vs dark. */
  background: string | null;
  font: FontId;
  serifHeadings: boolean;
  /** Interface size multiplier (web). */
  scale: number;
  radius: RadiusId;
  /** Let the palette drift with the time of day. */
  atmosphere: boolean;
  /** Eka mode. Overrides preset, colors, font and corners. */
  eka: boolean;
};

export const APPEARANCE_KEY = "campus-schedule:appearance:v1";
/** Derived CSS applied by index.html before the bundle loads (not user data). */
export const THEME_SNAPSHOT_KEY = "campus-schedule-cache:theme";

export const DEFAULT_APPEARANCE: Appearance = {
  preset: "campus",
  mode: "system",
  accent: null,
  background: null,
  font: "figtree",
  serifHeadings: true,
  scale: 1,
  radius: "default",
  atmosphere: true,
  eka: false,
};

type HSL = readonly [number, number, number];

export const PRESETS: Record<
  PresetId,
  { label: string; light: HSL; dark: HSL; neutralHueShift: number; neutralSat: number }
> = {
  campus: { label: "Campus", light: [172, 48, 30], dark: [168, 42, 52], neutralHueShift: 0, neutralSat: 1 },
  ink: { label: "Ink", light: [217, 58, 42], dark: [214, 78, 70], neutralHueShift: 185, neutralSat: 0.9 },
  moss: { label: "Moss", light: [100, 30, 32], dark: [95, 32, 60], neutralHueShift: 25, neutralSat: 1.1 },
  plum: { label: "Plum", light: [320, 34, 38], dark: [318, 38, 70], neutralHueShift: -65, neutralSat: 0.8 },
  ember: { label: "Ember", light: [14, 62, 43], dark: [16, 70, 64], neutralHueShift: -10, neutralSat: 1 },
};

export const FONTS: Record<FontId, { label: string; stack: string; google?: string }> = {
  figtree: {
    label: "Figtree",
    stack: '"Figtree", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    google: "Figtree:wght@400..700",
  },
  inter: {
    label: "Inter",
    stack: '"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    google: "Inter:wght@400..700",
  },
  atkinson: {
    label: "Atkinson Hyperlegible",
    stack: '"Atkinson Hyperlegible", ui-sans-serif, system-ui, sans-serif',
    google: "Atkinson+Hyperlegible:wght@400;700",
  },
  sourceSerif: {
    label: "Source Serif",
    stack: '"Source Serif 4", ui-serif, Georgia, "Times New Roman", serif',
    google: "Source+Serif+4:opsz,wght@8..60,400..700",
  },
  system: {
    label: "System",
    stack: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
  },
};

export const DISPLAY_SERIF = {
  stack: '"Fraunces", ui-serif, Georgia, "Times New Roman", serif',
  google: "Fraunces:opsz,wght@9..144,400..650",
};

export const UI_SCALES = [0.9, 1, 1.1, 1.25] as const;

export const RADII: Record<RadiusId, { label: string; value: string }> = {
  sharp: { label: "Sharp", value: "0.25rem" },
  default: { label: "Soft", value: "0.625rem" },
  round: { label: "Round", value: "1rem" },
};

/** Coerce anything (old saves, restored backups) into a valid Appearance. */
export function normalizeAppearance(raw: unknown): Appearance {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(v as T) ? (v as T) : fallback;
  const hex = (v: unknown) => (typeof v === "string" ? normalizeHex(v) : null);
  const scale = typeof a.scale === "number" && (UI_SCALES as readonly number[]).includes(a.scale) ? a.scale : 1;
  return {
    preset: pick(a.preset, Object.keys(PRESETS) as PresetId[], DEFAULT_APPEARANCE.preset),
    mode: pick(a.mode, ["system", "light", "dark"] as const, DEFAULT_APPEARANCE.mode),
    accent: hex(a.accent),
    background: hex(a.background),
    font: pick(a.font, Object.keys(FONTS) as FontId[], DEFAULT_APPEARANCE.font),
    serifHeadings: typeof a.serifHeadings === "boolean" ? a.serifHeadings : DEFAULT_APPEARANCE.serifHeadings,
    scale,
    radius: pick(a.radius, Object.keys(RADII) as RadiusId[], DEFAULT_APPEARANCE.radius),
    atmosphere: typeof a.atmosphere === "boolean" ? a.atmosphere : DEFAULT_APPEARANCE.atmosphere,
    eka: a.eka === true,
  };
}

// --- Eka mode -------------------------------------------------------------

export const EKA_FONTS = {
  sans: { stack: '"Nunito", ui-rounded, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif', google: "Nunito:wght@400..800" },
  display: { stack: '"Fredoka", "Nunito", ui-rounded, ui-sans-serif, system-ui, sans-serif', google: "Fredoka:wght@400..700" },
};
const EKA_RADIUS = "1.25rem";

// --- Tokens --------------------------------------------------------------

type Core = {
  background: HSL;
  foreground: HSL;
  card: HSL;
  popover: HSL;
  primary: HSL;
  primaryForeground: HSL;
  secondary: HSL;
  accent: HSL;
  mutedForeground: HSL;
  border: HSL;
  input: HSL;
  destructive: HSL;
  warning: HSL;
  success: HSL;
  dot: HSL;
  /** Soft tint washed down from the top of the window. */
  wash: HSL;
  washOpacity: number;
};

const BASE: Record<ThemeScheme, Core> = {
  light: {
    background: [40, 12, 97.5],
    foreground: [30, 12, 12],
    card: [40, 25, 99],
    popover: [40, 25, 99],
    primary: [172, 48, 30],
    primaryForeground: [40, 30, 98],
    secondary: [38, 16, 93],
    accent: [38, 18, 91],
    mutedForeground: [30, 7, 42],
    border: [36, 14, 87],
    input: [36, 14, 85],
    destructive: [6, 64, 50],
    warning: [34, 88, 40],
    success: [150, 40, 34],
    dot: [36, 12, 80],
    wash: [200, 45, 90],
    washOpacity: 0.25,
  },
  dark: {
    background: [30, 6, 9],
    foreground: [40, 14, 92],
    card: [30, 5, 12],
    popover: [30, 5, 13],
    primary: [168, 42, 52],
    primaryForeground: [170, 40, 10],
    secondary: [30, 5, 15],
    accent: [30, 5, 17],
    mutedForeground: [35, 6, 60],
    border: [30, 5, 19],
    input: [30, 5, 21],
    destructive: [6, 68, 60],
    warning: [38, 80, 58],
    success: [150, 38, 52],
    dot: [30, 5, 22],
    wash: [200, 40, 30],
    washOpacity: 0.18,
  },
};

// How each period nudges the base. Afternoon is the neutral baseline.
const SHIFTS: Record<ThemeScheme, Record<TimeOfDay, Partial<Core>>> = {
  light: {
    earlyMorning: {
      background: [42, 38, 97.5],
      secondary: [40, 28, 93],
      accent: [40, 28, 90],
      wash: [30, 95, 85],
      washOpacity: 0.55,
    },
    morning: {
      background: [44, 30, 97.8],
      secondary: [42, 22, 93],
      wash: [45, 90, 86],
      washOpacity: 0.4,
    },
    afternoon: {},
    evening: {
      background: [34, 26, 95],
      card: [36, 30, 98],
      popover: [36, 30, 98],
      secondary: [32, 20, 91],
      accent: [32, 20, 88.5],
      foreground: [26, 14, 15],
      border: [32, 16, 85],
      wash: [18, 85, 84],
      washOpacity: 0.45,
    },
    // Light scheme at night: dim paper, never harsh white.
    night: {
      background: [32, 16, 90],
      card: [34, 20, 93.5],
      popover: [34, 20, 94],
      secondary: [32, 14, 86],
      accent: [32, 14, 83.5],
      foreground: [28, 12, 20],
      mutedForeground: [28, 8, 38],
      border: [30, 12, 80],
      input: [30, 12, 78],
      dot: [30, 10, 74],
      wash: [235, 30, 78],
      washOpacity: 0.35,
    },
  },
  dark: {
    earlyMorning: {
      background: [215, 14, 10],
      card: [215, 12, 13],
      popover: [215, 12, 14],
      secondary: [215, 11, 16],
      accent: [215, 11, 18],
      border: [215, 10, 20],
      input: [215, 10, 22],
      wash: [26, 70, 35],
      washOpacity: 0.28,
    },
    morning: {
      background: [215, 12, 10],
      card: [215, 10, 13],
      popover: [215, 10, 14],
      secondary: [215, 9, 16],
      accent: [215, 9, 18],
      border: [215, 8, 20],
      wash: [40, 60, 35],
      washOpacity: 0.2,
    },
    afternoon: {},
    evening: {
      background: [24, 12, 9],
      card: [24, 10, 12],
      popover: [24, 10, 13],
      secondary: [24, 9, 15],
      accent: [24, 9, 17],
      border: [24, 9, 19],
      foreground: [36, 20, 90],
      wash: [16, 70, 30],
      washOpacity: 0.3,
    },
    // Deep and low-contrast for long late-night sessions.
    night: {
      background: [228, 18, 7.5],
      card: [228, 15, 10.5],
      popover: [228, 15, 12],
      secondary: [228, 13, 13.5],
      accent: [228, 12, 16],
      border: [228, 11, 17],
      input: [228, 11, 19],
      foreground: [40, 12, 82],
      mutedForeground: [228, 6, 54],
      dot: [228, 10, 18],
      wash: [238, 45, 26],
      washOpacity: 0.35,
    },
  },
};

const EKA: Record<ThemeScheme, Partial<Core>> = {
  light: {
    background: [340, 60, 97],
    foreground: [335, 32, 17],
    card: [340, 80, 99],
    popover: [340, 80, 99],
    secondary: [340, 55, 93],
    accent: [338, 55, 90],
    mutedForeground: [335, 20, 40],
    border: [338, 45, 86],
    input: [338, 45, 84],
    dot: [338, 40, 80],
  },
  dark: {
    background: [330, 22, 10],
    foreground: [335, 40, 93],
    card: [330, 22, 13],
    popover: [330, 22, 14],
    secondary: [330, 20, 17],
    accent: [330, 20, 20],
    mutedForeground: [335, 16, 67],
    border: [330, 18, 23],
    input: [330, 18, 25],
    dot: [330, 16, 26],
  },
};
const EKA_PRIMARY: Record<ThemeScheme, HSL> = { light: [330, 68, 46], dark: [330, 85, 74] };
// The sky still changes with the day: peach at dawn, pink by day, lavender at night.
const EKA_WASH: Record<ThemeScheme, Record<TimeOfDay, Pick<Core, "wash" | "washOpacity">>> = {
  light: {
    earlyMorning: { wash: [20, 95, 84], washOpacity: 0.55 },
    morning: { wash: [345, 90, 86], washOpacity: 0.5 },
    afternoon: { wash: [335, 85, 85], washOpacity: 0.5 },
    evening: { wash: [300, 70, 85], washOpacity: 0.5 },
    night: { wash: [270, 55, 82], washOpacity: 0.45 },
  },
  dark: {
    earlyMorning: { wash: [15, 70, 35], washOpacity: 0.3 },
    morning: { wash: [335, 60, 35], washOpacity: 0.3 },
    afternoon: { wash: [330, 60, 35], washOpacity: 0.3 },
    evening: { wash: [300, 50, 32], washOpacity: 0.32 },
    night: { wash: [275, 50, 28], washOpacity: 0.35 },
  },
};

const NEUTRAL_KEYS = [
  "background",
  "foreground",
  "card",
  "popover",
  "secondary",
  "accent",
  "mutedForeground",
  "border",
  "input",
  "dot",
] as const;

const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));
const css = ([h, s, l]: HSL) => `${Math.round(h)} ${Math.round(s * 10) / 10}% ${Math.round(l * 10) / 10}%`;
const hex = ([h, s, l]: HSL) => hslToHex(h, clamp(s), clamp(l));

/** Readable text color to sit on top of `bg`. */
function foregroundOn(bg: HSL): HSL {
  const onLight: HSL = [bg[0], 30, 10];
  const onDark: HSL = [40, 30, 98];
  return contrastRatio(hex(bg), hex(onDark)) >= contrastRatio(hex(bg), hex(onLight)) ? onDark : onLight;
}

/** Neutrals built around a user-chosen background color. */
function neutralsFrom([h, s, l]: HSL, dark: boolean): Pick<Core, (typeof NEUTRAL_KEYS)[number]> {
  const sat = Math.min(s, 40);
  const at = (d: number): HSL => [h, sat, clamp(l + d)];
  return dark
    ? {
        background: [h, sat, l],
        card: at(3),
        popover: at(4),
        secondary: at(6),
        accent: at(8),
        border: at(10),
        input: at(12),
        dot: at(13),
        foreground: [h, Math.min(sat, 14), 92],
        mutedForeground: [h, 6, 64],
      }
    : {
        background: [h, sat, l],
        card: at(l > 97 ? 1 : 1.5),
        popover: at(l > 97 ? 1 : 1.5),
        secondary: at(-4.5),
        accent: at(-6.5),
        border: at(-10),
        input: at(-12),
        dot: at(-17),
        foreground: [h, Math.min(sat, 14), 12],
        mutedForeground: [h, 7, 38],
      };
}

export type ContrastIssue = { label: string; ratio: number; min: number };

export type BuiltTheme = {
  /** The scheme actually in effect (a custom background decides it). */
  scheme: ThemeScheme;
  /** CSS custom properties consumed by tailwind.config.js. */
  tokens: Record<string, string>;
  /** Hex palette for StyleSheet-based code. */
  palette: Palette;
  wash: { color: string; opacity: number };
  fontSans: string;
  fontDisplay: string;
  scale: number;
  contrastIssues: ContrastIssue[];
};

export function buildTheme(
  requested: ThemeScheme,
  tod: TimeOfDay,
  appearance: Appearance = DEFAULT_APPEARANCE
): BuiltTheme {
  const period: TimeOfDay = appearance.atmosphere ? tod : "afternoon";
  const preset = PRESETS[appearance.preset];

  const eka = appearance.eka;
  let scheme = requested;
  let c: Core;
  if (eka) {
    c = { ...BASE[scheme], ...EKA[scheme], ...EKA_WASH[scheme][period] };
  } else if (appearance.background) {
    const bg = hexToHsl(appearance.background);
    scheme = bg[2] < 50 ? "dark" : "light";
    const base = { ...BASE[scheme], ...SHIFTS[scheme][period] };
    c = { ...base, ...neutralsFrom(bg, scheme === "dark") };
  } else {
    c = { ...BASE[scheme], ...SHIFTS[scheme][period] };
    if (preset.neutralHueShift || preset.neutralSat !== 1) {
      for (const k of NEUTRAL_KEYS) {
        const [h, s, l] = c[k];
        c[k] = [(h + preset.neutralHueShift + 360) % 360, clamp(s * preset.neutralSat), l];
      }
    }
  }

  let primary: HSL = eka ? EKA_PRIMARY[scheme] : scheme === "dark" ? preset.dark : preset.light;
  // Dim the accent a touch late at night in dark mode, like the rest of the palette.
  if (!eka && scheme === "dark" && period === "night") primary = [primary[0], primary[1] * 0.75, primary[2] - 6];
  if (appearance.accent && !eka) primary = hexToHsl(appearance.accent);
  c.primary = primary;
  c.primaryForeground = foregroundOn(primary);

  const white: HSL = [0, 0, 100];
  const tokens: Record<string, string> = {
    "--background": css(c.background),
    "--foreground": css(c.foreground),
    "--card": css(c.card),
    "--card-foreground": css(c.foreground),
    "--popover": css(c.popover),
    "--popover-foreground": css(c.foreground),
    "--primary": css(c.primary),
    "--primary-foreground": css(c.primaryForeground),
    "--secondary": css(c.secondary),
    "--secondary-foreground": css(c.foreground),
    "--muted": css(c.secondary),
    "--muted-foreground": css(c.mutedForeground),
    "--accent": css(c.accent),
    "--accent-foreground": css(c.foreground),
    "--destructive": css(c.destructive),
    "--destructive-foreground": css(white),
    "--border": css(c.border),
    "--input": css(c.input),
    "--ring": css(c.primary),
    "--warning": css(c.warning),
    "--success": css(c.success),
    "--radius": eka ? EKA_RADIUS : RADII[appearance.radius].value,
  };
  const palette: Palette = {
    scheme,
    bg: hex(c.background),
    surface: hex(c.secondary),
    card: hex(c.card),
    cardBorder: hex(c.border),
    border: hex(c.border),
    text: hex(c.foreground),
    muted: hex(c.mutedForeground),
    accent: hex(c.primary),
    danger: hex(c.destructive),
    warning: hex(c.warning),
    success: hex(c.success),
    onAccent: hex(c.primaryForeground),
    overlay: scheme === "dark" ? "rgba(0,0,0,0.6)" : "rgba(20,16,10,0.35)",
    dot: hex(c.dot),
    inputBg: hex(c.card),
  };

  const font = FONTS[appearance.font];
  return {
    scheme,
    tokens,
    palette,
    wash: { color: hex(c.wash), opacity: c.washOpacity },
    fontSans: eka ? EKA_FONTS.sans.stack : font.stack,
    fontDisplay: eka ? EKA_FONTS.display.stack : appearance.serifHeadings ? DISPLAY_SERIF.stack : font.stack,
    scale: appearance.scale,
    contrastIssues: contrastIssues(palette),
  };
}

/** Pairs that must stay readable, checked against WCAG thresholds. */
export function contrastIssues(p: Palette): ContrastIssue[] {
  const checks: [string, string, string, number][] = [
    ["Text on background", p.text, p.bg, 4.5],
    ["Text on cards", p.text, p.card, 4.5],
    ["Secondary text", p.muted, p.bg, 3],
    ["Accent on background", p.accent, p.bg, 3],
    ["Button text on accent", p.onAccent, p.accent, 4.5],
  ];
  return checks
    .map(([label, a, b, min]) => ({ label, ratio: contrastRatio(a, b), min }))
    .filter((c) => c.ratio < c.min);
}
