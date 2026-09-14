import { MapPin } from "lucide-react-native";
import { View } from "react-native";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { useCourses, useScheduleRules } from "@/context/store";
import { isoDate } from "@/lib/dates";
import { dayLabel } from "@/lib/insights";
import { classesInRoom, nextInRoom, transferInto, type Transfer } from "@/lib/rooms";
import { display12h, formatDuration, formatRange, WEEKDAY_SHORT, type DatedOccurrence } from "@/lib/schedule";
import { useNow } from "@/lib/useNow";

// A room from your schedule: your classes there, when you're next there, and
// how much time you have to walk over from the class before.

/** "10 min to get here from MATH 21 in MB 101." */
export function transferText(t: Transfer): string {
  const from = `${t.from.course.code}${t.from.meeting.room ? ` in ${t.from.meeting.room}` : ""}`;
  if (!t.roomChange) return t.gapMin ? `${formatDuration(t.gapMin)} after ${from}, same room.` : `Right after ${from}, same room.`;
  return t.gapMin ? `${formatDuration(t.gapMin)} to get here from ${from}.` : `No break after ${from} — you'll have to head straight over.`;
}

export function RoomDialog({ room, occurrence, onClose }: { room: string | null; occurrence?: DatedOccurrence | null; onClose: () => void }) {
  const { courses } = useCourses();
  const rules = useScheduleRules();
  const now = useNow();
  const today = isoDate(now);
  const uses = room ? classesInRoom(courses, room) : [];
  const next = room ? nextInRoom(courses, room, rules, now) : null;
  const transfer = occurrence && occurrence.status === "scheduled" ? transferInto(courses, occurrence, rules) : null;

  return (
    <Dialog open={!!room} onOpenChange={(o) => !o && onClose()}>
      {room ? (
        <DialogContent className="gap-4 p-5 sm:max-w-sm">
          <DialogHeader>
            <View className="flex-row items-center gap-2">
              <Icon as={MapPin} size={16} className="text-primary" />
              <DialogTitle>{room}</DialogTitle>
            </View>
            <DialogDescription>
              {next
                ? `Next time you're here: ${dayLabel(next.date, today)}, ${display12h(next.meeting.start)} (${next.course.code})`
                : "None of your classes meet here in the next two weeks."}
            </DialogDescription>
          </DialogHeader>
          {transfer ? (
            <Text className="text-sm leading-5">
              <Text className="text-sm font-semibold">{occurrence!.course.code}: </Text>
              {transferText(transfer)}
            </Text>
          ) : null}
          <View className="gap-1.5">
            <Text className="text-muted-foreground text-xs font-semibold uppercase tracking-[1px]">Your classes here</Text>
            {uses.map(({ course, meeting }, i) => (
              <View key={`${course.id}-${i}`} className="flex-row items-center gap-2">
                <View className="size-2 rounded-full" style={{ backgroundColor: course.color }} />
                <Text className="flex-1 text-sm">{course.code}</Text>
                <Text className="text-muted-foreground text-[13px] tabular-nums">
                  {[...meeting.days]
                    .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
                    .map((d) => WEEKDAY_SHORT[d])
                    .join(" / ")}{" "}
                  · {formatRange(meeting.start, meeting.end)}
                </Text>
              </View>
            ))}
          </View>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
