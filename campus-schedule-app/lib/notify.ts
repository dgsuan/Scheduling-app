// Native builds don't include expo-notifications yet, so reminders show as
// in-app toasts while the app is open. The web version is notify.web.ts.

export type NotifyPermission = "granted" | "denied" | "default" | "unsupported";

export function notificationPermission(): NotifyPermission {
  return "unsupported";
}

export async function requestNotificationPermission(): Promise<NotifyPermission> {
  return "unsupported";
}

export async function showSystemNotification(_title: string, _body: string, _tag: string, _path?: string): Promise<boolean> {
  return false;
}
