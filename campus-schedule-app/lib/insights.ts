import type { CourseGrades, Task } from "@/context/store";
import { addDaysIso, startOfWeekIso, weekdayOf } from "@/lib/dates";
import { courseStanding, UP_SCALE } from "@/lib/grades";
import { classesOnDate, WEEKDAY_LONG, type ScheduleRules } from "@/lib/schedule";
import type { Course } from "@/context/store";

// Insights built from data the app already has: what score you need for a
// target grade, days that pile up, and where this week's focus time went.
// Pure functions, unit-tested in tests/insights.test.ts.

// --- "What do I need?" -----------------------------------------------------

export type TargetStatus = "secured" | "reachable" | "out-of-reach";

export type GradeTarget = {
  grade: number;
  /** Overall percent this grade starts at (UP scale). */
  minPercent: number;
  /** Average percent needed on what's left; null when nothing is left. */
  need: number | null;
  status: TargetStatus;
};

export type GradeTargetPlan = {
  /** Components with no scores yet — what's still ahead. */
  remaining: { name: string; weight: number }[];
  remainingWeight: number;
  targets: GradeTarget[];
};

/**
 * For each grade on the UP scale, the average you'd need on the components
 * that have no scores yet. Components that already have some scores count as
 * finished (the standing can't know how many more quizzes are coming).
 */
export function gradeTargets(g: CourseGrades | undefined): GradeTargetPlan | null {
  const s = courseStanding(g);
  if (!g || s.totalWeight <= 0) return null;
  const earned = s.components.reduce((sum, c) => sum + (c.percent != null ? c.percent * c.component.weight : 0), 0);
  const remaining = s.components
    .filter((c) => c.percent == null && c.component.weight > 0)
    .map((c) => ({ name: c.component.name.trim() || "Unnamed", weight: c.component.weight }));
  const remainingWeight = remaining.reduce((sum, r) => sum + r.weight, 0);
  const targets = UP_SCALE.map(([minPercent, grade]): GradeTarget => {
    const missing = minPercent * s.totalWeight - earned;
    if (remainingWeight <= 0) return { grade, minPercent, need: null, status: missing <= 1e-9 ? "secured" : "out-of-reach" };
    const need = missing / remainingWeight;
    return { grade, minPercent, need, status: need <= 0 ? "secured" : need > 100 ? "out-of-reach" : "reachable" };
  });
  return { remaining, remainingWeight, targets };
}

/** A sensible first target: one step better than the estimate if it's still possible. */
export function defaultTarget(plan: GradeTargetPlan, estimated: number | null): number {
  const open = plan.targets.filter((t) => t.status !== "out-of-reach");
  if (!open.length) return plan.targets[plan.targets.length - 1].grade;
  if (estimated == null) return open[0].grade;
  const idx = plan.targets.findIndex((t) => t.grade === estimated);
  const better = idx > 0 ? plan.targets[idx - 1] : undefined;
  if (better && better.status !== "out-of-reach") return better.grade;
  return open.find((t) => t.grade >= estimated)?.grade ?? open[open.length - 1].grade;
}

// --- Heavy days ----------------------------------------------------------

const HEAVY = /\b(exams?|midterms?|finals?|long tests?|lt ?\d*|quiz(zes)?|lab|labs|reports?|papers?|projects?|presentations?|defen[cs]e|thesis|mp ?\d*|machine problems?)\b/i;

export type DayLoad = {
  date: string;
  classes: number;
  classMinutes: number;
  deadlines: Task[];
  /** Deadlines that look like exams, labs, reports or projects. */
  heavy: number;
  crunch: boolean;
};

export function dayLoads(courses: Course[], tasks: Task[], rules: ScheduleRules, fromIso: string, days = 7): DayLoad[] {
  const out: DayLoad[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDaysIso(fromIso, i);
    const classes = classesOnDate(courses, date, rules);
    const classMinutes = classes.reduce((sum, o) => sum + (o.endMin - o.startMin), 0);
    const deadlines = tasks.filter((t) => !t.done && t.due === date);
    const heavy = deadlines.filter((t) => HEAVY.test(t.title)).length;
    const crunch =
      deadlines.length >= 3 || heavy >= 2 || (deadlines.length >= 2 && (classMinutes >= 240 || heavy >= 1));
    out.push({ date, classes: classes.length, classMinutes, deadlines, heavy, crunch });
  }
  return out;
}

export function dayLabel(date: string, todayIso: string): string {
  if (date === todayIso) return "Today";
  if (date === addDaysIso(todayIso, 1)) return "Tomorrow";
  return WEEKDAY_LONG[weekdayOf(date)];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : word.endsWith("s") ? "es" : "s"}`;

/** "2 classes · 3 deadlines (Lab report, Quiz 2, Essay)". */
export function describeLoad(d: DayLoad): string {
  const parts: string[] = [];
  if (d.classes) parts.push(plural(d.classes, "class"));
  if (d.deadlines.length) {
    const names = d.deadlines.map((t) => t.title.trim() || "Untitled");
    const more = names.length > 3 ? `, +${names.length - 3}` : "";
    parts.push(`${plural(d.deadlines.length, "deadline")} (${names.slice(0, 3).join(", ")}${more})`);
  }
  return parts.join(" · ");
}

// --- Focus time per course ---------------------------------------------

export type CourseFocus = { courseId: string | null; seconds: number };

export type FocusWeek = {
  weekStart: string;
  weekEnd: string;
  totalSeconds: number;
  byCourse: CourseFocus[];
  /** Courses with deadlines left this week but little focus time. */
  warnings: { courseId: string; deadlines: number; seconds: number }[];
};

/** Below this much focus in a week, a course with 2+ deadlines left gets flagged. */
export const LOW_FOCUS_SECONDS = 30 * 60;

export function focusThisWeek(tasks: Task[], todayIso: string): FocusWeek {
  const weekStart = startOfWeekIso(todayIso);
  const weekEnd = addDaysIso(weekStart, 6);
  const seconds = new Map<string | null, number>();
  for (const t of tasks) {
    for (const [day, sec] of Object.entries(t.focusLog ?? {})) {
      if (day < weekStart || day > weekEnd || !(sec > 0)) continue;
      const key = t.courseId ?? null;
      seconds.set(key, (seconds.get(key) ?? 0) + sec);
    }
  }
  const byCourse = [...seconds.entries()].map(([courseId, s]) => ({ courseId, seconds: s })).sort((a, b) => b.seconds - a.seconds);

  const deadlines = new Map<string, number>();
  for (const t of tasks) {
    if (t.done || !t.courseId || !t.due || t.due < todayIso || t.due > weekEnd) continue;
    deadlines.set(t.courseId, (deadlines.get(t.courseId) ?? 0) + 1);
  }
  const warnings = [...deadlines.entries()]
    .map(([courseId, n]) => ({ courseId, deadlines: n, seconds: seconds.get(courseId) ?? 0 }))
    .filter((w) => w.deadlines >= 2 && w.seconds < LOW_FOCUS_SECONDS)
    .sort((a, b) => b.deadlines - a.deadlines || a.seconds - b.seconds);

  return { weekStart, weekEnd, totalSeconds: byCourse.reduce((s, c) => s + c.seconds, 0), byCourse, warnings };
}
