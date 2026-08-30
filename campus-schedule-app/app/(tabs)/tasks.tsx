import { useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { colors, radius, spacing, type Palette } from "@/constants/theme";
import { ThemeToggle, useTheme } from "@/context/theme";
import { useCourses, useTasks, type Priority } from "@/context/store";
import {
  friendlyDue,
  isOverdue,
  isoDate,
  PRIORITY_LABEL,
  sortTasks,
  todayIso,
} from "@/lib/tasks";

const PRIORITIES: Priority[] = ["low", "medium", "high"];

const priorityColor: Record<Priority, string> = {
  low: "#8A8F98",
  medium: colors.holidaySpecial,
  high: colors.danger,
};

/** Accepts "YYYY-MM-DD", "MM/DD", "M-D"; returns ISO or null. */
function parseDateInput(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{1,2})[/-](\d{1,2})$/.exec(s);
  if (m) {
    const month = Number(m[1]);
    const day = Number(m[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const year = new Date().getFullYear();
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return null;
}

function relativeIso(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return isoDate(d);
}

type DueChoice = "none" | "today" | "tomorrow" | "week" | "custom";

export default function TasksScreen() {
  const { tasks, addTask, updateTask, removeTask, clearCompletedTasks } = useTasks();
  const { courses } = useCourses();
  const th = useTheme();
  const styles = useMemo(() => makeStyles(th), [th]);

  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [dueChoice, setDueChoice] = useState<DueChoice>("today");
  const [customDate, setCustomDate] = useState("");
  const [courseId, setCourseId] = useState<string | undefined>(undefined);
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");

  const resolvedDue = (): string | undefined => {
    switch (dueChoice) {
      case "today":
        return todayIso();
      case "tomorrow":
        return relativeIso(1);
      case "week":
        return relativeIso(7);
      case "custom":
        return parseDateInput(customDate) ?? undefined;
      default:
        return undefined;
    }
  };

  const submit = () => {
    const t = title.trim();
    if (!t) return;
    if (dueChoice === "custom" && customDate.trim() && !parseDateInput(customDate)) {
      Alert.alert("Check the date", "Use YYYY-MM-DD or MM/DD.");
      return;
    }
    addTask({ title: t, priority, due: resolvedDue(), done: false, courseId });
    setTitle("");
  };

  const counts = useMemo(() => {
    const active = tasks.filter((t) => !t.done).length;
    return { all: tasks.length, active, completed: tasks.length - active };
  }, [tasks]);

  const visible = useMemo(() => {
    const filtered = tasks.filter((t) =>
      filter === "all" ? true : filter === "active" ? !t.done : t.done
    );
    return sortTasks(filtered);
  }, [tasks, filter]);

  const courseById = useMemo(
    () => Object.fromEntries(courses.map((c) => [c.id, c])),
    [courses]
  );

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.headerRow}>
          <Text style={styles.title}>Tasks</Text>
          <ThemeToggle />
        </View>
        <Text style={styles.subtitle}>Everything you need to get done.</Text>

        {/* Quick add */}
        <View style={styles.addCard}>
          <TextInput
            style={styles.addInput}
            value={title}
            onChangeText={setTitle}
            placeholder="What needs to be done?"
            placeholderTextColor={th.muted}
            onSubmitEditing={submit}
            returnKeyType="done"
          />

          <View style={styles.chipRow}>
            {(
              [
                ["none", "No date"],
                ["today", "Today"],
                ["tomorrow", "Tomorrow"],
                ["week", "In 1 week"],
                ["custom", "Pick…"],
              ] as [DueChoice, string][]
            ).map(([key, label]) => (
              <Pressable
                key={key}
                onPress={() => setDueChoice(key)}
                style={[styles.chip, dueChoice === key && styles.chipOn]}
              >
                <Text style={[styles.chipText, dueChoice === key && styles.chipTextOn]}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>

          {dueChoice === "custom" ? (
            <TextInput
              style={styles.dateInput}
              value={customDate}
              onChangeText={setCustomDate}
              placeholder="YYYY-MM-DD or MM/DD"
              placeholderTextColor={th.muted}
              keyboardType="numbers-and-punctuation"
            />
          ) : null}

          <View style={styles.chipRow}>
            {PRIORITIES.map((p) => (
              <Pressable
                key={p}
                onPress={() => setPriority(p)}
                style={[
                  styles.chip,
                  priority === p && { backgroundColor: priorityColor[p], borderColor: priorityColor[p] },
                ]}
              >
                <Text style={[styles.chipText, priority === p && styles.chipTextOn]}>
                  {PRIORITY_LABEL[p]}
                </Text>
              </Pressable>
            ))}
          </View>

          {courses.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              <Pressable
                onPress={() => setCourseId(undefined)}
                style={[styles.chip, courseId === undefined && styles.chipOn]}
              >
                <Text style={[styles.chipText, courseId === undefined && styles.chipTextOn]}>
                  No course
                </Text>
              </Pressable>
              {courses.map((c) => (
                <Pressable
                  key={c.id}
                  onPress={() => setCourseId(c.id)}
                  style={[
                    styles.chip,
                    courseId === c.id && { backgroundColor: c.color, borderColor: c.color },
                  ]}
                >
                  <Text style={[styles.chipText, courseId === c.id && styles.chipTextOn]}>
                    {c.code}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          <Pressable style={styles.addBtn} onPress={submit}>
            <Text style={styles.addBtnText}>Add task</Text>
          </Pressable>
        </View>

        {/* Filters */}
        <View style={styles.filterRow}>
          {(["all", "active", "completed"] as const).map((f) => (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              style={[styles.filterBtn, filter === f && styles.filterBtnOn]}
            >
              <Text style={[styles.filterText, filter === f && styles.filterTextOn]}>
                {f[0].toUpperCase() + f.slice(1)} ({counts[f]})
              </Text>
            </Pressable>
          ))}
          {counts.completed > 0 ? (
            <Pressable onPress={clearCompletedTasks} hitSlop={6} style={styles.clearBtn}>
              <Text style={styles.clearText}>Clear completed</Text>
            </Pressable>
          ) : null}
        </View>

        {/* List */}
        {visible.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              {filter === "completed" ? "Nothing completed yet." : "No tasks — add one above."}
            </Text>
          </View>
        ) : (
          visible.map((task) => {
            const course = task.courseId ? courseById[task.courseId] : undefined;
            const overdue = isOverdue(task);
            return (
              <View key={task.id} style={styles.taskRow}>
                <Pressable
                  hitSlop={6}
                  onPress={() => updateTask(task.id, { done: !task.done })}
                  style={[styles.checkbox, task.done && styles.checkboxOn]}
                >
                  {task.done ? <Text style={styles.checkTick}>✓</Text> : null}
                </Pressable>

                <View style={styles.taskMain}>
                  <TextInput
                    style={[styles.taskTitle, task.done && styles.taskTitleDone]}
                    value={task.title}
                    onChangeText={(v) => updateTask(task.id, { title: v })}
                  />
                  <View style={styles.taskMeta}>
                    <View style={[styles.dot, { backgroundColor: priorityColor[task.priority] }]} />
                    <Text style={styles.metaText}>{PRIORITY_LABEL[task.priority]}</Text>
                    {task.due ? (
                      <Text style={[styles.metaText, overdue && styles.metaOverdue]}>
                        · {overdue ? "Overdue " : ""}
                        {friendlyDue(task.due)}
                      </Text>
                    ) : null}
                    {course ? (
                      <Text style={[styles.metaText, { color: course.color }]}>· {course.code}</Text>
                    ) : null}
                  </View>
                </View>

                <Pressable
                  hitSlop={6}
                  onPress={() =>
                    Alert.alert("Delete task", task.title || "This task?", [
                      { text: "Cancel", style: "cancel" },
                      { text: "Delete", style: "destructive", onPress: () => removeTask(task.id) },
                    ])
                  }
                >
                  <Text style={styles.taskDelete}>✕</Text>
                </Pressable>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },
    content: { padding: spacing.lg, paddingBottom: spacing.xl },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    title: { fontSize: 24, fontWeight: "700", color: t.text },
    subtitle: { fontSize: 13, color: t.muted, marginTop: spacing.xs, marginBottom: spacing.lg },

    addCard: {
      backgroundColor: t.surface,
      borderRadius: radius.md,
      padding: spacing.md,
      gap: spacing.sm,
    },
    addInput: {
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      fontSize: 15,
      color: t.text,
      backgroundColor: t.inputBg,
    },
    dateInput: {
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      fontSize: 14,
      color: t.text,
      backgroundColor: t.inputBg,
    },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, alignItems: "center" },
    chip: {
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: spacing.xs + 2,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.inputBg,
    },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { fontSize: 12, fontWeight: "600", color: t.text },
    chipTextOn: { color: "#FFFFFF" },

    addBtn: {
      backgroundColor: colors.accent,
      borderRadius: radius.sm,
      paddingVertical: spacing.sm + 2,
      alignItems: "center",
      marginTop: spacing.xs,
    },
    addBtnText: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },

    filterRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.xs,
      alignItems: "center",
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
    },
    filterBtn: {
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: spacing.xs + 2,
      borderRadius: radius.sm,
    },
    filterBtnOn: { backgroundColor: t.surface },
    filterText: { fontSize: 13, color: t.muted, fontWeight: "600" },
    filterTextOn: { color: t.text },
    clearBtn: { marginLeft: "auto" },
    clearText: { fontSize: 12, color: colors.accent, fontWeight: "700" },

    emptyCard: {
      backgroundColor: t.surface,
      borderRadius: radius.md,
      padding: spacing.xl,
      alignItems: "center",
    },
    emptyText: { fontSize: 14, color: t.muted },

    taskRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    checkbox: {
      width: 22,
      height: 22,
      borderRadius: 6,
      borderWidth: 1.5,
      borderColor: t.muted,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 2,
    },
    checkboxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    checkTick: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
    taskMain: { flex: 1 },
    taskTitle: { fontSize: 15, color: t.text, padding: 0 },
    taskTitleDone: { textDecorationLine: "line-through", color: t.muted },
    taskMeta: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.xs, marginTop: 2 },
    dot: { width: 7, height: 7, borderRadius: 3.5 },
    metaText: { fontSize: 12, color: t.muted },
    metaOverdue: { color: colors.danger, fontWeight: "700" },
    taskDelete: { fontSize: 14, color: t.muted, paddingHorizontal: 4, paddingTop: 2 },
  });
