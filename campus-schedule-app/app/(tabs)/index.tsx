import { router } from "expo-router";
import { ArrowRight, Plus, TriangleAlert } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import Animated, { FadeIn, FadeOut, LayoutAnimationConfig, LinearTransition } from "react-native-reanimated";

import { ScreenHeader } from "@/components/ScreenHeader";
import { GetStarted } from "@/components/schedule/GetStarted";
import { RoomDialog } from "@/components/schedule/RoomDialog";
import { WhatsNewBanner } from "@/components/schedule/WhatsNewBanner";
import { ScheduleRow, TodayHero } from "@/components/schedule/TodayHero";
import { WeekStrip } from "@/components/schedule/WeekStrip";
import { TaskCheckbox } from "@/components/TaskCheckbox";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Text } from "@/components/ui/text";
import { colors } from "@/constants/theme";
import { holidaysOn } from "@/constants/holidays";
import { formatSpent } from "@/context/focus";
import {
  GENERAL_CANVAS,
  useCanvas,
  useCourses,
  useEvents,
  useScheduleRules,
  useTasks,
  type Task,
  type Weekday,
} from "@/context/store";
import { agendaForDate, formatShortDate } from "@/lib/calendar";
import { dayLabel, dayLoads, describeLoad, focusThisWeek } from "@/lib/insights";
import { classesOnDate, computeNowAndNext, occurrencesOnDate, type DatedOccurrence } from "@/lib/schedule";
import { formatDue, isDueSoon, isOverdue, isoDate, sortTasks, withinNextDays } from "@/lib/tasks";
import { greeting } from "@/lib/timeOfDay";
import { useBreakpoint } from "@/lib/useBreakpoint";
import { useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";

// Home: a personal command center. One dominant block (what's happening
// now / next), then the rest of today, with tasks, the week and recent
// notes alongside. Hierarchy comes from type and space, not more cards.

function SectionTitle({ children, right }: { children: string; right?: React.ReactNode }) {
  return (
    <View className="mb-2 flex-row items-baseline justify-between">
      <Text className="text-[15px] font-semibold">{children}</Text>
      {right}
    </View>
  );
}

function LinkButton({ label, href }: { label: string; href: "/tasks" | "/notes" | "/calendar" }) {
  return (
    <Pressable
      onPress={() => router.navigate(href)}
      accessibilityRole="link"
      className="group flex-row items-center gap-1 rounded px-1 web:transition-opacity web:hover:opacity-80"
    >
      <Text className="text-primary text-[13px] font-medium">{label}</Text>
      <Icon as={ArrowRight} size={13} className="text-primary web:transition-transform web:group-hover:translate-x-0.5" />
    </Pressable>
  );
}

function TaskLine({ task, now, onToggle }: { task: Task; now: Date; onToggle: (done: boolean) => void }) {
  const overdue = isOverdue(task, now);
  const soon = !overdue && isDueSoon(task, now);
  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      exiting={FadeOut.duration(150)}
      layout={LinearTransition.springify().damping(20).stiffness(220)}
    >
      {/* Reanimated views ignore className — layout lives on the inner View. */}
      <View className="flex-row items-center gap-3 py-2">
      <TaskCheckbox checked={task.done} onCheckedChange={onToggle} label={task.title || "Task"} />
      <Text
        numberOfLines={1}
        className={cn("flex-1 text-[15px]", task.done && "text-muted-foreground line-through")}
      >
        {task.title}
      </Text>
      {task.due ? (
        <Text
          className={cn(
            "text-[13px] tabular-nums",
            task.done ? "text-muted-foreground" : overdue ? "text-destructive font-medium" : soon ? "text-warning font-medium" : "text-muted-foreground"
          )}
        >
          {overdue && !task.done ? "Overdue · " : ""}
          {formatDue(task, now)}
        </Text>
      ) : null}
      </View>
    </Animated.View>
  );
}

export default function ScheduleHomeScreen() {
  const { courses } = useCourses();
  const { tasks, addTask, updateTask } = useTasks();
  const { events } = useEvents();
  const { items: generalItems } = useCanvas(GENERAL_CANVAS);
  const { desktop } = useBreakpoint();
  const now = useNow();
  const [quick, setQuick] = useState("");
  const [roomFor, setRoomFor] = useState<DatedOccurrence | null>(null);

  const tIso = isoDate(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const rules = useScheduleRules();
  const { ongoing, next, termState } = useMemo(() => computeNowAndNext(courses, now, rules), [courses, now, rules]);
  const todays = useMemo(() => classesOnDate(courses, tIso, rules), [courses, tIso, rules]);
  const skippedToday = useMemo(() => {
    if (todays.length) return null;
    const occ = occurrencesOnDate(courses, tIso, rules);
    const holiday = occ.find((o) => o.status === "holiday");
    if (holiday) return { reason: holiday.holiday!.name };
    const cancelled = occ.filter((o) => o.status === "cancelled");
    return cancelled.length ? { reason: `${cancelled.map((o) => o.course.code).join(", ")} cancelled` } : null;
  }, [courses, tIso, rules, todays.length]);

  // Rows beneath the hero: "Next" (only while something is on), then later.
  const heroOcc = ongoing ?? (next && next.daysAhead === 0 ? next : null);
  const nextRow = ongoing && next && next.daysAhead === 0 ? next : null;
  const laterStart = (nextRow ?? heroOcc)?.startMin ?? nowMin;
  const later = todays.filter((o) => o.startMin > laterStart);
  const todaysEvents = useMemo(
    () =>
      agendaForDate(tIso, now.getDay() as Weekday, { courses: [], tasks: [], events, notes: [], holidays: [] }).filter(
        (i) => i.kind === "event"
      ),
    [events, tIso, now]
  );

  const overdue = useMemo(() => sortTasks(tasks.filter((t) => isOverdue(t, now))), [tasks, now]);
  const dueToday = useMemo(
    () => sortTasks(tasks.filter((t) => t.due === tIso && !isOverdue(t, now))),
    [tasks, tIso, now]
  );
  const upcoming = useMemo(
    () => withinNextDays(tasks, 7, now).filter((t) => t.due! > tIso && !t.done).slice(0, 4),
    [tasks, now, tIso]
  );
  const doneToday = dueToday.filter((t) => t.done).length;

  const recentNotes = useMemo(
    () => generalItems.filter((it) => it.kind === "text" && it.text.trim()).slice(-3).reverse(),
    [generalItems]
  );

  // Heavy days ahead (today included) and where this week's focus time went.
  const crunches = useMemo(() => dayLoads(courses, tasks, rules, tIso, 7).filter((d) => d.crunch).slice(0, 2), [courses, tasks, rules, tIso]);
  const focusWeek = useMemo(() => focusThisWeek(tasks, tIso), [tasks, tIso]);
  const courseMap = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);

  const holiday = holidaysOn(tIso)[0];
  const openToday = dueToday.length - doneToday;
  const summary = [
    `${todays.length} class${todays.length === 1 ? "" : "es"} today`,
    `${openToday} task${openToday === 1 ? "" : "s"} due`,
  ];

  const addQuick = () => {
    const text = quick.trim();
    if (!text) return;
    addTask({ title: text, priority: "medium", due: tIso, done: false });
    setQuick("");
  };

  const dateTitle = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  const schedule = (
    <View>
      <TodayHero
        ongoing={ongoing}
        next={next}
        termState={termState}
        skippedToday={skippedToday}
        term={rules.term}
        now={now}
        hasCourses={courses.length > 0}
      />
      {nextRow || later.length || todaysEvents.length ? (
        <View className="mt-2 px-1">
          {nextRow ? <ScheduleRow occ={nextRow} label="Next" now={now} emphasis onRoomPress={() => setRoomFor(nextRow)} /> : null}
          {later.map((o, i) => (
            <View key={`${o.course.id}-${o.startMin}`}>
              {i > 0 || nextRow ? <Separator className="bg-border/60" /> : null}
              <ScheduleRow occ={o} label={i === 0 ? "Later" : undefined} now={now} onRoomPress={() => setRoomFor(o)} />
            </View>
          ))}
          {todaysEvents.map((e, i) => (
            <View key={e.key}>
              {i > 0 || nextRow || later.length ? <Separator className="bg-border/60" /> : null}
              <View className="flex-row items-center gap-4 py-3.5">
                <Text className="text-muted-foreground w-12 text-[11px] font-semibold uppercase tracking-[1.2px]">
                  {i === 0 ? "Event" : ""}
                </Text>
                <View className="bg-primary h-[3px] w-2 rounded-full" />
                <Text className="flex-1 text-[15px] font-medium">{e.title}</Text>
                <Text className="text-muted-foreground text-sm tabular-nums">{e.kind === "event" ? e.timeLabel : ""}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );

  const taskSection = (
    <View>
      <SectionTitle
        right={
          dueToday.length ? (
            <Text className="text-muted-foreground text-[13px] tabular-nums">
              {doneToday} of {dueToday.length} done today
            </Text>
          ) : (
            <LinkButton label="All tasks" href="/tasks" />
          )
        }
      >
        Tasks
      </SectionTitle>
      <View className="border-border bg-card/60 mb-1 flex-row items-center gap-2 rounded-lg border px-3">
        <Icon as={Plus} size={16} className="text-muted-foreground" />
        <Input
          value={quick}
          onChangeText={setQuick}
          onSubmitEditing={addQuick}
          returnKeyType="done"
          placeholder="Add a task for today…"
          accessibilityLabel="Add a task for today"
          className="h-10 flex-1 border-0 bg-transparent px-0 shadow-none dark:bg-transparent web:focus-visible:ring-0"
        />
      </View>
      <LayoutAnimationConfig skipEntering>
        {overdue.length + dueToday.length + upcoming.length === 0 ? (
          <Text className="text-muted-foreground py-3 text-sm">Nothing due. Enjoy the breathing room.</Text>
        ) : null}
        {[...overdue, ...dueToday.filter((t) => !t.done), ...upcoming, ...dueToday.filter((t) => t.done)].map((t) => (
          <TaskLine key={t.id} task={t} now={now} onToggle={(done) => updateTask(t.id, { done })} />
        ))}
      </LayoutAnimationConfig>
      {dueToday.length ? (
        <View className="mt-1 items-start">
          <LinkButton label="All tasks" href="/tasks" />
        </View>
      ) : null}
    </View>
  );

  const side = (
    <View className="gap-9">
      {taskSection}
      <View>
        <SectionTitle right={<LinkButton label="Calendar" href="/calendar" />}>This week</SectionTitle>
        <WeekStrip courses={courses} tasks={tasks} now={now} rules={rules} />
      </View>
      {focusWeek.totalSeconds > 0 || focusWeek.warnings.length ? (
        <View>
          <SectionTitle
            right={
              focusWeek.totalSeconds > 0 ? (
                <Text className="text-muted-foreground text-[13px] tabular-nums">{formatSpent(focusWeek.totalSeconds)} this week</Text>
              ) : undefined
            }
          >
            Focus time
          </SectionTitle>
          <View className="gap-2.5">
            {focusWeek.warnings.slice(0, 2).map((w) => {
              const course = courseMap.get(w.courseId);
              if (!course) return null;
              return (
                <View key={`warn-${w.courseId}`} className="flex-row gap-2">
                  <Icon as={TriangleAlert} size={14} className="text-warning mt-0.5" />
                  <Text className="flex-1 text-[13px] leading-[18px]">
                    {course.code} has {w.deadlines} deadlines left this week but {w.seconds ? `only ${formatSpent(w.seconds)} of` : "no"} focus time.
                  </Text>
                </View>
              );
            })}
            {focusWeek.byCourse.map((c) => {
              const course = c.courseId ? courseMap.get(c.courseId) : undefined;
              const share = c.seconds / (focusWeek.byCourse[0]?.seconds || 1);
              return (
                <View key={c.courseId ?? "none"} className="gap-1">
                  <View className="flex-row items-baseline justify-between">
                    <Text className="text-[13px]">{course?.code ?? "No course"}</Text>
                    <Text className="text-muted-foreground text-[13px] tabular-nums">{formatSpent(c.seconds)}</Text>
                  </View>
                  <View className="bg-muted h-1.5 overflow-hidden rounded-full">
                    <View
                      className="bg-muted-foreground/40 h-full rounded-full"
                      style={[{ width: `${Math.max(4, share * 100)}%` }, course ? { backgroundColor: course.color } : null]}
                    />
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}
      {recentNotes.length ? (
        <View>
          <SectionTitle right={<LinkButton label="Notes" href="/notes" />}>Recent notes</SectionTitle>
          <View className="gap-2">
            {recentNotes.map((n) =>
              n.kind === "text" ? (
                <Pressable
                  key={n.id}
                  onPress={() => router.navigate("/notes")}
                  accessibilityRole="button"
                  className="bg-card/70 border-border flex-row gap-3 overflow-hidden rounded-lg border py-2.5 pr-3 web:transition-colors web:hover:bg-card active:bg-accent"
                >
                  <View className="w-1 rounded-full" style={{ backgroundColor: n.color }} />
                  <View className="flex-1">
                    <Text numberOfLines={2} className="text-[14px] leading-5">
                      {n.text.trim()}
                    </Text>
                    {n.date ? <Text className="text-muted-foreground mt-0.5 text-xs">{formatShortDate(n.date)}</Text> : null}
                  </View>
                </Pressable>
              ) : null
            )}
          </View>
        </View>
      ) : null}
    </View>
  );

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName={cn("w-full max-w-[1120px] self-center pb-16", desktop ? "px-10 pt-10" : "px-5 pt-6")}
      keyboardShouldPersistTaps="handled"
    >
      <ScreenHeader eyebrow={greeting(now)} title={dateTitle} />
      <View className={cn("-mt-4 flex-row flex-wrap items-center gap-x-3 gap-y-1", crunches.length ? "mb-3" : "mb-7")}>
        <Text className="text-muted-foreground text-sm">
          {summary.join("  ·  ")}
          {overdue.length ? (
            <Text className="text-destructive text-sm font-medium">{`  ·  ${overdue.length} overdue`}</Text>
          ) : null}
        </Text>
        {holiday ? (
          <View className="flex-row items-center gap-1.5">
            <View className="size-1.5 rotate-45" style={{ backgroundColor: colors.holidayRegular }} />
            <Text className="text-sm font-medium" style={{ color: colors.holidayRegular }}>
              {holiday.name}
            </Text>
          </View>
        ) : null}
      </View>
      {crunches.length ? (
        <View className="mb-7 gap-1.5">
          {crunches.map((d) => (
            <Pressable
              key={d.date}
              onPress={() => router.navigate("/tasks")}
              accessibilityRole="link"
              className="flex-row items-start gap-2 self-start rounded web:transition-opacity web:hover:opacity-80"
            >
              <Icon as={TriangleAlert} size={14} className="text-warning mt-[3px]" />
              <Text className="flex-1 text-sm leading-5">
                <Text className="text-sm font-semibold">{dayLabel(d.date, tIso)} looks heavy:</Text> {describeLoad(d)}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <WhatsNewBanner />
      <GetStarted />
      <RoomDialog room={roomFor?.meeting.room ?? null} occurrence={roomFor} onClose={() => setRoomFor(null)} />

      {desktop ? (
        <View className="flex-row items-start gap-12">
          <View className="flex-[1.35]">{schedule}</View>
          <View className="flex-1">{side}</View>
        </View>
      ) : (
        <View className="gap-10">
          {schedule}
          {side}
        </View>
      )}
    </ScrollView>
  );
}
