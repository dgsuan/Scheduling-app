import AsyncStorage from "@react-native-async-storage/async-storage";
import { Moon, Sun } from "lucide-react-native";
import { colorScheme as nativewindScheme, vars } from "nativewind";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AppState, Appearance, Platform, View } from "react-native";

import { AmbientBackground } from "@/components/AmbientBackground";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { buildTheme, type Palette, type ThemeScheme } from "@/constants/theme";
import { getTimeOfDay, msUntilNextPeriod, type TimeOfDay } from "@/lib/timeOfDay";

// Global theme: light/dark (OS default, then the user's saved choice) plus
// a time-of-day "atmosphere" that re-tints the same tokens. One timer,
// scheduled for the next period boundary — nothing ticks in between.

const KEY = "campus-schedule:theme:v1";

type ThemeCtx = {
  scheme: ThemeScheme;
  tod: TimeOfDay;
  palette: Palette;
  toggle: () => void;
  setScheme: (s: ThemeScheme) => void;
};

const ThemeContext = createContext<ThemeCtx | null>(null);

function useTimeOfDayState(): TimeOfDay {
  const [tod, setTod] = useState<TimeOfDay>(() => getTimeOfDay());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const sync = () => {
      clearTimeout(timer);
      setTod(getTimeOfDay());
      // +1s so we land safely inside the new period.
      timer = setTimeout(sync, msUntilNextPeriod() + 1000);
    };
    sync();
    // Timers are throttled while backgrounded; re-check on return.
    const sub = AppState.addEventListener("change", (s) => s === "active" && sync());
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, []);
  return tod;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = Appearance.getColorScheme();
  const [scheme, setSchemeState] = useState<ThemeScheme>(
    system === "dark" ? "dark" : "light"
  );
  const tod = useTimeOfDayState();

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

  const theme = useMemo(() => buildTheme(scheme, tod), [scheme, tod]);

  // Keep NativeWind's `dark:` variants in step, and on web publish the
  // tokens on <html> so portalled dialogs/popovers inherit them too.
  useEffect(() => {
    nativewindScheme.set(scheme);
    if (Platform.OS !== "web") return;
    const root = document.documentElement;
    for (const [k, v] of Object.entries(theme.tokens)) root.style.setProperty(k, v);
    root.dataset.tod = tod;
    root.style.colorScheme = scheme;
    document.body.style.backgroundColor = theme.palette.bg;
  }, [scheme, tod, theme]);

  const setScheme = (s: ThemeScheme) => {
    setSchemeState(s);
    AsyncStorage.setItem(KEY, s).catch(() => {});
  };

  const value = useMemo<ThemeCtx>(
    () => ({
      scheme,
      tod,
      palette: theme.palette,
      toggle: () => setScheme(scheme === "dark" ? "light" : "dark"),
      setScheme,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scheme, tod, theme]
  );

  return (
    <ThemeContext.Provider value={value}>
      <View
        className="web:transition-colors web:duration-1000"
        style={[
          { flex: 1, backgroundColor: theme.palette.bg },
          Platform.OS !== "web" && vars(theme.tokens),
        ]}
      >
        <AmbientBackground color={theme.wash.color} opacity={theme.wash.opacity} />
        {children}
      </View>
    </ThemeContext.Provider>
  );
}

/** Returns the active palette (also carries `scheme`). */
export function useTheme(): Palette {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx.palette;
}

export function useTimeOfDay(): TimeOfDay {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTimeOfDay must be used inside <ThemeProvider>");
  return ctx.tod;
}

export function useThemeControls() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useThemeControls must be used inside <ThemeProvider>");
  return { scheme: ctx.scheme, toggle: ctx.toggle, setScheme: ctx.setScheme };
}

/** Quiet sun/moon button. */
export function ThemeToggle() {
  const { scheme, toggle } = useThemeControls();
  return (
    <Button
      variant="ghost"
      size="icon"
      onPress={toggle}
      accessibilityLabel={scheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      <Icon as={scheme === "dark" ? Sun : Moon} size={17} className="text-muted-foreground" />
    </Button>
  );
}
