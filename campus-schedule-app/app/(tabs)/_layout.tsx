import { Tabs } from "expo-router";

import { AppTabBar } from "@/components/AppTabBar";
import { useBreakpoint } from "@/lib/useBreakpoint";

// Tab order: the Schedule home screen is the default (first) tab. The bar
// itself (sidebar on wide screens, bottom bar on narrow) is AppTabBar.
export default function TabsLayout() {
  const { wide } = useBreakpoint();
  return (
    <Tabs
      tabBar={(props) => <AppTabBar {...props} vertical={wide} />}
      screenOptions={{
        headerShown: false,
        tabBarPosition: wide ? "left" : "bottom",
        animation: "fade",
        // Let the ambient time-of-day background show through.
        sceneStyle: { backgroundColor: "transparent" },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Schedule" }} />
      <Tabs.Screen name="tasks" options={{ title: "Tasks" }} />
      <Tabs.Screen name="calendar" options={{ title: "Calendar" }} />
      <Tabs.Screen name="courses" options={{ title: "Courses" }} />
      <Tabs.Screen name="notes" options={{ title: "Notes" }} />
      <Tabs.Screen name="import" options={{ title: "Import" }} />
      <Tabs.Screen name="settings" options={{ title: "Settings" }} />
    </Tabs>
  );
}
