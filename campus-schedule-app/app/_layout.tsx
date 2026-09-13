import "../global.css";
import "@/lib/webFonts";

import { DarkTheme, DefaultTheme, ThemeProvider as NavThemeProvider } from "@react-navigation/native";
import { PortalHost } from "@rn-primitives/portal";
import { useMemo } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppServices } from "@/components/AppServices";
import { CommandPaletteProvider } from "@/components/CommandPalette";
import { AuthProvider } from "@/context/auth";
import { FocusProvider } from "@/context/focus";
import { SectionsProvider } from "@/context/sections";
import { ToastProvider } from "@/components/Toaster";
import { AppProvider } from "@/context/store";
import { ThemeProvider, useTheme } from "@/context/theme";

// Root layout. Everything the app renders sits inside a single Stack so
// that later we can push non-tab screens on top of the tab shell. The
// data store and the light/dark theme both wrap the whole tree.
function ThemedShell() {
  const t = useTheme();
  const navTheme = useMemo(() => {
    const base = t.scheme === "dark" ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        background: "transparent",
        card: t.card,
        text: t.text,
        border: t.border,
        primary: t.accent,
      },
    };
  }, [t]);
  return (
    <>
      <StatusBar style={t.scheme === "dark" ? "light" : "dark"} />
      {/* React Navigation paints its own theme background (#F2F2F2 by
          default) behind every screen; make it transparent so the app's
          time-of-day background shows, and give it the palette colors. */}
      <NavThemeProvider value={navTheme}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "transparent" } }}>
          <Stack.Screen name="(tabs)" />
        </Stack>
      </NavThemeProvider>
      <AppServices />
      {/* Mount point for Reusables overlays (dialogs, popovers, selects). */}
      <PortalHost />
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <ToastProvider>
            <AuthProvider>
              <AppProvider>
                <SectionsProvider>
                  <FocusProvider>
                    <CommandPaletteProvider>
                      <ThemedShell />
                    </CommandPaletteProvider>
                  </FocusProvider>
                </SectionsProvider>
              </AppProvider>
            </AuthProvider>
          </ToastProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
