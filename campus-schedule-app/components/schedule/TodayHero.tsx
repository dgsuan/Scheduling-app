import { Clock, MapPin } from "lucide-react-native";
import { View } from "react-native";

import { LiveDot } from "@/components/schedule/LiveDot";
import { PopIn } from "@/components/PopIn";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { useTheme } from "@/context/theme";
import {
  display12h,
  formatDuration,
  formatRange,
  relativeDayLabel,
  type ClassOccurrence,
  type NowAndNext,
} from "@/lib/schedule";
import { formatShortDate } from "@/lib/calendar";
import { cn } from "@/lib/utils";

// The one dominant thing on the home screen: the class in session, or
// else the next one today, or a calm "you're done" state. Keyed by the
// occurrence so a hand-off (Now → Next) springs in as a new state.

function minutesNow(now: Date) {
  return now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
}

function Meta({ occ }: { occ: ClassOccurrence }) {
  return (
    <View className="mt-3 flex-row flex-wrap items-center gap-x-4 gap-y-1">
      <View className="flex-row items-center gap-1.5">
        <Icon as={Clock} size={14} className="text-muted-foreground" />
        <Text className="text-muted-foreground text-sm tabular-nums">
          {formatRange(occ.meeting.start, occ.meeting.end)}
        </Text>
      </View>
      {occ.meeting.room ? (
        <View className="flex-row items-center gap-1.5">
          <Icon as={MapPin} size={14} className="text-muted-foreground" />
          <Text className="text-muted-foreground text-sm">{occ.meeting.room}</Text>
        </View>
      ) : null}
    </View>
  );
}

function Title({ occ }: { occ: ClassOccurrence }) {
  return (
    <>
      <View className="flex-row items-center gap-2.5">
        <View className="size-2.5 rounded-full" style={{ backgroundColor: occ.course.color }} />
        <Text className="font-display text-[34px] font-semibold leading-[42px]">
          {occ.course.code}
          {occ.course.section ? (
            <Text className="text-muted-foreground font-display text-[22px] font-medium"> {occ.course.section}</Text>
          ) : null}
        </Text>
      </View>
      {occ.course.title ? <Text className="text-foreground/75 text-base">{occ.course.title}</Text> : null}
    </>
  );
}

export function TodayHero({
  ongoing,
  next,
  termState,
  term,
  now,
  hasCourses,
  skippedToday,
}: NowAndNext & {
  term?: { start: string; end: string };
  now: Date;
  hasCourses: boolean;
  /** Set when today's classes are all off (holiday / cancellations). */
  skippedToday?: { reason: string } | null;
}) {
  const t = useTheme();
  const nowMin = minutesNow(now);
  const nextToday = next && next.daysAhead === 0 ? next : null;

  if (ongoing) {
    const total = Math.max(1, ongoing.endMin - ongoing.startMin);
    const progress = Math.min(1, Math.max(0, (nowMin - ongoing.startMin) / total));
    const left = Math.ceil(ongoing.endMin - nowMin);
    return (
      <PopIn key={`now-${ongoing.course.id}-${ongoing.startMin}`}>
        <View
          className="bg-card border-primary/25 rounded-xl border px-6 pb-5 pt-4 shadow-sm shadow-black/5"
          accessibilityLabel={`Now: ${ongoing.course.code}, ends in ${formatDuration(left)}`}
        >
          <View className="mb-2 flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <LiveDot color={t.accent} />
              <Text className="text-primary text-xs font-semibold uppercase tracking-[1.5px]">Now</Text>
            </View>
            <Text className="text-muted-foreground text-sm">
              ends in <Text className="text-foreground text-sm font-semibold tabular-nums">{formatDuration(left)}</Text>
            </Text>
          </View>
          <Title occ={ongoing} />
          <Meta occ={ongoing} />
          <View className="mt-5">
            <View
              className="bg-muted h-1.5 overflow-hidden rounded-full"
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
            >
              <View
                className="bg-primary h-full rounded-full web:transition-[width] web:duration-1000"
                style={{ width: `${progress * 100}%` }}
              />
            </View>
            <View className="mt-1.5 flex-row justify-between">
              <Text className="text-muted-foreground text-[11px] tabular-nums">{display12h(ongoing.meeting.start)}</Text>
              <Text className="text-muted-foreground text-[11px] tabular-nums">{display12h(ongoing.meeting.end)}</Text>
            </View>
          </View>
        </View>
      </PopIn>
    );
  }

  if (nextToday) {
    return (
      <PopIn key={`next-${nextToday.course.id}-${nextToday.startMin}`}>
        <View className="bg-card border-border rounded-xl border px-6 py-5 shadow-sm shadow-black/5">
          <View className="mb-2 flex-row items-center justify-between">
            <Text className="text-muted-foreground text-xs font-semibold uppercase tracking-[1.5px]">Next class</Text>
            <Text className="text-muted-foreground text-sm">
              in <Text className="text-foreground text-sm font-semibold tabular-nums">{formatDuration(Math.ceil(nextToday.startMin - nowMin))}</Text>
            </Text>
          </View>
          <Title occ={nextToday} />
          <Meta occ={nextToday} />
        </View>
      </PopIn>
    );
  }

  const nextLine = next
    ? `${relativeDayLabel(next.daysAhead, next.day, next.date)}, ${display12h(next.meeting.start)} · ${next.course.code}`
    : null;
  const [headline, detail] = !hasCourses
    ? ["Your day will show up here.", "Add your courses on the Courses tab."]
    : termState === "after"
      ? [
          "The semester has ended.",
          `Classes ran until ${term ? formatShortDate(term.end) : "the term end"}. Set new term dates in Settings.`,
        ]
      : termState === "before"
        ? [
            "The semester hasn't started.",
            nextLine ? `First class: ${nextLine}` : "No classes are scheduled in the term yet.",
          ]
        : skippedToday
          ? ["No classes today.", `${skippedToday.reason}${nextLine ? ` · Next up: ${nextLine}` : ""}`]
          : ["No more classes today.", nextLine ? `Next up: ${nextLine}` : "No classes in the next few weeks."];

  return (
    <PopIn key={`none-${termState}`}>
      <View className="border-border rounded-xl border border-dashed px-6 py-6">
        <Text className="font-display text-2xl font-semibold">{headline}</Text>
        <Text className="text-muted-foreground mt-1 text-sm">{detail}</Text>
      </View>
    </PopIn>
  );
}

/** Compact timeline row for "Next" (when something is on now) and later today. */
export function ScheduleRow({
  occ,
  label,
  now,
  emphasis,
}: {
  occ: ClassOccurrence;
  label?: string;
  now: Date;
  emphasis?: boolean;
}) {
  const startsIn = Math.ceil(occ.startMin - minutesNow(now));
  return (
    <View className="flex-row items-center gap-4 py-3.5">
      <Text className="text-muted-foreground w-12 text-[11px] font-semibold uppercase tracking-[1.2px]">
        {label ?? ""}
      </Text>
      <View className="size-2 rounded-full" style={{ backgroundColor: occ.course.color }} />
      <View className="flex-1">
        <Text className={cn(emphasis ? "text-[17px] font-semibold" : "text-[15px] font-medium")}>
          {occ.course.code}
        </Text>
        {occ.course.title || occ.meeting.room ? (
          <Text className="text-muted-foreground text-[13px]" numberOfLines={1}>
            {[occ.course.title, occ.meeting.room].filter(Boolean).join(" · ")}
          </Text>
        ) : null}
      </View>
      <View className="items-end">
        <Text className={cn("tabular-nums", emphasis ? "text-[15px] font-medium" : "text-muted-foreground text-sm")}>
          {display12h(occ.meeting.start)}
        </Text>
        {emphasis && startsIn > 0 ? (
          <Text className="text-muted-foreground text-xs">in {formatDuration(startsIn)}</Text>
        ) : null}
      </View>
    </View>
  );
}
