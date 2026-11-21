import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { habitWeek } from "@/lib/habitReports";
import type { Habit, HabitLog } from "@/lib/habits";

export function HabitWeek({ habit, logs, now }: { habit: Habit; logs: HabitLog[]; now: number }) {
  const days = habitWeek(habit, logs, now);
  return <View className="gap-1" accessibilityLabel={`Recent progress for ${habit.title}`}>
    <View className="flex-row gap-2">{days.map(day => {
      const label = day.ratio === null ? "Rest day" : day.ratio === 1 ? "Goal reached" : `${Math.round(day.ratio * 100)}% progress`;
      return <View key={day.date} className="flex-1 items-center gap-1" accessible accessibilityLabel={`${day.date}: ${label}${day.weekly ? " (weekly goal)" : ""}`}>
        <Text className="text-muted-foreground text-xs">{new Date(`${day.date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "narrow", timeZone: "UTC" })}</Text>
        <View className="bg-muted h-1.5 w-full overflow-hidden rounded-full"><View className="bg-primary h-full" style={{ width: `${(day.ratio ?? 0) * 100}%` }} /></View>
        <Text className="text-muted-foreground text-xs">{day.ratio === null ? "–" : day.ratio === 1 ? "✓" : day.date.slice(8)}</Text>
      </View>;
    })}</View>
    {days.some(day => day.weekly) && <Text className="text-muted-foreground text-xs">Weekly goals show the same week's progress.</Text>}
  </View>;
}
