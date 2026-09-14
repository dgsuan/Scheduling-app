import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { ArrowLeft, ClipboardPaste } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { meetingLine } from "@/components/courses/CourseSharing";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useToast } from "@/components/Toaster";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { Textarea } from "@/components/ui/textarea";
import { colors } from "@/constants/theme";
import { useCourses, type Weekday } from "@/context/store";
import { parseCrs, planCrsImport } from "@/lib/crs";
import { findConflicts, groupOfferings, totalUnits, type Offering } from "@/lib/planner";
import { display12h, parseTime, WEEKDAY_SHORT } from "@/lib/schedule";
import { useBreakpoint } from "@/lib/useBreakpoint";
import { cn } from "@/lib/utils";

// Enlistment planner: paste the class offerings from CRS, pick one section
// per course, see the week and any clashes, then add the picks to Courses.
// The paste and picks are kept on this device until you clear them.

const DRAFT_KEY = "campus-schedule-cache:enlistment-draft";
const MAX_PASTE = 40_000;
const DAY_START = 7 * 60;
const DAY_END = 21 * 60;
const HOUR_PX = 44;

type Draft = { text: string; picks: Record<string, string> };

const codeKey = (code: string) => code.replace(/\s+/g, " ").trim().toUpperCase();

function WeekGrid({ picked, colorOf, clashing }: { picked: Offering[]; colorOf: Map<string, string>; clashing: Set<string> }) {
  const usesSunday = picked.some((o) => o.meetings.some((m) => m.days.includes(0)));
  const days: Weekday[] = usesSunday ? [1, 2, 3, 4, 5, 6, 0] : [1, 2, 3, 4, 5, 6];
  const hours = Array.from({ length: (DAY_END - DAY_START) / 60 + 1 }, (_, i) => DAY_START / 60 + i);
  const height = ((DAY_END - DAY_START) / 60) * HOUR_PX;
  const y = (min: number) => ((min - DAY_START) / 60) * HOUR_PX;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="min-w-full">
      <View className="border-border bg-card/70 min-w-[640px] flex-1 flex-row rounded-xl border p-3">
        <View style={{ width: 56, height, marginTop: 24, position: "relative" }}>
          {hours.map((h) => (
            <Text
              key={h}
              className="text-muted-foreground text-[11px] tabular-nums"
              style={{ position: "absolute", right: 8, top: y(h * 60) - 7 }}
            >
              {display12h(`${String(h).padStart(2, "0")}:00`)}
            </Text>
          ))}
        </View>
        {days.map((d) => (
          <View key={d} className="flex-1">
            <Text className="text-muted-foreground mb-2 h-4 text-center text-xs font-semibold">{WEEKDAY_SHORT[d]}</Text>
            <View className="border-border/60 border-l" style={{ height, position: "relative" }}>
              {hours.map((h) => (
                <View key={h} className="bg-border/50 absolute left-0 right-0 h-px" style={{ top: y(h * 60) }} />
              ))}
              {picked.flatMap((o) =>
                o.meetings
                  .filter((m) => m.days.includes(d))
                  .map((m, i) => {
                    const s = parseTime(m.start);
                    const e = parseTime(m.end);
                    if (s == null || e == null || e <= DAY_START || s >= DAY_END) return null;
                    const color = colorOf.get(codeKey(o.code)) ?? colors.courseColors[7];
                    const bad = clashing.has(o.key);
                    return (
                      <View
                        key={`${o.key}-${i}`}
                        accessibilityLabel={`${o.code} ${o.section ?? ""}, ${WEEKDAY_SHORT[d]} ${display12h(m.start)} to ${display12h(m.end)}${bad ? ", conflicts" : ""}`}
                        className={cn("absolute left-1 right-1 overflow-hidden rounded-md px-1.5 py-1", bad && "border-destructive border-2")}
                        style={{
                          top: y(Math.max(s, DAY_START)),
                          height: Math.max(18, y(Math.min(e, DAY_END)) - y(Math.max(s, DAY_START))),
                          backgroundColor: `${color}2E`,
                          borderLeftWidth: 3,
                          borderLeftColor: color,
                        }}
                      >
                        <Text className="text-[11px] font-semibold" numberOfLines={1}>
                          {o.code}
                        </Text>
                        {o.section ? (
                          <Text className="text-muted-foreground text-[10px]" numberOfLines={1}>
                            {o.section}
                          </Text>
                        ) : null}
                      </View>
                    );
                  })
              )}
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

export default function PlannerScreen() {
  const { desktop } = useBreakpoint();
  const { courses, addCourse, updateCourse } = useCourses();
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [parsedText, setParsedText] = useState("");
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(DRAFT_KEY)
      .then((raw) => {
        if (!raw) return;
        const draft = JSON.parse(raw) as Draft;
        setText(draft.text ?? "");
        setParsedText(draft.text ?? "");
        setPicks(draft.picks ?? {});
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);
  useEffect(() => {
    if (loaded) AsyncStorage.setItem(DRAFT_KEY, JSON.stringify({ text: parsedText, picks } satisfies Draft)).catch(() => {});
  }, [loaded, parsedText, picks]);

  const parsed = useMemo(() => parseCrs(parsedText), [parsedText]);
  const groups = useMemo(() => groupOfferings(parsed.courses), [parsed]);
  const picked = useMemo(
    () => groups.flatMap((g) => g.sections.filter((s) => s.key === picks[codeKey(g.code)])),
    [groups, picks]
  );
  const conflicts = useMemo(() => findConflicts(picked), [picked]);
  const clashing = useMemo(() => new Set(conflicts.flatMap((c) => [c.a, c.b])), [conflicts]);
  const colorOf = useMemo(
    () => new Map(groups.map((g, i) => [codeKey(g.code), colors.courseColors[i % colors.courseColors.length]])),
    [groups]
  );
  const labelOf = (key: string) => {
    const o = picked.find((p) => p.key === key);
    return o ? `${o.code}${o.section ? ` ${o.section}` : ""}` : key;
  };

  const read = () => {
    setParsedText(text.slice(0, MAX_PASTE));
    setPicks({});
  };
  const clear = () => {
    setText("");
    setParsedText("");
    setPicks({});
  };
  const toggle = (code: string, key: string) =>
    setPicks((prev) => {
      const next = { ...prev };
      if (next[codeKey(code)] === key) delete next[codeKey(code)];
      else next[codeKey(code)] = key;
      return next;
    });

  const addToCourses = () => {
    let added = 0;
    let updated = 0;
    planCrsImport(picked, courses).forEach((row, i) => {
      if (row.status === "same") return;
      const p = row.parsed;
      if (row.match) {
        updateCourse(row.match.id, { meetings: p.meetings, section: p.section ?? row.match.section, units: p.units ?? row.match.units });
        updated++;
      } else {
        addCourse({
          code: p.code,
          section: p.section,
          title: p.title,
          units: p.units,
          meetings: p.meetings,
          color: colors.courseColors[(courses.length + i) % colors.courseColors.length],
        });
        added++;
      }
    });
    toast({
      message:
        added || updated
          ? [added && `Added ${added} course${added === 1 ? "" : "s"}`, updated && `updated ${updated}`].filter(Boolean).join(", ")
          : "Those classes are already in Courses",
      actionLabel: "View courses",
      onAction: () => router.navigate("/courses"),
    });
  };

  return (
    <ScrollView
      className="bg-background flex-1"
      contentContainerClassName={cn("w-full max-w-[1000px] gap-6 self-center pb-24", desktop ? "px-10 pt-8" : "px-5 pt-6")}
      keyboardShouldPersistTaps="handled"
    >
      <View>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 mb-2 self-start"
          onPress={() => (router.canGoBack() ? router.back() : router.navigate("/courses"))}
        >
          <Icon as={ArrowLeft} size={15} className="text-muted-foreground" />
          <Text className="text-muted-foreground">Courses</Text>
        </Button>
        <ScreenHeader
          title="Enlistment planner"
          subtitle="Paste the class offerings from CRS, pick a section for each course, and catch schedule conflicts before enlistment."
        />
      </View>

      <View className="bg-card/80 border-border gap-3 rounded-xl border p-4">
        <View className="flex-row items-center gap-2">
          <Icon as={ClipboardPaste} size={16} className="text-primary" />
          <Text className="text-[15px] font-semibold">Paste class offerings</Text>
        </View>
        <Text className="text-muted-foreground text-sm leading-5">
          In CRS, search the courses you plan to take and copy the results tables (several sections per course is fine). Everything stays on
          this device.
        </Text>
        <Textarea
          value={text}
          onChangeText={(t) => setText(t.slice(0, MAX_PASTE))}
          placeholder={"CMSC 21 T-1L  3.0  TTh 10-11:30AM AECH\nCMSC 21 T-2L  3.0  TTh 1-2:30PM AECH\nMATH 21 THY1  4.0  MWF 7-8AM MB 101"}
          numberOfLines={6}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Pasted class offerings"
          className="min-h-32 font-mono text-[13px]"
        />
        <View className="flex-row flex-wrap gap-2">
          <Button onPress={read} disabled={!text.trim()}>
            <Text>Read offerings</Text>
          </Button>
          {text || parsedText ? (
            <Button variant="ghost" onPress={clear}>
              <Text>Clear</Text>
            </Button>
          ) : null}
        </View>
      </View>

      {parsedText && !groups.length ? (
        <Text className="text-destructive text-sm" role="alert">
          No classes found. Copy the rows with the class, section and schedule (e.g. “CMSC 21 T-1L … TTh 10-11:30AM”).
        </Text>
      ) : null}

      {groups.length ? (
        <>
          <View className="flex-row flex-wrap items-center justify-between gap-3">
            <Text className="text-sm">
              <Text className="text-sm font-semibold">
                {picked.length} of {groups.length}
              </Text>{" "}
              courses picked · {totalUnits(picked)} units
              {conflicts.length ? (
                <Text className="text-destructive text-sm font-medium">{` · ${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"}`}</Text>
              ) : null}
            </Text>
            <Button onPress={addToCourses} disabled={!picked.length}>
              <Text>{picked.length ? `Add ${picked.length} to Courses` : "Pick sections first"}</Text>
            </Button>
          </View>

          <View className="gap-5">
            {groups.map((g) => (
              <View key={g.code} className="gap-2">
                <View className="flex-row items-center gap-2">
                  <View className="size-2.5 rounded-full" style={{ backgroundColor: colorOf.get(codeKey(g.code)) }} />
                  <Text className="text-[15px] font-semibold">{g.code}</Text>
                  <Text className="text-muted-foreground text-[13px]">
                    {g.sections.length} section{g.sections.length === 1 ? "" : "s"}
                  </Text>
                </View>
                <View className="flex-row flex-wrap gap-2">
                  {g.sections.map((s) => {
                    const on = picks[codeKey(g.code)] === s.key;
                    const bad = on && clashing.has(s.key);
                    return (
                      <Pressable
                        key={s.key}
                        onPress={() => toggle(g.code, s.key)}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={`${g.code} ${s.section ?? "no section"}${bad ? ", conflicts with another pick" : ""}`}
                        className={cn(
                          "border-border max-w-full gap-0.5 rounded-lg border px-3 py-2 web:transition-colors web:hover:bg-accent/50",
                          on && "border-primary bg-primary/10",
                          bad && "border-destructive bg-destructive/10"
                        )}
                      >
                        <Text className="text-sm font-medium">
                          {s.section ?? "No section"}
                          {s.units ? <Text className="text-muted-foreground text-xs font-normal">{`  ${s.units} units`}</Text> : null}
                        </Text>
                        {s.meetings.length ? (
                          s.meetings.map((m, i) => (
                            <Text key={i} className="text-muted-foreground text-xs tabular-nums">
                              {meetingLine(m)}
                            </Text>
                          ))
                        ) : (
                          <Text className="text-muted-foreground text-xs">Schedule TBA</Text>
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
          </View>

          {conflicts.length ? (
            <View className="border-destructive/40 bg-destructive/10 gap-1 rounded-lg border p-3" role="alert">
              {conflicts.map((c, i) => (
                <Text key={i} className="text-sm leading-5">
                  {labelOf(c.a)} and {labelOf(c.b)} overlap on {WEEKDAY_SHORT[c.day]}, {display12h(c.start)}–{display12h(c.end)}
                </Text>
              ))}
            </View>
          ) : picked.length > 1 ? (
            <Text className="text-success text-sm">No conflicts between your picks.</Text>
          ) : null}

          {picked.length ? <WeekGrid picked={picked} colorOf={colorOf} clashing={clashing} /> : null}
        </>
      ) : null}
    </ScrollView>
  );
}
