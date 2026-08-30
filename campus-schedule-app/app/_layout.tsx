import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppProvider } from "@/context/store";

// Root layout. Everything the app renders sits inside a single Stack so
// that later we can push non-tab screens (e.g. a note editor, a class
// detail view) on top of the 4-tab shell defined in app/(tabs)/_layout.tsx.
// AppProvider holds the on-device data store (courses + notes) shared by
// every screen.
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppProvider>
          <StatusBar style="auto" />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
          </Stack>
        </AppProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
