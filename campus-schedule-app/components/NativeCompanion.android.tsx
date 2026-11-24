import { reconcileNativeNotifications } from "@/lib/reconcileNativeNotifications";
import React, { useEffect, useState } from "react";
import { AppState, DeviceEventEmitter } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { requestWidgetUpdate } from "react-native-android-widget";
import { router } from "expo-router";
import { useHabits, useSettings, useCourses, useTasks, useScheduleRules } from "@/context/store";
import { useAuth } from "@/context/auth";
import { useFocus } from "@/context/focus";
import { useToast } from "./Toaster";
import { emptyHabits } from "@/lib/habits";
import { planNativeReminders } from "@/lib/nativeReminders";
import { ensureNotificationChannel, refreshNotificationPermission } from "@/lib/notify.android";
import { HabitsWidget, WIDGET_CACHE } from "@/widgets/habits.android";

let queue = Promise.resolve();
let generation = 0;
export function NativeCompanion() {
  const { data, ready: habitsReady, habitError } = useHabits();
  const { settings, ready } = useSettings();
  const auth = useAuth();
  const { courses } = useCourses(); const { tasks } = useTasks(); const rules = useScheduleRules();
  const { session } = useFocus(); const { toast } = useToast();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const refresh = () => setTick(n => n + 1);
    const app = AppState.addEventListener("change", state => { if (state === "active") refresh(); });
    const permission = DeviceEventEmitter.addListener("isked-notification-permission", refresh);
    const timer = setInterval(refresh, 60000);
    return () => { app.remove(); permission.remove(); clearInterval(timer); };
  }, []);
  useEffect(() => {
    if (!ready || !auth.ready) return;
    const version = ++generation;
    const habits = habitsReady && !habitError ? data : emptyHabits();
    // Only scheduling/progress fields enter the widget cache, never private notes.
    const widgetData = { ...habits, cloud: undefined,
      habits: habits.habits.map(h => ({ ...h, notes: "", cue: undefined, routine: undefined })),
      logs: habits.logs.map(l => ({ ...l, reflection: undefined, mood: undefined })) };
    queue = queue.catch(() => {}).then(async () => {
      if (version !== generation) return;
      await AsyncStorage.setItem(WIDGET_CACHE, JSON.stringify(widgetData));
      // A launcher rendering failure must not prevent local notifications.
      await requestWidgetUpdate({ widgetName: "IskedHabits", renderWidget: info => <HabitsWidget data={widgetData} height={info.height} /> }).catch(() => {
        toast({ id: "widget-refresh-error", message: "Widget could not refresh", description: "Try removing and adding the widget again." });
      });
      const permission = await refreshNotificationPermission();
      await ensureNotificationChannel();
      const now = Date.now();
      const owner = auth.user?.id ?? "guest";
      const planned = settings.reminders.enabled && permission === "granted"
        ? planNativeReminders({ habits, courses, tasks, rules, classLeadMin: settings.reminders.classLeadMin, taskLeadMin: settings.reminders.taskLeadMin }, now)
        : [];
      const wanted = planned.map(r => ({ identifier: `isked:${owner}:${r.id}`, content: { title: r.title, body: r.body, data: { owner, path: r.kind === "habit" ? "habits" : r.kind === "task" ? "tasks" : "", habitId: r.habitId, fireAt: r.fireAt } }, trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(r.fireAt), channelId: "reminders" } }));
      if (settings.reminders.enabled && permission === "granted" && session?.startedAt && session.limitMs && !session.committing && (!session.habit || session.habit.owner === data.cloud?.ownerId && habitsReady)) {
        const at = Math.min(session.endAt ?? Infinity, session.startedAt + Math.max(0, session.limitMs - session.accumulatedMs));
        if (at > now + 1000) wanted.push({ identifier: `isked:${owner}:focus:${session.id}:${at}`, content: { title: session.phase === "break" ? "Break complete" : "Focus block complete", body: session.phase === "break" ? "Ready when you are." : "Nice work. Time for a break.", data: { owner, path: "habits", habitId: session.habit?.id, fireAt: at } }, trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at), channelId: "reminders" } });
      }
      await reconcileNativeNotifications(Notifications, wanted, () => version === generation);
    }).catch(() => { toast({ id: "native-reminders-error", message: "Could not refresh Android reminders or widget", description: "Open the app again to retry. Your habit progress is safe.", tone: "danger" }); });
  }, [ready, auth.ready, auth.user?.id, habitsReady, habitError, data, settings.reminders, courses, tasks, rules, session, tick, toast]);
  useEffect(() => {
    if (!ready || !auth.ready) return;
    let disposed = false;
    const open = (response: Notifications.NotificationResponse | null) => {
      const d = response?.notification.request.content.data;
      if (disposed || !d) return;
      if (d.owner && d.owner !== (auth.user?.id ?? "guest")) { void Notifications.clearLastNotificationResponseAsync(); return; }
      if (d.path === "habits") router.push(typeof d.habitId === "string" ? { pathname: "/habits", params: { habitId: d.habitId } } : "/habits");
      else if (d.path === "tasks") router.push("/tasks");
      else router.push("/");
      void Notifications.clearLastNotificationResponseAsync();
    };
    void Notifications.getLastNotificationResponseAsync().then(open);
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => { disposed = true; subscription.remove(); };
  }, [ready, auth.ready, auth.user?.id]);
  return null;
}
