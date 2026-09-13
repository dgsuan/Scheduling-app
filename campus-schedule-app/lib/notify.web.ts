import { getServiceWorkerRegistration } from "@/lib/pwa";

// System notifications on the web. Permission is only requested when the
// user turns reminders on. Android Chrome requires notifications to go
// through the service worker, so that path is tried first.

export type NotifyPermission = "granted" | "denied" | "default" | "unsupported";

export function notificationPermission(): NotifyPermission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission as NotifyPermission;
}

export async function requestNotificationPermission(): Promise<NotifyPermission> {
  if (notificationPermission() === "unsupported") return "unsupported";
  try {
    return (await Notification.requestPermission()) as NotifyPermission;
  } catch {
    return notificationPermission();
  }
}

function iconUrl(): string | undefined {
  const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  return manifest ? new URL("icons/icon-192.png", manifest.href).href : undefined;
}

/** Show a system notification. Resolves false if it couldn't be shown. */
export async function showSystemNotification(title: string, body: string, tag: string, path = ""): Promise<boolean> {
  if (notificationPermission() !== "granted") return false;
  const options: NotificationOptions = { body, tag, icon: iconUrl(), data: { path } };
  try {
    const reg = await getServiceWorkerRegistration();
    if (reg) {
      await reg.showNotification(title, options);
      return true;
    }
  } catch {
    // Fall through to the page-level API.
  }
  try {
    const n = new Notification(title, options);
    n.onclick = () => {
      window.focus();
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}
