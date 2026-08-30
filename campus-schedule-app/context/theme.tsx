import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Appearance, Pressable, StyleSheet, Text } from "react-native";

import { palettes, spacing, type Palette, type ThemeScheme } from "@/constants/theme";

// Global light/dark theme. Defaults to the OS setting, then remembers the
// user's explicit choice on-device.

const KEY = "campus-schedule:theme:v1";

type ThemeCtx = {
  scheme: ThemeScheme;
  palette: Palette;
  toggle: () => void;
  setScheme: (s: ThemeScheme) => void;
};

const ThemeContext = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = Appearance.getColorScheme();
  const [scheme, setSchemeState] = useState<ThemeScheme>(
    system === "dark" ? "dark" : "light"
  );

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(KEY)
      .then((v) => {
        if (!cancelled && (v === "light" || v === "dark")) setSchemeState(v);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const setScheme = (s: ThemeScheme) => {
    setSchemeState(s);
    AsyncStorage.setItem(KEY, s).catch(() => {});
  };

  const value = useMemo<ThemeCtx>(
    () => ({
      scheme,
      palette: palettes[scheme],
      toggle: () => setScheme(scheme === "dark" ? "light" : "dark"),
      setScheme,
    }),
    [scheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Returns the active palette (also carries `scheme`). */
export function useTheme(): Palette {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx.palette;
}

export function useThemeControls() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useThemeControls must be used inside <ThemeProvider>");
  return { scheme: ctx.scheme, toggle: ctx.toggle, setScheme: ctx.setScheme };
}

/** Small round sun/moon button — drop into any screen header. */
export function ThemeToggle() {
  const { scheme, toggle } = useThemeControls();
  const palette = useTheme();
  return (
    <Pressable
      onPress={toggle}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={scheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      style={[
        styles.btn,
        { backgroundColor: palette.surface, borderColor: palette.border },
      ]}
    >
      <Text style={styles.icon}>{scheme === "dark" ? "☀️" : "🌙"}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  icon: { fontSize: 16, lineHeight: 20, marginTop: spacing.xs / 2 },
});
