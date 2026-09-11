import { ChevronLeft, ChevronRight, Share } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";

import type { EditableAgendaItem } from "@/components/calendar/CalendarDayPopover";
import { CalendarMonth } from "@/components/calendar/CalendarMonth";
import { ComingSoonButton } from "@/components/ComingSoonButton";
import { ItemEditorDialog, type EditorTarget } from "@/components/ItemEditorDialog";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { colors } from "@/constants/theme";
import { getHolidays } from "@/constants/holidays";
import { useCourses, useDatedNotes, useEvents, useTasks } from "@/context/store";
import { MONTH_NAMES } from "@/lib/calendar";
import { useBreakpoint } from "@/lib/useBreakpoint";
import { cn } from "@/lib/utils";

const EVENTS_TO_EXPORT = [
  "All events",
  "Events related to categories",
  "Events related to courses",
  "Events related to groups",
  "My personal events",
] as const;

const TIME_PERIODS = ["This week", "This month", "Recent and next 60 days", "Custom range"] as const;

function RadioList({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View className="gap-1">
      <Text className="mb-1 text-sm font-semibold">{label}</Text>
      <View role="radiogroup" aria-label={label}>
        {options.map((o) => {
          const on = o === value;
          return (
            <Pressable
              key={o}
              onPress={() => onChange(o)}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              className="flex-row items-center gap-3 rounded-md px-2 py-1.5 web:transition-colors web:hover:bg-accent active:bg-accent"
            >
              <View className={cn("size-4 items-center justify-center rounded-full border", on ? "border-primary" : "border-input")}>
                {on ? <View className="bg-primary size-2 rounded-full" /> : null}
              </View>
              <Text className="text-sm">{o}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function ExportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [events, setEvents] = useState<string>(EVENTS_TO_EXPORT[0]);
  const [period, setPeriod] = useState<string>(TIME_PERIODS[0]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export calendar</DialogTitle>
          <DialogDescription>
            Choose what to include, then generate a subscribable calendar URL. Not wired up yet.
          </DialogDescription>
        </DialogHeader>
        <RadioList label="Events to export" options={EVENTS_TO_EXPORT} value={events} onChange={setEvents} />
        <RadioList label="Time period" options={TIME_PERIODS} value={period} onChange={setPeriod} />
        <View className="flex-row gap-2">
          <ComingSoonButton label="Get calendar URL" style={{ flex: 1 }} />
          <ComingSoonButton label="Export" style={{ flex: 1 }} />
        </View>
      </DialogContent>
    </Dialog>
  );
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
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const sources = useMemo(() => ({ courses, tasks, events, notes }), [courses, tasks, events, notes]);
  const monthHolidays = useMemo(
    () => getHolidays(year).filter((h) => Number(h.date.slice(5, 7)) === month + 1),
    [year, month]
  );

  const shift = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  };
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth();

  const edit = useCallback((item: EditableAgendaItem) => {
    if (item.kind === "task") setEditor({ mode: "edit", kind: "task", task: item.task });
    else if (item.kind === "event") setEditor({ mode: "edit", kind: "event", event: item.event });
    else setEditor({ mode: "edit", kind: "note", note: item.note });
  }, []);

  // Keep a dragged range lit while its create dialog is open.
  const highlight = editor?.mode === "create" ? { start: editor.start, end: editor.end } : null;

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName={cn("w-full max-w-[1120px] self-center pb-16", desktop ? "px-10 pt-10" : "px-5 pt-6")}
    >
      <ScreenHeader
        eyebrow="Calendar"
        title={`${MONTH_NAMES[month]} ${year}`}
        subtitle={
          Platform.OS === "web"
            ? "Click a day to see what's on · drag across days to add something"
            : "Tap a day to see what's on · hold and drag to add something"
        }
        right={
          <>
            {!isCurrentMonth ? (
              <Button
                variant="outline"
                size="sm"
                onPress={() => {
                  setYear(today.getFullYear());
                  setMonth(today.getMonth());
                }}
              >
                <Text>Today</Text>
              </Button>
            ) : null}
            <Button variant="ghost" size="icon" onPress={() => shift(-1)} accessibilityLabel="Previous month">
              <Icon as={ChevronLeft} size={18} />
            </Button>
            <Button variant="ghost" size="icon" onPress={() => shift(1)} accessibilityLabel="Next month">
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
        <CalendarMonth
          year={year}
          month={month}
          sources={sources}
          highlight={highlight}
          onCreateRange={(start, end) => setEditor({ mode: "create", start, end })}
          onEdit={edit}
          onToggleTask={(task, done) => updateTask(task.id, { done })}
        />
      </View>
      <Legend />

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

      <ItemEditorDialog target={editor} onClose={() => setEditor(null)} />
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
    </ScrollView>
  );
}
