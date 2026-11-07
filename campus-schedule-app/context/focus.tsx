import { useAuth } from "@/context/auth";
import { habitId, habitDate, habitOccurrences } from "@/lib/habits";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Pause, Play, Square } from "lucide-react-native";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Platform, View } from "react-native";

import { LiveDot } from "@/components/schedule/LiveDot";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { useTheme } from "@/context/theme";
import { useHabits, useTasks } from "@/context/store";
import { useBreakpoint } from "@/lib/useBreakpoint";

// Focus timer for one task at a time. The session survives reloads; when
// stopped, the elapsed time is added to the task's total.

const KEY = "campus-schedule-cache:focus";

type Session = { taskId: string; startedAt: number | null; accumulatedMs: number; id?: string; habit?: { id: string; key: string; date: string; owner?: string }; committing?: boolean };

type FocusCtx = {
  session: Session | null;
  start: (taskId: string) => void;
  startHabit: (habitId: string, key: string, date: string) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
};

const FocusContext = createContext<FocusCtx | null>(null);

export function elapsedMs(s: Session, now = Date.now()): number {
  return s.accumulatedMs + (s.startedAt ? now - s.startedAt : 0);
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
    if (!s) return true;
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
      if (!(await commit(sessionRef.current))) return;
      await persist(next);
      sessionRef.current = next;
      setSession(next);
    } catch { /* Keep the current session available for retry. */ }
    finally { busy.current = false; }
  }, [commit, persist, ready, loaded]);
  const start = useCallback((taskId: string) => {
    if (sessionRef.current?.taskId === taskId && !sessionRef.current.habit) return;
    void switchTo({ taskId, id: habitId(), startedAt: Date.now(), accumulatedMs: 0 });
  }, [switchTo]);
  const startHabit = useCallback((id: string, key: string, date: string) => {
    const h = data.habits.find(h => h.id === id);
    const o = h && habitOccurrences(h, date, date).find(o => o.key === key);
    if (!h || h.type !== "duration" || !o || Date.now() < o.startAt || Date.now() >= o.endAt) return;
    if (sessionRef.current?.habit?.key === key) return;
    void switchTo({ taskId: "", id: habitId(), habit: { id, key, date: habitDate(o.schedule.timezone), owner: data.cloud?.ownerId }, startedAt: Date.now(), accumulatedMs: 0 });
  }, [data.habits, data.cloud?.ownerId, switchTo]);
  const pause = useCallback(() => {
    setSession((s) => (s && s.startedAt ? { ...s, startedAt: null, accumulatedMs: elapsedMs(s) } : s));
  }, []);
  const resume = useCallback(() => {
    setSession((s) => (s && !s.startedAt && !s.committing ? { ...s, startedAt: Date.now() } : s));
  }, []);
  const stop = useCallback(() => { void switchTo(null); }, [switchTo]);

  useEffect(() => {
    if (auth.ready && habitLocked && session?.habit) { sessionRef.current = null; setSession(null); return; }
    if (!ready || !loaded || !session) return;
    const exists = session.habit ? (data.cloud?.ownerId === session.habit.owner && data.habits.some(h => h.id === session.habit!.id)) : tasks.some(t => t.id === session.taskId);
    if (!exists) { sessionRef.current = null; setSession(null); }
  }, [tasks, data.habits, data.cloud?.ownerId, auth.ready, habitLocked, ready, loaded, session]);

  const value = useMemo(() => ({ session, start, startHabit, pause, resume, stop }), [session, start, startHabit, pause, resume, stop]);
  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>;
}

export function useFocus() {
  const ctx = useContext(FocusContext);
  if (!ctx) throw new Error("useFocus must be used inside <FocusProvider>");
  return ctx;
}

/** Floating timer shown while a focus session exists. */
export function FocusBar() {
  const { session, pause, resume, stop } = useFocus();
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
        style={wide ? { width: 320 } : undefined}
      >
        {running ? <LiveDot color={t.accent} /> : <View className="bg-muted-foreground size-2 rounded-full" />}
        <View className="flex-1">
          <Text className="text-muted-foreground text-[11px] font-medium">{running ? "Focusing on" : "Paused"}</Text>
          <Text className="text-sm font-medium" numberOfLines={1}>
            {task.title || "Untitled task"}
          </Text>
        </View>
        <Text className="font-display text-lg font-semibold tabular-nums" accessibilityLabel={`Elapsed ${formatClock(elapsedMs(session))}`}>
          {formatClock(elapsedMs(session))}
        </Text>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onPress={running ? pause : resume}
          accessibilityLabel={running ? "Pause focus timer" : "Resume focus timer"}
        >
          <Icon as={running ? Pause : Play} size={16} />
        </Button>
        <Button variant="ghost" size="icon" className="h-9 w-9" onPress={stop} accessibilityLabel="Stop and save focus time">
          <Icon as={Square} size={14} />
        </Button>
      </View>
    </View>
  );
}
