import { BellRing, TriangleAlert } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { AppState, View } from "react-native";

import { SegmentedControl } from "@/components/SegmentedControl";
import { SettingsRow, SettingsSection, SettingsToggleRow } from "@/components/settings/SettingsSection";
import { useToast } from "@/components/Toaster";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { useAuth } from "@/context/auth";
import { useSettings } from "@/context/store";
import { disablePush, enablePush, pushActiveHere, pushSupport } from "@/lib/push";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  notificationPermission,
  requestNotificationPermission,
  showSystemNotification,
  type NotifyPermission,
} from "@/lib/notify";
import { formatLead } from "@/lib/reminders";

const CLASS_LEADS = [5, 10, 15, 30];
const TASK_LEADS = [15, 30, 60, 180, 1440];

function usePermission() {
  const [permission, setPermission] = useState<NotifyPermission>(notificationPermission);
  const refresh = useCallback(() => setPermission(notificationPermission()), []);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => s === "active" && refresh());
    return () => sub.remove();
  }, [refresh]);
  return { permission, setPermission, refresh };
}

/** Reminders that arrive even when the app is closed (web push from the server). */
function BackgroundReminders() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [active, setActive] = useState(pushActiveHere);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!isSupabaseConfigured) return null;
  const support = pushSupport();

  const hint = !user
    ? "Sign in under Account & sync to get reminders on this device even when the app is closed."
    : support === "no-key"
      ? "Not set up for this site yet."
      : support === "unsupported"
        ? "This browser can't get notifications while the app is closed. On iPhone, add the app to your Home Screen first."
        : active
          ? "On for this device. Reminders come from your synced courses and tasks, so changes made on any device count."
          : "Uses your synced courses and tasks, so reminders arrive even when every tab is closed.";

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      if (active) await disablePush();
      else await enablePush();
      setActive(pushActiveHere());
      toast({ message: active ? "Background reminders are off on this device" : "Background reminders are on for this device" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsRow label="Remind me when the app is closed" hint={hint}>
      <View className="items-start gap-1 sm:items-end">
        <Button size="sm" variant={active ? "outline" : "default"} onPress={toggle} disabled={busy || !user || support !== "ok"}>
          <Text>{busy ? "Working…" : active ? "Turn off" : "Turn on"}</Text>
        </Button>
        {error ? (
          <Text className="text-destructive max-w-xs text-xs leading-4" role="alert">
            {error}
          </Text>
        ) : null}
      </View>
    </SettingsRow>
  );
}

export function RemindersSection() {
  const { settings, updateSettings } = useSettings();
  const r = settings.reminders;
  const { permission, setPermission, refresh } = usePermission();
  const { toast } = useToast();

  const setReminders = (patch: Partial<typeof r>) => updateSettings({ reminders: { ...r, ...patch } });

  const toggle = async (enabled: boolean) => {
    setReminders({ enabled });
    // Ask for permission only in response to turning reminders on.
    if (enabled && notificationPermission() === "default") setPermission(await requestNotificationPermission());
  };

  const test = async () => {
    const shown = await showSystemNotification("Reminders are working", "This is how a class or task reminder will look.", "test");
    if (!shown) toast({ message: "Reminders are working", description: "This is how an in-app reminder will look." });
  };

  const status =
    permission === "granted"
      ? { tone: "ok" as const, text: "System notifications are allowed." }
      : permission === "denied"
        ? {
            tone: "warn" as const,
            text: "Notifications are blocked for this site, so reminders will appear inside the app instead. To get system notifications, allow them in your browser's site settings, then check again.",
          }
        : permission === "unsupported"
          ? { tone: "warn" as const, text: "System notifications aren't available here, so reminders will appear inside the app." }
          : { tone: "warn" as const, text: "Allow notifications to get reminders even while you're in another tab." };

  return (
    <SettingsSection
      title="Reminders"
      description="Heads-ups before classes and deadlines. Cancelled classes, holidays and days outside the term are skipped."
    >
      <SettingsToggleRow
        label="Remind me"
        hint="Works while this app is open (in a tab or installed window). Without a server, a closed app can't be notified."
        checked={r.enabled}
        onChange={toggle}
      />

      {r.enabled ? (
        <>
          <View className="border-border/70 gap-2 border-b px-4 py-3" role={status.tone === "warn" ? "alert" : undefined}>
            <View className="flex-row items-start gap-2.5">
              <Icon
                as={status.tone === "ok" ? BellRing : TriangleAlert}
                size={16}
                className={status.tone === "ok" ? "text-success mt-0.5" : "text-warning mt-0.5"}
              />
              <Text className="flex-1 text-sm leading-5">{status.text}</Text>
            </View>
            <View className="flex-row flex-wrap gap-2 pl-6">
              {permission === "default" ? (
                <Button size="sm" onPress={async () => setPermission(await requestNotificationPermission())}>
                  <Text>Allow notifications</Text>
                </Button>
              ) : null}
              {permission === "denied" ? (
                <Button size="sm" variant="outline" onPress={refresh}>
                  <Text>Check again</Text>
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onPress={test}>
                <Text>Send a test reminder</Text>
              </Button>
            </View>
          </View>

          <BackgroundReminders />
          <SettingsRow label="Before a class">
            <SegmentedControl<string>
              value={String(r.classLeadMin)}
              onChange={(v) => setReminders({ classLeadMin: Number(v) })}
              options={CLASS_LEADS.map((m) => ({ value: String(m), label: `${m} min` }))}
              accessibilityLabel="Minutes before a class"
            />
          </SettingsRow>
          <SettingsRow label="Before a task is due" hint="Tasks without a time are reminded at 8:00 AM on the due day." last stacked>
            <SegmentedControl<string>
              value={String(r.taskLeadMin)}
              onChange={(v) => setReminders({ taskLeadMin: Number(v) })}
              options={TASK_LEADS.map((m) => ({ value: String(m), label: m < 60 ? `${m} min` : formatLead(m).replace(" hours", " hr").replace(" hour", " hr") }))}
              accessibilityLabel="Time before a task is due"
            />
          </SettingsRow>
        </>
      ) : null}
    </SettingsSection>
  );
}
