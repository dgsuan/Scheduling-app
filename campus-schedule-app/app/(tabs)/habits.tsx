import { HabitCloudControls } from "@/components/habits/HabitCloud";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ScreenHeader } from "@/components/ScreenHeader";
import { HabitCheckIn } from "@/components/habits/HabitCheckIn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useHabits } from "@/context/store";
import { addDaysIso } from "@/lib/dates";
import { currentZone, habitDate, habitId, habitOccurrences, habitProgress, habitStats, validateHabitData, type Habit, type HabitSchedule, type HabitType } from "@/lib/habits";
import { useNow } from "@/lib/useNow";

function Choices<T extends string>({ values, value, onChange }: { values: T[]; value: T; onChange: (v: T) => void }) {
  return <View className="flex-row flex-wrap gap-2">{values.map(v => <Button key={v} variant={v === value ? "default" : "outline"} size="sm" onPress={() => onChange(v)}><Text>{v[0].toUpperCase() + v.slice(1)}</Text></Button>)}</View>;
}
function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (s: string) => void; placeholder?: string }) {
  return <View className="gap-1"><Text className="text-sm font-medium">{label}</Text><Input accessibilityLabel={label} value={value} onChangeText={onChange} placeholder={placeholder} /></View>;
}
function HabitEditor({ habit, onClose }: { habit?: Habit; onClose: () => void }) {
  const { changeHabits } = useHabits();
  const old = habit?.schedules.at(-1);
  const [title, setTitle] = useState(habit?.title ?? "");
  const [type, setType] = useState<HabitType>(habit?.type ?? "binary");
  const [category, setCategory] = useState(habit?.category ?? "Personal");
  const [notes, setNotes] = useState(habit?.notes ?? "");
  const [frequency, setFrequency] = useState<HabitSchedule["frequency"]>(old?.frequency ?? "daily");
  const [target, setTarget] = useState(String(old ? (type === "duration" ? old.target / 60 : old.target) : 1));
  const [unit, setUnit] = useState(old?.unit ?? "times");
  const [weekdays, setWeekdays] = useState(old?.weekdays ?? [1, 2, 3, 4, 5]);
  const [interval, setInterval] = useState(String(old?.interval ?? 2));
  const [quota, setQuota] = useState(String(old?.quota ?? 3));
  const [zone, setZone] = useState(old?.timezone ?? currentZone());
  const [from, setFrom] = useState(habit ? addDaysIso(habitDate(old!.timezone), old!.frequency === "weekly" ? 7 - ((new Date(`${habitDate(old!.timezone)}T12:00:00Z`).getUTCDay() - old!.weekStart + 7) % 7) : 1) : habitDate(currentZone()));
  const [until, setUntil] = useState(old?.until ?? "");
  const [slots, setSlots] = useState(old?.slots.join(", ") ?? "00:00");
  const [reminder, setReminder] = useState(habit?.reminder ?? false);
  const [error, setError] = useState("");
  const schedule: HabitSchedule = { id: habitId(), from, until: until || undefined, timezone: zone, frequency, weekdays, interval: Number(interval), quota: Number(quota), weekStart: old?.weekStart ?? 1, slots: slots.split(",").map(s => s.trim()).sort(), target: type === "binary" ? 1 : Number(target) * (type === "duration" ? 60 : 1), unit: type === "duration" ? "minutes" : unit, state: "active" };
  const next: Habit = { id: habit?.id ?? habitId(), title: title.trim(), type, category, notes, createdAt: habit?.createdAt ?? Date.now(), schedules: [...(habit?.schedules ?? []), schedule], reminder };
  const valid = validateHabitData({ version: 1, habits: [next], logs: [] });
  const save = () => {
    if (!valid) { setError("Check the name, dates, timezone, target, weekdays, and times (HH:MM, separated by commas)."); return; }
    if (habit && from <= habitDate(zone)) { setError("Schedule edits must begin on a future date to preserve history."); return; }
    changeHabits(d => ({ ...d, habits: habit ? d.habits.map(h => h.id === habit.id ? next : h) : [...d.habits, next] })); onClose();
  };
  return <View className="bg-card border-border mb-6 gap-4 rounded-xl border p-5">
    <Text className="text-xl font-semibold">{habit ? "Edit habit" : "Create a habit"}</Text>
    {!habit && <View className="flex-row flex-wrap gap-2">{["Read a little", "Move my body", "Take a mindful break"].map(t => <Button key={t} size="sm" variant="outline" onPress={() => setTitle(t)}><Text>{t}</Text></Button>)}</View>}
    <Field label="Habit name" value={title} onChange={setTitle} />
    {!habit && <Choices values={["binary", "quantity", "duration", "avoid"] as HabitType[]} value={type} onChange={setType} />}
    <Text className="text-muted-foreground text-sm">{type === "avoid" ? "Log amounts and explicitly confirm your observation. No logs alone do not count as success." : type === "duration" ? "Track minutes manually or with the focus timer toward your target." : type === "quantity" ? "Add measured amounts toward your target." : "One tap to mark a scheduled habit done."}</Text>
    {type !== "binary" && <><Field label={type === "avoid" ? "Maximum amount" : type === "duration" ? "Target minutes" : "Target amount"} value={target} onChange={setTarget} />{type !== "duration" && <Field label="Unit" value={unit} onChange={setUnit} />}</>}
    <Text className="font-medium">Schedule</Text><Choices values={["daily", "weekdays", "interval", "weekly"] as HabitSchedule["frequency"][]} value={frequency} onChange={setFrequency} />
    {frequency === "weekdays" && <View className="flex-row flex-wrap gap-2">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, i) => <Button key={day} size="sm" variant={weekdays.includes(i) ? "default" : "outline"} onPress={() => setWeekdays(ds => ds.includes(i) ? ds.filter(n => n !== i) : [...ds, i])}><Text>{day}</Text></Button>)}</View>}
    {frequency === "interval" && <Field label="Repeat every N days" value={interval} onChange={setInterval} />}
    {frequency === "weekly" ? <><Field label="Sessions per week (1–7)" value={quota} onChange={setQuota} /><Text className="text-muted-foreground text-sm">Monday–Sunday. At most one qualifying session per day.</Text></> : <Field label="Daily slots (24-hour times)" value={slots} onChange={setSlots} placeholder="00:00 or 08:00, 18:00" />}
    <Field label={habit ? "Apply schedule from" : "Start date"} value={from} onChange={setFrom} placeholder="YYYY-MM-DD" />
    <Field label="End date (optional)" value={until} onChange={setUntil} placeholder="YYYY-MM-DD" />
    <Field label="Timezone" value={zone} onChange={setZone} />
    <Field label="Category" value={category} onChange={setCategory} /><Field label="Notes" value={notes} onChange={setNotes} />
    <Button variant="outline" onPress={() => setReminder(!reminder)}><Text>{reminder ? "Reminders on" : "Reminders off"}</Text></Button>
    <Text className="text-muted-foreground text-xs">Reminders use your notification settings and work while the app is open. Habits are saved on this device and included in JSON backups. Enable optional account sync from the habit library.</Text>
    {valid && <Text className="text-muted-foreground text-sm">Next: {habitOccurrences(next, from, addDaysIso(from, 14)).slice(0, 3).map(o => `${o.date} ${o.slot}`).join(" · ") || "No opportunities in the next two weeks"}</Text>}
    {error && <Text className="text-destructive">{error}</Text>}
    <View className="flex-row gap-2"><Button onPress={save}><Text>Save habit</Text></Button><Button variant="ghost" onPress={onClose}><Text>Cancel</Text></Button></View>
  </View>;
}
export default function HabitsScreen() {
  const { data, ready, changeHabits, habitError, retryHabits } = useHabits();
  const params = useLocalSearchParams<{ habitId?: string; date?: string }>();
  const now = useNow();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("active");
  const [editor, setEditor] = useState<Habit | "new" | null>(null);
  const [detail, setDetail] = useState<string | null>(params.habitId ?? null);
  const [remove, setRemove] = useState<Habit | null>(null);
  const [historyDate, setHistoryDate] = useState(params.date ?? habitDate(currentZone()));
  const state = (h: Habit) => h.schedules.at(-1)?.state ?? "active";
  const transition = (h: Habit, state: HabitSchedule["state"]) => {
    const last = h.schedules.at(-1)!;
    const date = addDaysIso(habitDate(last.timezone), 1);
    // Preserve today and all past versions. Changes start tomorrow without backfilling gaps.
    changeHabits(d => ({ ...d, habits: d.habits.map(x => x.id === h.id ? { ...x, schedules: [...x.schedules.filter(s => s.from < date), { ...last, id: habitId(), from: date, state }] } : x) }));
  };
  return <ScrollView className="bg-background flex-1" contentContainerStyle={{ padding: 24, paddingBottom: 100, maxWidth: 1000, width: "100%", alignSelf: "center" }} keyboardShouldPersistTaps="handled">
    <ScreenHeader title="Habits" eyebrow="Small steps, steady momentum" subtitle="Build a rhythm that fits around your day." right={<Button disabled={!ready || !!habitError} onPress={() => setEditor("new")}><Text>New habit</Text></Button>} />
    <HabitCloudControls />
    {habitError && <View className="mb-4 gap-2"><Text className="text-destructive">{habitError}</Text><Button onPress={retryHabits}><Text>Retry saving</Text></Button></View>}
    {!ready ? <Text>Loading habits…</Text> : <>
      {editor && <HabitEditor key={editor === "new" ? "new" : editor.id} habit={editor === "new" ? undefined : editor} onClose={() => setEditor(null)} />}
      <View className="mb-5 gap-3"><Input accessibilityLabel="Search habits" placeholder="Search habits or categories" value={search} onChangeText={setSearch} /><Choices values={["active", "paused", "archived", "all"]} value={filter} onChange={setFilter} /></View>
      {!data.habits.length && <View className="bg-card border-border gap-3 rounded-xl border p-6"><Text className="text-xl font-semibold">Start small. Make it yours.</Text><Text>Choose a habit you can repeat on an ordinary day. Rest and restarting are part of the process.</Text><Button className="self-start" onPress={() => setEditor("new")}><Text>Create your first habit</Text></Button></View>}
      {data.habits.filter(h => (filter === "all" || state(h) === filter) && `${h.title} ${h.category}`.toLowerCase().includes(search.toLowerCase())).map(h => {
        const today = habitDate(h.schedules.at(-1)!.timezone, now.getTime());
        const occurrences = state(h) === "active" ? habitOccurrences(h, today, today) : [];
        const stats = detail === h.id ? habitStats(h, data.logs, now.getTime()) : null;
        return <View key={h.id} className="bg-card border-border mb-4 gap-3 rounded-xl border p-5">
          <View className="flex-row flex-wrap items-center justify-between gap-2"><View><Text className="text-lg font-semibold">{h.title}</Text><Text className="text-muted-foreground text-sm">{h.category} · {h.type} · {state(h)}</Text></View><Button variant="ghost" size="sm" onPress={() => setDetail(detail === h.id ? null : h.id)}><Text>{detail === h.id ? "Hide history" : "History & insights"}</Text></Button></View>
          {occurrences.map(o => <View key={o.key} className="gap-2"><Text className="text-muted-foreground text-xs">{o.schedule.frequency === "weekly" ? "Weekly goal" : o.slot === "00:00" ? "Any time today" : o.slot}</Text><HabitCheckIn habit={h} occurrence={o} /></View>)}
          {!occurrences.length && <Text className="text-muted-foreground text-sm">No check-in scheduled today.</Text>}
          <View className="flex-row flex-wrap gap-2"><Button size="sm" variant="outline" onPress={() => setEditor(h)}><Text>Edit</Text></Button><Button size="sm" variant="outline" onPress={() => transition(h, state(h) === "active" ? "paused" : "active")}><Text>{state(h) === "active" ? "Pause tomorrow" : "Resume tomorrow"}</Text></Button>{state(h) !== "archived" && <Button size="sm" variant="ghost" onPress={() => transition(h, "archived")}><Text>Archive</Text></Button>}<Button size="sm" variant="ghost" onPress={() => setRemove(h)}><Text>Delete</Text></Button></View>
          {detail === h.id && stats && <View className="border-border gap-3 border-t pt-4">
            <Text className="font-semibold">Momentum: {stats.score === null ? "Not enough history" : `${Math.round(stats.score)} / 100`}</Text>
            <Text className="text-muted-foreground text-sm">{stats.count} closed opportunities{stats.count < 7 ? " · early estimate" : ""}. Weighted progress over the latest 7, 30 and 90 opportunities (40%, 40%, 20%). Open periods and pauses are excluded.</Text>
            <Text>Strict streak: {stats.current} · Best: {stats.best} {h.schedules.at(-1)!.frequency === "weekly" ? "weeks" : "opportunities"}</Text>
            {!!h.notes && <Text>{h.notes}</Text>}
            <Text className="font-medium">Last 14 days</Text><View className="flex-row flex-wrap gap-2">{Array.from({ length: 14 }, (_, i) => addDaysIso(today, i - 13)).map(date => {
              const os = habitOccurrences(h, date, date); const label = !os.length ? "Rest / unscheduled" : os.map(o => habitProgress(h, o, data.logs, now.getTime()).status).join(", ");
              return <Button key={date} variant="outline" className="h-auto min-h-12 p-2" accessibilityLabel={`${date}: ${label}`} onPress={() => setHistoryDate(date)}><Text className="text-xs">{date.slice(5)}{String.fromCharCode(10)}{label}</Text></Button>;
            })}</View>
            <Field label="Review / correct date" value={historyDate} onChange={setHistoryDate} />
            {/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(historyDate) && Number.isFinite(Date.parse(historyDate)) && habitOccurrences(h, historyDate, historyDate).map(o => <HabitCheckIn key={o.key} habit={h} occurrence={o} effectiveDate={historyDate} />)}
            <Text className="text-muted-foreground text-xs">Undo retracts entries while keeping an audit trail. Schedule changes apply to future opportunities.</Text>
          </View>}
        </View>;
      })}
    </>}
    <ConfirmDialog open={!!remove} onOpenChange={open => !open && setRemove(null)} title="Delete habit and history?" description="This permanently deletes this habit and all its check-ins on this device. Export a backup first if you want to keep a copy." onConfirm={() => { changeHabits(d => ({ ...d, habits: d.habits.filter(h => h.id !== remove?.id), logs: d.logs.filter(l => l.habitId !== remove?.id) })); setRemove(null); }} />
  </ScrollView>;
}
