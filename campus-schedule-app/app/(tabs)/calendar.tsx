import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { colors, radius, spacing, type Palette } from "@/constants/theme";
import { ThemeToggle, useTheme } from "@/context/theme";
import { ComingSoonButton } from "@/components/ComingSoonButton";
import type { EditableAgendaItem } from "@/components/calendar/CalendarDayPopover";
import { CalendarMonth } from "@/components/calendar/CalendarMonth";
import { ItemEditorDialog, type EditorTarget } from "@/components/ItemEditorDialog";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text as UIText } from "@/components/ui/text";
import { getHolidays } from "@/constants/holidays";
import { useCourses, useDatedNotes, useEvents, useTasks } from "@/context/store";
import { MONTH_NAMES } from "@/lib/calendar";

const EVENTS_TO_EXPORT = [
  "All events",
  "Events related to categories",
  "Events related to courses",
  "Events related to groups",
  "My personal events",
] as const;

const TIME_PERIODS = [
  "This week",
  "This month",
  "Recent and next 60 days",
  "Custom range",
] as const;

function RadioRow({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const styles = makeStyles(useTheme());
  return (
    <Pressable style={styles.radioRow} onPress={onSelect}>
      <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>
        {selected ? <View style={styles.radioInner} /> : null}
      </View>
      <Text style={styles.radioLabel}>{label}</Text>
    </Pressable>
  );
}

function MonthCalendar() {
  const { courses } = useCourses();
  const { tasks, updateTask } = useTasks();
  const { events } = useEvents();
  const { notes } = useDatedNotes();
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [editor, setEditor] = useState<EditorTarget | null>(null);

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
    <View>
      <View style={styles.monthHeader}>
        <Text style={styles.monthTitle} accessibilityRole="header">
          {MONTH_NAMES[month]} {year}
        </Text>
        <View style={styles.monthNav}>
          {!isCurrentMonth ? (
            <Button
              variant="outline"
              size="sm"
              onPress={() => {
                setYear(today.getFullYear());
                setMonth(today.getMonth());
              }}
            >
              <UIText>Today</UIText>
            </Button>
          ) : null}
          <Button variant="ghost" size="icon" onPress={() => shift(-1)} accessibilityLabel="Previous month">
            <Icon as={ChevronLeft} size={18} />
          </Button>
          <Button variant="ghost" size="icon" onPress={() => shift(1)} accessibilityLabel="Next month">
            <Icon as={ChevronRight} size={18} />
          </Button>
        </View>
      </View>

      <View style={styles.monthGrid}>
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

      <View style={styles.legendRow}>
        <LegendItem label="Class">
          <View className="size-1.5 rounded-full" style={{ backgroundColor: colors.accent }} />
        </LegendItem>
        <LegendItem label="Event">
          <View className="bg-primary h-[3px] w-2 rounded-full" />
        </LegendItem>
        <LegendItem label="Task">
          <View className="size-[7px] rounded-[2px] border border-foreground/70" />
        </LegendItem>
        <LegendItem label="Note">
          <View className="size-[7px] rounded-full border border-muted-foreground" />
        </LegendItem>
        <LegendItem label="Holiday">
          <View className="size-[6px] rotate-45" style={{ backgroundColor: colors.holidayRegular }} />
        </LegendItem>
      </View>

      <ItemEditorDialog target={editor} onClose={() => setEditor(null)} />

      <Text style={styles.sectionSubTitle}>Holidays in {MONTH_NAMES[month]}</Text>
      {monthHolidays.length === 0 ? (
        <Text style={styles.sectionHint}>No holidays this month.</Text>
      ) : (
        monthHolidays.map((h) => (
          <View key={h.date + h.name} style={styles.holidayRow}>
            <View
              style={[
                styles.holidayDot,
                {
                  backgroundColor:
                    h.type === "regular" ? colors.holidayRegular : colors.holidaySpecial,
                },
              ]}
            />
            <Text style={styles.holidayDate}>{Number(h.date.slice(8, 10))}</Text>
            <Text style={styles.holidayName} numberOfLines={2}>
              {h.name}
              {h.approx ? " *" : ""}
            </Text>
          </View>
        ))
      )}
      <Text style={styles.disclaimer}>
        Philippine holidays. Movable dates (Holy Week, Chinese New Year) are
        computed; items marked “*” (Eid&apos;l Fitr / Adha) depend on moon
        sighting and are estimates. Always confirm against the official
        Malacañang proclamation for the year.
      </Text>
    </View>
  );
}

function LegendItem({ label, children }: { label: string; children: React.ReactNode }) {
  const styles = makeStyles(useTheme());
  return (
    <View style={styles.legendItem}>
      {children}
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

export default function CalendarScreen() {
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
  const [eventsChoice, setEventsChoice] = useState<string>(EVENTS_TO_EXPORT[0]);
  const [periodChoice, setPeriodChoice] = useState<string>(TIME_PERIODS[0]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Calendar</Text>
        <ThemeToggle />
      </View>
      <Text style={styles.sectionHint}>
        {Platform.OS === "web"
          ? "Click a day to see what's on. Drag across days to add a task, event or note."
          : "Tap a day to see what's on. Hold and drag across days to add a task, event or note."}
      </Text>

      <MonthCalendar />

      <View style={styles.divider} />

      <Text style={styles.sectionTitle}>Export calendar</Text>
      <Text style={styles.sectionHint}>
        Choose what to include and a time range, then generate a subscribable
        calendar URL. (UI only — no export logic yet.)
      </Text>

      <Text style={styles.fieldLabel}>Events to export</Text>
      <View style={styles.optionGroup}>
        {EVENTS_TO_EXPORT.map((option) => (
          <RadioRow
            key={option}
            label={option}
            selected={eventsChoice === option}
            onSelect={() => setEventsChoice(option)}
          />
        ))}
      </View>

      <Text style={styles.fieldLabel}>Time period</Text>
      <View style={styles.optionGroup}>
        {TIME_PERIODS.map((option) => (
          <RadioRow
            key={option}
            label={option}
            selected={periodChoice === option}
            onSelect={() => setPeriodChoice(option)}
          />
        ))}
      </View>

      <View style={styles.buttonRow}>
        <ComingSoonButton label="Get calendar URL" style={styles.button} />
        <ComingSoonButton label="Export" style={styles.button} />
      </View>
    </ScrollView>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  screen: {
    flex: 1,
    backgroundColor: t.bg,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    width: "100%",
    maxWidth: 1040,
    alignSelf: "center",
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: t.text,
    marginBottom: spacing.md,
  },
  monthHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  monthTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: t.text,
  },
  monthNav: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  monthGrid: {
    backgroundColor: t.surface,
    borderRadius: radius.md,
    padding: spacing.sm,
    // Web gives every View its own stacking context, so lift the whole grid
    // (and its day popover) above the legend/holiday list that follow it.
    zIndex: 10,
  },
  legendRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  legendText: {
    fontSize: 11,
    color: t.muted,
  },
  sectionSubTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: t.text,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  holidayRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  holidayDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  holidayDate: {
    width: 22,
    fontSize: 13,
    fontWeight: "700",
    color: t.text,
  },
  holidayName: {
    flex: 1,
    fontSize: 13,
    color: t.text,
  },
  disclaimer: {
    fontSize: 11,
    color: t.muted,
    lineHeight: 16,
    marginTop: spacing.sm,
  },
  divider: {
    height: 1,
    backgroundColor: t.border,
    marginVertical: spacing.lg,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: t.text,
  },
  sectionHint: {
    fontSize: 13,
    color: t.muted,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: t.text,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  optionGroup: {
    gap: spacing.xs,
  },
  radioRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.xs,
    gap: spacing.sm,
  },
  radioOuter: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: t.border,
    alignItems: "center",
    justifyContent: "center",
  },
  radioOuterSelected: {
    borderColor: colors.accent,
  },
  radioInner: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.accent,
  },
  radioLabel: {
    fontSize: 14,
    color: t.text,
  },
  buttonRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  button: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.sm,
    alignItems: "center",
  },
  buttonSecondary: {
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.border,
  },
  buttonSecondaryText: {
    color: t.text,
    fontWeight: "600",
  },
  buttonPrimary: {
    backgroundColor: colors.accent,
  },
  buttonPrimaryText: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
});
