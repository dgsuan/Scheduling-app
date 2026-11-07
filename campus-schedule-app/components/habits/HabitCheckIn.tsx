import { useFocus } from "@/context/focus";
import { useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useHabits } from "@/context/store";
import { activeHabitLogs, habitDate, habitId, habitProgress, type Habit, type HabitOccurrence } from "@/lib/habits";

export function HabitCheckIn({ habit, occurrence, effectiveDate }: { habit: Habit; occurrence: HabitOccurrence; effectiveDate?: string }) {
  const { data, changeHabits, habitError } = useHabits();
  const focus = useFocus();
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const p = habitProgress(habit, occurrence, data.logs);
  const today = habitDate(occurrence.schedule.timezone);
  const date = effectiveDate ?? (today < occurrence.endDate ? today : occurrence.date);
  const logs = activeHabitLogs(data.logs).filter(l => l.occurrenceKey === occurrence.key && (occurrence.schedule.frequency !== "weekly" || l.date === date));
  const doneToday = logs.some(l => l.amount > 0 || l.confirmed);
  const add = (value: number, confirmed = false) => {
    if (!Number.isFinite(value) || value < 0 || (!confirmed && value === 0)) { setError("Enter an amount greater than zero."); return; }
    if (Date.now() < occurrence.startAt || date > today) return;
    changeHabits(d => ({ ...d, logs: [...d.logs, { id: habitId(), habitId: habit.id, occurrenceKey: occurrence.key, date, at: Date.now(), amount: value, confirmed }] }));
    setAmount(""); setError("");
  };
  const undo = () => changeHabits(d => ({ ...d, logs: [...d.logs, ...logs.map(l => ({ id: habitId(), habitId: habit.id, occurrenceKey: occurrence.key, date, at: Date.now(), amount: 0, confirmed: false, retracts: l.id }))] }));
  const disabled = Date.now() < occurrence.startAt || date > today || !!habitError;
  return <View className="gap-2">
    <Text className="text-muted-foreground text-sm">{occurrence.schedule.frequency === "weekly" ? `${p.sessions} / ${occurrence.schedule.quota} sessions this week` : habit.type === "binary" ? (p.ratio === 1 ? "Completed" : "Not checked in") : `${habit.type === "duration" ? Math.round(p.amount / 60) : p.amount} / ${habit.type === "duration" ? occurrence.schedule.target / 60 : occurrence.schedule.target} ${occurrence.schedule.unit}`} · {p.status}</Text>
    <View className="flex-row flex-wrap items-center gap-2">
      {habit.type === "duration" && Date.now() < occurrence.endAt && <Button size="sm" variant="outline" disabled={disabled} onPress={() => focus.startHabit(habit.id, occurrence.key, date)}><Text>Focus</Text></Button>}
      {habit.type === "binary" ? <Button size="sm" disabled={disabled} onPress={doneToday ? undo : () => add(1)}><Text>{doneToday ? "Undo check-in" : "Check in"}</Text></Button> : <>
        <Input className="w-28" accessibilityLabel={`Amount for ${habit.title}`} placeholder={habit.type === "duration" ? "Minutes" : "Amount"} keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
        <Button size="sm" disabled={disabled} onPress={() => add(Number(amount) * (habit.type === "duration" ? 60 : 1))}><Text>Add</Text></Button>
        {habit.type === "avoid" && <Button variant="outline" size="sm" disabled={disabled} onPress={() => add(0, true)}><Text>Confirm observation</Text></Button>}
        {!!logs.length && <Button variant="ghost" size="sm" onPress={undo}><Text>Undo entries</Text></Button>}
      </>}
    </View>
    {error ? <Text className="text-destructive text-sm">{error}</Text> : null}
    {disabled && !habitError ? <Text className="text-muted-foreground text-xs">Check-in opens at {occurrence.slot} in {occurrence.schedule.timezone}.</Text> : null}
  </View>;
}
