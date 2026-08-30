import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { colors, radius, spacing } from "@/constants/theme";

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

// Static placeholder month grid — no real date math or event data yet.
// It exists to establish the layout: a Folderly-style month view sits
// above an export panel. See ARCHITECTURE.md roadmap item "Calendar
// export / subscribe" for what replaces this.
function MonthGridPlaceholder() {
  const daysInGrid = Array.from({ length: 35 }, (_, i) => i - 3); // fake offset
  return (
    <View style={styles.monthGrid}>
      <View style={styles.weekdayRow}>
        {WEEKDAY_LABELS.map((d, i) => (
          <Text key={`${d}-${i}`} style={styles.weekdayLabel}>
            {d}
          </Text>
        ))}
      </View>
      <View style={styles.daysWrap}>
        {daysInGrid.map((day, i) => (
          <View key={i} style={styles.dayCell}>
            <Text style={styles.dayText}>{day > 0 && day <= 30 ? day : ""}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export default function CalendarScreen() {
  const [eventsChoice, setEventsChoice] = useState<string>(EVENTS_TO_EXPORT[0]);
  const [periodChoice, setPeriodChoice] = useState<string>(TIME_PERIODS[0]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Calendar</Text>

      <MonthGridPlaceholder />

      <View style={styles.divider} />

      <Text style={styles.sectionTitle}>Export calendar</Text>
      <Text style={styles.sectionHint}>
        Choose what to include and a time range, then generate a
        subscribable calendar URL. (UI only — no export logic yet.)
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
  monthGrid: {
    backgroundColor: colors.lightSurface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  weekdayRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  weekdayLabel: {
    width: 28,
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
  },
  dayText: {
    fontSize: 13,
    color: colors.lightText,
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
