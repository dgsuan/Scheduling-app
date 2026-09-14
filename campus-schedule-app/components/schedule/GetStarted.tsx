import { router } from "expo-router";
import { Check } from "lucide-react-native";
import { View } from "react-native";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { useSections } from "@/context/sections";
import { useCourses, useSettings } from "@/context/store";
import { isSupabaseConfigured } from "@/lib/supabase";
import { cn } from "@/lib/utils";

// First-run checklist on Home: three features that together set up a
// semester in about a minute. Each step ticks itself off from real data, and
// the card disappears when everything is done (or is hidden).

const SEED_COURSE_ID = "seed-cmsc13";

export function GetStarted() {
  const { courses } = useCourses();
  const { settings, updateSettings } = useSettings();
  const sections = useSections();

  const steps = [
    {
      id: "classes",
      title: "Add your classes",
      hint: "Paste your schedule from CRS — courses, times and rooms fill in.",
      done: courses.some((c) => c.id !== SEED_COURSE_ID),
      action: "Paste from CRS",
      go: () => router.navigate("/import"),
    },
    {
      id: "term",
      title: "Set your semester dates",
      hint: "Classes stop at the end of the term and skip holidays.",
      done: !!settings.term,
      action: "Set dates",
      go: () => router.navigate("/settings"),
    },
    ...(isSupabaseConfigured
      ? [
          {
            id: "section",
            title: "Join your block's section",
            hint: "Deadlines your classmates post show up in your Tasks.",
            done: sections.sections.length > 0,
            action: sections.available ? "Join with a code" : "Sign in first",
            go: () => router.navigate(sections.available ? "/tasks?sections=1" : "/settings"),
          },
        ]
      : []),
  ];

  if (settings.onboardingDismissed || steps.every((s) => s.done)) return null;
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <View className="border-border bg-card/70 mb-8 gap-3 rounded-xl border p-4">
      <View className="flex-row items-baseline justify-between gap-2">
        <Text className="text-[15px] font-semibold">Get set up</Text>
        <Text className="text-muted-foreground text-[13px] tabular-nums">
          {doneCount} of {steps.length} done
        </Text>
      </View>
      {steps.map((s, i) => (
        <View key={s.id} className="flex-row flex-wrap items-center gap-3">
          <View
            className={cn("size-6 items-center justify-center rounded-full border", s.done ? "border-primary bg-primary" : "border-border")}
            accessibilityLabel={s.done ? "Done" : `Step ${i + 1}`}
          >
            {s.done ? (
              <Icon as={Check} size={13} className="text-primary-foreground" />
            ) : (
              <Text className="text-muted-foreground text-xs tabular-nums">{i + 1}</Text>
            )}
          </View>
          <View className="min-w-[180px] flex-1 gap-0.5">
            <Text className={cn("text-[15px] font-medium", s.done && "text-muted-foreground line-through")}>{s.title}</Text>
            {!s.done ? <Text className="text-muted-foreground text-[13px] leading-[18px]">{s.hint}</Text> : null}
          </View>
          {!s.done ? (
            <Button size="sm" variant="outline" onPress={s.go}>
              <Text>{s.action}</Text>
            </Button>
          ) : null}
        </View>
      ))}
      <Button variant="ghost" size="sm" className="-ml-2 self-start" onPress={() => updateSettings({ onboardingDismissed: true })}>
        <Text className="text-muted-foreground">Hide this</Text>
      </Button>
    </View>
  );
}
