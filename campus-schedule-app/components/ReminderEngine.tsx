import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";

import { useToast } from "@/components/Toaster";
import { useHabits, useCourses, useScheduleRules, useSettings, useTasks } from "@/context/store";
import { showSystemNotification } from "@/lib/notify";
import { pushActiveHere } from "@/lib/push";
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
  const { data: habits, changeHabits } = useHabits();
  const rules = useScheduleRules();
  const { toast } = useToast();

  const latest = useRef({ settings, courses, tasks, rules, toast, habits, changeHabits });
  latest.current = { settings, courses, tasks, rules, toast, habits, changeHabits };

  const enabled = settings.reminders.enabled;
  useEffect(() => {
    if (!enabled) return;
    const check = () => {
      const { settings: s, courses: c, tasks: t, rules: r, toast: show } = latest.current;
      const due = dueReminders({
        now: new Date(),
        habits: latest.current.habits,
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
        if (reminder.kind === "habit") {
          const owner = latest.current.habits.cloud?.ownerId;
          const habit = latest.current.habits.habits.find(h => h.id === reminder.habitId);
          const inApp = Platform.OS !== "web" || document.visibilityState === "visible";
          if (inApp) show({ id: reminder.id, message: habit && /water|drink/i.test(habit.title) ? "Time for a water break?" : "A small habit check-in?",
            description: habit?.title ?? reminder.body, duration: 15000, actionLabel: "Snooze 15 min", onAction: () => {
              if (latest.current.habits.cloud?.ownerId !== owner) return;
              void latest.current.changeHabits(d => ({ ...d, habits: d.habits.map(h => h.id === reminder.habitId ? { ...h, reminderSnoozedUntil: Date.now() + 15 * 60000 } : h) }));
            } });
          else void showSystemNotification(reminder.title, reminder.body, reminder.id, "habits");
          continue;
        }
        if (pushActiveHere()) {
          // The server sends the system notification; only show it in-app while the app is in view.
          if (Platform.OS !== "web" || document.visibilityState === "visible") {
            show({ id: reminder.id, message: reminder.title, description: reminder.body, duration: 15_000 });
          }
          continue;
        }
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
