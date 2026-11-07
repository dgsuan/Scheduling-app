import { router } from "expo-router";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useHabits } from "@/context/store";
import { habitDate, habitOccurrences, habitProgress } from "@/lib/habits";
import { useNow } from "@/lib/useNow";
import { HabitCheckIn } from "./HabitCheckIn";

export function TodayHabits() {
  const { data, ready, habitError, retryHabits } = useHabits();
  const now = useNow();
  const due = data.habits.filter(h => h.schedules.at(-1)?.state === "active").flatMap(h => { const date = habitDate(h.schedules.at(-1)!.timezone, now.getTime()); return habitOccurrences(h, date, date).map(o => ({ h, o })); });
  const completed = due.filter(({ h, o }) => habitProgress(h, o, data.logs, now.getTime()).ratio === 1).length;
  return <View className="bg-card border-border my-5 gap-3 rounded-xl border p-4">
    <View className="flex-row items-center justify-between gap-2"><Text className="text-lg font-semibold">Habits</Text><Button variant="ghost" size="sm" onPress={() => router.push("/habits")}><Text>Manage habits</Text></Button></View>
    {!ready ? <Text>Loading habits…</Text> : <>
      <Text className="text-muted-foreground text-sm">{due.length ? `${completed} of ${due.length} daily slots / weekly goals complete` : "Make room for one small habit. Start with reading, movement, or a moment to reset."}</Text>
      {due.slice(0, 3).map(({ h, o }) => <View key={o.key} className="border-border gap-2 border-t pt-3"><Text className="font-medium">{h.title}</Text><HabitCheckIn habit={h} occurrence={o} /></View>)}
      {due.length > 3 && <Text className="text-muted-foreground text-sm">{due.length - 3} more in Habits</Text>}
    </>}
    {habitError && <><Text className="text-destructive">{habitError}</Text><Button onPress={retryHabits}><Text>Retry saving</Text></Button></>}
  </View>;
}
