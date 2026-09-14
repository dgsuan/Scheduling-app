import { router, useLocalSearchParams } from "expo-router";
import { CalendarDays } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { formatShortDate } from "@/lib/calendar";
import { fetchPublicSection, friendlyCloudError, type PublicSection } from "@/lib/cloud";
import { dayLabel } from "@/lib/insights";
import { display12h } from "@/lib/schedule";
import { isSupabaseConfigured } from "@/lib/supabase";
import { todayIso } from "@/lib/tasks";
import { useBreakpoint } from "@/lib/useBreakpoint";
import { cn } from "@/lib/utils";

// Public, read-only deadlines for a class section (?code=…), for pinning in
// a group chat. Works signed out. Shows only titles and due dates.

type State =
  | { status: "loading" }
  | { status: "ready"; data: PublicSection }
  | { status: "missing" }
  | { status: "error"; message: string };

export default function PublicDeadlinesScreen() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const { desktop } = useBreakpoint();
  const [state, setState] = useState<State>({ status: "loading" });
  const today = todayIso();

  useEffect(() => {
    let cancelled = false;
    if (!isSupabaseConfigured) {
      setState({ status: "error", message: "This copy of the app isn't connected to class sections." });
      return;
    }
    setState({ status: "loading" });
    fetchPublicSection(String(code ?? ""))
      .then((data) => !cancelled && setState(data ? { status: "ready", data } : { status: "missing" }))
      .catch((e) => !cancelled && setState({ status: "error", message: friendlyCloudError(e) }));
    return () => {
      cancelled = true;
    };
  }, [code]);

  const days = useMemo(() => {
    if (state.status !== "ready") return [];
    const map = new Map<string, PublicSection["posts"]>();
    for (const p of state.data.posts) map.set(p.due, [...(map.get(p.due) ?? []), p]);
    return [...map.entries()];
  }, [state]);

  return (
    <ScrollView
      className="bg-background flex-1"
      contentContainerClassName={cn("w-full max-w-[640px] gap-6 self-center pb-24", desktop ? "px-10 pt-12" : "px-5 pt-8")}
    >
      <View className="gap-1">
        <View className="flex-row items-center gap-2">
          <Icon as={CalendarDays} size={15} className="text-primary" />
          <Text className="text-muted-foreground text-[13px] font-medium">Class deadlines</Text>
        </View>
        <Text role="heading" aria-level={1} className="font-display text-[30px] font-semibold leading-9">
          {state.status === "ready" ? state.data.name : "Deadlines"}
        </Text>
        {state.status === "ready" && state.data.courseCode ? (
          <Text className="text-muted-foreground text-sm">{state.data.courseCode}</Text>
        ) : null}
      </View>

      {state.status === "loading" ? (
        <Text className="text-muted-foreground text-sm">Loading…</Text>
      ) : state.status === "missing" ? (
        <Text className="text-sm leading-5">This link doesn&apos;t work anymore. Ask your section&apos;s owner for the current one.</Text>
      ) : state.status === "error" ? (
        <Text className="text-destructive text-sm leading-5" role="alert">
          {state.message}
        </Text>
      ) : days.length === 0 ? (
        <Text className="text-muted-foreground text-sm">No upcoming deadlines.</Text>
      ) : (
        <View className="gap-5">
          {days.map(([due, posts]) => {
            const label = dayLabel(due, today);
            return (
              <View key={due} className="gap-1.5">
                <Text className={cn("text-[13px] font-semibold", due < today ? "text-muted-foreground" : "text-foreground")}>
                  {label === "Today" || label === "Tomorrow" ? `${label} · ${formatShortDate(due)}` : formatShortDate(due)}
                </Text>
                <View className="border-border bg-card/70 rounded-xl border">
                  {posts.map((p, i) => (
                    <View key={`${p.title}-${i}`} className={cn("flex-row items-baseline gap-3 px-4 py-3", i > 0 && "border-border/60 border-t")}>
                      <Text className="flex-1 text-[15px] leading-5">{p.title}</Text>
                      <Text className="text-muted-foreground text-[13px] tabular-nums">{p.dueTime ? display12h(p.dueTime) : "End of day"}</Text>
                    </View>
                  ))}
                </View>
              </View>
            );
          })}
        </View>
      )}

      <View className="border-border/70 gap-3 border-t pt-5">
        <Text className="text-muted-foreground text-xs leading-4">
          A read-only list shared by the section&apos;s owner. It shows titles and due dates only.
        </Text>
        <Button variant="outline" size="sm" className="self-start" onPress={() => router.replace("/")}>
          <Text>Open the app</Text>
        </Button>
      </View>
    </ScrollView>
  );
}
