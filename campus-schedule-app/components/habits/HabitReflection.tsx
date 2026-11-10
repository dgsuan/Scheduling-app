import { HabitReveal } from "./HabitReveal";
import { useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useHabits } from "@/context/store";
import { activeHabitLogs, habitDate, habitId, habitOccurrences, type Habit, type HabitLog } from "@/lib/habits";

export function HabitReflection({ habit }: { habit: Habit }) {
  const { data, changeHabits, habitError } = useHabits();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [mood, setMood] = useState<HabitLog["mood"]>();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const today = habitDate(habit.schedules.at(-1)!.timezone);
  const occurrence = habitOccurrences(habit, today, today).find(o => o.startAt <= Date.now());
  const reflections = activeHabitLogs(data.logs).filter(l => l.habitId === habit.id && (l.reflection || l.mood)).slice(-5).reverse();
  const save = async () => {
    if (!occurrence || saving || (!note.trim() && !mood)) return;
    setSaving(true);
    const ok = await changeHabits(d => ({ ...d, logs: [...d.logs, { id: habitId(), habitId: habit.id, occurrenceKey: occurrence.key, date: today, at: Date.now(), amount: 0, confirmed: false, reflection: note.trim(), ...(mood ? { mood } : {}) }] }));
    setSaving(false);
    if (ok) { setNote(""); setMood(undefined); setMessage("Reflection saved. It doesn't change your progress."); }
    else setMessage("Waiting to save. Use Retry saving before continuing.");
  };
  return <View className="gap-3">
    <Button variant="ghost" className="self-start" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)}><Text>{open ? "Hide reflection" : "Reflect (optional)"}</Text></Button>
    {open && <HabitReveal className="gap-3">
      {occurrence ? <><Text className="text-muted-foreground text-sm">How did today feel? This stays with your personal habit history.</Text><View className="flex-row gap-2">{(["low", "okay", "good"] as const).map(value => <Button key={value} variant={mood === value ? "default" : "outline"} onPress={() => setMood(mood === value ? undefined : value)}><Text>{value === "low" ? "Tough" : value === "okay" ? "Okay" : "Good"}</Text></Button>)}</View><Input multiline maxLength={2000} accessibilityLabel="Optional reflection" placeholder="What helped? What could make tomorrow easier?" value={note} onChangeText={setNote} /><Button className="self-start" disabled={saving || !!habitError || (!note.trim() && !mood)} onPress={() => void save()}><Text>{saving ? "Saving…" : "Save reflection"}</Text></Button></> : <Text className="text-muted-foreground text-sm">Add a reflection when a scheduled habit opens.</Text>}
      {!!message && <Text accessibilityLiveRegion="polite">{message}</Text>}
      {reflections.map(log => <View key={log.id} className="border-border gap-1 border-t pt-2"><Text className="text-sm">{log.date}{log.mood ? ` · ${log.mood === "low" ? "Tough" : log.mood}` : ""}</Text>{!!log.reflection && <Text>{log.reflection}</Text>}<Button className="self-start" size="sm" variant="ghost" disabled={!!habitError} onPress={() => void changeHabits(d => ({ ...d, logs: [...d.logs, { id: habitId(), habitId: habit.id, occurrenceKey: log.occurrenceKey, date: log.date, at: Date.now(), amount: 0, confirmed: false, retracts: log.id }] }))}><Text>Remove reflection</Text></Button></View>)}
    </HabitReveal>}
  </View>;
}
