import { Pencil, Trash2 } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DatePickerField } from "@/components/DatePickerField";
import { ItemEditorDialog, type EditorTarget } from "@/components/ItemEditorDialog";
import { PressableScale } from "@/components/PressableScale";
import { TaskCheckbox } from "@/components/TaskCheckbox";
import { TimePickerField } from "@/components/TimePickerField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Text as UIText } from "@/components/ui/text";
import { colors, radius, spacing, type Palette } from "@/constants/theme";
import { ThemeToggle, useTheme } from "@/context/theme";
import { useCourses, useTasks, type Priority, type Task } from "@/context/store";
import {
  formatDue,
  isDueSoon,
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

function relativeIso(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return isoDate(d);
}

type DueChoice = "none" | "today" | "tomorrow" | "week" | "custom";
type Filter = "all" | "active" | "soon" | "completed";

const FILTER_LABEL: Record<Filter, string> = {
  all: "All",
  active: "Active",
  soon: "Due soon",
  completed: "Done",
};

export default function TasksScreen() {
  const { tasks, addTask, updateTask, removeTask, clearCompletedTasks } = useTasks();
  const { courses } = useCourses();
  const th = useTheme();
  const styles = useMemo(() => makeStyles(th), [th]);

  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [dueChoice, setDueChoice] = useState<DueChoice>("today");
  const [customDate, setCustomDate] = useState<string | undefined>(undefined);
  const [dueTime, setDueTime] = useState<string | undefined>(undefined);
  const [courseId, setCourseId] = useState<string | undefined>(undefined);
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<EditorTarget | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);

  // Re-evaluate "due soon" / "overdue" as time passes.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const resolvedDue = (): string | undefined => {
    switch (dueChoice) {
      case "today":
        return todayIso();
      case "tomorrow":
        return relativeIso(1);
      case "week":
        return relativeIso(7);
      case "custom":
        return customDate;
      default:
        return undefined;
    }
  };

  const submit = () => {
    const t = title.trim();
    if (!t) return;
    const due = resolvedDue();
    addTask({ title: t, priority, due, dueTime: due ? dueTime : undefined, done: false, courseId });
    setTitle("");
  };

  const needsAttention = (t: Task) => isOverdue(t, now) || isDueSoon(t, now);

  const counts = useMemo(() => {
    const active = tasks.filter((t) => !t.done).length;
    return {
      all: tasks.length,
      active,
      soon: tasks.filter(needsAttention).length,
      completed: tasks.length - active,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, now]);

  const visible = useMemo(() => {
    const filtered = tasks.filter((t) =>
      filter === "all"
        ? true
        : filter === "active"
          ? !t.done
          : filter === "soon"
            ? needsAttention(t)
            : t.done
    );
    return sortTasks(filtered);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, filter, now]);

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
            accessibilityLabel="New task title"
          />

          <View style={styles.chipRow}>
            {(
              [
                ["none", "No date"],
                ["today", "Today"],
                ["tomorrow", "Tomorrow"],
                ["week", "In 1 week"],
                ["custom", "Pick date…"],
              ] as [DueChoice, string][]
            ).map(([key, label]) => (
              <PressableScale
                key={key}
                onPress={() => setDueChoice(key)}
                accessibilityRole="radio"
                accessibilityState={{ checked: dueChoice === key }}
                className="web:hover:opacity-80"
                style={[styles.chip, dueChoice === key && styles.chipOn]}
              >
                <Text style={[styles.chipText, dueChoice === key && styles.chipTextOn]}>
                  {label}
                </Text>
              </PressableScale>
            ))}
          </View>

          {dueChoice !== "none" ? (
            <View style={styles.chipRow}>
              {dueChoice === "custom" ? (
                <DatePickerField value={customDate} onChange={setCustomDate} accessibilityLabel="Due date" />
              ) : null}
              <TimePickerField value={dueTime} onChange={setDueTime} placeholder="Add time" accessibilityLabel="Due time" />
            </View>
          ) : null}

          <View style={styles.chipRow}>
            {PRIORITIES.map((p) => (
              <PressableScale
                key={p}
                onPress={() => setPriority(p)}
                accessibilityRole="radio"
                accessibilityState={{ checked: priority === p }}
                accessibilityLabel={`${PRIORITY_LABEL[p]} priority`}
                className="web:hover:opacity-80"
                style={[
                  styles.chip,
                  priority === p && { backgroundColor: priorityColor[p], borderColor: priorityColor[p] },
                ]}
              >
                <Text style={[styles.chipText, priority === p && styles.chipTextOn]}>
                  {PRIORITY_LABEL[p]}
                </Text>
              </PressableScale>
            ))}
          </View>

          {courses.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              <PressableScale
                onPress={() => setCourseId(undefined)}
                style={[styles.chip, courseId === undefined && styles.chipOn]}
              >
                <Text style={[styles.chipText, courseId === undefined && styles.chipTextOn]}>
                  No course
                </Text>
              </PressableScale>
              {courses.map((c) => (
                <PressableScale
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
                </PressableScale>
              ))}
            </ScrollView>
          ) : null}

          <Button onPress={submit} disabled={!title.trim()} className="mt-1">
            <UIText>Add task</UIText>
          </Button>
        </View>

        {/* Filters */}
        <View style={styles.filterRow}>
          <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <TabsList>
              {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
                <TabsTrigger key={f} value={f}>
                  <UIText>
                    {FILTER_LABEL[f]} {counts[f] ? `(${counts[f]})` : ""}
                  </UIText>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {counts.completed > 0 ? (
            <Button variant="link" size="sm" onPress={clearCompletedTasks} className="ml-auto">
              <UIText>Clear completed</UIText>
            </Button>
          ) : null}
        </View>

        {/* List */}
        {visible.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              {filter === "completed"
                ? "Nothing completed yet."
                : filter === "soon"
                  ? "Nothing due in the next 24 hours. 🎉"
                  : "No tasks — add one above."}
            </Text>
          </View>
        ) : (
          visible.map((task) => {
            const course = task.courseId ? courseById[task.courseId] : undefined;
            const overdue = isOverdue(task, now);
            const soon = !overdue && isDueSoon(task, now);
            return (
              <View
                key={task.id}
                className="web:transition-colors web:hover:bg-accent/40 rounded-lg"
                style={[styles.taskRow, task.done && styles.taskRowDone]}
              >
                <View style={styles.checkWrap}>
                  <TaskCheckbox
                    checked={task.done}
                    onCheckedChange={(done) => updateTask(task.id, { done })}
                    label={task.title || "Task"}
                  />
                </View>

                <View style={styles.taskMain}>
                  <TextInput
                    style={[styles.taskTitle, task.done && styles.taskTitleDone]}
                    value={task.title}
                    onChangeText={(v) => updateTask(task.id, { title: v })}
                    accessibilityLabel="Task title"
                  />
                  <View style={styles.taskMeta}>
                    <View style={[styles.dot, { backgroundColor: priorityColor[task.priority] }]} />
                    <Text style={styles.metaText}>{PRIORITY_LABEL[task.priority]}</Text>
                    {task.due ? (
                      <Text
                        style={[
                          styles.metaText,
                          !task.done && overdue && styles.metaOverdue,
                          !task.done && soon && styles.metaSoon,
                        ]}
                      >
                        · Due {formatDue(task, now)}
                      </Text>
                    ) : null}
                    {course ? (
                      <Text style={[styles.metaText, { color: course.color }]}>· {course.code}</Text>
                    ) : null}
                    {!task.done && overdue ? (
                      <Badge variant="destructive">
                        <UIText>Overdue</UIText>
                      </Badge>
                    ) : !task.done && soon ? (
                      <Badge variant="outline" style={{ borderColor: colors.holidaySpecial }}>
                        <UIText style={{ color: colors.holidaySpecial }}>Due soon</UIText>
                      </Badge>
                    ) : null}
                  </View>
                </View>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onPress={() => setEditing({ mode: "edit", kind: "task", task })}
                  accessibilityLabel={`Edit ${task.title || "task"}`}
                >
                  <Icon as={Pencil} size={15} className="text-muted-foreground" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onPress={() => setDeleting(task)}
                  accessibilityLabel={`Delete ${task.title || "task"}`}
                >
                  <Icon as={Trash2} size={15} className="text-muted-foreground" />
                </Button>
              </View>
            );
          })
        )}
      </ScrollView>

      <ItemEditorDialog target={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete task?"
        description={`"${deleting?.title || "This task"}" will be removed. This can't be undone.`}
        onConfirm={() => {
          if (deleting) removeTask(deleting.id);
          setDeleting(null);
        }}
      />
    </View>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },
    content: {
      padding: spacing.lg,
      paddingBottom: spacing.xl,
      width: "100%",
      maxWidth: 760,
      alignSelf: "center",
    },
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

    filterRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.xs,
      alignItems: "center",
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
    },

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
      paddingHorizontal: spacing.xs,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    taskRowDone: { opacity: 0.7 },
    checkWrap: { paddingTop: 2 },
    taskMain: { flex: 1 },
    taskTitle: { fontSize: 15, color: t.text, padding: 0 },
    taskTitleDone: { textDecorationLine: "line-through", color: t.muted },
    taskMeta: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.xs, marginTop: 4 },
    dot: { width: 7, height: 7, borderRadius: 3.5 },
    metaText: { fontSize: 12, color: t.muted },
    metaOverdue: { color: colors.danger, fontWeight: "700" },
    metaSoon: { color: colors.holidaySpecial, fontWeight: "600" },
  });
