import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";

import { DatePickerField } from "@/components/DatePickerField";
import { SettingsRow, SettingsSection, SettingsToggleRow } from "@/components/settings/SettingsSection";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useCancellations, useCourses, useScheduleRules, useSettings } from "@/context/store";
import { addDaysIso, daysBetween } from "@/lib/dates";
import { formatShortDate } from "@/lib/calendar";
import { display12h, occurrencesOnDate, relativeDayLabel, termStateOn } from "@/lib/schedule";
import { todayIso } from "@/lib/tasks";

// Semester dates, holiday skipping and one-off cancellations — the inputs
// to every "does this class happen?" decision in the app.

const SKIP_PREVIEW_DAYS = 180;

export function SemesterSection() {
  const { settings, updateSettings } = useSettings();
  const { courses } = useCourses();
  const { cancellations, restoreClass } = useCancellations();
  const rules = useScheduleRules();
  const today = todayIso();

  // Draft dates: only saved once both are set and in order.
  const [start, setStart] = useState(settings.term?.start);
  const [end, setEnd] = useState(settings.term?.end);
  useEffect(() => {
    setStart(settings.term?.start);
    setEnd(settings.term?.end);
  }, [settings.term?.start, settings.term?.end]);
  const invalid = !!start && !!end && end < start;

  const save = (s?: string, e?: string) => {
    setStart(s);
    setEnd(e);
    if (s && e && e >= s) updateSettings({ term: { start: s, end: e } });
  };

  const termLine = (() => {
    if (!settings.term) return "No term set — classes repeat every week with no end.";
    const { start: ts, end: te } = settings.term;
    const weeks = Math.round((daysBetween(ts, te) + 1) / 7);
    const state = termStateOn(today, rules);
    const range = `${formatShortDate(ts)} – ${formatShortDate(te)} · ${weeks} week${weeks === 1 ? "" : "s"}`;
    if (state === "before") return `${range} · starts in ${daysBetween(today, ts)} days`;
    if (state === "after") return `${range} · ended ${formatShortDate(te)}`;
    return `${range} · ${daysBetween(today, te)} days left`;
  })();

  const upcomingSkips = useMemo(() => {
    const out: { iso: string; name: string; count: number }[] = [];
    for (let i = 0; i < SKIP_PREVIEW_DAYS && out.length < 3; i++) {
      const iso = addDaysIso(today, i);
      if (rules.term && iso > rules.term.end) break;
      const skipped = occurrencesOnDate(courses, iso, rules).filter((o) => o.status === "holiday");
      if (skipped.length) out.push({ iso, name: skipped[0].holiday!.name, count: skipped.length });
    }
    return out;
  }, [courses, rules, today]);

  const courseById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);
  const sorted = useMemo(
    () => [...cancellations].sort((x, y) => `${x.date}${x.start}`.localeCompare(`${y.date}${y.start}`)),
    [cancellations]
  );
  const upcoming = sorted.filter((c) => c.date >= today);
  const pastCount = sorted.length - upcoming.length;

  return (
    <SettingsSection
      title="Semester"
      description="Classes only happen between these dates, and not on holidays or days you've cancelled."
    >
      <SettingsRow label="Term dates" hint={termLine} stacked>
        <View className="flex-row flex-wrap items-end gap-3">
          <View className="gap-1">
            <Text className="text-muted-foreground text-xs font-medium">First day</Text>
            <DatePickerField value={start} onChange={(iso) => save(iso, end)} placeholder="Start" accessibilityLabel="Term start date" />
          </View>
          <View className="gap-1">
            <Text className="text-muted-foreground text-xs font-medium">Last day</Text>
            <DatePickerField value={end} onChange={(iso) => save(start, iso)} placeholder="End" accessibilityLabel="Term end date" />
          </View>
          {settings.term || start || end ? (
            <Button
              variant="ghost"
              size="sm"
              onPress={() => {
                setStart(undefined);
                setEnd(undefined);
                updateSettings({ term: undefined });
              }}
            >
              <Text className="text-muted-foreground">Clear</Text>
            </Button>
          ) : null}
        </View>
        {invalid ? (
          <Text className="text-destructive text-sm" role="alert">
            The last day must be on or after the first day.
          </Text>
        ) : start && !end ? (
          <Text className="text-muted-foreground text-sm">Pick the last day to save.</Text>
        ) : null}
      </SettingsRow>

      <SettingsToggleRow
        label="Skip classes on regular holidays"
        hint="e.g. National Heroes Day, Bonifacio Day"
        checked={settings.skipRegularHolidays}
        onChange={(skipRegularHolidays) => updateSettings({ skipRegularHolidays })}
      />
      <SettingsToggleRow
        label="Skip classes on special non-working days"
        hint="e.g. All Saints' Day, Christmas Eve"
        checked={settings.skipSpecialHolidays}
        onChange={(skipSpecialHolidays) => updateSettings({ skipSpecialHolidays })}
        last={!upcomingSkips.length}
      />
      {upcomingSkips.length ? (
        <View className="border-border/70 gap-1 border-b px-4 py-3">
          <Text className="text-muted-foreground text-xs font-semibold uppercase tracking-[1px]">Next skipped days</Text>
          {upcomingSkips.map((s) => (
            <Text key={s.iso} className="text-sm">
              {formatShortDate(s.iso)} · {s.name}
              <Text className="text-muted-foreground text-sm">
                {"  "}({s.count} class{s.count === 1 ? "" : "es"})
              </Text>
            </Text>
          ))}
        </View>
      ) : null}

      <SettingsRow
        label="Cancelled classes"
        hint={
          upcoming.length
            ? "Restoring a class brings back just that one day."
            : "To cancel a single class, open the Calendar, click the day, then Cancel next to the class."
        }
        stacked
        last
      >
        {upcoming.length ? (
          <View>
            {upcoming.map((c) => {
              const course = courseById.get(c.courseId);
              const ahead = daysBetween(today, c.date);
              return (
                <View key={c.id} className="flex-row items-center gap-3 py-1.5">
                  <View className="size-2 rounded-full" style={{ backgroundColor: course?.color ?? "#999" }} />
                  <Text className="flex-1 text-sm">
                    {course?.code ?? "Removed course"}
                    <Text className="text-muted-foreground text-sm">
                      {" · "}
                      {relativeDayLabel(ahead, new Date(`${c.date}T00:00:00`).getDay() as 0, c.date)}
                      {ahead > 1 ? `, ${formatShortDate(c.date)}` : ""} · {display12h(c.start)}
                    </Text>
                  </Text>
                  <Button variant="ghost" size="sm" onPress={() => restoreClass(c.id)} accessibilityLabel={`Restore ${course?.code ?? "class"} on ${c.date}`}>
                    <Text className="text-primary">Restore</Text>
                  </Button>
                </View>
              );
            })}
          </View>
        ) : null}
        {pastCount ? (
          <Text className="text-muted-foreground text-xs">
            {pastCount} past cancellation{pastCount === 1 ? "" : "s"} kept for your records.
          </Text>
        ) : null}
      </SettingsRow>
    </SettingsSection>
  );
}
