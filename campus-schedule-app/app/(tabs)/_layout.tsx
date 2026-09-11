import { Tabs } from "expo-router";
import { useEffect } from "react";
import { Text } from "react-native";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { useTheme } from "@/context/theme";

// Tab bar order mirrors the concept mockups: the "Schedule" home screen
// is the default (first) tab. Emoji stay as the app's icon language; the
// active one gets a soft pill and a small spring.
function TabIcon({ emoji, focused }: { emoji: string; focused: boolean }) {
  const scale = useSharedValue(focused ? 1.08 : 1);

  useEffect(() => {
    scale.value = withSpring(focused ? 1.08 : 1, {
      damping: 12,
      stiffness: 260,
      reduceMotion: ReduceMotion.System,
    });
  }, [focused, scale]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View
      style={[
        {
          paddingHorizontal: 12,
          paddingVertical: 2,
          borderRadius: 999,
          backgroundColor: focused ? "rgba(79,140,255,0.14)" : "transparent",
        },
        style,
      ]}
    >
      <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.55 }}>{emoji}</Text>
    </Animated.View>
  );
}

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.accent,
        tabBarInactiveTintColor: t.muted,
        tabBarLabelStyle: { fontSize: 10, fontWeight: "600" },
        tabBarStyle: { backgroundColor: t.card, borderTopColor: t.border },
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Schedule",
          tabBarIcon: ({ focused }) => <TabIcon emoji="🗓️" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: "Tasks",
          tabBarIcon: ({ focused }) => <TabIcon emoji="✅" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: "Calendar",
          tabBarIcon: ({ focused }) => <TabIcon emoji="📅" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="courses"
        options={{
          title: "Courses",
          tabBarIcon: ({ focused }) => <TabIcon emoji="📚" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="notes"
        options={{
          title: "Notes",
          tabBarIcon: ({ focused }) => <TabIcon emoji="🗒️" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="import"
        options={{
          title: "Import",
          tabBarIcon: ({ focused }) => <TabIcon emoji="📥" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
