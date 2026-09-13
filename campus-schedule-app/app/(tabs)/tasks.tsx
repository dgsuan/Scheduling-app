import { router, useLocalSearchParams } from "expo-router";
import { ChevronRight, Flag, ListTree, Pencil, Repeat, Timer, Trash2, Users } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import Animated, { FadeIn, FadeOut, LayoutAnimationConfig, LinearTransition } from "react-native-reanimated";

import { ChoicePopover, type Choice } from "@/components/ChoicePopover";
import { DueDateButton } from "@/components/DueDateButton";
import { ItemEditorDialog, type EditorTarget } from "@/components/ItemEditorDialog";
import { ScreenHeader } from "@/components/ScreenHeader";
import { TaskCheckbox } from "@/components/TaskCheckbox";
import { RecurringDeleteDialog } from "@/components/tasks/RecurringDeleteDialog";
import { SubtaskList } from "@/components/tasks/SubtaskList";
import { TimePickerField } from "@/components/TimePickerField";
import { SectionsDialog } from "@/components/sections/SectionsDialog";
import { useToast } from "@/components/Toaster";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Separator } from "@/components/ui/separator";
import { Text } from "@/components/ui/text";
import { formatSpent, useFocus } from "@/context/focus";
import { useTheme } from "@/context/theme";
import { useCourses, useSettings, useTasks, type Course, type Priority, type Task, type TaskRepeat } from "@/context/store";
import { addDaysIso, formatShortDate } from "@/lib/calendar";
import { describeRepeat, nextRepeatDate, repeatStop, weeklyOn } from "@/lib/recurrence";
import { display12h } from "@/lib/schedule";
import { formatDue, isDueSoon, isOverdue, isoDate, sortTasks, todayIso } from "@/lib/tasks";
import { useBreakpoint } from "@/lib/useBreakpoint";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";

// Tasks grouped by urgency. Section titles carry the status (only the
// Overdue title is tinted), so rows stay calm and readable. Completing a
// task shows the check first, then lets it glide into Completed.

type SectionKey = "overdue" | "today" | "tomorrow" | "week" | "later" | "nodate" | "done";

const SECTIONS: { key: SectionKey; title: string }[] = [
  { key: "overdue", title: "Overdue" },
  { key: "today", title: "Today" },
  { key: "tomorrow", title: "Tomorrow" },
  { key: "week", title: "Next 7 days" },
  { key: "later", title: "Later" },
  { key: "nodate", title: "No date" },
  { key: "done", title: "Completed" },
];

const COMPLETE_DELAY_MS = 420;
const UNDO_MS = 6000;

const PRIORITY_CHOICES: Choice<Priority>[] = [
  { value: "high", label: "High priority", iconClassName: "text-destructive" },
  { value: "medium", label: "Medium priority", iconClassName: "text-warning" },
  { value: "low", label: "Low priority", iconClassName: "text-muted-foreground" },
];

type RepeatChoice = "none" | "daily" | "weekdays" | "weekly";

function sectionOf(task: Task, now: Date): SectionKey {
  if (task.done) return "done";
  if (!task.due) return "nodate";
  if (isOverdue(task, now)) return "overdue";
  const today = isoDate(now);
  if (task.due === today) return "today";
  if (task.due === addDaysIso(today, 1)) return "tomorrow";
  if (task.due <= addDaysIso(today, 7)) return "week";
  return "later";
}

function dueLabel(task: Task, section: SectionKey, now: Date): string | null {
  if (!task.due) return null;
  if (section === "today" || section === "tomorrow") return task.dueTime ? display12h(task.dueTime) : null;
  return formatDue(task, now);
}

function TaskRow({
  task,
  section,
  course,
  now,
  focusing,
  onToggle,
  onRename,
  onEdit,
  onDelete,
  onFocus,
}: {
  task: Task;
  section: SectionKey;
  course?: Course;
  now: Date;
  focusing: boolean;
  onToggle: (done: boolean) => void;
  onRename: (title: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  onFocus: () => void;
}) {
  const t = useTheme();
  // Show the tick (and strike-through) before the row moves to Completed.
  const [completing, setCompleting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const checked = task.done || completing;
  const toggle = (value: boolean) => {
    clearTimeout(timer.current);
    if (value && !task.done) {
      setCompleting(true);
      timer.current = setTimeout(() => {
        setCompleting(false);
        onToggle(true);
      }, COMPLETE_DELAY_MS);
    } else {
      setCompleting(false);
      onToggle(value);
    }
  };

  const soon = section === "today" && isDueSoon(task, now);
  const label = dueLabel(task, section, now);
  const subtasks = task.subtasks ?? [];
  const stepsDone = subtasks.filter((s) => s.done).length;

  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      exiting={FadeOut.duration(160)}
      layout={LinearTransition.springify().damping(22).stiffness(240)}
    >
      <View
        className={cn(
          "group flex-row items-start gap-3 rounded-lg px-2 py-2.5 web:transition-colors web:duration-150 web:hover:bg-accent/50",
          focusing && "bg-primary/5"
        )}
      >
        <View className="pt-0.5">
          <TaskCheckbox checked={checked} onCheckedChange={toggle} label={task.title || "Task"} />
        </View>
        <View className="flex-1 gap-0.5">
          <TextInput
            value={task.title}
            onChangeText={onRename}
            accessibilityLabel="Task title"
            placeholder="Untitled task"
            placeholderTextColor={t.muted}
            className={cn(
              "text-foreground p-0 text-[15px] leading-5 web:outline-none web:transition-colors",
              checked && "text-muted-foreground line-through"
            )}
          />
          <View className="flex-row flex-wrap items-center gap-x-3 gap-y-0.5">
            {label ? (
              <Text
                className={cn(
                  "text-[13px] tabular-nums",
                  section === "overdue" ? "text-destructive" : soon ? "text-warning font-medium" : "text-muted-foreground"
                )}
              >
                {label}
              </Text>
            ) : null}
            {task.repeat && !task.done ? (
              <View className="flex-row items-center gap-1" accessibilityLabel={describeRepeat(task.repeat)}>
                <Icon as={Repeat} size={12} className="text-muted-foreground" />
                <Text className="text-muted-foreground text-[13px]">{describeRepeat(task.repeat)}</Text>
              </View>
            ) : null}
            {course ? (
              <View className="flex-row items-center gap-1.5">
                <View className="size-1.5 rounded-full" style={{ backgroundColor: course.color }} />
                <Text className="text-muted-foreground text-[13px]">{course.code}</Text>
              </View>
            ) : null}
            {task.priority === "high" && !task.done ? (
              <View className="flex-row items-center gap-1">
                <Icon as={Flag} size={12} className="text-destructive" />
                <Text className="text-muted-foreground text-[13px]">High</Text>
              </View>
            ) : null}
            {subtasks.length ? (
              <Pressable
                onPress={() => setExpanded((v) => !v)}
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                accessibilityLabel={`${stepsDone} of ${subtasks.length} steps done`}
                className="flex-row items-center gap-1 rounded web:hover:opacity-80"
              >
                <View style={{ transform: [{ rotate: expanded ? "90deg" : "0deg" }] }}>
                  <Icon as={ChevronRight} size={12} className="text-muted-foreground" />
                </View>
                <Text className="text-muted-foreground text-[13px] tabular-nums">
                  {stepsDone}/{subtasks.length} steps
                </Text>
              </Pressable>
            ) : null}
            {task.timeSpentSec ? (
              <View className="flex-row items-center gap-1">
                <Icon as={Timer} size={12} className="text-muted-foreground" />
                <Text className="text-muted-foreground text-[13px] tabular-nums">{formatSpent(task.timeSpentSec)}</Text>
              </View>
            ) : null}
          </View>
        </View>
        <View className="flex-row items-center web:opacity-0 web:transition-opacity web:group-hover:opacity-100 web:group-focus-within:opacity-100">
          {!task.done ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onPress={onFocus}
              accessibilityLabel={focusing ? `Focusing on ${task.title || "task"}` : `Start focus timer for ${task.title || "task"}`}
            >
              <Icon as={Timer} size={15} className={focusing ? "text-primary" : "text-muted-foreground"} />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onPress={() => setExpanded((v) => !v)}
            accessibilityLabel={`${expanded ? "Hide" : "Show"} steps for ${task.title || "task"}`}
          >
            <Icon as={ListTree} size={15} className="text-muted-foreground" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onPress={onEdit} accessibilityLabel={`Edit ${task.title || "task"}`}>
            <Icon as={Pencil} size={15} className="text-muted-foreground" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onPress={onDelete} accessibilityLabel={`Delete ${task.title || "task"}`}>
            <Icon as={Trash2} size={15} className="text-muted-foreground" />
          </Button>
        </View>
      </View>
      {expanded ? <SubtaskList task={task} /> : null}
    </Animated.View>
  );
}

export default function TasksScreen() {
  const { tasks, addTask, updateTask, removeTask, restoreTask, skipTaskOccurrence, clearCompletedTasks } = useTasks();
  const { courses } = useCourses();
  const { settings } = useSettings();
  const focus = useFocus();
  const { toast } = useToast();
  const t = useTheme();
  const { desktop } = useBreakpoint();
  const now = useNow();

  const [title, setTitle] = useState("");
  const [due, setDue] = useState<string | undefined>(() => todayIso());
  const [dueTime, setDueTime] = useState<string | undefined>(undefined);
  const [priority, setPriority] = useState<Priority>("medium");
  const [courseId, setCourseId] = useState<string | undefined>(undefined);
  const [repeatChoice, setRepeatChoice] = useState<RepeatChoice>("none");
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState<EditorTarget | null>(null);
  const [deletingSeries, setDeletingSeries] = useState<Task | null>(null);
  const composer = useRef<TextInput>(null);

  const [sectionsOpen, setSectionsOpen] = useState(false);
  const [joinCode, setJoinCode] = useState<string | undefined>(undefined);

  // Deep links: ?new=1 focuses the composer, ?open=<id> opens a task,
  // ?join=<code> opens a class-section invite.
  const params = useLocalSearchParams<{ new?: string; open?: string; join?: string }>();
  useEffect(() => {
    if (params.join && isSupabaseConfigured) {
      setJoinCode(String(params.join).slice(0, 16));
      setSectionsOpen(true);
      // Deferred: on a cold load from an invite link the root navigator isn't mounted yet.
      setTimeout(() => router.setParams({ join: undefined }), 0);
    }
  }, [params.join]);
  useEffect(() => {
    if (params.new) {
      setTimeout(() => composer.current?.focus(), 50);
      router.setParams({ new: undefined });
    }
    if (params.open) {
      const task = tasks.find((x) => x.id === params.open);
      if (task) {
        setEditing({ mode: "edit", kind: "task", task });
        if (task.done) setShowDone(true);
      }
      router.setParams({ open: undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.new, params.open]);

  const repeatFor = (choice: RepeatChoice, iso?: string): TaskRepeat | undefined =>
    choice === "none" ? undefined : choice === "weekly" ? weeklyOn(iso) : { freq: choice };

  const submit = () => {
    const text = title.trim();
    if (!text) return;
    addTask({
      title: text,
      priority,
      due,
      dueTime: due ? dueTime : undefined,
      done: false,
      courseId,
      repeat: due ? repeatFor(repeatChoice, due) : undefined,
    });
    setTitle("");
  };

  const complete = (task: Task, done: boolean) => {
    updateTask(task.id, { done });
    if (done && focus.session?.taskId === task.id) focus.stop();
    if (done && task.repeat && task.due) {
      const next = nextRepeatDate(task.repeat, task.due, repeatStop(task, settings.term?.end));
      if (next) toast({ message: "Nice — next one is ready", description: `${task.title || "Task"} · due ${formatShortDate(next)}` });
    }
  };

  const remove = (task: Task) => {
    if (task.repeat && !task.done) {
      setDeletingSeries(task);
      return;
    }
    removeTask(task.id);
    toast({
      message: "Task deleted",
      description: task.title || undefined,
      actionLabel: "Undo",
      onAction: () => restoreTask(task),
      duration: UNDO_MS,
    });
  };

  const grouped = useMemo(() => {
    const map = new Map<SectionKey, Task[]>();
    for (const task of sortTasks(tasks)) {
      const key = sectionOf(task, now);
      map.set(key, [...(map.get(key) ?? []), task]);
    }
    return map;
  }, [tasks, now]);

  const courseById = useMemo(() => Object.fromEntries(courses.map((c) => [c.id, c])), [courses]);
  const open = tasks.filter((x) => !x.done).length;
  const overdueCount = grouped.get("overdue")?.length ?? 0;
  const doneCount = grouped.get("done")?.length ?? 0;

  const courseChoices: Choice<string | undefined>[] = [
    { value: undefined, label: "No course" },
    ...courses.map((c) => ({ value: c.id as string | undefined, label: c.code, color: c.color })),
  ];
  const repeatChoices: Choice<RepeatChoice>[] = [
    { value: "none", label: "Doesn't repeat" },
    { value: "daily", label: "Every day" },
    { value: "weekdays", label: "Every weekday" },
    { value: "weekly", label: due ? describeRepeat(weeklyOn(due)) : "Every week" },
  ];

  return (
    <View className="flex-1">
      <ScrollView
        className="flex-1"
        contentContainerClassName={cn("w-full max-w-[760px] self-center pb-16", desktop ? "px-10 pt-10" : "px-5 pt-6")}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenHeader
          title="Tasks"
          subtitle={
            tasks.length
              ? `${open} open${overdueCount ? ` · ${overdueCount} overdue` : ""}${doneCount ? ` · ${doneCount} done` : ""}`
              : "Everything you need to get done."
          }
          right={
            isSupabaseConfigured ? (
              <Button
                variant="ghost"
                size="sm"
                onPress={() => {
                  setJoinCode(undefined);
                  setSectionsOpen(true);
                }}
              >
                <Icon as={Users} size={15} className="text-muted-foreground" />
                <Text className="text-muted-foreground">Class sections</Text>
              </Button>
            ) : undefined
          }
        />
        {isSupabaseConfigured ? (
          <SectionsDialog
            open={sectionsOpen}
            onOpenChange={(o) => {
              setSectionsOpen(o);
              if (!o) setJoinCode(undefined);
            }}
            joinCode={joinCode}
          />
        ) : null}

        {/* Composer */}
        <View className="bg-card border-border rounded-xl border shadow-sm shadow-black/5">
          <View className="flex-row items-center gap-3 px-4">
            <View className="border-muted-foreground/40 size-5 rounded-md border border-dashed" />
            <TextInput
              ref={composer}
              value={title}
              onChangeText={setTitle}
              onSubmitEditing={submit}
              returnKeyType="done"
              placeholder="Add a task…"
              placeholderTextColor={t.muted}
              accessibilityLabel="New task title"
              className="text-foreground h-12 flex-1 text-[15px] web:outline-none"
            />
          </View>
          <Separator className="bg-border/70" />
          <View className="flex-row flex-wrap items-center gap-1 px-2 py-1.5">
            <DueDateButton value={due} onChange={setDue} />
            {due ? (
              <TimePickerField value={dueTime} onChange={setDueTime} placeholder="Time" variant="ghost" accessibilityLabel="Due time" />
            ) : null}
            {due ? (
              <ChoicePopover value={repeatChoice} options={repeatChoices} onChange={setRepeatChoice} icon={Repeat} accessibilityLabel="Repeat" />
            ) : null}
            <ChoicePopover value={priority} options={PRIORITY_CHOICES} onChange={setPriority} icon={Flag} accessibilityLabel="Priority" />
            {courses.length ? (
              <ChoicePopover value={courseId} options={courseChoices} onChange={setCourseId} accessibilityLabel="Course" />
            ) : null}
            <View className="flex-1" />
            <Button size="sm" onPress={submit} disabled={!title.trim()} className="px-4">
              <Text>Add</Text>
            </Button>
          </View>
        </View>

        {/* Sections */}
        {tasks.length === 0 ? (
          <View className="items-center py-16">
            <Text className="font-display text-xl font-semibold">A clean slate.</Text>
            <Text className="text-muted-foreground mt-1 text-sm">Add your first task above.</Text>
          </View>
        ) : (
          <LayoutAnimationConfig skipEntering>
            {SECTIONS.map(({ key, title: sectionTitle }) => {
              const list = grouped.get(key);
              if (!list?.length) return null;
              const isDone = key === "done";
              return (
                <Animated.View key={key} layout={LinearTransition.springify().damping(22).stiffness(240)}>
                  <View className="flex-row items-center gap-2 px-2 pb-1 pt-7">
                    {isDone ? (
                      <Pressable
                        onPress={() => setShowDone((v) => !v)}
                        accessibilityRole="button"
                        accessibilityState={{ expanded: showDone }}
                        className="flex-row items-center gap-1.5 rounded web:transition-opacity web:hover:opacity-80"
                      >
                        <View style={{ transform: [{ rotate: showDone ? "90deg" : "0deg" }] }}>
                          <Icon as={ChevronRight} size={14} className="text-muted-foreground" />
                        </View>
                        <Text className="text-muted-foreground text-[13px] font-semibold">{sectionTitle}</Text>
                        <Text className="text-muted-foreground text-[13px] tabular-nums">{list.length}</Text>
                      </Pressable>
                    ) : (
                      <>
                        <Text className={cn("text-[13px] font-semibold", key === "overdue" ? "text-destructive" : "text-foreground")}>
                          {sectionTitle}
                        </Text>
                        <Text className="text-muted-foreground text-[13px] tabular-nums">{list.length}</Text>
                      </>
                    )}
                    <View className="flex-1" />
                    {isDone && showDone ? (
                      <Button variant="link" size="sm" className="h-6 px-1" onPress={clearCompletedTasks}>
                        <Text className="text-xs">Clear</Text>
                      </Button>
                    ) : null}
                  </View>
                  {!isDone || showDone
                    ? list.map((task) => (
                        <TaskRow
                          key={task.id}
                          task={task}
                          section={key}
                          course={task.courseId ? courseById[task.courseId] : undefined}
                          now={now}
                          focusing={focus.session?.taskId === task.id}
                          onToggle={(done) => complete(task, done)}
                          onRename={(v) => updateTask(task.id, { title: v })}
                          onEdit={() => setEditing({ mode: "edit", kind: "task", task })}
                          onDelete={() => remove(task)}
                          onFocus={() => (focus.session?.taskId === task.id ? focus.stop() : focus.start(task.id))}
                        />
                      ))
                    : null}
                </Animated.View>
              );
            })}
          </LayoutAnimationConfig>
        )}
      </ScrollView>

      <ItemEditorDialog target={editing} onClose={() => setEditing(null)} />
      <RecurringDeleteDialog
        task={deletingSeries}
        onCancel={() => setDeletingSeries(null)}
        onSkipOne={(task) => {
          skipTaskOccurrence(task.id);
          setDeletingSeries(null);
          toast({ message: "Skipped this one", description: `${task.title || "Task"} — the series continues`, actionLabel: "Undo", onAction: () => updateTask(task.id, { due: task.due, start: task.start, subtasks: task.subtasks }), duration: UNDO_MS });
        }}
        onDeleteSeries={(task) => {
          removeTask(task.id);
          setDeletingSeries(null);
          toast({ message: "Repeating task deleted", description: task.title || undefined, actionLabel: "Undo", onAction: () => restoreTask(task), duration: UNDO_MS });
        }}
      />
    </View>
  );
}
