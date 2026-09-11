import { View } from "react-native";

import { LiveDot } from "@/components/schedule/LiveDot";
import { Text } from "@/components/ui/text";
import { colors } from "@/constants/theme";
import { formatDuration, formatRange, type ClassOccurrence } from "@/lib/schedule";

// The class happening right now: live dot, time left, and a thin
// progress bar through the session. Everything derives from `now`.

export function ScheduleNowCard({ occ, now }: { occ: ClassOccurrence; now: Date }) {
  const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const total = Math.max(1, occ.endMin - occ.startMin);
  const progress = Math.min(1, Math.max(0, (nowMin - occ.startMin) / total));
  const left = Math.ceil(occ.endMin - nowMin);

  return (
    <View
      className="bg-card border-primary/30 gap-1 rounded-2xl border p-6 web:transition-shadow web:hover:shadow-md web:hover:shadow-black/5"
      accessibilityLabel={`Now: ${occ.course.code}, ends in ${formatDuration(left)}`}
    >
      <View className="mb-2 flex-row items-center gap-2">
        <LiveDot color={colors.accent} />
        <Text className="text-primary text-xs font-bold uppercase tracking-widest">Now</Text>
        <View className="flex-1" />
        <Text className="text-muted-foreground text-sm">
          Ends in <Text className="text-foreground text-sm font-semibold">{formatDuration(left)}</Text>
        </Text>
      </View>

      <View className="flex-row items-center gap-2">
        <View className="size-2.5 rounded-full" style={{ backgroundColor: occ.course.color }} />
        <Text className="text-2xl font-bold">
          {occ.course.code}
          {occ.course.section ? ` (${occ.course.section})` : ""}
        </Text>
      </View>
      {occ.course.title ? <Text className="text-foreground/80 text-base">{occ.course.title}</Text> : null}
      <Text className="text-muted-foreground text-sm">
        {formatRange(occ.meeting.start, occ.meeting.end)}
        {occ.meeting.room ? `  ·  ${occ.meeting.room}` : ""}
      </Text>

      <View
        className="bg-muted mt-3 h-1.5 overflow-hidden rounded-full"
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
      >
        <View className="bg-primary h-full rounded-full" style={{ width: `${progress * 100}%` }} />
      </View>
    </View>
  );
}
