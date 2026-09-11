import { hslToHex } from "@/lib/color";
import type { TimeOfDay } from "@/lib/timeOfDay";

// The app's color system. One identity — warm stone neutrals, a deep teal
// primary, ochre for "soon", brick for "late" — whose temperature drifts
// with the time of day. Everything else (Tailwind classes, StyleSheet
// palettes) is derived from buildTheme(), so components never care which
// period it is.

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

// --- Tokens --------------------------------------------------------------

type HSL = readonly [number, number, number];

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
      primary: [168, 32, 46],
      dot: [228, 10, 18],
      wash: [238, 45, 26],
      washOpacity: 0.35,
    },
  },
};

const css = ([h, s, l]: HSL) => `${h} ${s}% ${l}%`;
const hex = ([h, s, l]: HSL) => hslToHex(h, s, l);

export type BuiltTheme = {
  /** CSS custom properties (HSL triplets) consumed by tailwind.config.js. */
  tokens: Record<string, string>;
  /** Hex palette for StyleSheet-based code. */
  palette: Palette;
  wash: { color: string; opacity: number };
};

export function buildTheme(scheme: ThemeScheme, tod: TimeOfDay): BuiltTheme {
  const c: Core = { ...BASE[scheme], ...SHIFTS[scheme][tod] };
  const white: HSL = [0, 0, 100];
  const tokens = {
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
  return { tokens, palette, wash: { color: hex(c.wash), opacity: c.washOpacity } };
}
