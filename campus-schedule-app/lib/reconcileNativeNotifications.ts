import type { NotificationRequestInput } from "expo-notifications";
type API = Pick<typeof import("expo-notifications"), "getAllScheduledNotificationsAsync" | "cancelScheduledNotificationAsync" | "scheduleNotificationAsync">;
/** Reconcile only Isked-owned requests. Disabling reminders supplies an empty list. */
export async function reconcileNativeNotifications(api: API, wanted: NotificationRequestInput[], current: () => boolean = () => true) {
  const existing = await api.getAllScheduledNotificationsAsync();
  if (!current()) return;
  const ids = new Set(wanted.map(n => n.identifier));
  for (const old of existing) {
    if (!current()) return;
    if (old.identifier.startsWith("isked:") && !ids.has(old.identifier)) await api.cancelScheduledNotificationAsync(old.identifier);
  }
  for (const next of wanted) {
    if (!current()) return;
    const old = existing.find(n => n.identifier === next.identifier);
    if (!old || JSON.stringify(old.content.data) !== JSON.stringify(next.content.data) || old.content.title !== next.content.title || old.content.body !== next.content.body) await api.scheduleNotificationAsync(next);
  }
}
