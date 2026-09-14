import { router } from "expo-router";
import { CloudCheck, CloudOff, CloudUpload, RefreshCw, TriangleAlert, type LucideIcon } from "lucide-react-native";
import { Pressable } from "react-native";

import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { useSyncState } from "@/lib/sync";

// One quiet line in the sidebar saying whether this device is in step with
// the account. Taps through to Settings for details.

export function SyncBadge() {
  const sync = useSyncState();
  if (sync.phase === "off") return null;

  const offline = sync.phase === "error" && !!sync.error?.startsWith("You're offline");
  const view: { icon: LucideIcon; text: string; tone: string } =
    sync.phase === "error"
      ? offline
        ? { icon: CloudOff, text: sync.waiting ? "Offline · changes waiting" : "Offline", tone: "text-muted-foreground" }
        : { icon: TriangleAlert, text: "Sync problem", tone: "text-warning" }
      : sync.phase === "choice"
        ? { icon: TriangleAlert, text: "Choose what to keep", tone: "text-warning" }
        : sync.phase === "syncing" || sync.phase === "connecting"
          ? { icon: RefreshCw, text: "Syncing…", tone: "text-muted-foreground" }
          : sync.waiting
            ? { icon: CloudUpload, text: "Changes waiting to sync", tone: "text-muted-foreground" }
            : { icon: CloudCheck, text: "Synced", tone: "text-success" };

  return (
    <Pressable
      onPress={() => router.navigate("/settings")}
      accessibilityRole="button"
      accessibilityLabel={`${view.text}. Open sync settings`}
      className="mb-2 flex-row items-center gap-2 rounded-lg px-3 py-1.5 web:transition-colors web:hover:bg-accent/60"
    >
      <Icon as={view.icon} size={14} className={view.tone} />
      <Text className="text-muted-foreground text-xs" role="status" aria-live="polite">
        {view.text}
      </Text>
    </Pressable>
  );
}
