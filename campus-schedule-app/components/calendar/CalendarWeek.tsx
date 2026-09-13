import { useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, View, type GestureResponderEvent } from "react-native";

import type { EditableAgendaItem } from "@/components/calendar/CalendarDayPopover";
import { Text } from "@/components/ui/text";
import { colors } from "@/constants/theme";
import { holidayMap, type Holiday } from "@/constants/holidays";
import type { CalendarEvent, Course, DatedNote, Task } from "@/context/store";
import { formatShortDate, spansDate } from "@/lib/calendar";
import { addDaysIso } from "@/lib/dates";
import { projectedDates } from "@/lib/recurrence";
import {
  WEEKDAY_SHORT,
  display12h,
  formatRange,
  occurrencesOnDate,
  type DatedOccurrence,
  type ScheduleRules,
} from "@/lib/schedule";
import { isoDate } from "@/lib/tasks";
import { useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";

// Monday–Sunday on an hour timeline (like macOS Calendar's week view).
// Pure layout over existing data: classes (with term/holiday/cancellation
// status), timed events, and timed task deadlines. Overlapping items share
// the width side by side; all-day things sit in a strip above the grid.

const HOUR_H = 52;
const GUTTER_W = 52;
const MIN_COL_W = 92;
const DEFAULT_START_HOUR = 7;
const DEFAULT_END_HOUR = 21;
/** A deadline is drawn as a short block ending at the due time. */
const DEADLINE_MIN = 30;
const MIN_BLOCK_H = 20;

type Sources = {
  courses: Course[];
  tasks: Task[];
  events: CalendarEvent[];
  notes: DatedNote[];
  rules: ScheduleRules;
};

type Block =
  | { kind: "class"; key: string; start: number; end: number; occ: DatedOccurrence }
  | { kind: "event"; key: string; start: number; end: number; event: CalendarEvent; label: string }
  | { kind: "task"; key: string; start: number; end: number; task: Task; projected: boolean };

type Placed = Block & { col: number; cols: number };

type AllDay =
  | { kind: "holiday"; key: string; title: string; holiday: Holiday }
  | { kind: "event"; key: string; title: string; event: CalendarEvent }
  | { kind: "task"; key: string; title: string; task: Task }
  | { kind: "note"; key: string; title: string; note: DatedNote };

const mins = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

const hourLabel = (h: number) => (h === 0 || h === 24 ? "12 AM" : h === 12 ? "Noon" : h < 12 ? `${h} AM` : `${h - 12} PM`);

/** Side-by-side columns for overlapping blocks (greedy interval packing). */
export function layoutOverlaps(blocks: Block[]): Placed[] {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Placed[] = [];
  let cluster: Placed[] = [];
  let colEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    for (const p of cluster) p.cols = colEnds.length;
    out.push(...cluster);
    cluster = [];
    colEnds = [];
  };
  for (const b of sorted) {
    if (cluster.length && b.start >= clusterEnd) flush();
    let col = colEnds.findIndex((end) => end <= b.start);
    if (col < 0) {
      col = colEnds.length;
      colEnds.push(b.end);
    } else colEnds[col] = b.end;
    cluster.push({ ...b, col, cols: 1 });
    clusterEnd = Math.max(clusterEnd, b.end);
  }
  flush();
  return out;
}

function daysOfWeek(weekStart: string) {
  return Array.from({ length: 7 }, (_, i) => addDaysIso(weekStart, i));
}

export function CalendarWeek({
  weekStart,
  sources,
  onEdit,
  onCreateAt,
  onClassPress,
}: {
  /** Monday of the week, ISO. */
  weekStart: string;
  sources: Sources;
  onEdit: (item: EditableAgendaItem) => void;
  onCreateAt: (iso: string, hhmm: string) => void;
  onClassPress: (occ: DatedOccurrence) => void;
}) {
  const [width, setWidth] = useState(0);
  const now = useNow();
  const today = isoDate(now);
  const days = useMemo(() => daysOfWeek(weekStart), [weekStart]);

  const week = useMemo(() => {
    const { courses, tasks, events, notes, rules } = sources;
    const holidayCache = new Map<number, Map<string, Holiday[]>>();
    const holidaysOn = (iso: string) => {
      const y = Number(iso.slice(0, 4));
      if (!holidayCache.has(y)) holidayCache.set(y, holidayMap(y));
      return holidayCache.get(y)!.get(iso) ?? [];
    };

    return days.map((iso) => {
      const blocks: Block[] = [];
      const allDay: AllDay[] = holidaysOn(iso).map((h) => ({ kind: "holiday", key: `h-${h.name}`, title: h.name, holiday: h }));

      for (const occ of occurrencesOnDate(courses, iso, rules)) {
        if (occ.status === "outsideTerm") continue;
        blocks.push({ kind: "class", key: `c-${occ.course.id}-${occ.startMin}`, start: occ.startMin, end: occ.endMin, occ });
      }

      for (const e of events) {
        if (!spansDate(e.start, e.end, iso)) continue;
        const timed = !!e.startTime && !!e.endTime;
        if (!timed || (e.start !== iso && e.end !== iso)) {
          allDay.push({ kind: "event", key: e.id, title: e.title, event: e });
          continue;
        }
        const start = e.start === iso ? mins(e.startTime!) : 0;
        const end = e.end === iso ? mins(e.endTime!) : 24 * 60;
        const label =
          e.start === e.end ? formatRange(e.startTime!, e.endTime!) : e.start === iso ? `From ${display12h(e.startTime!)}` : `Until ${display12h(e.endTime!)}`;
        blocks.push({ kind: "event", key: e.id, start, end: Math.max(end, start + 15), event: e, label });
      }

      for (const t of tasks) {
        if (!t.due) continue;
        const projected = !!t.repeat && !t.done && iso > t.due && projectedDates(t, iso, iso, rules.term?.end).length > 0;
        const dueHere = t.due === iso || projected;
        if (dueHere && t.dueTime) {
          const end = mins(t.dueTime);
          blocks.push({ kind: "task", key: projected ? `${t.id}@${iso}` : t.id, start: Math.max(0, end - DEADLINE_MIN), end: Math.max(end, 1), task: t, projected });
        } else if (dueHere || (t.start && spansDate(t.start, t.due, iso))) {
          allDay.push({ kind: "task", key: projected ? `${t.id}@${iso}` : t.id, title: t.title || "Untitled task", task: t });
        }
      }

      for (const n of notes) {
        if (spansDate(n.date, n.endDate, iso)) allDay.push({ kind: "note", key: n.id, title: n.text.trim() || "Note", note: n });
      }

      return { iso, placed: layoutOverlaps(blocks), allDay };
    });
  }, [days, sources]);

  // Visible hours: the usual day, stretched to fit anything earlier/later.
  const [startHour, endHour] = useMemo(() => {
    let lo = DEFAULT_START_HOUR * 60;
    let hi = DEFAULT_END_HOUR * 60;
    for (const d of week)
      for (const b of d.placed) {
        lo = Math.min(lo, b.start);
        hi = Math.max(hi, b.end);
      }
    return [Math.max(0, Math.floor(lo / 60)), Math.min(24, Math.ceil(hi / 60))];
  }, [week]);

  const gridH = (endHour - startHour) * HOUR_H;
  const colW = Math.max(MIN_COL_W, (width - GUTTER_W) / 7);
  const contentW = GUTTER_W + colW * 7;
  const scrolls = contentW > width + 1;
  const top = (m: number) => ((m - startHour * 60) / 60) * HOUR_H;
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const createFromPress = (iso: string) => (e: GestureResponderEvent) => {
    const y = e.nativeEvent.locationY;
    const hour = Math.min(23, Math.max(0, startHour + Math.floor(y / HOUR_H)));
    onCreateAt(iso, `${String(hour).padStart(2, "0")}:00`);
  };

  const grid = (
    <View style={{ width: scrolls ? contentW : "100%" }}>
      {/* Day headers */}
      <View className="border-border/70 flex-row border-b pb-2">
        <View style={{ width: GUTTER_W }} />
        {days.map((iso, i) => {
          const isToday = iso === today;
          const d = Number(iso.slice(8, 10));
          return (
            <View key={iso} style={{ width: colW }} className="items-center gap-1" accessibilityRole="header">
              <Text className={cn("text-[11px] font-semibold uppercase tracking-[1px]", isToday ? "text-primary" : "text-muted-foreground")}>
                {WEEKDAY_SHORT[(i + 1) % 7]}
              </Text>
              <View className={cn("size-8 items-center justify-center rounded-full", isToday && "bg-primary")}>
                <Text className={cn("text-[15px] tabular-nums", isToday ? "text-primary-foreground font-bold" : "font-medium")}>{d}</Text>
              </View>
            </View>
          );
        })}
      </View>

      {/* All-day strip */}
      {week.some((d) => d.allDay.length) ? (
        <View className="border-border/70 flex-row border-b py-1.5">
          <View style={{ width: GUTTER_W }} className="justify-center pr-2">
            <Text className="text-muted-foreground text-right text-[10px]">all-day</Text>
          </View>
          {week.map((d) => (
            <View key={d.iso} style={{ width: colW }} className="gap-1 px-0.5">
              {d.allDay.slice(0, 3).map((a) => {
                const tint =
                  a.kind === "holiday"
                    ? { backgroundColor: `${a.holiday.type === "regular" ? colors.holidayRegular : colors.holidaySpecial}1F` }
                    : undefined;
                const editable: EditableAgendaItem | null =
                  a.kind === "event"
                    ? { kind: "event", key: a.key, title: a.title, timeLabel: "All day", sortMin: -1, event: a.event }
                    : a.kind === "task"
                      ? { kind: "task", key: a.key, title: a.title, timeLabel: "", sortMin: 0, task: a.task }
                      : a.kind === "note"
                        ? { kind: "note", key: a.key, title: a.title, note: a.note }
                        : null;
                return (
                  <Pressable
                    key={a.key}
                    disabled={!editable}
                    onPress={() => editable && onEdit(editable)}
                    accessibilityRole={editable ? "button" : "text"}
                    accessibilityLabel={`${a.title}, all day`}
                    style={tint}
                    className={cn(
                      "rounded px-1.5 py-0.5 web:transition-opacity web:hover:opacity-80",
                      a.kind === "event" && "bg-primary/15",
                      a.kind === "task" && "border-border border border-dashed",
                      a.kind === "note" && "bg-muted"
                    )}
                  >
                    <Text numberOfLines={1} className={cn("text-[11px]", a.kind === "task" && a.task.done && "text-muted-foreground line-through")}>
                      {a.title}
                    </Text>
                  </Pressable>
                );
              })}
              {d.allDay.length > 3 ? <Text className="text-muted-foreground px-1 text-[10px]">+{d.allDay.length - 3} more</Text> : null}
            </View>
          ))}
        </View>
      ) : null}

      {/* Timeline */}
      <View className="flex-row" style={{ height: gridH + 8 }}>
        <View style={{ width: GUTTER_W, height: gridH }}>
          {Array.from({ length: endHour - startHour + 1 }, (_, i) => (
            <Text
              key={i}
              className="text-muted-foreground absolute right-2 text-[10px] tabular-nums"
              style={{ top: i * HOUR_H - 6 }}
            >
              {i === 0 ? "" : hourLabel(startHour + i)}
            </Text>
          ))}
        </View>

        {week.map((d) => {
          const isToday = d.iso === today;
          return (
            <View key={d.iso} style={{ width: colW, height: gridH }} className="border-border/60 relative border-l">
              {/* Empty-slot press → create an event at that hour */}
              <Pressable
                onPress={createFromPress(d.iso)}
                accessibilityLabel={`Add an event on ${formatShortDate(d.iso)}`}
                className={cn("absolute inset-0 web:cursor-cell", isToday && "bg-primary/[0.03]")}
              />
              {Array.from({ length: endHour - startHour }, (_, i) => (
                <View key={i} pointerEvents="none" className="border-border/50 absolute left-0 right-0 border-t" style={{ top: i * HOUR_H }} />
              ))}

              {d.placed.map((b) => {
                const gap = 2;
                const style = {
                  position: "absolute" as const,
                  top: top(b.start) + 1,
                  height: Math.max(MIN_BLOCK_H, top(b.end) - top(b.start) - 2),
                  left: `${(b.col / b.cols) * 100}%` as const,
                  width: `${100 / b.cols}%` as const,
                  paddingHorizontal: gap / 2,
                };
                if (b.kind === "class") {
                  const off = b.occ.status !== "scheduled";
                  const status = b.occ.status === "cancelled" ? "Cancelled" : b.occ.status === "holiday" ? "Holiday" : null;
                  return (
                    <Pressable
                      key={b.key}
                      style={style}
                      onPress={() => onClassPress(b.occ)}
                      accessibilityRole="button"
                      accessibilityLabel={`${b.occ.course.code}, ${formatRange(b.occ.meeting.start, b.occ.meeting.end)}${status ? `, ${status}` : ""}`}
                    >
                      <View
                        className={cn("flex-1 overflow-hidden rounded-md border-l-[3px] px-1.5 py-1 web:transition-opacity web:hover:opacity-85", off && "opacity-55")}
                        style={{ borderLeftColor: b.occ.course.color, backgroundColor: `${b.occ.course.color}${off ? "14" : "26"}` }}
                      >
                        <Text numberOfLines={1} className={cn("text-[11.5px] font-semibold", off && "line-through")}>
                          {b.occ.course.code}
                        </Text>
                        <Text numberOfLines={1} className="text-muted-foreground text-[10.5px]">
                          {status ?? `${display12h(b.occ.meeting.start)}${b.occ.meeting.room ? ` · ${b.occ.meeting.room}` : ""}`}
                        </Text>
                      </View>
                    </Pressable>
                  );
                }
                if (b.kind === "event") {
                  return (
                    <Pressable
                      key={b.key}
                      style={style}
                      onPress={() => onEdit({ kind: "event", key: b.key, title: b.event.title, timeLabel: b.label, sortMin: b.start, event: b.event })}
                      accessibilityRole="button"
                      accessibilityLabel={`${b.event.title}, ${b.label}`}
                    >
                      <View className="bg-primary/15 border-primary flex-1 overflow-hidden rounded-md border-l-[3px] px-1.5 py-1 web:transition-opacity web:hover:opacity-85">
                        <Text numberOfLines={1} className="text-[11.5px] font-semibold">
                          {b.event.title}
                        </Text>
                        <Text numberOfLines={1} className="text-muted-foreground text-[10.5px]">
                          {b.label}
                        </Text>
                      </View>
                    </Pressable>
                  );
                }
                const due = display12h(b.task.dueTime!);
                return (
                  <Pressable
                    key={b.key}
                    style={style}
                    onPress={() =>
                      onEdit({ kind: "task", key: b.key, title: b.task.title, timeLabel: `Due ${due}`, sortMin: b.end, task: b.task, projected: b.projected })
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`${b.task.title || "Task"}, due ${due}${b.projected ? ", repeats" : ""}`}
                  >
                    <View
                      className={cn(
                        "bg-card border-warning/70 flex-1 justify-end overflow-hidden rounded-md border border-dashed px-1.5 py-0.5 web:transition-opacity web:hover:opacity-85",
                        (b.task.done || b.projected) && "opacity-60"
                      )}
                    >
                      <Text numberOfLines={1} className={cn("text-[11px] font-medium", b.task.done && "line-through")}>
                        {b.task.title || "Untitled task"}
                      </Text>
                      <Text numberOfLines={1} className="text-muted-foreground text-[10px]">
                        Due {due}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}

              {isToday && nowMin >= startHour * 60 && nowMin <= endHour * 60 ? (
                <View pointerEvents="none" className="absolute left-0 right-0 flex-row items-center" style={{ top: top(nowMin) - 4 }} accessibilityLabel="Current time">
                  <View className="bg-destructive size-2 rounded-full" style={{ marginLeft: -4 }} />
                  <View className="bg-destructive h-[1.5px] flex-1" />
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} className={cn(Platform.OS === "web" && "select-none")}>
      {width === 0 ? null : scrolls ? (
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ width: contentW }}>
          {grid}
        </ScrollView>
      ) : (
        grid
      )}
    </View>
  );
}
