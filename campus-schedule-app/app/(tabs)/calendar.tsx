import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { colors, radius, spacing } from "@/constants/theme";
import { getHolidays, holidayMap, type Holiday } from "@/constants/holidays";
import { useCourses } from "@/context/store";
import { formatRange, occurrencesOnDay } from "@/lib/schedule";
import type { Weekday } from "@/context/store";

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

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function RadioRow({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Pressable style={styles.radioRow} onPress={onSelect}>
      <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>
        {selected ? <View style={styles.radioInner} /> : null}
      </View>
      <Text style={styles.radioLabel}>{label}</Text>
    </Pressable>
  );
}

type DayCell = {
  day: number;
  iso: string;
  weekday: Weekday;
  isToday: boolean;
  holidays: Holiday[];
  classColors: string[];
};

function buildMonth(
  year: number,
  month: number, // 0-indexed
  classColorsByWeekday: string[][]
): (DayCell | null)[] {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leading = first.getDay(); // 0=Sun
  const holidays = holidayMap(year);

  const today = new Date();
  const todayIso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  const cells: (DayCell | null)[] = [];
  for (let i = 0; i < leading; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${pad(month + 1)}-${pad(d)}`;
    const weekday = new Date(year, month, d).getDay() as Weekday;
    cells.push({
      day: d,
      iso,
      weekday,
      isToday: iso === todayIso,
      holidays: holidays.get(iso) ?? [],
      classColors: classColorsByWeekday[weekday],
    });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function MonthCalendar() {
  const { courses } = useCourses();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedIso, setSelectedIso] = useState<string | null>(null);

  const classColorsByWeekday = useMemo(() => {
    const arr: string[][] = [];
    for (let w = 0; w < 7; w++) {
      const seen: string[] = [];
      for (const o of occurrencesOnDay(courses, w as Weekday)) {
        if (!seen.includes(o.course.color)) seen.push(o.course.color);
      }
      arr.push(seen);
    }
    return arr;
  }, [courses]);

  const cells = useMemo(
    () => buildMonth(year, month, classColorsByWeekday),
    [year, month, classColorsByWeekday]
  );

  const monthHolidays = useMemo(
    () => getHolidays(year).filter((h) => Number(h.date.slice(5, 7)) === month + 1),
    [year, month]
  );

  const shift = (delta: number) => {
    setSelectedIso(null);
    const m = month + delta;
    if (m < 0) {
      setMonth(11);
      setYear((y) => y - 1);
    } else if (m > 11) {
      setMonth(0);
      setYear((y) => y + 1);
    } else {
      setMonth(m);
    }
  };

  const selectedCell = selectedIso
    ? cells.find((c) => c && c.iso === selectedIso) ?? null
    : null;
  const selectedClasses = selectedCell
    ? occurrencesOnDay(courses, selectedCell.weekday)
    : [];

  return (
    <View>
      <View style={styles.monthHeader}>
        <Pressable onPress={() => shift(-1)} hitSlop={10} style={styles.navBtn}>
          <Text style={styles.navBtnText}>‹</Text>
        </Pressable>
        <Text style={styles.monthTitle}>
          {MONTH_NAMES[month]} {year}
        </Text>
        <Pressable onPress={() => shift(1)} hitSlop={10} style={styles.navBtn}>
          <Text style={styles.navBtnText}>›</Text>
        </Pressable>
      </View>

      <View style={styles.monthGrid}>
        <View style={styles.weekdayRow}>
          {WEEKDAY_LABELS.map((d, i) => (
            <Text key={`${d}-${i}`} style={styles.weekdayLabel}>
              {d}
            </Text>
          ))}
        </View>
        <View style={styles.daysWrap}>
          {cells.map((cell, i) => {
            if (!cell) return <View key={i} style={styles.dayCell} />;
            const regular = cell.holidays.some((h) => h.type === "regular");
            const special = cell.holidays.length > 0 && !regular;
            const selected = cell.iso === selectedIso;
            return (
              <Pressable
                key={i}
                style={styles.dayCell}
                onPress={() => setSelectedIso(selected ? null : cell.iso)}
              >
                <View
                  style={[
                    styles.dayInner,
                    cell.isToday && styles.dayToday,
                    selected && styles.daySelected,
                  ]}
                >
                  <Text
                    style={[
                      styles.dayText,
                      cell.isToday && styles.dayTextToday,
                      regular && styles.dayTextHoliday,
                    ]}
                  >
                    {cell.day}
                  </Text>
                  <View style={styles.dotRow}>
                    {(regular || special) && (
                      <View
                        style={[
                          styles.marker,
                          {
                            backgroundColor: regular
                              ? colors.holidayRegular
                              : colors.holidaySpecial,
                          },
                        ]}
                      />
                    )}
                    {cell.classColors.slice(0, 3).map((c, ci) => (
                      <View key={ci} style={[styles.marker, { backgroundColor: c }]} />
                    ))}
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.legendRow}>
        <Legend color={colors.holidayRegular} label="Regular holiday" />
        <Legend color={colors.holidaySpecial} label="Special day" />
        <Legend color={colors.accent} label="Class (course color)" />
      </View>

      {selectedCell ? (
        <View style={styles.selectedCard}>
          <Text style={styles.selectedDate}>
            {new Date(selectedCell.iso + "T00:00:00").toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </Text>
          {selectedCell.holidays.map((h, i) => (
            <Text key={i} style={styles.selectedHoliday}>
              {h.type === "regular" ? "🇵🇭" : "•"} {h.name}
              {h.approx ? "  (date approximate)" : ""}
            </Text>
          ))}
          {selectedClasses.length > 0 ? (
            selectedClasses.map((o, i) => (
              <Text key={`c-${i}`} style={styles.selectedClass}>
                📚 {o.course.code} · {formatRange(o.meeting.start, o.meeting.end)}
                {o.meeting.room ? ` · ${o.meeting.room}` : ""}
              </Text>
            ))
          ) : null}
          {selectedCell.holidays.length === 0 && selectedClasses.length === 0 ? (
            <Text style={styles.selectedEmpty}>Nothing on this day.</Text>
          ) : null}
        </View>
      ) : null}

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

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.marker, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

export default function CalendarScreen() {
  const [eventsChoice, setEventsChoice] = useState<string>(EVENTS_TO_EXPORT[0]);
  const [periodChoice, setPeriodChoice] = useState<string>(TIME_PERIODS[0]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Calendar</Text>

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
        <Pressable style={[styles.button, styles.buttonSecondary]}>
          <Text style={styles.buttonSecondaryText}>Get calendar URL</Text>
        </Pressable>
        <Pressable style={[styles.button, styles.buttonPrimary]}>
          <Text style={styles.buttonPrimaryText}>Export</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.lightBg,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.lightText,
    marginBottom: spacing.md,
  },
  monthHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  monthTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.lightText,
  },
  navBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.lightSurface,
  },
  navBtnText: {
    fontSize: 20,
    color: colors.lightText,
    lineHeight: 22,
  },
  monthGrid: {
    backgroundColor: colors.lightSurface,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  weekdayRow: {
    flexDirection: "row",
    marginBottom: spacing.xs,
  },
  weekdayLabel: {
    width: `${100 / 7}%`,
    textAlign: "center",
    fontSize: 12,
    color: colors.lightMuted,
    fontWeight: "600",
  },
  daysWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  dayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 2,
  },
  dayInner: {
    width: "100%",
    height: "100%",
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  dayToday: {
    backgroundColor: colors.today,
  },
  daySelected: {
    borderWidth: 2,
    borderColor: colors.lightText,
  },
  dayText: {
    fontSize: 13,
    color: colors.lightText,
  },
  dayTextToday: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  dayTextHoliday: {
    color: colors.holidayRegular,
    fontWeight: "700",
  },
  dotRow: {
    flexDirection: "row",
    gap: 2,
    marginTop: 2,
    height: 4,
  },
  marker: {
    width: 4,
    height: 4,
    borderRadius: 2,
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
    color: colors.lightMuted,
  },
  selectedCard: {
    marginTop: spacing.md,
    backgroundColor: colors.lightSurface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  selectedDate: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.lightText,
    marginBottom: spacing.xs,
  },
  selectedHoliday: {
    fontSize: 13,
    color: colors.holidayRegular,
  },
  selectedClass: {
    fontSize: 13,
    color: colors.lightText,
  },
  selectedEmpty: {
    fontSize: 13,
    color: colors.lightMuted,
  },
  sectionSubTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.lightText,
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
    color: colors.lightText,
  },
  holidayName: {
    flex: 1,
    fontSize: 13,
    color: colors.lightText,
  },
  disclaimer: {
    fontSize: 11,
    color: colors.lightMuted,
    lineHeight: 16,
    marginTop: spacing.sm,
  },
  divider: {
    height: 1,
    backgroundColor: colors.lightBorder,
    marginVertical: spacing.lg,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.lightText,
  },
  sectionHint: {
    fontSize: 13,
    color: colors.lightMuted,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.lightText,
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
    borderColor: colors.lightBorder,
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
    color: colors.lightText,
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
    backgroundColor: colors.lightSurface,
    borderWidth: 1,
    borderColor: colors.lightBorder,
  },
  buttonSecondaryText: {
    color: colors.lightText,
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
