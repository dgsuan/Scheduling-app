import { View } from "react-native";

import { Text } from "@/components/ui/text";
import type { Course, CourseGrades } from "@/context/store";
import { computeGwa, formatGrade } from "@/lib/grades";

// Overall GWA (general weighted average, UP scale) across courses with grades.

export function GwaSummary({ courses, grades }: { courses: Course[]; grades: Record<string, CourseGrades> }) {
  const r = computeGwa(courses, grades);
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
    </View>
  );
}
