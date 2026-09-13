import { useWindowDimensions } from "react-native";

import { useUiScale } from "@/context/theme";

/** Sidebar navigation from this width up. */
export const WIDE_MIN = 900;
/** Two-column page layouts from this width up. */
export const DESKTOP_MIN = 1180;

/** Breakpoints in layout pixels, so a larger interface size switches layouts sooner. */
export function useBreakpoint() {
  const { width: windowWidth } = useWindowDimensions();
  const width = windowWidth / useUiScale();
  return { width, wide: width >= WIDE_MIN, desktop: width >= DESKTOP_MIN };
}
