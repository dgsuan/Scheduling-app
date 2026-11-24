import * as Notifications from "expo-notifications";
import { AppState, DeviceEventEmitter } from "react-native";
export type NotifyPermission = "granted" | "denied" | "default" | "unsupported";
let permission: NotifyPermission = "default";
export const notificationPermission = () => permission;
export async function refreshNotificationPermission(): Promise<NotifyPermission> {
  const p = await Notifications.getPermissionsAsync();
  permission = p.granted ? "granted" : p.canAskAgain ? "default" : "denied";
  return permission;
}
export async function ensureNotificationChannel() {
  await Notifications.setNotificationChannelAsync("reminders", { name: "Habit and schedule reminders", importance: Notifications.AndroidImportance.DEFAULT });
}
Notifications.setNotificationHandler({ handleNotification: async notification => {
  const show = AppState.currentState !== "active" || notification.request.content.data?.test === true;
  return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: false };
} });
export async function requestNotificationPermission(): Promise<NotifyPermission> {
  await ensureNotificationChannel();
  await Notifications.requestPermissionsAsync();
  const result = await refreshNotificationPermission();
  DeviceEventEmitter.emit("isked-notification-permission");
  return result;
}
export async function showSystemNotification(title: string, body: string, tag: string, path = ""): Promise<boolean> {
  try {
    if (await refreshNotificationPermission() !== "granted") return false;
    await ensureNotificationChannel();
    await Notifications.scheduleNotificationAsync({ identifier: tag, content: { title, body, data: { path, test: tag === "test" } }, trigger: null });
    return true;
  } catch { return false; }
}
