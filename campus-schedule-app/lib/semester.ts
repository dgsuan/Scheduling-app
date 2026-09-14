import type { Course, CourseGrades, Task } from "@/context/store";
import { computeGwa, courseStanding, DEFAULT_UNITS } from "@/lib/grades";

// Ending a semester: a compact record of what you took and how it went,
// kept after the courses themselves are cleared, so GWA can run across
// semesters. Stored inside planner settings, so it syncs and is backed up.

export type ArchivedCourse = {
  code: string;
  title?: string;
  section?: string;
  units: number;
  grade: number | null;
  isFinal: boolean;
};

export type ArchivedTerm = {
  id: string;
  label: string;
  term?: { start: string; end: string };
  archivedAt: number;
  courses: ArchivedCourse[];
  gwa: number | null;
  units: number;
  tasksDone: number;
};

/** UP's calendar: 1st semester from August, 2nd from January, midyear in June–July. */
export function termLabel(term: { start: string; end: string } | undefined, todayIso: string): string {
  const ref = term?.start ?? todayIso;
  const year = Number(ref.slice(0, 4));
  const month = Number(ref.slice(5, 7));
  if (month >= 8) return `1st Semester, AY ${year}–${year + 1}`;
  if (month <= 5) return `2nd Semester, AY ${year - 1}–${year}`;
  return `Midyear ${year}`;
}

export function buildArchive(input: {
  id: string;
  label: string;
  term?: { start: string; end: string };
  courses: Course[];
  grades: Record<string, CourseGrades>;
  tasks: Task[];
  archivedAt: number;
}): ArchivedTerm {
  const gwa = computeGwa(input.courses, input.grades);
  return {
    id: input.id,
    label: input.label.trim().slice(0, 80) || termLabel(input.term, new Date(input.archivedAt).toISOString().slice(0, 10)),
    term: input.term,
    archivedAt: input.archivedAt,
    courses: input.courses.map((c) => {
      const s = courseStanding(input.grades[c.id]);
      return {
        code: c.code,
        title: c.title,
        section: c.section,
        units: c.units ?? DEFAULT_UNITS,
        grade: s.grade,
        isFinal: s.isFinal,
      };
    }),
    gwa: gwa.gwa,
    units: gwa.units,
    tasksDone: input.tasks.filter((t) => t.done).length,
  };
}

/** GWA across archived semesters plus (optionally) the current one. */
export function cumulativeGwa(
  archives: ArchivedTerm[],
  current?: { courses: Course[]; grades: Record<string, CourseGrades> }
): { gwa: number | null; units: number } {
  let points = 0;
  let units = 0;
  for (const term of archives) {
    for (const c of term.courses) {
      if (c.grade == null || !(c.units > 0)) continue;
      points += c.grade * c.units;
      units += c.units;
    }
  }
  if (current) {
    for (const c of computeGwa(current.courses, current.grades).counted) {
      points += c.grade * c.units;
      units += c.units;
    }
  }
  return { gwa: units > 0 ? points / units : null, units };
}
