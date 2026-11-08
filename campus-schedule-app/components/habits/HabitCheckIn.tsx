import { elapsedMs, formatClock, useFocus } from "@/context/focus";
import { useEffect, useState } from "react";
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
  const [custom, setCustom] = useState(false);
  const p = habitProgress(habit, occurrence, data.logs);
  const today = habitDate(occurrence.schedule.timezone);
  const date = effectiveDate ?? (today < occurrence.endDate ? today : occurrence.date);
  const session = focus.session?.habit?.key === occurrence.key && focus.session.habit.date === date ? focus.session : null;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!session?.startedAt) return;
    const timer = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(timer);
  }, [session?.startedAt]);
  const activeSeconds = session && session.phase !== "break" && !data.logs.some(l => l.sourceId === session.id) ? elapsedMs(session) / 1000 : 0;
  const studyLabel = /study|studying/i.test(habit.title) ? "Start studying" : "Start focus";
  const logs = activeHabitLogs(data.logs).filter(l => l.occurrenceKey === occurrence.key && !l.reflection && !l.mood && (occurrence.schedule.frequency !== "weekly" || l.date === date));
  const doneToday = logs.some(l => l.amount > 0 || l.confirmed);
  const add = (value: number, confirmed = false) => {
    if (!Number.isFinite(value) || value < 0 || (!confirmed && value === 0)) { setError("Enter an amount greater than zero."); return; }
    if (Date.now() < occurrence.startAt || date > today) return;
    changeHabits(d => ({ ...d, logs: [...d.logs, { id: habitId(), habitId: habit.id, occurrenceKey: occurrence.key, date, at: Date.now(), amount: value, confirmed }] }));
    setAmount(""); setError("");
  };
  const undo = () => changeHabits(d => ({ ...d, logs: [...d.logs, ...logs.map(l => ({ id: habitId(), habitId: habit.id, occurrenceKey: occurrence.key, date, at: Date.now(), amount: 0, confirmed: false, retracts: l.id }))] }));
  const undoLast = () => {
    const last = logs.at(-1);
    if (!last) return;
    void changeHabits(d => ({ ...d, logs: [...d.logs, { id: habitId(), habitId: habit.id, occurrenceKey: occurrence.key, date, at: Date.now(), amount: 0, confirmed: false, retracts: last.id }] }));
  };
  const disabled = Date.now() < occurrence.startAt || date > today || !!habitError;
  return <View className="gap-2">
    <Text className="text-muted-foreground text-sm">{occurrence.schedule.frequency === "weekly" ? `${p.sessions} / ${occurrence.schedule.quota} days this week` : habit.type === "binary" ? (p.ratio === 1 ? "Done for today" : "Ready when you are") : `${habit.type === "duration" ? Math.floor((p.amount + activeSeconds) / 60) : p.amount} / ${habit.type === "duration" ? occurrence.schedule.target / 60 : occurrence.schedule.target} ${occurrence.schedule.unit}${p.ratio === 1 ? " · Goal reached" : ""}`}</Text>
    {session && <Text className="text-sm">{session.phase === "break" ? `Break · ${formatClock(session.limitMs ? Math.max(0, session.limitMs - elapsedMs(session)) : elapsedMs(session))}${session.limitMs ? " left" : ""}` : `${formatClock(elapsedMs(session))} this focus block${session.startedAt ? " · Studying" : " · Paused"}`}</Text>}
    <View className="flex-row flex-wrap items-center gap-2">
      {habit.type === "duration" && date === today && Date.now() < occurrence.endAt && <><Button size="sm" disabled={disabled} onPress={() => {
        if (!session) focus.startHabit(habit.id, occurrence.key, date);
        else if (session.phase === "break") focus.continueFocus();
        else if (session.startedAt || elapsedMs(session) >= (session.limitMs ?? Infinity)) focus.takeBreak();
        else focus.continueFocus();
      }}><Text>{!session ? studyLabel : session.phase === "break" ? "Continue" : session.startedAt || elapsedMs(session) >= (session.limitMs ?? Infinity) ? "Take a break" : "Continue"}</Text></Button>{session && <Button variant="ghost" size="sm" onPress={focus.stop}><Text>Finish & save</Text></Button>}</>}
      {habit.type === "binary" ? <Button size="sm" disabled={disabled} onPress={doneToday ? undo : () => add(1)}><Text>{doneToday ? "Undo check-in" : "Check in"}</Text></Button> : <>
        {habit.type === "quantity" && <Button size="sm" disabled={disabled} onPress={() => add(Math.min(1, occurrence.schedule.target))}><Text>+{Math.min(1, occurrence.schedule.target)} {occurrence.schedule.unit}</Text></Button>}
        {habit.type === "avoid" && <Button size="sm" disabled={disabled || logs.some(l => l.confirmed)} onPress={() => add(0, true)}><Text>{logs.some(l => l.confirmed) ? "Observation saved" : "Confirm observation"}</Text></Button>}
        <Button variant="ghost" size="sm" accessibilityState={{ expanded: custom }} onPress={() => setCustom(!custom)}><Text>{custom ? "Close" : habit.type === "duration" ? "Log minutes" : "Enter amount"}</Text></Button>
        {!!logs.length && <Button variant="ghost" size="sm" disabled={disabled} onPress={undoLast}><Text>Undo last</Text></Button>}
        {custom && <View className="w-full flex-row flex-wrap items-center gap-2"><Input className="w-28" accessibilityLabel={`Amount for ${habit.title}`} placeholder={habit.type === "duration" ? "Minutes" : "Amount"} keyboardType="decimal-pad" value={amount} onChangeText={setAmount} /><Button size="sm" disabled={disabled || !amount.trim()} onPress={() => add(Number(amount) * (habit.type === "duration" ? 60 : 1))}><Text>Add</Text></Button></View>}
      </>}
    </View>
    {error ? <Text className="text-destructive text-sm">{error}</Text> : null}
    {disabled && !habitError ? <Text className="text-muted-foreground text-xs">Check-in opens at {occurrence.slot} in {occurrence.schedule.timezone}.</Text> : null}
  </View>;
}
