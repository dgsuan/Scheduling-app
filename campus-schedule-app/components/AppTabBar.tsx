import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import {
  BookOpen,
  CalendarClock,
  CalendarDays,
  Download,
  ListChecks,
  Moon,
  NotebookPen,
  Search,
  Settings,
  Sun,
  Sunrise,
  Sunset,
  type LucideIcon,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import { Image, Pressable, View, type LayoutRectangle } from "react-native";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useCommandPalette } from "@/components/CommandPalette";
import { SyncBadge } from "@/components/SyncBadge";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { ThemeToggle, useTheme, useTimeOfDay } from "@/context/theme";
import type { TimeOfDay } from "@/lib/timeOfDay";
import { useNow } from "@/lib/useNow";
import { display12h } from "@/lib/schedule";
import { cn } from "@/lib/utils";

// App navigation. A sidebar on wide screens, a bottom bar on narrow ones.
// A single highlight springs between items so switching tabs feels
// physical rather than a hard swap.

// The Isked wordmark (rendered by scripts/gen-icons.mjs), one per theme.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const WORDMARK_LIGHT = require("../assets/wordmark-light.png");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const WORDMARK_DARK = require("../assets/wordmark-dark.png");

const ICONS: Record<string, LucideIcon> = {
  index: CalendarClock,
  tasks: ListChecks,
  calendar: CalendarDays,
  courses: BookOpen,
  notes: NotebookPen,
  import: Download,
  settings: Settings,
};

const PERIOD: Record<TimeOfDay, { label: string; icon: LucideIcon }> = {
  earlyMorning: { label: "Early morning", icon: Sunrise },
  morning: { label: "Morning", icon: Sun },
  afternoon: { label: "Afternoon", icon: Sun },
  evening: { label: "Evening", icon: Sunset },
  night: { label: "Night", icon: Moon },
};

const SPRING = { damping: 22, stiffness: 300, mass: 0.8, reduceMotion: ReduceMotion.System };

function useIndicator(active: number, layouts: (LayoutRectangle | undefined)[]) {
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const w = useSharedValue(0);
  const h = useSharedValue(0);
  const placed = useSharedValue(0);

  const target = layouts[active];
  useEffect(() => {
    if (!target) return;
    if (!placed.value) {
      // First placement: jump there, no animation.
      x.value = target.x;
      y.value = target.y;
      w.value = target.width;
      h.value = target.height;
      placed.value = 1;
      return;
    }
    x.value = withSpring(target.x, SPRING);
    y.value = withSpring(target.y, SPRING);
    w.value = withSpring(target.width, SPRING);
    h.value = withSpring(target.height, SPRING);
  }, [target, x, y, w, h, placed]);

  return useAnimatedStyle(() => ({
    opacity: placed.value,
    width: w.value,
    height: h.value,
    transform: [{ translateX: x.value }, { translateY: y.value }],
  }));
}

export function AppTabBar({ state, descriptors, navigation, vertical }: BottomTabBarProps & { vertical: boolean }) {
  const [layouts, setLayouts] = useState<(LayoutRectangle | undefined)[]>([]);
  const indicator = useIndicator(state.index, layouts);
  const insets = useSafeAreaInsets();
  const { setOpen } = useCommandPalette();
  const openPalette = () => setOpen(true);
  const { scheme } = useTheme();

  const items = state.routes.map((route, i) => {
    const { options } = descriptors[route.key];
    const label = typeof options.title === "string" ? options.title : route.name;
    const focused = state.index === i;
    const onPress = () => {
      const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
      if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
    };
    return (
      <Pressable
        key={route.key}
        onPress={onPress}
        onLayout={(e) => {
          const l = e.nativeEvent.layout;
          setLayouts((prev) => {
            const next = [...prev];
            next[i] = l;
            return next;
          });
        }}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={label}
        className={cn(
          "group rounded-lg web:transition-colors web:duration-150 active:opacity-80",
          vertical
            ? "flex-row items-center gap-3 px-3 py-2.5"
            : "flex-1 items-center gap-1 py-1.5",
          !focused && "web:hover:bg-accent/60"
        )}
      >
        <Icon
          as={ICONS[route.name] ?? CalendarDays}
          size={vertical ? 18 : 20}
          strokeWidth={focused ? 2.25 : 1.75}
          className={focused ? "text-primary" : "text-muted-foreground web:group-hover:text-foreground"}
        />
        <Text
          numberOfLines={1}
          className={cn(
            vertical ? "text-[14px]" : "text-[10.5px]",
            focused ? "text-foreground font-semibold" : "text-muted-foreground font-medium"
          )}
        >
          {label}
        </Text>
      </Pressable>
    );
  });

  if (vertical) {
    return (
      <View className="border-border/70 w-[232px] border-r px-3 pb-4 pt-6">
        <View className="mb-7 px-2" accessibilityRole="header">
          <Image
            source={scheme === "dark" ? WORDMARK_DARK : WORDMARK_LIGHT}
            style={{ width: 96, height: 40 }}
            accessibilityLabel="isked"
            accessibilityIgnoresInvertColors
          />
        </View>
        <Pressable
          onPress={openPalette}
          accessibilityRole="button"
          accessibilityLabel="Search"
          className="border-border mb-4 flex-row items-center gap-2.5 rounded-lg border px-3 py-2 web:transition-colors web:hover:bg-accent/60"
        >
          <Icon as={Search} size={15} className="text-muted-foreground" />
          <Text className="text-muted-foreground flex-1 text-[13px]">Search</Text>
          <Text className="text-muted-foreground border-border rounded border px-1 text-[10px]">Ctrl K</Text>
        </Pressable>
        <View role="tablist" className="gap-0.5">
          {/* Reanimated views ignore className: animate the outer, style the inner. */}
          <Animated.View pointerEvents="none" style={[{ position: "absolute", left: 0, top: 0 }, indicator]}>
            <View className="bg-card border-border flex-1 rounded-lg border shadow-sm shadow-black/5" />
          </Animated.View>
          {items}
        </View>
        <View className="flex-1" />
        <SyncBadge />
        <SidebarFooter />
      </View>
    );
  }

  return (
    <View
      className="bg-card/95 border-border/70 border-t px-2 pt-1.5"
      style={{ paddingBottom: Math.max(insets.bottom, 6) }}
    >
      <View role="tablist" className="flex-row">
        <Animated.View pointerEvents="none" style={[{ position: "absolute", left: 0, top: 0 }, indicator]}>
          <View className="bg-primary/10 flex-1 rounded-lg" />
        </Animated.View>
        {items}
      </View>
    </View>
  );
}

/** The time-of-day awareness, stated quietly once. */
function SidebarFooter() {
  const tod = useTimeOfDay();
  const now = useNow();
  const period = PERIOD[tod];
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return (
    <View className="flex-row items-center justify-between px-3">
      <View className="flex-row items-center gap-2">
        <Icon as={period.icon} size={14} className="text-muted-foreground" />
        <Text className="text-muted-foreground text-xs">
          {period.label} · <Text className="text-muted-foreground text-xs tabular-nums">{display12h(hhmm)}</Text>
        </Text>
      </View>
      <ThemeToggle />
    </View>
  );
}
