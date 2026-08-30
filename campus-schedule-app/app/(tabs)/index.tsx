import { useEffect, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Svg, { Circle } from "react-native-svg";

import { colors, radius, spacing, type Palette } from "@/constants/theme";
import { ThemeToggle, useTheme } from "@/context/theme";
import { getHolidays, holidaysOn } from "@/constants/holidays";
import { useCourses, useTasks } from "@/context/store";
import type { Weekday } from "@/context/store";
import {
  computeNowAndNext,
  formatRange,
  occurrencesOnDay,
  relativeDayLabel,
} from "@/lib/schedule";
import {
  friendlyDue,
  isOverdue,
  isoDate,
  sortTasks,
  todayIso,
  withinNextDays,
} from "@/lib/tasks";

function greeting(h: number): string {
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function ProgressRing({ pct }: { pct: number }) {
  const t = useTheme();
  const styles = makeStyles(t);
  const size = 88;
  const stroke = 9;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={t.cardBorder} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colors.accent}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${circ} ${circ}`}
          strokeDashoffset={circ * (1 - pct)}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={styles.ringLabel}>
        <Text style={styles.ringPct}>{Math.round(pct * 100)}%</Text>
      </View>
    </View>
  );
}

function Stat({ value, label, danger }: { value: number; label: string; danger?: boolean }) {
  const styles = makeStyles(useTheme());
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, danger && value > 0 && styles.statDanger]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function ScheduleHomeScreen() {
  const { courses } = useCourses();
  const { tasks, addTask, updateTask } = useTasks();
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const [quick, setQuick] = useState("");

  const dateLabel = now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const { ongoing, next } = useMemo(() => computeNowAndNext(courses, now), [courses, now]);
  const todaysClasses = useMemo(
    () => occurrencesOnDay(courses, now.getDay() as Weekday),
    [courses, now]
  );

  const tIso = isoDate(now);
  const todayTasks = useMemo(
    () => sortTasks(tasks.filter((t) => t.due === tIso)),
    [tasks, tIso]
  );
  const doneToday = todayTasks.filter((t) => t.done).length;
  const pct = todayTasks.length ? doneToday / todayTasks.length : 0;
  const overdueCount = tasks.filter((t) => isOverdue(t, tIso)).length;
  const dueTodayCount = todayTasks.filter((t) => !t.done).length;

  const upcomingTasks = useMemo(
    () => withinNextDays(tasks, 7, now).filter((t) => t.due !== tIso),
    [tasks, now, tIso]
  );

  const endIso = isoDate(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7)
  );
  const holidaysThisWeek = useMemo(() => {
    const years = [now.getFullYear(), now.getFullYear() + 1];
    return years
      .flatMap((y) => getHolidays(y))
      .filter((h) => h.date >= tIso && h.date <= endIso);
  }, [now, tIso, endIso]);
  const upcomingHolidays = holidaysThisWeek.filter((h) => h.date !== tIso);

  const todayHolidays = holidaysOn(tIso);

  const addQuick = () => {
    const text = quick.trim();
    if (!text) return;
    addTask({ title: text, priority: "medium", due: todayIso(), done: false });
    setQuick("");
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.greeting}>{greeting(now.getHours())}</Text>
          <Text style={styles.date}>{dateLabel}</Text>
        </View>
        <ThemeToggle />
      </View>

      {todayHolidays.length > 0 ? (
        <View style={styles.holidayBanner}>
          <Text style={styles.holidayBannerText}>
            🎉 {todayHolidays.map((h) => h.name).join(" · ")}
          </Text>
        </View>
      ) : null}

      {/* Up next */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>Up Next</Text>
        {ongoing ? (
          <>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>NOW</Text>
            </View>
            <Text style={styles.bigTitle}>
              {ongoing.course.code}
              {ongoing.course.section ? ` (${ongoing.course.section})` : ""}
            </Text>
            <Text style={styles.mutedLine}>
              ⏰ {formatRange(ongoing.meeting.start, ongoing.meeting.end)}
              {ongoing.meeting.room ? `   📍 ${ongoing.meeting.room}` : ""}
            </Text>
          </>
        ) : next ? (
          <>
            <Text style={styles.bigTitle}>
              {next.course.code}
              {next.course.section ? ` (${next.course.section})` : ""}
            </Text>
            <Text style={styles.mutedLine}>
              📆 {relativeDayLabel(next.daysAhead, next.day)}   ⏰{" "}
              {formatRange(next.meeting.start, next.meeting.end)}
            </Text>
            {next.meeting.room ? (
              <Text style={styles.mutedLine}>📍 {next.meeting.room}</Text>
            ) : null}
          </>
        ) : (
          <Text style={styles.emptyLine}>
            {courses.length === 0
              ? "Add courses on the Courses tab."
              : "No classes in the next 7 days."}
          </Text>
        )}
      </View>

      {/* Progress + glance */}
      <View style={styles.progressRow}>
        <View style={[styles.card, styles.progressCard]}>
          <Text style={styles.cardLabel}>Today&apos;s Progress</Text>
          <View style={styles.progressInner}>
            <ProgressRing pct={pct} />
            <View style={{ flex: 1 }}>
              <Text style={styles.progressStat}>
                <Text style={styles.progressStrong}>{doneToday}</Text> completed
              </Text>
              <Text style={styles.progressStat}>
                <Text style={styles.progressStrong}>{dueTodayCount}</Text> remaining
              </Text>
            </View>
          </View>
        </View>
      </View>

      <View style={[styles.card, styles.glanceCard]}>
        <Text style={styles.cardLabel}>At a Glance</Text>
        <View style={styles.glanceGrid}>
          <Stat value={todaysClasses.length} label="Classes today" />
          <Stat value={dueTodayCount} label="Due today" />
          <Stat value={overdueCount} label="Overdue" danger />
          <Stat value={holidaysThisWeek.length} label="Events this week" />
          <Stat value={doneToday} label="Done today" />
        </View>
      </View>

      {/* Quick add */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>Quick Add</Text>
        <View style={styles.quickRow}>
          <TextInput
            style={styles.quickInput}
            value={quick}
            onChangeText={setQuick}
            placeholder="Add a task for today…"
            placeholderTextColor={t.muted}
            onSubmitEditing={addQuick}
            returnKeyType="done"
          />
          <Pressable style={styles.quickBtn} onPress={addQuick}>
            <Text style={styles.quickBtnText}>Add</Text>
          </Pressable>
        </View>
      </View>

      {/* Today */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>Today</Text>
        {todaysClasses.length === 0 && todayTasks.length === 0 ? (
          <Text style={styles.emptyLine}>Nothing scheduled today.</Text>
        ) : (
          <>
            {todaysClasses.map((o, i) => (
              <View key={`c-${i}`} style={styles.listRow}>
                <View style={[styles.rowDot, { backgroundColor: o.course.color }]} />
                <Text style={styles.rowTime}>{formatRange(o.meeting.start, o.meeting.end)}</Text>
                <Text style={styles.rowText} numberOfLines={1}>
                  {o.course.code}
                </Text>
              </View>
            ))}
            {todayTasks.map((t) => (
              <Pressable
                key={t.id}
                style={styles.listRow}
                onPress={() => updateTask(t.id, { done: !t.done })}
              >
                <View style={[styles.checkbox, t.done && styles.checkboxOn]}>
                  {t.done ? <Text style={styles.checkTick}>✓</Text> : null}
                </View>
                <Text
                  style={[styles.rowText, { flex: 1 }, t.done && styles.rowTextDone]}
                  numberOfLines={1}
                >
                  {t.title}
                </Text>
              </Pressable>
            ))}
          </>
        )}
      </View>

      {/* Next 7 days */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>Next 7 Days</Text>
        {upcomingHolidays.length === 0 && upcomingTasks.length === 0 ? (
          <Text style={styles.emptyLine}>Nothing coming up.</Text>
        ) : (
          <>
            {upcomingHolidays.map((h) => (
              <View key={`h-${h.date}-${h.name}`} style={styles.listRow}>
                <View style={[styles.rowDot, { backgroundColor: colors.holidayRegular }]} />
                <Text style={styles.rowTime}>{friendlyDue(h.date, now)}</Text>
                <Text style={styles.rowText} numberOfLines={1}>
                  {h.name}
                </Text>
              </View>
            ))}
            {upcomingTasks.map((t) => (
              <Pressable
                key={t.id}
                style={styles.listRow}
                onPress={() => updateTask(t.id, { done: !t.done })}
              >
                <View style={[styles.checkbox, t.done && styles.checkboxOn]}>
                  {t.done ? <Text style={styles.checkTick}>✓</Text> : null}
                </View>
                <Text style={styles.rowTime}>{friendlyDue(t.due, now)}</Text>
                <Text
                  style={[styles.rowText, { flex: 1 }, t.done && styles.rowTextDone]}
                  numberOfLines={1}
                >
                  {t.title}
                </Text>
              </Pressable>
            ))}
          </>
        )}
      </View>

      <Text style={styles.footnote}>
        Classes come from your Courses list; tasks and progress from the Tasks
        tab. Philippine holidays are shown automatically.
      </Text>
    </ScrollView>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.bg },
  content: { padding: spacing.lg, gap: spacing.md },
  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },

  greeting: { color: t.text, fontSize: 26, fontWeight: "700" },
  date: { color: t.muted, fontSize: 14, marginTop: spacing.xs },

  holidayBanner: { backgroundColor: colors.holidayRegular, borderRadius: radius.md, padding: spacing.md },
  holidayBannerText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },

  card: {
    backgroundColor: t.card,
    borderColor: t.cardBorder,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  cardLabel: {
    color: t.muted,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: spacing.md,
  },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: colors.danger,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    marginBottom: spacing.sm,
  },
  badgeText: { color: "#FFFFFF", fontSize: 10, fontWeight: "700" },
  bigTitle: { color: t.text, fontSize: 20, fontWeight: "700", marginBottom: spacing.xs },
  mutedLine: { color: t.muted, fontSize: 14, marginTop: 2 },
  emptyLine: { color: t.muted, fontSize: 14 },

  progressRow: { flexDirection: "row", gap: spacing.md },
  progressCard: { flex: 1 },
  progressInner: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  ringLabel: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  ringPct: { color: t.text, fontSize: 18, fontWeight: "700" },
  progressStat: { color: t.muted, fontSize: 14, marginVertical: 2 },
  progressStrong: { color: t.text, fontWeight: "700" },

  glanceCard: {},
  glanceGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  stat: { minWidth: 72 },
  statValue: { color: t.text, fontSize: 22, fontWeight: "700" },
  statDanger: { color: colors.danger },
  statLabel: { color: t.muted, fontSize: 11, marginTop: 2 },

  quickRow: { flexDirection: "row", gap: spacing.sm },
  quickInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: t.cardBorder,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    color: t.text,
    fontSize: 14,
  },
  quickBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    justifyContent: "center",
  },
  quickBtnText: { color: "#FFFFFF", fontWeight: "700" },

  listRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs + 2 },
  rowDot: { width: 8, height: 8, borderRadius: 4 },
  rowTime: { color: t.muted, fontSize: 12, width: 96 },
  rowText: { color: t.text, fontSize: 14 },
  rowTextDone: { color: t.muted, textDecorationLine: "line-through" },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: t.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkTick: { color: "#FFFFFF", fontSize: 11, fontWeight: "700" },

  footnote: { color: t.muted, fontSize: 12, lineHeight: 18, marginTop: spacing.sm },
});
