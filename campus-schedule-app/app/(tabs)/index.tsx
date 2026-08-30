import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { colors, radius, spacing } from "@/constants/theme";
import { useCourses } from "@/context/store";
import {
  computeNowAndNext,
  formatRange,
  occurrencesOnDay,
  relativeDayLabel,
} from "@/lib/schedule";
import { holidaysOn } from "@/constants/holidays";
import type { Weekday } from "@/context/store";

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export default function ScheduleHomeScreen() {
  const { courses } = useCourses();

  // Re-render every 30s so "ongoing / next" stays honest as time passes.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const dateLabel = now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const timeLabel = now.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  const { ongoing, next } = useMemo(
    () => computeNowAndNext(courses, now),
    [courses, now]
  );

  const todaysClasses = useMemo(
    () => occurrencesOnDay(courses, now.getDay() as Weekday),
    [courses, now]
  );

  const todayHolidays = holidaysOn(isoDate(now));

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Schedule</Text>
        <Text style={styles.headerSubtitle}>
          {dateLabel} · {timeLabel}
        </Text>
      </View>

      {todayHolidays.length > 0 ? (
        <View style={styles.holidayBanner}>
          <Text style={styles.holidayBannerText}>
            🎉 {todayHolidays.map((h) => h.name).join(" · ")}
          </Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Ongoing Class</Text>
        {ongoing ? (
          <>
            <Text style={styles.courseCode}>
              {ongoing.course.code}
              {ongoing.course.section ? ` (${ongoing.course.section})` : ""}
            </Text>
            {ongoing.course.title ? (
              <Text style={styles.courseTitle}>{ongoing.course.title}</Text>
            ) : null}
            <View style={styles.detailRow}>
              <Text style={styles.detailIcon}>⏰</Text>
              <Text style={styles.detailText}>
                {formatRange(ongoing.meeting.start, ongoing.meeting.end)}
              </Text>
            </View>
            {ongoing.meeting.room ? (
              <View style={styles.detailRow}>
                <Text style={styles.detailIcon}>📍</Text>
                <Text style={styles.detailText}>{ongoing.meeting.room}</Text>
              </View>
            ) : null}
          </>
        ) : (
          <Text style={styles.emptyState}>No Ongoing Class</Text>
        )}
      </View>

      <View style={[styles.card, styles.nextClassCard]}>
        <View style={styles.nextClassBadge}>
          <Text style={styles.nextClassBadgeText}>Next Class</Text>
        </View>
        {next ? (
          <>
            <Text style={styles.courseCode}>
              {next.course.code}
              {next.course.section ? ` (${next.course.section})` : ""}
            </Text>
            {next.course.title ? (
              <Text style={styles.courseTitle}>{next.course.title}</Text>
            ) : null}
            <View style={styles.detailRow}>
              <Text style={styles.detailIcon}>📆</Text>
              <Text style={styles.detailText}>
                {relativeDayLabel(next.daysAhead, next.day)}
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailIcon}>⏰</Text>
              <Text style={styles.detailText}>
                {formatRange(next.meeting.start, next.meeting.end)}
              </Text>
            </View>
            {next.meeting.room ? (
              <View style={styles.detailRow}>
                <Text style={styles.detailIcon}>📍</Text>
                <Text style={styles.detailText}>{next.meeting.room}</Text>
              </View>
            ) : null}
          </>
        ) : (
          <Text style={styles.emptyState}>
            {courses.length === 0
              ? "Add courses on the Courses tab to see your next class."
              : "No upcoming classes in the next 7 days."}
          </Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Rest of Today</Text>
        {todaysClasses.length === 0 ? (
          <Text style={styles.emptyStateSmall}>Nothing scheduled today.</Text>
        ) : (
          todaysClasses.map((o, i) => (
            <View key={`${o.course.id}-${i}`} style={styles.todayRow}>
              <View style={[styles.todayDot, { backgroundColor: o.course.color }]} />
              <Text style={styles.todayTime}>
                {formatRange(o.meeting.start, o.meeting.end)}
              </Text>
              <Text style={styles.todayCode} numberOfLines={1}>
                {o.course.code}
              </Text>
            </View>
          ))
        )}
      </View>

      <Text style={styles.footnote}>
        “Ongoing” and “Next” are computed from your Courses list and the current
        time. AMIS integration (auto-importing your official schedule) is a later
        roadmap item — see ARCHITECTURE.md.
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
  holidayBanner: {
    backgroundColor: colors.holidayRegular,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  holidayBannerText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
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
  emptyStateSmall: {
    color: colors.scheduleMuted,
    fontSize: 14,
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
  courseTitle: {
    color: colors.scheduleMuted,
    fontSize: 15,
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
  todayRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  todayDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  todayTime: {
    color: colors.scheduleMuted,
    fontSize: 13,
    width: 130,
  },
  todayCode: {
    color: colors.scheduleText,
    fontSize: 14,
    fontWeight: "600",
    flex: 1,
  },
  footnote: {
    color: colors.scheduleMuted,
    fontSize: 12,
    marginTop: spacing.md,
    lineHeight: 18,
  },
});
