// Minimal shared style tokens. Kept intentionally small for the scaffold —
// a real design system can replace this later without touching screen files
// that just import { colors, spacing } from "@/constants/theme".

export const colors = {
  // "Schedule" home screen is dark-mode per the concept mockup.
  scheduleBg: "#121212",
  scheduleCard: "#1E1E1E",
  scheduleCardBorder: "#2A2A2A",
  scheduleText: "#F5F5F5",
  scheduleMuted: "#9A9A9A",
  accent: "#4F8CFF",
  danger: "#E5484D",

  // Everything else (calendar, notes, import) uses a light surface for now.
  lightBg: "#FFFFFF",
  lightSurface: "#F4F5F7",
  lightBorder: "#E2E4E9",
  lightText: "#1A1A1A",
  lightMuted: "#6B7280",
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
