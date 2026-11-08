import { HabitCloudControls } from "@/components/habits/HabitCloud";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, View, Pressable } from "react-native";
import { CalendarDays, Bell, Timer, SlidersHorizontal, ChevronDown, ChevronUp } from "lucide-react-native";
import { Icon } from "@/components/ui/icon";
import { DatePickerField } from "@/components/DatePickerField";
import { TimePickerField } from "@/components/TimePickerField";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ScreenHeader } from "@/components/ScreenHeader";
import { HabitCheckIn } from "@/components/habits/HabitCheckIn";
import { HabitInsights } from "@/components/habits/HabitInsights";
import { HabitReflection } from "@/components/habits/HabitReflection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useHabits, useSettings } from "@/context/store";
import { addDaysIso } from "@/lib/dates";
import { currentZone, habitDate, habitId, habitOccurrences, habitProgress, habitStats, validateHabitData, withHabitGoal, type Habit, type HabitSchedule, type HabitType } from "@/lib/habits";
import { useNow } from "@/lib/useNow";

function Choices<T extends string>({ values, value, onChange }: { values: T[]; value: T; onChange: (v: T) => void }) {
  const labels: Record<string, string> = { binary: "Check off", quantity: "Count", duration: "Time", avoid: "Reduce / avoid", weekdays: "Choose days", interval: "Every few days", weekly: "Weekly goal", created: "Added order", name: "A–Z", category: "By category" };
  return <View className="flex-row flex-wrap gap-2">{values.map(v => <Button key={v} variant={v === value ? "default" : "outline"} size="sm" accessibilityState={{ selected: v === value }} onPress={() => onChange(v)}><Text>{labels[v] ?? v[0].toUpperCase() + v.slice(1)}</Text></Button>)}</View>;
}
function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (s: string) => void; placeholder?: string }) {
  return <View className="gap-1"><Text className="text-sm font-medium">{label}</Text><Input accessibilityLabel={label} value={value} onChangeText={onChange} placeholder={placeholder} /></View>;
}
function HabitEditor({ habit, onClose }: { habit?: Habit; onClose: () => void }) {
  const { changeHabits } = useHabits();
  const { settings } = useSettings();
  const old = habit?.schedules.at(-1);
  const [recordId] = useState(() => habit?.id ?? habitId());
  const [revisionId] = useState(habitId);
  const [createdAt] = useState(() => habit?.createdAt ?? Date.now());
  const [title, setTitle] = useState(habit?.title ?? "");
  const [type, setType] = useState<HabitType>(habit?.type ?? "binary");
  const [category, setCategory] = useState(habit?.category ?? "Personal");
  const [notes, setNotes] = useState(habit?.notes ?? "");
  const [routine, setRoutine] = useState(habit?.routine ?? "");
  const [cue, setCue] = useState(habit?.cue ?? "");
  const [frequency, setFrequency] = useState<HabitSchedule["frequency"]>(old?.frequency ?? "daily");
  const savedGoal = habit?.goals?.at(-1) ?? old;
  const [target, setTarget] = useState(String(savedGoal ? (type === "duration" ? savedGoal.target / 60 : savedGoal.target) : 1));
  const [unit, setUnit] = useState(savedGoal?.unit ?? "times");
  const [weekdays, setWeekdays] = useState(old?.weekdays ?? [1, 2, 3, 4, 5]);
  const [interval, setInterval] = useState(String(old?.interval ?? 2));
  const [quota, setQuota] = useState(String(old?.quota ?? 3));
  const [zone, setZone] = useState(old?.timezone ?? currentZone());
  const [from, setFrom] = useState(habit ? addDaysIso(habitDate(old!.timezone), old!.frequency === "weekly" ? 7 - ((new Date(`${habitDate(old!.timezone)}T12:00:00Z`).getUTCDay() - old!.weekStart + 7) % 7) : 1) : habitDate(currentZone()));
  const [until, setUntil] = useState(old?.until ?? "");
  const [slots, setSlots] = useState(old?.slots.join(", ") ?? "00:00");
  const [reminder, setReminder] = useState(habit?.reminder ?? false);
  const [focusMinutes, setFocusMinutes] = useState(String(habit?.focusMinutes ?? 30));
  const [breakMinutes, setBreakMinutes] = useState(String(habit?.breakMinutes ?? 10));
  const [reminderEvery, setReminderEvery] = useState(habit?.reminderEveryMinutes ? String(habit.reminderEveryMinutes) : "");
  const [pomodoroEnabled, setPomodoroEnabled] = useState(habit?.pomodoroEnabled ?? true);
  const [reminderStart, setReminderStart] = useState(habit?.reminderStart ?? "09:00");
  const [reminderEnd, setReminderEnd] = useState(habit?.reminderEnd ?? "21:00");
  const [error, setError] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [option, setOption] = useState("tracking");
  const [datesOpen, setDatesOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const schedule: HabitSchedule = { id: revisionId, from, until: until || undefined, timezone: zone, frequency, weekdays, interval: Number(interval), quota: Number(quota), weekStart: old?.weekStart ?? 1, slots: slots.split(",").map(s => s.trim()).sort(), target: type === "binary" ? 1 : Number(target) * (type === "duration" ? 60 : 1), unit: type === "duration" ? "minutes" : unit, state: old?.state ?? "active" };
  const scheduleChanged = !old || (Object.keys(schedule) as (keyof HabitSchedule)[]).some(key => !["id", "from", "target", "unit"].includes(key) && JSON.stringify(schedule[key]) !== JSON.stringify(old[key]));
  const draft: Habit = { ...habit, id: recordId, title: title.trim(), type, category, notes, routine: routine.trim(), cue: cue.trim(), createdAt, schedules: scheduleChanged ? [...(habit?.schedules ?? []), schedule] : habit!.schedules, reminder,
    ...(type === "duration" ? { pomodoroEnabled, focusMinutes: Number(focusMinutes), breakMinutes: Number(breakMinutes) } : {}), reminderEveryMinutes: reminderEvery ? Number(reminderEvery) : undefined, reminderStart, reminderEnd };
  const next = habit ? withHabitGoal(draft, schedule.target, schedule.unit) : draft;
  const valid = validateHabitData({ version: 1, habits: [next], logs: [] });
  const save = async () => {
    if (!valid) { setError("Check the name, dates, timezone, target, weekdays, and times (HH:MM, separated by commas)."); return; }
    if (habit && scheduleChanged && from <= habitDate(zone)) { setError("Schedule edits must begin on a future date to preserve history."); return; }
    setSaving(true);
    const saved = await changeHabits(d => ({ ...d, habits: d.habits.some(h => h.id === recordId) ? d.habits.map(h => h.id === recordId ? next : h) : [...d.habits, next] }));
    setSaving(false);
    if (saved) onClose(); else setError("Your changes are waiting to save. Use Retry saving before continuing.");
  };
  return <View className="bg-card border-border mb-6 w-full max-w-3xl self-center gap-5 rounded-2xl border p-4 sm:p-6">
    <Text className="text-xl font-semibold">{habit ? "Edit habit" : "Create a habit"}</Text>
    {!habit && <View className="flex-row flex-wrap gap-2">{[
      { title: "Study", type: "duration" as HabitType, target: "120", unit: "minutes", category: "Learning" },
      { title: "Drink water", type: "quantity" as HabitType, target: "8", unit: "glasses", category: "Wellbeing" },
      { title: "Take a mindful break", type: "binary" as HabitType, target: "1", unit: "times", category: "Wellbeing" },
    ].map(t => <Button key={t.title} size="sm" variant="outline" onPress={() => { setTitle(t.title); setType(t.type); setTarget(t.target); setUnit(t.unit); setCategory(t.category); setReminderEvery(t.title === "Drink water" ? "120" : ""); }}><Text>{t.title}</Text></Button>)}</View>}
    <Field label="Habit name" value={title} onChange={setTitle} />
    <Text className="text-muted-foreground text-sm">{frequency === "daily" ? "Every day" : frequency === "weekly" ? `${quota} days per week` : "Custom schedule"} · {type === "binary" ? "One-tap check-in" : `${target} ${type === "duration" ? "minutes" : unit}`} · {slots === "00:00" ? "Any time" : slots}</Text>
    {type === "duration" && <Field label="Daily study / focus goal (minutes)" value={target} onChange={setTarget} />}
    <Button variant="outline" className="self-start" accessibilityState={{ expanded: advanced }} onPress={() => setAdvanced(!advanced)}><Icon as={SlidersHorizontal} size={16} /><Text>{advanced ? "Hide options" : "Customize habit"}</Text><Icon as={advanced ? ChevronUp : ChevronDown} size={16} /></Button>
    {advanced && <View className="gap-4">
    <View className="flex-row flex-wrap gap-2">{[
      { id: "tracking", label: "Tracking", icon: Timer },
      { id: "schedule", label: "Schedule", icon: CalendarDays },
      { id: "reminders", label: "Reminders", icon: Bell },
      { id: "details", label: "Details", icon: SlidersHorizontal },
    ].map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.label} options`} accessibilityState={{ selected: option === item.id }} onPress={() => setOption(item.id)} className={`min-h-12 flex-1 items-center justify-center gap-1 rounded-xl px-2 py-3 web:focus-visible:outline web:focus-visible:outline-2 web:focus-visible:outline-primary ${option === item.id ? "bg-primary/10" : "bg-muted/40 web:hover:bg-muted"}`}><Icon as={item.icon} size={18} className={option === item.id ? "text-primary" : "text-muted-foreground"} /><Text className={`text-xs font-medium ${option === item.id ? "text-primary" : "text-muted-foreground"}`}>{item.label}</Text></Pressable>)}</View>
    <View className="bg-muted/20 border-border gap-4 rounded-xl border p-4 sm:p-5">
    {option === "tracking" && <View className="gap-4">
    <View className="gap-1"><Text className="font-semibold">How you'll track it</Text><Text className="text-muted-foreground text-sm">Choose what counts as progress.</Text></View>
    {!habit && <Choices values={["binary", "quantity", "duration", "avoid"] as HabitType[]} value={type} onChange={setType} />}
    <Text className="text-muted-foreground text-sm">{type === "avoid" ? "Log amounts and explicitly confirm your observation. No logs alone do not count as success." : type === "duration" ? "Track minutes manually or with the focus timer toward your target." : type === "quantity" ? "Add measured amounts toward your target." : "One tap to mark a scheduled habit done."}</Text>
    {type !== "binary" && type !== "duration" && <><Field label={type === "avoid" ? "Maximum amount" : "Target amount"} value={target} onChange={setTarget} /><Field label="Unit" value={unit} onChange={setUnit} /></>}
    {type === "duration" && <><Button variant="outline" accessibilityState={{ checked: pomodoroEnabled }} onPress={() => setPomodoroEnabled(!pomodoroEnabled)}><Text>Pomodoro {pomodoroEnabled ? "on" : "off"}</Text></Button>{pomodoroEnabled && <><View className="flex-row flex-wrap gap-2">{[{ focus: 25, rest: 5 }, { focus: 30, rest: 10 }, { focus: 60, rest: 20 }].map(p => <Button key={p.focus} variant={Number(focusMinutes) === p.focus && Number(breakMinutes) === p.rest ? "default" : "outline"} onPress={() => { setFocusMinutes(String(p.focus)); setBreakMinutes(String(p.rest)); }}><Text>{p.focus} focus / {p.rest} break</Text></Button>)}</View><Field label="Focus block (minutes)" value={focusMinutes} onChange={setFocusMinutes} /><Field label="Break length (minutes)" value={breakMinutes} onChange={setBreakMinutes} /></>}<Text className="text-muted-foreground text-xs">{pomodoroEnabled ? "A gentle prompt at the end of each block. Breaks never count toward your goal." : "Use a normal start-and-pause timer without timed break prompts."}</Text></>}
    </View>}
    {option === "schedule" && <View className="gap-4">
    <View className="gap-1"><Text className="font-semibold">Make it fit your day</Text><Text className="text-muted-foreground text-sm">Every day, at any time, is a good place to start.</Text></View>
    <Choices values={["daily", "weekdays", "interval", "weekly"] as HabitSchedule["frequency"][]} value={frequency} onChange={setFrequency} />
    {frequency === "weekdays" && <View className="flex-row flex-wrap gap-2">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, i) => <Button key={day} size="sm" variant={weekdays.includes(i) ? "default" : "outline"} onPress={() => setWeekdays(ds => ds.includes(i) ? ds.filter(n => n !== i) : [...ds, i])}><Text>{day}</Text></Button>)}</View>}
    {frequency === "interval" && <Field label="Repeat every N days" value={interval} onChange={setInterval} />}
    {frequency === "weekly" ? <><Field label="Sessions per week (1–7)" value={quota} onChange={setQuota} /><Text className="text-muted-foreground text-sm">Monday–Sunday. At most one qualifying session per day.</Text></> : <View className="gap-3"><Text className="text-sm font-medium">When?</Text><View className="flex-row flex-wrap gap-2"><Button size="sm" variant={slots === "00:00" ? "default" : "outline"} onPress={() => setSlots("00:00")}><Text>Any time</Text></Button><Button size="sm" variant={slots !== "00:00" ? "default" : "outline"} onPress={() => { if (slots === "00:00") setSlots("09:00"); }}><Text>Set times</Text></Button></View>{slots !== "00:00" && <><View className="flex-row flex-wrap gap-2">{slots.split(",").map((slot, i) => <View key={i} className="flex-row items-center gap-1"><TimePickerField value={slot.trim()} accessibilityLabel={`Habit time ${i + 1}`} onChange={value => { const times = slots.split(",").map(s => s.trim()); if (value) times[i] = value; else times.splice(i, 1); setSlots(times.join(", ") || "00:00"); }} /></View>)}</View><Button size="sm" className="self-start" variant="ghost" disabled={slots.split(",").length >= 24} onPress={() => { const times = slots.split(",").map(s => s.trim()); const available = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`).find(t => !times.includes(t)); if (available) setSlots([...times, available].join(", ")); }}><Text>+ Add another time</Text></Button></>}</View>}
    <View className="border-border border-t pt-3"><Button variant="ghost" className="h-auto min-h-11 justify-between" accessibilityState={{ expanded: datesOpen }} onPress={() => setDatesOpen(!datesOpen)}><Text>Dates & timezone</Text><Icon as={datesOpen ? ChevronUp : ChevronDown} size={16} /></Button><Text className="text-muted-foreground px-3 text-xs">{from} · {until ? `Until ${until}` : "No end date"} · {zone}</Text></View>
    {datesOpen && <View className="gap-4"><View className="flex-row flex-wrap gap-4"><View className="min-w-48 flex-1 gap-2"><Text className="text-sm font-medium">{habit ? "Apply schedule from" : "Start date"}</Text><DatePickerField value={from} onChange={v => v && setFrom(v)} accessibilityLabel="Habit start date" /></View><View className="min-w-48 flex-1 gap-2"><Text className="text-sm font-medium">End date</Text><DatePickerField value={until || undefined} onChange={v => setUntil(v ?? "")} placeholder="No end date" accessibilityLabel="Habit end date" /></View></View><Field label="Timezone" value={zone} onChange={setZone} /></View>}
    </View>}
    {option === "schedule" && datesOpen && !!until && <Button className="self-start" variant="ghost" size="sm" onPress={() => setUntil("")}><Text>Remove end date</Text></Button>}
    {option === "details" && <View className="gap-4"><View className="gap-1"><Text className="font-semibold">Make it yours</Text><Text className="text-muted-foreground text-sm">All optional. Add only what helps you.</Text></View>
    <Field label="Category" value={category} onChange={setCategory} /><Field label="Notes" value={notes} onChange={setNotes} />
    <Field label="Routine (optional)" value={routine} onChange={setRoutine} placeholder="e.g. Morning or Wind down" />
    <Field label="After I… (optional cue)" value={cue} onChange={setCue} placeholder="e.g. Finish breakfast, I'll read for 10 minutes" />
    </View>}
    {option === "reminders" && <View className="gap-4"><View className="gap-1"><Text className="font-semibold">A gentle nudge</Text><Text className="text-muted-foreground text-sm">Choose when you'd like a reminder.</Text></View>
    <Button variant="outline" onPress={() => setReminder(!reminder)}><Text>{reminder ? "Reminders on" : "Reminders off"}</Text></Button>
    {reminder && <><View className="flex-row flex-wrap gap-2">{[{ label: "At scheduled times", value: "" }, { label: "After 1 hour", value: "60" }, { label: "After 2 hours", value: "120" }].map(preset => <Button key={preset.label} size="sm" variant={reminderEvery === preset.value ? "default" : "outline"} onPress={() => setReminderEvery(preset.value)}><Text>{preset.label}</Text></Button>)}</View><Field label="Remind after no check-in for (minutes, optional)" value={reminderEvery} onChange={setReminderEvery} placeholder="Or enter your own interval" />{!!reminderEvery && <View className="gap-2"><Text className="text-sm font-medium">Only remind me between</Text><View className="flex-row flex-wrap items-center gap-3"><TimePickerField value={reminderStart} onChange={v => v && setReminderStart(v)} accessibilityLabel="Reminder hours start" /><Text className="text-muted-foreground">and</Text><TimePickerField value={reminderEnd} onChange={v => v && setReminderEnd(v)} accessibilityLabel="Reminder hours end" /></View></View>}<Text className="text-muted-foreground text-xs">Resets after a check-in and stops when your goal is reached. Leave the interval empty to use scheduled times.</Text></>}
    <Text className="text-muted-foreground text-xs">Reminders use your notification settings and work while the app is open.</Text>
    {reminder && !settings.reminders.enabled && <View className="gap-2"><Text className="text-sm">App reminders are currently off. Enable them in Settings for this reminder to run.</Text><Button variant="outline" className="self-start" onPress={() => router.push("/settings")}><Text>Open reminder settings</Text></Button></View>}
    </View>}
    </View>
    </View>}
    {habit && <Text className="text-muted-foreground text-sm">Your goal and unit update today when saved. Logged progress is kept.{scheduleChanged ? ` Schedule changes start ${from}.` : " Timer settings apply to the next block."}</Text>}
    {error && <Text className="text-destructive">{error}</Text>}
    <View className="border-border flex-row items-center gap-2 border-t pt-4"><Button className="min-w-32" disabled={saving || !title.trim()} onPress={() => void save()}><Text>{saving ? "Saving…" : "Save habit"}</Text></Button><Button disabled={saving} variant="ghost" onPress={onClose}><Text>Cancel</Text></Button></View>
  </View>;
}
export default function HabitsScreen() {
  const { data, ready, changeHabits, habitError, retryHabits } = useHabits();
  const params = useLocalSearchParams<{ habitId?: string; date?: string }>();
  const now = useNow();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("active");
  const [view, setView] = useState(params.habitId ? "library" : "today");
  const [sort, setSort] = useState("created");
  const [routineFilter, setRoutineFilter] = useState("All routines");
  const [editor, setEditor] = useState<Habit | "new" | null>(null);
  const [detail, setDetail] = useState<string | null>(params.habitId ?? null);
  const [remove, setRemove] = useState<Habit | null>(null);
  const [historyDate, setHistoryDate] = useState(params.date ?? habitDate(currentZone()));
  useEffect(() => {
    if (!params.habitId) return;
    setDetail(params.habitId); setView("library"); setFilter("all"); setRoutineFilter("All routines"); setSearch("");
    if (params.date) setHistoryDate(params.date);
  }, [params.habitId, params.date]);
  const state = (h: Habit) => h.schedules.at(-1)?.state ?? "active";
  const due = (h: Habit) => { const date = habitDate(h.schedules.at(-1)!.timezone, now.getTime()); return habitOccurrences(h, date, date); };
  const todayItems = data.habits.flatMap(h => due(h).map(o => ({ h, o })));
  const completed = todayItems.filter(({ h, o }) => habitProgress(h, o, data.logs, now.getTime()).ratio === 1).length;
  const routines = [...new Set(data.habits.map(h => h.routine).filter((r): r is string => !!r))];
  const visible = data.habits.filter(h => (view === "today" ? due(h).length > 0 : filter === "all" || state(h) === filter) && (view === "today" || routines.length > 5 || !routines.includes(routineFilter) || h.routine === routineFilter) && `${h.title} ${h.category} ${h.routine ?? ""}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => sort === "name" ? a.title.localeCompare(b.title) : sort === "category" ? a.category.localeCompare(b.category) || a.title.localeCompare(b.title) : a.createdAt - b.createdAt);
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
      <View className="mb-5 gap-3"><Choices values={["today", "library", "insights"]} value={view} onChange={v => { setView(v); setSearch(""); }} />
      {view === "today" && <Text className="text-muted-foreground">{todayItems.length ? completed === todayItems.length ? "You're all caught up. Enjoy the rest of your day." : `${completed} of ${todayItems.length} goals complete · One small step at a time.` : "No habits due today. Enjoy a little breathing room."}</Text>}
      {view === "library" && <><Input accessibilityLabel="Search habits" placeholder="Search habits or categories" value={search} onChangeText={setSearch} /><Choices values={["active", "paused", "archived", "all"]} value={filter} onChange={setFilter} /><Choices values={["created", "name", "category"]} value={sort} onChange={setSort} /></>}
      {view === "library" && routines.length > 0 && routines.length <= 5 && <Choices values={["All routines", ...routines]} value={routineFilter} onChange={setRoutineFilter} />}
      </View>
      {view === "insights" && <HabitInsights data={data} now={now.getTime()} />}
      {!data.habits.length && <View className="bg-card border-border gap-3 rounded-xl border p-6"><Text className="text-xl font-semibold">Start small. Make it yours.</Text><Text>Choose a habit you can repeat on an ordinary day. Rest and restarting are part of the process.</Text><Button className="self-start" onPress={() => setEditor("new")}><Text>Create your first habit</Text></Button></View>}
      {view !== "insights" && !!data.habits.length && !visible.length && view === "library" && <Text className="text-muted-foreground">No habits match this view. Try another filter or search.</Text>}
      {view !== "insights" && visible.map(h => {
        const today = habitDate(h.schedules.at(-1)!.timezone, now.getTime());
        const occurrences = habitOccurrences(h, today, today);
        const stats = detail === h.id ? habitStats(h, data.logs, now.getTime()) : null;
        return <View key={h.id} className="bg-card border-border mb-4 gap-3 rounded-xl border p-5">
          <View className="flex-row flex-wrap items-center justify-between gap-2"><View className="flex-1"><Text className="text-lg font-semibold">{h.title}</Text><Text className="text-muted-foreground text-sm">{h.category}{state(h) !== "active" ? ` · ${state(h)}` : ""}</Text></View><Button variant="ghost" size="sm" accessibilityLabel={`Details for ${h.title}`} accessibilityState={{ expanded: detail === h.id }} onPress={() => setDetail(detail === h.id ? null : h.id)}><Text>{detail === h.id ? "Close" : "Details"}</Text></Button></View>
          {occurrences.map(o => <View key={o.key} className="gap-2"><Text className="text-muted-foreground text-xs">{o.schedule.frequency === "weekly" ? "Weekly goal" : o.slot === "00:00" ? "Any time today" : o.slot}</Text><HabitCheckIn habit={h} occurrence={o} /></View>)}
          {!!h.cue && <Text className="text-muted-foreground text-sm">After I {h.cue}</Text>}
          {!occurrences.length && <Text className="text-muted-foreground text-sm">No check-in scheduled today.</Text>}
          {detail === h.id && stats && <View className="border-border gap-3 border-t pt-4">
            <View className="flex-row flex-wrap gap-2"><Button size="sm" variant="outline" onPress={() => setEditor(h)}><Text>Edit</Text></Button><Button size="sm" variant="outline" onPress={() => transition(h, state(h) === "active" ? "paused" : "active")}><Text>{state(h) === "active" ? "Pause tomorrow" : "Resume tomorrow"}</Text></Button>{state(h) !== "archived" && <Button size="sm" variant="ghost" onPress={() => transition(h, "archived")}><Text>Archive tomorrow</Text></Button>}<Button size="sm" variant="ghost" onPress={() => setRemove(h)}><Text>Delete</Text></Button></View>
            <Text className="font-semibold">Momentum: {stats.score === null ? "Not enough history" : `${Math.round(stats.score)} / 100`}</Text>
            <Text className="text-muted-foreground text-sm">{stats.count} closed opportunities{stats.count < 7 ? " · early estimate" : ""}. Weighted progress over the latest 7, 30 and 90 opportunities (40%, 40%, 20%). Open periods and pauses are excluded.</Text>
            <Text>Strict streak: {stats.current} · Best: {stats.best} {h.schedules.at(-1)!.frequency === "weekly" ? "weeks" : "opportunities"}</Text>
            {!!h.notes && <Text>{h.notes}</Text>}
            <HabitReflection habit={h} />
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
    <ConfirmDialog open={!!remove} onOpenChange={open => !open && setRemove(null)} title="Delete habit and history?" description="This deletes the habit and its check-ins, including synced copies when cloud sync is enabled. Archive instead to keep your history, or export a backup first." onConfirm={() => { changeHabits(d => ({ ...d, habits: d.habits.filter(h => h.id !== remove?.id), logs: d.logs.filter(l => l.habitId !== remove?.id) })); setRemove(null); }} />
  </ScrollView>;
}
