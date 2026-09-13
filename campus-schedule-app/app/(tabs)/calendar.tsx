import { ChevronLeft, ChevronRight, Share } from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, ScrollView, View } from "react-native";

import type { EditableAgendaItem } from "@/components/calendar/CalendarDayPopover";
import { CalendarMonth } from "@/components/calendar/CalendarMonth";
import { CalendarWeek } from "@/components/calendar/CalendarWeek";
import { ClassOccurrenceDialog } from "@/components/calendar/ClassOccurrenceDialog";
import { ExportIcsDialog } from "@/components/calendar/ExportIcsDialog";
import { ItemEditorDialog, type EditorTarget } from "@/components/ItemEditorDialog";
import { ScreenHeader } from "@/components/ScreenHeader";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { colors } from "@/constants/theme";
import { getHolidays } from "@/constants/holidays";
import {
  useCancellations,
  useCourses,
  useDatedNotes,
  useEvents,
  useScheduleRules,
  useTasks,
} from "@/context/store";
import { MONTH_NAMES } from "@/lib/calendar";
import { addDaysIso, isoToDate, startOfWeekIso } from "@/lib/dates";
import type { DatedOccurrence } from "@/lib/schedule";
import { shouldIgnoreShortcut } from "@/lib/shortcuts";
import { isoDate } from "@/lib/tasks";
import { useBreakpoint } from "@/lib/useBreakpoint";
import { cn } from "@/lib/utils";

type CalendarView = "month" | "week";
const VIEW_KEY = "campus-schedule-cache:calendar-view";

function readSavedView(): CalendarView {
  if (Platform.OS !== "web") return "month";
  try {
    return localStorage.getItem(VIEW_KEY) === "week" ? "week" : "month";
  } catch {
    return "month";
  }
}

/** "Sep 14 – 20, 2026", "Aug 31 – Sep 6, 2026", "Dec 29, 2025 – Jan 4, 2026". */
function formatWeekRange(weekStart: string): string {
  const a = isoToDate(weekStart);
  const b = isoToDate(addDaysIso(weekStart, 6));
  const mon = (d: Date) => d.toLocaleDateString(undefined, { month: "short" });
  if (a.getFullYear() !== b.getFullYear())
    return `${mon(a)} ${a.getDate()}, ${a.getFullYear()} – ${mon(b)} ${b.getDate()}, ${b.getFullYear()}`;
  if (a.getMonth() !== b.getMonth()) return `${mon(a)} ${a.getDate()} – ${mon(b)} ${b.getDate()}, ${b.getFullYear()}`;
  return `${mon(a)} ${a.getDate()} – ${b.getDate()}, ${b.getFullYear()}`;
}

function Legend() {
  const Item = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <View className="flex-row items-center gap-1.5">
      {children}
      <Text className="text-muted-foreground text-xs">{label}</Text>
    </View>
  );
  return (
    <View className="mt-3 flex-row flex-wrap gap-x-4 gap-y-1 px-1">
      <Item label="Class">
        <View className="size-1.5 rounded-full" style={{ backgroundColor: colors.courseColors[0] }} />
      </Item>
      <Item label="Event">
        <View className="bg-primary h-[3px] w-2 rounded-full" />
      </Item>
      <Item label="Task">
        <View className="border-foreground/70 size-[7px] rounded-[2px] border" />
      </Item>
      <Item label="Note">
        <View className="border-muted-foreground size-[7px] rounded-full border" />
      </Item>
      <Item label="Holiday">
        <View className="size-[6px] rotate-45" style={{ backgroundColor: colors.holidayRegular }} />
      </Item>
    </View>
  );
}

export default function CalendarScreen() {
  const { courses } = useCourses();
  const { tasks, updateTask } = useTasks();
  const { events } = useEvents();
  const { notes } = useDatedNotes();
  const { desktop } = useBreakpoint();
  const today = new Date();
  const todayIso = isoDate(today);
  const [view, setViewState] = useState<CalendarView>(readSavedView);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [weekStart, setWeekStart] = useState(() => startOfWeekIso(todayIso));
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [classOcc, setClassOcc] = useState<DatedOccurrence | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const rules = useScheduleRules();
  const { cancelClass, restoreClass } = useCancellations();
  const sources = useMemo(
    () => ({ courses, tasks, events, notes, rules }),
    [courses, tasks, events, notes, rules]
  );
  const monthHolidays = useMemo(
    () => getHolidays(year).filter((h) => Number(h.date.slice(5, 7)) === month + 1),
    [year, month]
  );

  const setView = (next: CalendarView) => {
    if (next === view) return;
    if (next === "week") {
      // Show the week of today if this month is on screen, else the month's first week.
      const isCurrent = year === today.getFullYear() && month === today.getMonth();
      setWeekStart(startOfWeekIso(isCurrent ? todayIso : isoDate(new Date(year, month, 1))));
    } else {
      const mid = isoToDate(addDaysIso(weekStart, 3));
      setYear(mid.getFullYear());
      setMonth(mid.getMonth());
    }
    setViewState(next);
    if (Platform.OS === "web") {
      try {
        localStorage.setItem(VIEW_KEY, next);
      } catch {
        // Remembering the view is only a convenience.
      }
    }
  };

  const shift = (delta: number) => {
    if (view === "week") {
      setWeekStart((w) => addDaysIso(w, delta * 7));
      return;
    }
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  };
  const goToday = () => {
    setYear(today.getFullYear());
    setMonth(today.getMonth());
    setWeekStart(startOfWeekIso(todayIso));
  };
  const onToday =
    view === "week"
      ? weekStart === startOfWeekIso(todayIso)
      : year === today.getFullYear() && month === today.getMonth();

  const edit = useCallback((item: EditableAgendaItem) => {
    if (item.kind === "task") setEditor({ mode: "edit", kind: "task", task: item.task });
    else if (item.kind === "event") setEditor({ mode: "edit", kind: "event", event: item.event });
    else setEditor({ mode: "edit", kind: "note", note: item.note });
  }, []);

  const cancel = (o: DatedOccurrence) => cancelClass({ courseId: o.course.id, date: o.date, start: o.meeting.start });
  const restore = (o: DatedOccurrence) => o.cancellation && restoreClass(o.cancellation.id);

  // Deep links from search / shortcuts: ?today=1, ?event=<id>.
  const params = useLocalSearchParams<{ today?: string; event?: string }>();
  useEffect(() => {
    if (params.today) {
      goToday();
      router.setParams({ today: undefined });
    }
    if (params.event) {
      const ev = events.find((e) => e.id === params.event);
      if (ev) {
        const d = isoToDate(ev.start);
        setYear(d.getFullYear());
        setMonth(d.getMonth());
        setWeekStart(startOfWeekIso(ev.start));
        setEditor({ mode: "edit", kind: "event", event: ev });
      }
      router.setParams({ event: undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.today, params.event]);

  // ← / → move between months (or weeks).
  const shiftRef = useRef(shift);
  shiftRef.current = shift;
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== "ArrowLeft" && e.key !== "ArrowRight") || shouldIgnoreShortcut(e)) return;
      e.preventDefault();
      shiftRef.current(e.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Keep a dragged range lit while its create dialog is open.
  const highlight = editor?.mode === "create" ? { start: editor.start, end: editor.end } : null;

  const hint =
    view === "week"
      ? Platform.OS === "web"
        ? "Click a class to cancel or restore it · click an empty slot to add an event"
        : "Tap a class to cancel or restore it · tap an empty slot to add an event"
      : Platform.OS === "web"
        ? "Click a day to see what's on · drag across days to add something"
        : "Tap a day to see what's on · hold and drag to add something";

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName={cn("w-full max-w-[1120px] self-center pb-16", desktop ? "px-10 pt-10" : "px-5 pt-6")}
    >
      <ScreenHeader
        eyebrow="Calendar"
        title={view === "week" ? formatWeekRange(weekStart) : `${MONTH_NAMES[month]} ${year}`}
        subtitle={hint}
        right={
          <>
            <SegmentedControl<CalendarView>
              value={view}
              onChange={setView}
              options={[
                { value: "month", label: "Month" },
                { value: "week", label: "Week" },
              ]}
              accessibilityLabel="Calendar view"
              className="mr-1"
            />
            {!onToday ? (
              <Button variant="outline" size="sm" onPress={goToday}>
                <Text>Today</Text>
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              onPress={() => shift(-1)}
              accessibilityLabel={view === "week" ? "Previous week" : "Previous month"}
            >
              <Icon as={ChevronLeft} size={18} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onPress={() => shift(1)}
              accessibilityLabel={view === "week" ? "Next week" : "Next month"}
            >
              <Icon as={ChevronRight} size={18} />
            </Button>
            <Button variant="ghost" size="icon" onPress={() => setExportOpen(true)} accessibilityLabel="Export calendar">
              <Icon as={Share} size={16} className="text-muted-foreground" />
            </Button>
          </>
        }
      />

      {/* z-10: web gives every View a stacking context; keep the popover above what follows. */}
      <View className="bg-card/80 border-border z-10 rounded-xl border px-1.5 pb-1.5 pt-3 shadow-sm shadow-black/5">
        {view === "week" ? (
          <CalendarWeek
            weekStart={weekStart}
            sources={sources}
            onEdit={edit}
            onCreateAt={(iso, hhmm) => setEditor({ mode: "create", start: iso, end: iso, type: "event", startTime: hhmm })}
            onClassPress={setClassOcc}
          />
        ) : (
          <CalendarMonth
            year={year}
            month={month}
            sources={sources}
            highlight={highlight}
            onCreateRange={(start, end) => setEditor({ mode: "create", start, end })}
            onEdit={edit}
            onToggleTask={(task, done) => updateTask(task.id, { done })}
            onCancelClass={cancel}
            onRestoreClass={restore}
          />
        )}
      </View>
      {view === "month" ? <Legend /> : null}

      {view === "month" ? (
        <View className="mt-10 max-w-[560px]">
          <Text className="mb-2 text-[15px] font-semibold">Holidays in {MONTH_NAMES[month]}</Text>
          {monthHolidays.length === 0 ? (
            <Text className="text-muted-foreground text-sm">No holidays this month.</Text>
          ) : (
            monthHolidays.map((h) => (
              <View key={h.date + h.name} className="border-border/60 flex-row items-center gap-3 border-b py-2.5">
                <Text className="text-muted-foreground w-8 text-sm tabular-nums">{Number(h.date.slice(8, 10))}</Text>
                <View
                  className="size-[6px] rotate-45"
                  style={{ backgroundColor: h.type === "regular" ? colors.holidayRegular : colors.holidaySpecial }}
                />
                <Text className="flex-1 text-sm">
                  {h.name}
                  {h.approx ? <Text className="text-muted-foreground text-sm"> (estimated)</Text> : null}
                </Text>
                <Text className="text-muted-foreground text-xs">{h.type === "regular" ? "Regular" : "Special"}</Text>
              </View>
            ))
          )}
          <Text className="text-muted-foreground mt-3 text-xs leading-4">
            Philippine holidays. Movable dates (Holy Week, Chinese New Year) are computed; Eid&apos;l Fitr / Adha
            depend on moon sighting and are estimates. Always confirm against the official Malacañang proclamation.
          </Text>
        </View>
      ) : null}

      <ItemEditorDialog target={editor} onClose={() => setEditor(null)} />
      <ClassOccurrenceDialog occ={classOcc} onClose={() => setClassOcc(null)} onCancelClass={cancel} onRestoreClass={restore} />
      <ExportIcsDialog open={exportOpen} onOpenChange={setExportOpen} />
    </ScrollView>
  );
}
