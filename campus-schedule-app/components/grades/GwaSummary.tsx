import { View } from "react-native";

import { Text } from "@/components/ui/text";
import { useSemester, type Course, type CourseGrades } from "@/context/store";
import { computeGwa, formatGrade } from "@/lib/grades";
import { cumulativeGwa } from "@/lib/semester";

// GWA (general weighted average, UP scale) for this semester, plus the
// overall GWA once past semesters have been archived.

export function GwaSummary({ courses, grades }: { courses: Course[]; grades: Record<string, CourseGrades> }) {
  const r = computeGwa(courses, grades);
  const { archivedTerms } = useSemester();
  const overall = archivedTerms.length ? cumulativeGwa(archivedTerms, { courses, grades }) : null;
  return (
    <View className="bg-card/80 border-border mb-6 flex-row items-center gap-5 rounded-xl border px-5 py-4">
      <View>
        <Text className="text-muted-foreground text-xs font-semibold uppercase tracking-[1.2px]">GWA</Text>
        <Text className="font-display text-[34px] font-semibold leading-[40px] tabular-nums">
          {r.gwa == null ? "—" : formatGrade(r.gwa)}
        </Text>
      </View>
      <Text className="text-muted-foreground flex-1 text-sm leading-5">
        {r.gwa == null
          ? courses.length
            ? "Open a course's Grades to log scores — your GWA will appear here."
            : "Add courses to start tracking grades."
          : `${r.allFinal ? "From final grades" : "Estimated"} · ${r.counted.length} course${r.counted.length === 1 ? "" : "s"} · ${r.units} unit${r.units === 1 ? "" : "s"}`}
      </Text>
      {overall?.gwa != null ? (
        <View className="items-end">
          <Text className="text-muted-foreground text-xs font-semibold uppercase tracking-[1.2px]">Overall</Text>
          <Text className="font-display text-[22px] font-semibold leading-7 tabular-nums">{formatGrade(overall.gwa)}</Text>
          <Text className="text-muted-foreground text-xs tabular-nums">
            {archivedTerms.length + 1} semesters · {overall.units} units
          </Text>
        </View>
      ) : null}
    </View>
  );
}
