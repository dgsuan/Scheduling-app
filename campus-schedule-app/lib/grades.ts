import type { Course, CourseGrades, GradeComponent } from "@/context/store";

// Course standing and GWA using UP's 1.00–5.00 grading scale.
//
// Standing is the weighted average of the components that have scores so
// far ("running" standing), so an early quiz isn't dragged down by exams
// that haven't happened yet. The percent → grade conversion uses a common
// UP transmutation table; instructors vary, so it's labelled an estimate
// and every course can record its actual final grade instead.

/** [minimum percent, grade], best first. Below the last row: 5.00. */
export const UP_SCALE: readonly (readonly [number, number])[] = [
  [92, 1.0],
  [88, 1.25],
  [84, 1.5],
  [80, 1.75],
  [76, 2.0],
  [72, 2.25],
  [68, 2.5],
  [64, 2.75],
  [60, 3.0],
  [55, 4.0],
];

export const FAILING_GRADE = 5.0;
export const PASSING_GRADE = 3.0;

/** Grades a student can record as a course's final grade. */
export const FINAL_GRADE_OPTIONS = [1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0, 4.0, 5.0];

export const DEFAULT_UNITS = 3;

export function defaultComponents(): GradeComponent[] {
  const id = () => `gc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  return [
    { id: id(), name: "Quizzes", weight: 20 },
    { id: id(), name: "Exams", weight: 50 },
    { id: id(), name: "Requirements", weight: 30 },
  ];
}

export function emptyGrades(): CourseGrades {
  return { components: defaultComponents(), entries: [] };
}

export function percentToGrade(percent: number): number {
  for (const [min, grade] of UP_SCALE) if (percent >= min) return grade;
  return FAILING_GRADE;
}

export function formatGrade(grade: number): string {
  return grade.toFixed(2);
}

export type ComponentStanding = {
  component: GradeComponent;
  /** Points-based percent within the component, or null if no scores yet. */
  percent: number | null;
  count: number;
};

export type CourseStanding = {
  components: ComponentStanding[];
  /** Weighted running percent over graded components, or null. */
  percent: number | null;
  /** Sum of weights of components that have scores. */
  weightCovered: number;
  totalWeight: number;
  estimatedGrade: number | null;
  /** The recorded final grade if set, else the estimate. */
  grade: number | null;
  isFinal: boolean;
};

export function courseStanding(g: CourseGrades | undefined): CourseStanding {
  const components = (g?.components ?? []).map((component) => {
    const entries = (g?.entries ?? []).filter((e) => e.componentId === component.id && e.total > 0);
    const total = entries.reduce((s, e) => s + e.total, 0);
    const score = entries.reduce((s, e) => s + e.score, 0);
    return { component, percent: total > 0 ? (score / total) * 100 : null, count: entries.length };
  });
  const graded = components.filter((c) => c.percent != null && c.component.weight > 0);
  const weightCovered = graded.reduce((s, c) => s + c.component.weight, 0);
  const percent =
    weightCovered > 0 ? graded.reduce((s, c) => s + c.percent! * c.component.weight, 0) / weightCovered : null;
  const estimatedGrade = percent == null ? null : percentToGrade(percent);
  const isFinal = g?.finalGrade != null;
  return {
    components,
    percent,
    weightCovered,
    totalWeight: (g?.components ?? []).reduce((s, c) => s + c.weight, 0),
    estimatedGrade,
    grade: isFinal ? g!.finalGrade! : estimatedGrade,
    isFinal,
  };
}

export type GwaResult = {
  gwa: number | null;
  units: number;
  counted: { course: Course; grade: number; units: number; isFinal: boolean }[];
  allFinal: boolean;
};

/** GWA = Σ(grade × units) / Σ units over courses that have a grade. */
export function computeGwa(courses: Course[], grades: Record<string, CourseGrades>): GwaResult {
  const counted = courses.flatMap((course) => {
    const s = courseStanding(grades[course.id]);
    const units = course.units ?? DEFAULT_UNITS;
    return s.grade != null && units > 0 ? [{ course, grade: s.grade, units, isFinal: s.isFinal }] : [];
  });
  const units = counted.reduce((s, c) => s + c.units, 0);
  return {
    gwa: units > 0 ? counted.reduce((s, c) => s + c.grade * c.units, 0) / units : null,
    units,
    counted,
    allFinal: counted.length > 0 && counted.every((c) => c.isFinal),
  };
}
