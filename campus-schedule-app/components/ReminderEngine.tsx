import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";

import { useToast } from "@/components/Toaster";
import { useCourses, useScheduleRules, useSettings, useTasks } from "@/context/store";
import { showSystemNotification } from "@/lib/notify";
import { dueReminders } from "@/lib/reminders";

// Fires class and task reminders while the app is open. One interval, only
// while reminders are on. Each reminder fires once (ids are remembered
// across reloads). Without notification permission, it falls back to an
// in-app toast so nothing silently goes missing.

const CHECK_INTERVAL_MS = 20_000;
const FIRED_KEY = "campus-schedule-cache:reminders-fired";
const FORGET_AFTER_MS = 2 * 24 * 60 * 60 * 1000;

const memoryFired: Record<string, number> = {};

function loadFired(): Record<string, number> {
  if (Platform.OS !== "web") return memoryFired;
  try {
    return JSON.parse(localStorage.getItem(FIRED_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveFired(fired: Record<string, number>) {
  const now = Date.now();
  for (const [id, at] of Object.entries(fired)) if (now - at > FORGET_AFTER_MS) delete fired[id];
  if (Platform.OS !== "web") return;
  try {
    localStorage.setItem(FIRED_KEY, JSON.stringify(fired));
  } catch {
    // Storage full: worst case a reminder could repeat after a reload.
  }
}

export function ReminderEngine() {
  const { settings } = useSettings();
  const { courses } = useCourses();
  const { tasks } = useTasks();
  const rules = useScheduleRules();
  const { toast } = useToast();

  const latest = useRef({ settings, courses, tasks, rules, toast });
  latest.current = { settings, courses, tasks, rules, toast };

  const enabled = settings.reminders.enabled;
  useEffect(() => {
    if (!enabled) return;
    const check = () => {
      const { settings: s, courses: c, tasks: t, rules: r, toast: show } = latest.current;
      const due = dueReminders({
        now: new Date(),
        courses: c,
        tasks: t,
        rules: r,
        classLeadMin: s.reminders.classLeadMin,
        taskLeadMin: s.reminders.taskLeadMin,
      });
      if (!due.length) return;
      const fired = loadFired();
      let changed = false;
      for (const reminder of due) {
        if (fired[reminder.id]) continue;
        fired[reminder.id] = Date.now();
        changed = true;
        showSystemNotification(reminder.title, reminder.body, reminder.id, reminder.kind === "task" ? "tasks" : "").then(
          (shown) => {
            if (!shown) show({ id: reminder.id, message: reminder.title, description: reminder.body, duration: 15_000 });
          }
        );
      }
      if (changed) saveFired(fired);
    };

    check();
    const timer = setInterval(check, CHECK_INTERVAL_MS);
    const sub = AppState.addEventListener("change", (state) => state === "active" && check());
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [enabled]);

  return null;
}
