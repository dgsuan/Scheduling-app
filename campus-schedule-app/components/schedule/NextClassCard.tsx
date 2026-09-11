import { View } from "react-native";

import { Badge } from "@/components/ui/badge";
import { Text } from "@/components/ui/text";
import {
  formatDuration,
  formatRange,
  relativeDayLabel,
  type NowAndNext,
} from "@/lib/schedule";

// "Next class" today, or a calm empty state that still points at the
// next class on a later day. Prominent when nothing is in session.

export function NextClassCard({
  next,
  now,
  hasCourses,
  prominent,
}: {
  next: NowAndNext["next"];
  now: Date;
  hasCourses: boolean;
  /** No class in session → this is the headline card. */
  prominent: boolean;
}) {
  const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const today = next && next.daysAhead === 0 ? next : null;

  return (
    <View className="bg-card border-border gap-1 rounded-2xl border p-6 web:transition-shadow web:hover:shadow-md web:hover:shadow-black/5">
      <View className="mb-2 flex-row items-center justify-between">
        <Text className="text-muted-foreground text-xs uppercase tracking-widest">Next class</Text>
        {today ? (
          <Badge variant="secondary">
            <Text>in {formatDuration(Math.ceil(today.startMin - nowMin))}</Text>
          </Badge>
        ) : null}
      </View>

      {today ? (
        <>
          <View className="flex-row items-center gap-2">
            <View className="size-2.5 rounded-full" style={{ backgroundColor: today.course.color }} />
            <Text className={prominent ? "text-2xl font-bold" : "text-lg font-semibold"}>
              {today.course.code}
              {today.course.section ? ` (${today.course.section})` : ""}
            </Text>
          </View>
          {today.course.title ? <Text className="text-foreground/80 text-base">{today.course.title}</Text> : null}
          <Text className="text-muted-foreground text-sm">
            {formatRange(today.meeting.start, today.meeting.end)}
            {today.meeting.room ? `  ·  ${today.meeting.room}` : ""}
          </Text>
        </>
      ) : !hasCourses ? (
        <Text className="text-muted-foreground text-sm">Add courses on the Courses tab.</Text>
      ) : (
        <>
          <Text className="text-base font-medium">No more classes today.</Text>
          <Text className="text-muted-foreground text-sm">
            {next
              ? `Next up: ${relativeDayLabel(next.daysAhead, next.day)} · ${next.course.code} · ${formatRange(next.meeting.start, next.meeting.end)}`
              : "No classes in the next 7 days."}
          </Text>
        </>
      )}
    </View>
  );
}
