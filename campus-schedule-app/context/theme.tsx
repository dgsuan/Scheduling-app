import AsyncStorage from "@react-native-async-storage/async-storage";
import { Moon, Sun } from "lucide-react-native";
import { colorScheme as nativewindScheme, vars } from "nativewind";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, Platform, View, useColorScheme } from "react-native";

import { AmbientBackground } from "@/components/AmbientBackground";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  APPEARANCE_KEY,
  DEFAULT_APPEARANCE,
  THEME_SNAPSHOT_KEY,
  buildTheme,
  normalizeAppearance,
  type Appearance,
  type BuiltTheme,
  type Palette,
  type ThemeScheme,
} from "@/constants/theme";
import { getTimeOfDay, msUntilNextPeriod, type TimeOfDay } from "@/lib/timeOfDay";
import { ensureFonts } from "@/lib/webFonts";

// Global theme: the user's Appearance settings (light/dark/system, preset,
// custom colors, font, size, roundness) plus a time-of-day "atmosphere"
// that re-tints the same tokens. One timer, scheduled for the next period
// boundary — nothing ticks in between.

/** Before Appearance existed, only "light"/"dark" was saved here. */
const LEGACY_SCHEME_KEY = "campus-schedule:theme:v1";

type ThemeCtx = {
  scheme: ThemeScheme;
  tod: TimeOfDay;
  palette: Palette;
  theme: BuiltTheme;
  appearance: Appearance;
  setAppearance: (patch: Partial<Appearance>) => void;
  resetAppearance: () => void;
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

/** Web reads localStorage synchronously so the first render is already themed. */
function readSavedAppearanceSync(): Appearance | null {
  if (Platform.OS !== "web" || typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(APPEARANCE_KEY);
    if (raw) return normalizeAppearance(JSON.parse(raw));
    const legacy = localStorage.getItem(LEGACY_SCHEME_KEY);
    if (legacy === "light" || legacy === "dark") return { ...DEFAULT_APPEARANCE, mode: legacy };
  } catch {
    // Unreadable save: fall back to defaults.
  }
  return null;
}

function applyToDocument(theme: BuiltTheme, tod: TimeOfDay) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(theme.tokens)) root.style.setProperty(k, v);
  root.style.setProperty("--font-sans", theme.fontSans);
  root.style.setProperty("--font-display", theme.fontDisplay);
  root.dataset.tod = tod;
  root.style.colorScheme = theme.scheme;
  root.style.backgroundColor = theme.palette.bg;

  // Interface size: zoom the whole page, sizing <body> so it still fills the window.
  const body = document.body;
  body.style.backgroundColor = theme.palette.bg;
  if (theme.scale !== 1) {
    body.style.setProperty("zoom", String(theme.scale));
    body.style.width = `calc(100% / ${theme.scale})`;
    body.style.height = `calc(100% / ${theme.scale})`;
  } else {
    body.style.removeProperty("zoom");
    body.style.width = "";
    body.style.height = "";
  }

  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = theme.palette.bg;

  try {
    localStorage.setItem(
      THEME_SNAPSHOT_KEY,
      JSON.stringify({
        tokens: theme.tokens,
        bg: theme.palette.bg,
        dark: theme.scheme === "dark",
        fontSans: theme.fontSans,
        fontDisplay: theme.fontDisplay,
        scale: theme.scale,
      })
    );
  } catch {
    // Storage full or blocked: the pre-paint snapshot is only an optimisation.
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [appearance, setAppearanceState] = useState<Appearance>(
    () => readSavedAppearanceSync() ?? DEFAULT_APPEARANCE
  );
  const system = useColorScheme();
  const tod = useTimeOfDayState();

  // Native: AsyncStorage is async-only, so load after mount.
  const loaded = useRef(Platform.OS === "web");
  useEffect(() => {
    if (Platform.OS === "web") return;
    let cancelled = false;
    AsyncStorage.multiGet([APPEARANCE_KEY, LEGACY_SCHEME_KEY])
      .then(([[, raw], [, legacy]]) => {
        if (cancelled) return;
        if (raw) setAppearanceState(normalizeAppearance(JSON.parse(raw)));
        else if (legacy === "light" || legacy === "dark") setAppearanceState({ ...DEFAULT_APPEARANCE, mode: legacy });
      })
      .catch(() => {})
      .finally(() => {
        loaded.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist changes (skipping the initial value).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!loaded.current) return;
    AsyncStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance)).catch(() => {});
  }, [appearance]);

  const requested: ThemeScheme =
    appearance.mode === "system" ? (system === "dark" ? "dark" : "light") : appearance.mode;
  const theme = useMemo(() => buildTheme(requested, tod, appearance), [requested, tod, appearance]);

  useEffect(() => {
    nativewindScheme.set(theme.scheme);
    if (Platform.OS !== "web") return;
    applyToDocument(theme, tod);
    ensureFonts(appearance.font, appearance.serifHeadings);
  }, [theme, tod, appearance.font, appearance.serifHeadings]);

  const setAppearance = useCallback((patch: Partial<Appearance>) => {
    setAppearanceState((prev) => normalizeAppearance({ ...prev, ...patch }));
  }, []);
  const resetAppearance = useCallback(() => setAppearanceState(DEFAULT_APPEARANCE), []);

  const value = useMemo<ThemeCtx>(
    () => ({
      scheme: theme.scheme,
      tod,
      palette: theme.palette,
      theme,
      appearance,
      setAppearance,
      resetAppearance,
      // An explicit light/dark choice replaces a custom background.
      toggle: () => setAppearance({ mode: theme.scheme === "dark" ? "light" : "dark", background: null }),
      setScheme: (s: ThemeScheme) => setAppearance({ mode: s, background: null }),
    }),
    [theme, tod, appearance, setAppearance, resetAppearance]
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

function useThemeCtx(): ThemeCtx {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("Theme hooks must be used inside <ThemeProvider>");
  return ctx;
}

/** Returns the active palette (also carries `scheme`). */
export function useTheme(): Palette {
  return useThemeCtx().palette;
}

export function useTimeOfDay(): TimeOfDay {
  return useThemeCtx().tod;
}

export function useThemeControls() {
  const ctx = useThemeCtx();
  return { scheme: ctx.scheme, toggle: ctx.toggle, setScheme: ctx.setScheme };
}

export function useAppearance() {
  const { appearance, setAppearance, resetAppearance, theme } = useThemeCtx();
  return { appearance, setAppearance, resetAppearance, theme };
}

/** Page zoom from Appearance (web only) — gesture math divides by it. */
export function useUiScale(): number {
  const ctx = useContext(ThemeContext);
  return Platform.OS === "web" ? (ctx?.appearance.scale ?? 1) : 1;
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
