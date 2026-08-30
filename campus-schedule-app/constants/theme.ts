// Shared style tokens. `spacing`/`radius` and the accent/holiday/palette
// colors below are theme-independent. Light/dark surface + text colors
// live in `palettes` and are served through context/theme.tsx (useTheme).

export const colors = {
  accent: "#4F8CFF",
  danger: "#E5484D",

  // Calendar / holiday accents (same in both themes).
  holidayRegular: "#E5484D", // regular holidays (red)
  holidaySpecial: "#F2A20C", // special non-working days (amber)
  today: "#4F8CFF",

  // Course label palette — user picks one per course.
  courseColors: [
    "#4F8CFF",
    "#E5484D",
    "#12A594",
    "#F2A20C",
    "#8E4EC6",
    "#E93D82",
    "#30A46C",
    "#5B5BD6",
  ],

  // Sticky-note palette for the canvas.
  noteColors: ["#FFF7C2", "#D7F5DD", "#DCEBFF", "#FFE0E6", "#EADCFF", "#FFE8CC"],
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
  md: 12,
  lg: 16,
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
  onAccent: string;
  overlay: string;
  dot: string;
  inputBg: string;
};

const LIGHT: Palette = {
  scheme: "light",
  bg: "#FFFFFF",
  surface: "#F4F5F7",
  card: "#FFFFFF",
  cardBorder: "#E2E4E9",
  border: "#E2E4E9",
  text: "#1A1A1A",
  muted: "#6B7280",
  accent: "#4F8CFF",
  danger: "#E5484D",
  onAccent: "#FFFFFF",
  overlay: "rgba(0,0,0,0.35)",
  dot: "#D3D6DD",
  inputBg: "#FFFFFF",
};

const DARK: Palette = {
  scheme: "dark",
  bg: "#121212",
  surface: "#1C1C1E",
  card: "#1E1E1E",
  cardBorder: "#2A2A2A",
  border: "#2E2E31",
  text: "#F5F5F5",
  muted: "#9A9A9A",
  accent: "#4F8CFF",
  danger: "#E5484D",
  onAccent: "#FFFFFF",
  overlay: "rgba(0,0,0,0.6)",
  dot: "#34343A",
  inputBg: "#1C1C1E",
};

export const palettes: Record<ThemeScheme, Palette> = { light: LIGHT, dark: DARK };
