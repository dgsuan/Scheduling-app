import AsyncStorage from "@react-native-async-storage/async-storage";
import { Pause, Play, Square } from "lucide-react-native";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Platform, View } from "react-native";

import { LiveDot } from "@/components/schedule/LiveDot";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { useTheme } from "@/context/theme";
import { useTasks } from "@/context/store";
import { useBreakpoint } from "@/lib/useBreakpoint";

// Focus timer for one task at a time. The session survives reloads; when
// stopped, the elapsed time is added to the task's total.

const KEY = "campus-schedule-cache:focus";

type Session = { taskId: string; startedAt: number | null; accumulatedMs: number };

type FocusCtx = {
  session: Session | null;
  start: (taskId: string) => void;
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
  const [session, setSession] = useState<Session | null>(readSync);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  useEffect(() => {
    if (Platform.OS === "web") return;
    AsyncStorage.getItem(KEY)
      .then((raw) => raw && setSession(JSON.parse(raw)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (session) AsyncStorage.setItem(KEY, JSON.stringify(session)).catch(() => {});
    else AsyncStorage.removeItem(KEY).catch(() => {});
  }, [session]);

  const commit = useCallback(
    (s: Session | null) => {
      if (s) addTimeSpent(s.taskId, elapsedMs(s) / 1000);
    },
    [addTimeSpent]
  );

  const start = useCallback(
    (taskId: string) => {
      const current = sessionRef.current;
      if (current?.taskId === taskId) return;
      commit(current);
      setSession({ taskId, startedAt: Date.now(), accumulatedMs: 0 });
    },
    [commit]
  );
  const pause = useCallback(() => {
    setSession((s) => (s && s.startedAt ? { ...s, startedAt: null, accumulatedMs: elapsedMs(s) } : s));
  }, []);
  const resume = useCallback(() => {
    setSession((s) => (s && !s.startedAt ? { ...s, startedAt: Date.now() } : s));
  }, []);
  const stop = useCallback(() => {
    commit(sessionRef.current);
    setSession(null);
  }, [commit]);

  // If the task disappears (deleted), end the session quietly.
  useEffect(() => {
    if (session && !tasks.some((t) => t.id === session.taskId)) setSession(null);
  }, [tasks, session]);

  const value = useMemo(() => ({ session, start, pause, resume, stop }), [session, start, pause, resume, stop]);
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
  const { wide } = useBreakpoint();
  const t = useTheme();
  const [, tick] = useState(0);
  const running = !!session?.startedAt;

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  const task = session ? tasks.find((x) => x.id === session.taskId) : undefined;
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
