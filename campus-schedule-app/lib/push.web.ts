import { getServiceWorkerRegistration } from "@/lib/pwa";
import { supabase } from "@/lib/supabase";

// Background reminders via web push: this device subscribes with the site's
// public VAPID key, and the "reminders" Edge Function sends due reminders
// from your synced data — so they arrive even when the app is closed.

const VAPID_PUBLIC_KEY = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY;
/** This device's push endpoint, while background reminders are on here. */
const ACTIVE_KEY = "campus-schedule-cache:push-endpoint";

export type PushSupport = "ok" | "no-key" | "unsupported";

export function pushSupport(): PushSupport {
  if (!VAPID_PUBLIC_KEY || !supabase) return "no-key";
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return "unsupported";
  }
  return "ok";
}

export function pushActiveHere(): boolean {
  try {
    return !!localStorage.getItem(ACTIVE_KEY);
  } catch {
    return false;
  }
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = (value + "=".repeat((4 - (value.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function enablePush(): Promise<void> {
  if (pushSupport() !== "ok" || !supabase) throw new Error("This browser can't receive background reminders.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Allow notifications for this site first, then try again.");
  const registration = await getServiceWorkerRegistration();
  if (!registration) throw new Error("Reload the app once so it can finish installing, then try again.");
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(VAPID_PUBLIC_KEY!) }));
  const json = subscription.toJSON();
  const { error } = await supabase.rpc("save_push_subscription", {
    p_endpoint: subscription.endpoint,
    p_p256dh: json.keys?.p256dh ?? "",
    p_auth: json.keys?.auth ?? "",
    p_tz_offset_min: -new Date().getTimezoneOffset(),
  });
  if (error) {
    await subscription.unsubscribe().catch(() => {});
    throw new Error(/check constraint|violates/i.test(error.message) ? "This browser's notification service isn't supported." : error.message);
  }
  try {
    localStorage.setItem(ACTIVE_KEY, subscription.endpoint);
  } catch {
    // Without storage the switch just shows as off after a reload.
  }
}

export async function disablePush(): Promise<void> {
  try {
    const registration = await getServiceWorkerRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      await supabase?.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
      await subscription.unsubscribe();
    }
  } finally {
    try {
      localStorage.removeItem(ACTIVE_KEY);
    } catch {
      // Nothing to clean up.
    }
  }
}
