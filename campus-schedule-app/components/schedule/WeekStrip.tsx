import { router } from "expo-router";
import { Pressable, View } from "react-native";

import { Text } from "@/components/ui/text";
import { colors } from "@/constants/theme";
import { holidaysOn } from "@/constants/holidays";
import type { Course, Task, Weekday } from "@/context/store";
import { WEEKDAY_SHORT, occurrencesOnDay } from "@/lib/schedule";
import { isoDate } from "@/lib/tasks";
import { cn } from "@/lib/utils";

// The next seven days at a glance: classes as course-colored dots, tasks
// due as a small square. Tapping jumps to the Calendar.

export function WeekStrip({ courses, tasks, now }: { courses: Course[]; tasks: Task[]; now: Date }) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const iso = isoDate(d);
    const weekday = d.getDay() as Weekday;
    const classColors = [...new Set(occurrencesOnDay(courses, weekday).map((o) => o.course.color))];
    return {
      iso,
      day: d.getDate(),
      label: i === 0 ? "Today" : WEEKDAY_SHORT[weekday],
      classColors,
      dueCount: tasks.filter((t) => t.due === iso && !t.done).length,
      holiday: holidaysOn(iso)[0],
      isToday: i === 0,
    };
  });

  return (
    <View className="flex-row">
      {days.map((d) => (
        <Pressable
          key={d.iso}
          onPress={() => router.navigate("/calendar")}
          accessibilityRole="button"
          accessibilityLabel={`${d.label} ${d.day}: ${d.classColors.length} course${d.classColors.length === 1 ? "" : "s"}, ${d.dueCount} task${d.dueCount === 1 ? "" : "s"} due${d.holiday ? `, ${d.holiday.name}` : ""}. Open calendar`}
          className="flex-1 items-center gap-1.5 rounded-lg py-2 web:transition-colors web:hover:bg-accent/60 active:bg-accent"
        >
          <Text className={cn("text-[11px] font-medium", d.isToday ? "text-primary" : "text-muted-foreground")}>
            {d.label}
          </Text>
          <View className={cn("size-8 items-center justify-center rounded-full", d.isToday && "bg-primary")}>
            <Text
              className={cn("text-[15px] tabular-nums", d.isToday ? "text-primary-foreground font-semibold" : "font-medium")}
              style={!d.isToday && d.holiday ? { color: colors.holidayRegular } : undefined}
            >
              {d.day}
            </Text>
          </View>
          <View className="h-1.5 flex-row items-center gap-[3px]">
            {d.classColors.slice(0, 3).map((c) => (
              <View key={c} className="size-1.5 rounded-full" style={{ backgroundColor: c }} />
            ))}
            {d.dueCount > 0 ? <View className="border-foreground/60 size-[6px] rounded-[1.5px] border" /> : null}
          </View>
        </Pressable>
      ))}
    </View>
  );
}
