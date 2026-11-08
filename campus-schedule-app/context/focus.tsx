import { useAuth } from "@/context/auth";
import { habitId, habitDate, habitOccurrences, habitTime } from "@/lib/habits";
import { addDaysIso } from "@/lib/dates";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Pause, Play, Square } from "lucide-react-native";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Platform, View } from "react-native";

import { LiveDot } from "@/components/schedule/LiveDot";
import { useToast } from "@/components/Toaster";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { useTheme } from "@/context/theme";
import { useHabits, useTasks } from "@/context/store";
import { useBreakpoint } from "@/lib/useBreakpoint";

// Focus timer for one task at a time. The session survives reloads; when
// stopped, the elapsed time is added to the task's total.

const KEY = "campus-schedule-cache:focus";

type Session = { taskId: string; startedAt: number | null; accumulatedMs: number; id?: string; habit?: { id: string; key: string; date: string; owner?: string }; committing?: boolean; limitMs?: number; endAt?: number; phase?: "focus" | "break"; breakMinutes?: number };

type FocusCtx = {
  session: Session | null;
  start: (taskId: string) => void;
  startHabit: (habitId: string, key: string, date: string, minutes?: number) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  takeBreak: () => void;
  continueFocus: () => void;
};

const FocusContext = createContext<FocusCtx | null>(null);

export function elapsedMs(s: Session, now = Date.now()): number {
  const elapsed = s.accumulatedMs + (s.startedAt ? Math.max(0, Math.min(now, s.endAt ?? now) - s.startedAt) : 0);
  return Math.min(elapsed, s.limitMs ?? Infinity);
}

export function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return `${h ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

/** "1h 20m", "25m", "<1m". */
export function formatSpent(seconds: number): string {
  const m = Math.floor(seconds / 60);
  if (m < 1) return "<1m";
  const h = Math.floor(m / 60);
  return h ? `${h}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`;
}

function readSync(): Session | null {
  if (Platform.OS !== "web") return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function FocusProvider({ children }: { children: React.ReactNode }) {
  const { tasks, addTimeSpent } = useTasks();
  const auth = useAuth();
  const { toast, dismiss } = useToast();
  const { data, ready, changeHabits, habitLocked } = useHabits();
  const busy = useRef(false);
  const persistence = useRef<Promise<unknown>>(Promise.resolve());
  const [loaded, setLoaded] = useState(Platform.OS === "web");
  const [session, setSession] = useState<Session | null>(readSync);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const persist = useCallback((s: Session | null) => {
    persistence.current = persistence.current.catch(() => {}).then(() => s ? AsyncStorage.setItem(KEY, JSON.stringify(s)) : AsyncStorage.removeItem(KEY));
    return persistence.current;
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") return;
    AsyncStorage.getItem(KEY)
      .then((raw) => raw && setSession(JSON.parse(raw)))
      .catch(() => {}).finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (loaded) void persist(session).catch(() => {});
  }, [session, loaded, persist]);

  const commit = useCallback(async (s: Session | null) => {
    if (!s || s.phase === "break" || elapsedMs(s) <= 0) return true;
    if (!s.habit) { addTimeSpent(s.taskId, elapsedMs(s) / 1000); return true; }
    const stopped = { ...s, id: s.id ?? habitId(), accumulatedMs: elapsedMs(s), startedAt: null, committing: true };
    sessionRef.current = stopped;
    setSession(stopped);
    try { await persist(stopped); } catch { return false; }
    return changeHabits(d => {
      if (d.logs.some(l => l.sourceId === stopped.id)) return d;
      if (d.cloud?.ownerId !== s.habit!.owner || !d.habits.some(h => h.id === s.habit!.id)) return d;
      return { ...d, logs: [...d.logs, { id: habitId(), sourceId: stopped.id, habitId: s.habit!.id, occurrenceKey: s.habit!.key, date: s.habit!.date, at: Date.now(), amount: stopped.accumulatedMs / 1000, confirmed: false }] };
    });
  }, [addTimeSpent, changeHabits, persist]);
  const switchTo = useCallback(async (next: Session | null) => {
    if (busy.current || !ready || !loaded) return;
    busy.current = true;
    try {
      const previousId = sessionRef.current?.id;
      if (!(await commit(sessionRef.current))) return;
      await persist(next);
      if (previousId) dismiss(`focus:${previousId}`);
      sessionRef.current = next;
      setSession(next);
    } catch { /* Keep the current session available for retry. */ }
    finally { busy.current = false; }
  }, [commit, persist, ready, loaded, dismiss]);
  const start = useCallback((taskId: string) => {
    if (sessionRef.current?.taskId === taskId && !sessionRef.current.habit) return;
    void switchTo({ taskId, id: habitId(), startedAt: Date.now(), accumulatedMs: 0 });
  }, [switchTo]);
  const startHabit = useCallback((id: string, key: string, date: string, minutes?: number) => {
    const h = data.habits.find(h => h.id === id);
    const o = h && habitOccurrences(h, date, date).find(o => o.key === key);
    if (!h || h.type !== "duration" || !o || Date.now() < o.startAt || Date.now() >= o.endAt) return;
    if (sessionRef.current?.habit?.key === key) return;
    const localDate = habitDate(o.schedule.timezone);
    void switchTo({ taskId: "", id: habitId(), habit: { id, key, date: localDate, owner: data.cloud?.ownerId }, phase: "focus", breakMinutes: h.breakMinutes ?? 10, startedAt: Date.now(), accumulatedMs: 0,
      endAt: Math.min(o.endAt, habitTime(addDaysIso(localDate, 1), "00:00", o.schedule.timezone)),
      ...(h.pomodoroEnabled !== false ? { limitMs: (minutes ?? h.focusMinutes ?? 30) * 60000 } : {}) });
  }, [data.habits, data.cloud?.ownerId, switchTo]);
  const pause = useCallback(() => {
    if (busy.current) return;
    const s = sessionRef.current;
    if (s?.startedAt) { const next = { ...s, startedAt: null, accumulatedMs: elapsedMs(s) }; sessionRef.current = next; setSession(next); }
  }, []);
  const resume = useCallback(() => {
    if (busy.current) return;
    const s = sessionRef.current;
    if (s && !s.startedAt && !s.committing && Date.now() < (s.endAt ?? Infinity) && elapsedMs(s) < (s.limitMs ?? Infinity)) { const next = { ...s, startedAt: Date.now() }; sessionRef.current = next; setSession(next); }
  }, []);
  const stop = useCallback(() => { void switchTo(null); }, [switchTo]);
  const takeBreak = useCallback(() => {
    const s = sessionRef.current;
    if (!s?.habit || s.phase === "break") return;
    const h = data.habits.find(h => h.id === s.habit!.id);
    void switchTo({ taskId: "", id: habitId(), habit: s.habit, phase: "break", accumulatedMs: 0, startedAt: Date.now(),
      ...(h?.pomodoroEnabled !== false ? { limitMs: (h?.breakMinutes ?? s.breakMinutes ?? 10) * 60000 } : {}) });
  }, [data.habits, switchTo]);
  const continueFocus = useCallback(() => {
    const s = sessionRef.current;
    if (!s?.habit) return;
    if (s.phase !== "break" && !s.committing && elapsedMs(s) < (s.limitMs ?? Infinity) && Date.now() < (s.endAt ?? Infinity)) { resume(); return; }
    const h = data.habits.find(h => h.id === s.habit!.id);
    if (!h) return;
    const date = habitDate(h.schedules.at(-1)!.timezone);
    const o = habitOccurrences(h, date, date).find(o => o.startAt <= Date.now() && o.endAt > Date.now());
    if (!o) { toast({ message: "No focus session scheduled right now.", description: "Your previous focus time is kept. You can stop this timer." }); return; }
    void switchTo({ taskId: "", id: habitId(), habit: { id: h.id, key: o.key, date, owner: data.cloud?.ownerId }, phase: "focus", breakMinutes: h.breakMinutes ?? 10,
      accumulatedMs: 0, startedAt: Date.now(), endAt: Math.min(o.endAt, habitTime(addDaysIso(date, 1), "00:00", o.schedule.timezone)),
      ...(h.pomodoroEnabled !== false ? { limitMs: (h.focusMinutes ?? 30) * 60000 } : {}) });
  }, [data.habits, data.cloud?.ownerId, switchTo, resume, toast]);

  useEffect(() => {
    if (!ready || !loaded || !session?.startedAt || (!session.limitMs && !session.endAt)) return;
    const tick = () => {
      const current = sessionRef.current;
      if (current?.startedAt && (Date.now() >= (current.endAt ?? Infinity) || elapsedMs(current) >= (current.limitMs ?? Infinity))) {
        const stopped = { ...current, accumulatedMs: elapsedMs(current), startedAt: null };
        sessionRef.current = stopped; setSession(stopped);
        if (current.phase === "break") toast({ id: `focus:${current.id}`, message: "Break complete. Ready when you are.", actionLabel: "Continue", onAction: continueFocus, duration: 0 });
        else if (Date.now() >= (current.endAt ?? Infinity)) toast({ id: `focus:${current.id}`, message: "Today's focus timer is paused.", description: "Save this session when you're ready.", actionLabel: "Save", onAction: stop, duration: 0 });
        else toast({ id: `focus:${current.id}`, message: `Nice work — ${Math.round(elapsedMs(current) / 60000)} minutes of focus!`, description: `Take ${current.breakMinutes ?? 10} minutes off. Your study timer is paused.`, actionLabel: "Take a break", onAction: takeBreak, duration: 0 });
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [session, ready, loaded, toast, takeBreak, continueFocus, stop]);

  useEffect(() => {
    if (auth.ready && habitLocked && session?.habit) { sessionRef.current = null; setSession(null); return; }
    if (!ready || !loaded || !session) return;
    const exists = session.habit ? (data.cloud?.ownerId === session.habit.owner && data.habits.some(h => h.id === session.habit!.id)) : tasks.some(t => t.id === session.taskId);
    if (!exists) { sessionRef.current = null; setSession(null); }
  }, [tasks, data.habits, data.cloud?.ownerId, auth.ready, habitLocked, ready, loaded, session]);

  const value = useMemo(() => ({ session, start, startHabit, pause, resume, stop, takeBreak, continueFocus }), [session, start, startHabit, pause, resume, stop, takeBreak, continueFocus]);
  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>;
}

export function useFocus() {
  const ctx = useContext(FocusContext);
  if (!ctx) throw new Error("useFocus must be used inside <FocusProvider>");
  return ctx;
}

/** Floating timer shown while a focus session exists. */
export function FocusBar() {
  const { session, pause, resume, stop, takeBreak, continueFocus } = useFocus();
  const { tasks } = useTasks();
  const { data } = useHabits();
  const { wide } = useBreakpoint();
  const t = useTheme();
  const [, tick] = useState(0);
  const running = !!session?.startedAt;

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  const task = session?.habit ? data.habits.find(h => h.id === session.habit!.id) : session ? tasks.find((x) => x.id === session.taskId) : undefined;
  if (!session || !task) return null;
  const finished = Date.now() >= (session.endAt ?? Infinity) || elapsedMs(session) >= (session.limitMs ?? Infinity);

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: Platform.OS === "web" ? ("fixed" as "absolute") : "absolute",
        zIndex: 90,
        ...(wide ? { right: 24, bottom: 24 } : { left: 12, right: 12, top: 12 }),
        alignItems: wide ? "flex-end" : "stretch",
      }}
    >
      <View
        role="timer"
        aria-live="off"
        className="bg-card border-border flex-row items-center gap-3 rounded-xl border py-2 pl-3.5 pr-1.5 shadow-lg shadow-black/15"
        style={wide ? { width: 390 } : undefined}
      >
        {running ? <LiveDot color={t.accent} /> : <View className="bg-muted-foreground size-2 rounded-full" />}
        <View className="flex-1">
          <Text className="text-muted-foreground text-[11px] font-medium">{session.phase === "break" ? finished ? "Break complete" : "Taking a break" : finished ? "Nice work · time for a break" : running ? "Focusing on" : "Paused"}</Text>
          <Text className="text-sm font-medium" numberOfLines={1}>
            {task.title || "Untitled task"}
          </Text>
        </View>
        <Text className="font-display text-lg font-semibold tabular-nums" accessibilityLabel={`Elapsed ${formatClock(elapsedMs(session))}`}>
          {formatClock(session.phase === "break" && session.limitMs ? Math.max(0, session.limitMs - elapsedMs(session)) : elapsedMs(session))}
        </Text>
        {session.habit ? <Button variant="ghost" size="sm" onPress={session.phase === "break" ? continueFocus : running || finished ? takeBreak : continueFocus}><Text>{session.phase === "break" ? "Continue" : running || finished ? "Break" : "Resume"}</Text></Button> : <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onPress={running ? pause : resume}
          disabled={finished || !!session.committing}
          accessibilityLabel={running ? "Pause focus timer" : "Resume focus timer"}
        >
          <Icon as={running ? Pause : Play} size={16} />
        </Button>}
        <Button variant="ghost" size="icon" className="h-9 w-9" onPress={stop} accessibilityLabel="Stop and save focus time">
          <Icon as={Square} size={14} />
        </Button>
      </View>
    </View>
  );
}
