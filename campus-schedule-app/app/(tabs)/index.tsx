import { ScrollView, StyleSheet, Text, View } from "react-native";

import { colors, radius, spacing } from "@/constants/theme";

// Placeholder data shaped like what would eventually be read from AMIS
// (the university's official student-info system) or a locally cached
// copy of it. No network/database call is wired up yet — see
// ARCHITECTURE.md, "MVP" roadmap item 1.
const NEXT_CLASS = {
  courseCode: "CMSC 13 (N)",
  timeRange: "2:30 PM – 4:00 PM",
  room: "CS Laboratory 2",
};

export default function ScheduleHomeScreen() {
  const now = new Date();
  const dateLabel = now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const timeLabel = now.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Schedule</Text>
        <Text style={styles.headerSubtitle}>
          {dateLabel} · {timeLabel}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Ongoing Class</Text>
        <Text style={styles.emptyState}>No Ongoing Class</Text>
      </View>

      <View style={[styles.card, styles.nextClassCard]}>
        <View style={styles.nextClassBadge}>
          <Text style={styles.nextClassBadgeText}>Next Class</Text>
        </View>
        <Text style={styles.courseCode}>{NEXT_CLASS.courseCode}</Text>
        <View style={styles.detailRow}>
          <Text style={styles.detailIcon}>⏰</Text>
          <Text style={styles.detailText}>{NEXT_CLASS.timeRange}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailIcon}>📍</Text>
          <Text style={styles.detailText}>{NEXT_CLASS.room}</Text>
        </View>
      </View>

      <Text style={styles.footnote}>
        Placeholder data. Real schedule data will eventually be pulled from
        AMIS (or a local cache of it) — no logic implemented yet.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.scheduleBg,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: {
    marginBottom: spacing.sm,
  },
  headerTitle: {
    color: colors.scheduleText,
    fontSize: 28,
    fontWeight: "700",
  },
  headerSubtitle: {
    color: colors.scheduleMuted,
    fontSize: 14,
    marginTop: spacing.xs,
  },
  card: {
    backgroundColor: colors.scheduleCard,
    borderColor: colors.scheduleCardBorder,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  cardLabel: {
    color: colors.scheduleMuted,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: spacing.md,
  },
  emptyState: {
    color: colors.scheduleText,
    fontSize: 16,
    textAlign: "center",
    paddingVertical: spacing.lg,
  },
  nextClassCard: {
    gap: spacing.sm,
  },
  nextClassBadge: {
    alignSelf: "flex-start",
    backgroundColor: colors.danger,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    marginBottom: spacing.xs,
  },
  nextClassBadgeText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },
  courseCode: {
    color: colors.scheduleText,
    fontSize: 22,
    fontWeight: "700",
    marginBottom: spacing.xs,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  detailIcon: {
    fontSize: 14,
  },
  detailText: {
    color: colors.scheduleMuted,
    fontSize: 15,
  },
  footnote: {
    color: colors.scheduleMuted,
    fontSize: 12,
    marginTop: spacing.md,
    lineHeight: 18,
  },
});
