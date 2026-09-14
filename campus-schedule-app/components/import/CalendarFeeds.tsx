import { RefreshCw, TriangleAlert } from "lucide-react-native";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { useToast } from "@/components/Toaster";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useAuth } from "@/context/auth";
import { addFeed, describeFeedUrl, listFeeds, removeFeed, type CalendarFeed } from "@/lib/cloud";
import { isSupabaseConfigured } from "@/lib/supabase";
import { relativeTime } from "@/lib/sync";

// Calendar links the server checks every half hour, adding new and changed
// deadlines to your synced tasks — no need to re-import by hand. The link
// stays private to your account.

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function CalendarFeeds() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [feeds, setFeeds] = useState<CalendarFeed[] | null>(null);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userId = user?.id;

  const load = async () => {
    try {
      setFeeds(await listFeeds());
    } catch (e) {
      setFeeds([]);
      setError(message(e));
    }
  };
  useEffect(() => {
    if (userId) void load();
    else setFeeds(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (!isSupabaseConfigured) return null;

  const add = async () => {
    if (!userId) return;
    setBusy(true);
    setError(null);
    try {
      await addFeed(userId, url, label);
      setUrl("");
      setLabel("");
      await load();
      toast({ message: "Calendar link saved", description: "New deadlines will show up in Tasks within about half an hour." });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="bg-card/80 border-border mt-4 gap-3 rounded-xl border p-4">
      <View className="flex-row items-center gap-2">
        <Icon as={RefreshCw} size={16} className="text-primary" />
        <Text className="text-[15px] font-semibold">Keep a calendar link in sync</Text>
      </View>
      <Text className="text-muted-foreground text-sm leading-5">
        Save your UVLE calendar link once, and new or changed deadlines are added to your tasks automatically, even when the app is
        closed. In UVLE: Calendar → Export calendar → Get calendar URL.
      </Text>

      {!userId ? (
        <Text className="text-sm">Sign in under Settings → Account & sync to use this.</Text>
      ) : (
        <>
          {feeds?.map((f) => (
            <View key={f.id} className="border-border/70 flex-row flex-wrap items-center gap-3 border-t pt-3">
              <View className="min-w-[180px] flex-1 gap-0.5">
                <Text className="text-sm font-medium">{f.label || describeFeedUrl(f.url)}</Text>
                <Text className={f.lastStatus === "error" ? "text-destructive text-xs leading-4" : "text-muted-foreground text-xs leading-4"}>
                  {f.lastStatus === "error"
                    ? `Last check failed: ${f.lastError ?? "unknown error"}`
                    : f.lastCheckedAt
                      ? `Checked ${relativeTime(Date.parse(f.lastCheckedAt))}${f.importedCount ? ` · ${f.importedCount} added or updated` : ""}`
                      : "Waiting for the first check"}
                </Text>
              </View>
              <Button
                size="sm"
                variant="ghost"
                onPress={async () => {
                  try {
                    await removeFeed(f.id);
                    await load();
                  } catch (e) {
                    setError(message(e));
                  }
                }}
              >
                <Text className="text-muted-foreground">Remove</Text>
              </Button>
            </View>
          ))}
          <Input
            value={url}
            onChangeText={setUrl}
            placeholder="webcal://uvle.upd.edu.ph/calendar/export_execute.php?…"
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Calendar link to keep in sync"
          />
          <View className="flex-row flex-wrap items-center gap-2">
            <Input
              value={label}
              onChangeText={setLabel}
              placeholder="Name (optional), e.g. UVLE"
              maxLength={80}
              accessibilityLabel="Calendar link name"
              className="min-w-[180px] flex-1"
            />
            <Button onPress={add} disabled={busy || !url.trim()}>
              <Text>{busy ? "Saving…" : "Keep in sync"}</Text>
            </Button>
          </View>
          <Text className="text-muted-foreground text-xs leading-4">The link is stored privately in your account. Up to 3 links.</Text>
        </>
      )}
      {error ? (
        <View className="flex-row gap-2" role="alert">
          <Icon as={TriangleAlert} size={14} className="text-destructive mt-0.5" />
          <Text className="flex-1 text-sm leading-5">{error}</Text>
        </View>
      ) : null}
    </View>
  );
}
