import { Plus, TriangleAlert, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ScrollView, useWindowDimensions, View } from "react-native";

import { ChoicePopover, type Choice } from "@/components/ChoicePopover";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { uid, useCourses, useGrades, type Course, type CourseGrades } from "@/context/store";
import {
  DEFAULT_UNITS,
  FINAL_GRADE_OPTIONS,
  PASSING_GRADE,
  courseStanding,
  emptyGrades,
  formatGrade,
} from "@/lib/grades";
import { defaultTarget, gradeTargets } from "@/lib/insights";
import { cn } from "@/lib/utils";

// Per-course grade book: weighted components (e.g. Quizzes 20%), scores
// within them, a running standing, and an optional recorded final grade.
// Edits save as you type.

/** "Quizzes" → "Quiz", "Exams" → "Exam" (for naming new scores). */
function singular(name: string): string {
  return name.trim().replace(/zzes$/i, "z").replace(/([^s])s$/i, "$1") || "Score";
}

/** A number input that allows in-progress text ("8.", "") without fighting the user. */
function NumberField({
  value,
  onChange,
  placeholder,
  label,
  className,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
  label: string;
  className?: string;
}) {
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => {
    setText((t) => (Number(t) === value ? t : value == null ? "" : String(value)));
  }, [value]);
  return (
    <Input
      value={text}
      onChangeText={(t) => {
        setText(t);
        const n = t.trim() === "" ? undefined : Number(t);
        if (n === undefined || (isFinite(n) && n >= 0)) onChange(n);
      }}
      keyboardType="decimal-pad"
      placeholder={placeholder}
      accessibilityLabel={label}
      className={cn("h-9 px-2 text-sm tabular-nums", className)}
    />
  );
}

/** "What do I need for a 1.75?" — the average needed on components with no scores yet. */
function GradeTargetRow({ g, estimated }: { g: CourseGrades; estimated: number | null }) {
  const [picked, setPicked] = useState<number | undefined>(undefined);
  const plan = gradeTargets(g);
  if (!plan) return null;
  const grade = picked ?? defaultTarget(plan, estimated);
  const target = plan.targets.find((t) => t.grade === grade) ?? plan.targets[0];
  const left = plan.remaining.map((r) => `${r.name} (${r.weight}%)`).join(", ");
  const sentence =
    target.need == null
      ? target.status === "secured"
        ? `Every component has scores, and you're already at ${formatGrade(target.grade)} or better.`
        : `Every component has scores, so ${formatGrade(target.grade)} isn't possible unless scores change.`
      : target.status === "secured"
        ? `You've locked in at least ${formatGrade(target.grade)}, even with 0% on ${left}.`
        : target.status === "out-of-reach"
          ? `${formatGrade(target.grade)} is out of reach: you'd need ${Math.ceil(target.need)}% on ${left}.`
          : `To get ${formatGrade(target.grade)}, average at least ${Math.ceil(target.need)}% on ${left}.`;

  return (
    <View className="border-border gap-1.5 rounded-xl border px-4 py-3">
      <View className="flex-row flex-wrap items-center gap-1.5">
        <Text className="text-sm font-medium">What do I need for</Text>
        <ChoicePopover<number>
          value={grade}
          options={plan.targets.map((t) => ({ value: t.grade, label: formatGrade(t.grade) }))}
          onChange={setPicked}
          accessibilityLabel="Target grade"
          triggerClassName="border-border h-8 border"
        />
        <Text className="text-sm font-medium">?</Text>
      </View>
      <Text className={cn("text-sm leading-5", target.status === "out-of-reach" && "text-destructive")}>{sentence}</Text>
      {plan.remaining.length ? (
        <Text className="text-muted-foreground text-xs leading-4">
          Counts components with no scores yet as what&apos;s left. A component with some scores already counts as finished.
        </Text>
      ) : null}
    </View>
  );
}

export function GradesDialog({ course, onClose }: { course: Course | null; onClose: () => void }) {
  return (
    <Dialog open={!!course} onOpenChange={(o) => !o && onClose()}>
      {course ? (
        <DialogContent className="gap-4 p-5 sm:max-w-xl">
          <GradeBook key={course.id} course={course} />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function GradeBook({ course }: { course: Course }) {
  const { grades, setCourseGrades } = useGrades();
  const { updateCourse } = useCourses();
  const { height } = useWindowDimensions();
  const g: CourseGrades = grades[course.id] ?? emptyGrades();
  const s = courseStanding(g);
  const save = (next: CourseGrades) => setCourseGrades(course.id, next);

  const finalChoices: Choice<number | undefined>[] = [
    { value: undefined, label: "Not final yet" },
    ...FINAL_GRADE_OPTIONS.map((grade) => ({ value: grade as number | undefined, label: formatGrade(grade) })),
  ];

  const weightOff = g.components.length > 0 && Math.abs(s.totalWeight - 100) > 0.01;

  return (
    <>
      <DialogHeader>
        <View className="flex-row items-center gap-2">
          <View className="size-2.5 rounded-full" style={{ backgroundColor: course.color }} />
          <DialogTitle>{course.code} grades</DialogTitle>
        </View>
        <DialogDescription>{course.title ?? "Scores, weights and your running standing."}</DialogDescription>
      </DialogHeader>

      {/* Summary */}
      <View className="bg-muted/60 flex-row flex-wrap items-center gap-x-6 gap-y-3 rounded-xl px-4 py-3">
        <View>
          <Text className="text-muted-foreground text-xs">Standing</Text>
          <Text className="font-display text-2xl font-semibold tabular-nums">{s.percent == null ? "—" : `${s.percent.toFixed(1)}%`}</Text>
        </View>
        <View>
          <Text className="text-muted-foreground text-xs">{s.isFinal ? "Final grade" : "Estimated grade"}</Text>
          <Text
            className={cn("font-display text-2xl font-semibold tabular-nums", s.grade != null && s.grade > PASSING_GRADE && "text-destructive")}
          >
            {s.grade == null ? "—" : formatGrade(s.grade)}
          </Text>
        </View>
        <View className="ml-auto gap-1">
          <Text className="text-muted-foreground text-xs">Units</Text>
          <NumberField
            value={course.units ?? DEFAULT_UNITS}
            onChange={(units) => units != null && units > 0 && updateCourse(course.id, { units })}
            label="Units"
            className="w-16"
          />
        </View>
        <View className="gap-1">
          <Text className="text-muted-foreground text-xs">Final grade</Text>
          <ChoicePopover
            value={g.finalGrade}
            options={finalChoices}
            onChange={(finalGrade) => save({ ...g, finalGrade })}
            accessibilityLabel="Final grade"
            triggerClassName="border-border border"
          />
        </View>
      </View>
      {!s.isFinal ? (
        <Text className="text-muted-foreground -mt-2 text-xs">
          Estimate uses a common UP scale (92% = 1.00 … 60% = 3.00). Instructors vary, so record your final grade when it&apos;s out.
        </Text>
      ) : null}
      {!s.isFinal ? <GradeTargetRow g={g} estimated={s.estimatedGrade} /> : null}

      <ScrollView style={{ maxHeight: Math.max(240, height * 0.5) }} contentContainerClassName="gap-4">
        {g.components.map((comp) => {
          const cs = s.components.find((c) => c.component.id === comp.id);
          const entries = g.entries.filter((e) => e.componentId === comp.id);
          return (
            <View key={comp.id} className="border-border rounded-xl border">
              <View className="flex-row items-center gap-2 px-3 py-2">
                <Input
                  value={comp.name}
                  onChangeText={(name) => save({ ...g, components: g.components.map((c) => (c.id === comp.id ? { ...c, name } : c)) })}
                  accessibilityLabel="Component name"
                  placeholder="Component"
                  className="h-9 flex-1 font-medium"
                />
                <NumberField
                  value={comp.weight}
                  onChange={(w) => save({ ...g, components: g.components.map((c) => (c.id === comp.id ? { ...c, weight: w ?? 0 } : c)) })}
                  label={`${comp.name} weight percent`}
                  className="w-14 text-right"
                />
                <Text className="text-muted-foreground text-sm">%</Text>
                <Text className="text-muted-foreground w-14 text-right text-sm tabular-nums">
                  {cs?.percent == null ? "—" : `${cs.percent.toFixed(0)}%`}
                </Text>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  accessibilityLabel={`Remove ${comp.name}`}
                  onPress={() =>
                    save({
                      ...g,
                      components: g.components.filter((c) => c.id !== comp.id),
                      entries: g.entries.filter((e) => e.componentId !== comp.id),
                    })
                  }
                >
                  <Icon as={X} size={14} className="text-muted-foreground" />
                </Button>
              </View>
              <View className="border-border/60 gap-1.5 border-t px-3 py-2">
                {entries.map((e) => (
                  <View key={e.id} className="flex-row items-center gap-2">
                    <Input
                      value={e.name}
                      onChangeText={(name) => save({ ...g, entries: g.entries.map((x) => (x.id === e.id ? { ...x, name } : x)) })}
                      placeholder="e.g. Quiz 1"
                      accessibilityLabel="Score name"
                      className="h-9 flex-1 text-sm"
                    />
                    <NumberField
                      value={e.score}
                      onChange={(score) => save({ ...g, entries: g.entries.map((x) => (x.id === e.id ? { ...x, score: score ?? 0 } : x)) })}
                      label={`${e.name || "Score"} points earned`}
                      className="w-16 text-right"
                    />
                    <Text className="text-muted-foreground text-sm">/</Text>
                    <NumberField
                      value={e.total}
                      onChange={(total) => save({ ...g, entries: g.entries.map((x) => (x.id === e.id ? { ...x, total: total ?? 0 } : x)) })}
                      label={`${e.name || "Score"} total points`}
                      className="w-16"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      accessibilityLabel={`Remove ${e.name || "score"}`}
                      onPress={() => save({ ...g, entries: g.entries.filter((x) => x.id !== e.id) })}
                    >
                      <Icon as={X} size={14} className="text-muted-foreground" />
                    </Button>
                  </View>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  onPress={() =>
                    save({
                      ...g,
                      entries: [
                        ...g.entries,
                        { id: uid("ge"), componentId: comp.id, name: `${singular(comp.name)} ${entries.length + 1}`, score: 0, total: 100 },
                      ],
                    })
                  }
                >
                  <Icon as={Plus} size={14} className="text-primary" />
                  <Text className="text-primary">Add score</Text>
                </Button>
              </View>
            </View>
          );
        })}
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onPress={() => save({ ...g, components: [...g.components, { id: uid("gc"), name: "New component", weight: 0 }] })}
        >
          <Icon as={Plus} size={14} />
          <Text>Add component</Text>
        </Button>
      </ScrollView>

      {weightOff ? (
        <View className="flex-row items-center gap-2" role="alert">
          <Icon as={TriangleAlert} size={14} className="text-warning" />
          <Text className="text-muted-foreground text-xs">
            Weights add up to {s.totalWeight}%, not 100%. Standing uses the weights of components that have scores.
          </Text>
        </View>
      ) : null}
    </>
  );
}
