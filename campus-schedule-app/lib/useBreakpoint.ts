import { useWindowDimensions } from "react-native";

/** Sidebar navigation from this width up. */
export const WIDE_MIN = 900;
/** Two-column page layouts from this width up. */
export const DESKTOP_MIN = 1180;

export function useBreakpoint() {
  const { width } = useWindowDimensions();
  return { width, wide: width >= WIDE_MIN, desktop: width >= DESKTOP_MIN };
}
