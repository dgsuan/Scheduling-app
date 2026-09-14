import type { RealtimeChannel } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform } from "react-native";

import { useAuth } from "@/context/auth";
import { useSectionTasks, useTasks } from "@/context/store";
import { fetchSectionData, friendlyCloudError, setPostDone, type SectionData } from "@/lib/cloud";
import { supabase } from "@/lib/supabase";

// The class sections the signed-in user belongs to, kept fresh (live
// updates, app focus, every few minutes). Each section's deadlines are
// mirrored into the task list, so they show in Tasks, the Calendar and
// reminders like any other task.

const REFRESH_MS = 5 * 60_000;

type SectionsCtx = SectionData & {
  /** Sections need an account and a configured backend. */
  available: boolean;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** "I submitted it": ticks the deadline's task here and shares the check-off with the section. */
  setSubmitted: (postId: string, done: boolean) => void;
};

const EMPTY: SectionData = { sections: [], members: [], posts: [], marks: [], sharedNotes: [] };
const MARK_DEBOUNCE_MS = 1200;

const SectionsContext = createContext<SectionsCtx | null>(null);

export function SectionsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { applySectionPosts } = useSectionTasks();
  const { tasks, updateTask } = useTasks();
  const [data, setData] = useState<SectionData>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const applyRef = useRef(applySectionPosts);
  applyRef.current = applySectionPosts;
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const userId = user?.id ?? null;

  useEffect(() => {
    setData(EMPTY);
    setLoaded(false);
    setError(null);
    if (!supabase || !userId) return;
    const db = supabase;
    let disposed = false;
    let running: Promise<void> | null = null;
    let again = false;

    const refresh = async (): Promise<void> => {
      if (running) {
        again = true;
        return running;
      }
      running = (async () => {
        setLoading(true);
        try {
          const next = await fetchSectionData();
          if (disposed) return;
          setData(next);
          setError(null);
          setLoaded(true);
          const byId = new Map(next.sections.map((s) => [s.id, s]));
          applyRef.current(
            next.posts.map((p) => ({
              postId: p.id,
              sectionId: p.sectionId,
              title: p.title,
              due: p.due,
              dueTime: p.dueTime ?? undefined,
              courseCode: byId.get(p.sectionId)?.courseCode ?? null,
              createdAt: Date.parse(p.createdAt) || 0,
            }))
          );
        } catch (e) {
          // Keep the last good data (and the tasks) when a refresh fails.
          if (!disposed) setError(friendlyCloudError(e));
        } finally {
          if (!disposed) setLoading(false);
        }
      })();
      await running;
      running = null;
      if (again && !disposed) {
        again = false;
        await refresh();
      }
    };
    refreshRef.current = refresh;
    void refresh();

    let soonTimer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(soonTimer);
      soonTimer = setTimeout(() => void refresh(), 700);
    };
    // Row rules apply to live updates too: only posts from your sections arrive.
    const channel: RealtimeChannel = db
      .channel(`section-posts:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "section_posts" }, soon)
      .on("postgres_changes", { event: "*", schema: "public", table: "section_post_marks" }, soon)
      .on("postgres_changes", { event: "*", schema: "public", table: "section_shared_notes" }, soon)
      .subscribe();
    const interval = setInterval(() => void refresh(), REFRESH_MS);
    const appSub = AppState.addEventListener("change", (s) => s === "active" && soon());
    if (Platform.OS === "web") window.addEventListener("online", soon);

    return () => {
      disposed = true;
      clearTimeout(soonTimer);
      clearInterval(interval);
      appSub.remove();
      if (Platform.OS === "web") window.removeEventListener("online", soon);
      db.removeChannel(channel);
      refreshRef.current = async () => {};
    };
  }, [userId]);

  // Keep check-offs in step with the deadline tasks: finishing a section
  // deadline in Tasks marks it submitted for the section, and un-ticking undoes it.
  const marksDisabled = useRef(false);
  useEffect(() => {
    if (!supabase || !userId || !loaded || marksDisabled.current) return;
    const postIds = new Set(data.posts.map((p) => p.id));
    const mine = new Set(data.marks.filter((m) => m.userId === userId).map((m) => m.postId));
    const changes = tasks.flatMap((t) =>
      t.source?.kind === "section" && postIds.has(t.source.key) && t.done !== mine.has(t.source.key)
        ? [{ postId: t.source.key, done: t.done }]
        : []
    );
    if (!changes.length) return;
    const timer = setTimeout(async () => {
      for (const c of changes) {
        try {
          await setPostDone(c.postId, userId, c.done);
          setData((d) => ({
            ...d,
            marks: c.done
              ? [...d.marks.filter((m) => !(m.postId === c.postId && m.userId === userId)), { postId: c.postId, userId }]
              : d.marks.filter((m) => !(m.postId === c.postId && m.userId === userId)),
          }));
        } catch (e) {
          // Not set up yet (migration 0003) or offline: stop until the next refresh.
          if (/database update/i.test(friendlyCloudError(e))) marksDisabled.current = true;
          return;
        }
      }
    }, MARK_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [tasks, data.posts, data.marks, userId, loaded]);

  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  const value = useMemo<SectionsCtx>(
    () => ({
      ...data,
      available: !!supabase && !!userId,
      loading,
      loaded,
      error,
      refresh: () => {
        marksDisabled.current = false;
        return refreshRef.current();
      },
      setSubmitted: (postId: string, done: boolean) => {
        const task = tasksRef.current.find((t) => t.source?.kind === "section" && t.source.key === postId);
        if (task) {
          updateTask(task.id, { done });
          return;
        }
        // The deadline's task was deleted here: record the check-off directly.
        if (!userId) return;
        setPostDone(postId, userId, done)
          .then(() =>
            setData((d) => ({
              ...d,
              marks: done
                ? [...d.marks.filter((m) => !(m.postId === postId && m.userId === userId)), { postId, userId }]
                : d.marks.filter((m) => !(m.postId === postId && m.userId === userId)),
            }))
          )
          .catch((e) => setError(friendlyCloudError(e)));
      },
    }),
    [data, userId, loading, loaded, error, updateTask]
  );

  return <SectionsContext.Provider value={value}>{children}</SectionsContext.Provider>;
}

export function useSections() {
  const ctx = useContext(SectionsContext);
  if (!ctx) throw new Error("useSections must be used inside <SectionsProvider>");
  return ctx;
}
