import { useEffect, useMemo, useRef } from "react";

import { useAuth } from "@/context/auth";
import { useSections } from "@/context/sections";
import { useCourses, useSettings, useTasks } from "@/context/store";
import { activityKey, currentActivity } from "@/lib/activity";
import { clearActivity, publishActivity } from "@/lib/cloud";
import { supabase } from "@/lib/supabase";
import { useNow } from "@/lib/useNow";

// Publishes "what I'm doing" for Friend activity while sharing is on: the
// newest task in Doing, or one finished in the last few hours. Turning
// sharing off, or having nothing to show, removes it from the server.

const DEBOUNCE_MS = 1500;

/** The name friends see: the one picked for activity, else a section display name. */
export function activityName(picked: string | undefined, members: { userId: string; displayName: string }[], userId: string | undefined): string {
  return picked?.trim() || members.find((m) => m.userId === userId)?.displayName || "";
}

export function ActivityEngine() {
  const { user } = useAuth();
  const { tasks } = useTasks();
  const { courses } = useCourses();
  const { settings } = useSettings();
  const { members } = useSections();
  const now = useNow();
  const userId = user?.id;
  const name = activityName(settings.activityName, members, userId);
  const share = !!settings.shareActivity && !!name;

  const activity = useMemo(() => (share ? currentActivity(tasks, courses, now.getTime()) : null), [share, tasks, courses, now]);
  const key = activity ? `${name}|${activityKey(activity)}` : "";

  const latest = useRef({ activity, name });
  latest.current = { activity, name };
  /** What the server has from this session; null = not known yet (clear once on start). */
  const sent = useRef<string | null>(null);
  useEffect(() => {
    sent.current = null;
  }, [userId]);

  useEffect(() => {
    if (!supabase || !userId || sent.current === key) return;
    const timer = setTimeout(async () => {
      const { activity: a, name: n } = latest.current;
      try {
        if (a) await publishActivity(userId, n, a);
        else await clearActivity(userId);
        sent.current = key;
      } catch {
        // Offline or the database isn't updated yet: try again on the next change.
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [key, userId]);

  return null;
}
