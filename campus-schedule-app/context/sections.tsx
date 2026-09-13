import type { RealtimeChannel } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform } from "react-native";

import { useAuth } from "@/context/auth";
import { useSectionTasks } from "@/context/store";
import { fetchSectionData, friendlyCloudError, type SectionData } from "@/lib/cloud";
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
};

const EMPTY: SectionData = { sections: [], members: [], posts: [] };

const SectionsContext = createContext<SectionsCtx | null>(null);

export function SectionsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { applySectionPosts } = useSectionTasks();
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

  const value = useMemo<SectionsCtx>(
    () => ({
      ...data,
      available: !!supabase && !!userId,
      loading,
      loaded,
      error,
      refresh: () => refreshRef.current(),
    }),
    [data, userId, loading, loaded, error]
  );

  return <SectionsContext.Provider value={value}>{children}</SectionsContext.Provider>;
}

export function useSections() {
  const ctx = useContext(SectionsContext);
  if (!ctx) throw new Error("useSections must be used inside <SectionsProvider>");
  return ctx;
}
