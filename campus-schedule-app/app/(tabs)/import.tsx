import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { ComingSoonButton } from "@/components/ComingSoonButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useBreakpoint } from "@/lib/useBreakpoint";
import { cn } from "@/lib/utils";

// Import-from-LMS screen (e.g. UVLE). Mirrors the Calendar's export dialog,
// in reverse. No network request or parsing is implemented yet — see
// ARCHITECTURE.md roadmap item "LMS import".
const IMPORT_SCOPES = ["All events", "Events related to courses", "Events related to groups"] as const;

export default function ImportScreen() {
  const { desktop } = useBreakpoint();
  const [scope, setScope] = useState<string>(IMPORT_SCOPES[0]);
  const [sourceUrl, setSourceUrl] = useState("");

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName={cn("w-full max-w-[640px] self-center pb-16", desktop ? "px-10 pt-10" : "px-5 pt-6")}
    >
      <ScreenHeader
        title="Import"
        subtitle="Bring events in from your LMS by pasting its calendar link (e.g. UVLE's “Export calendar” URL)."
      />

      <View className="gap-2">
        <Text className="text-sm font-semibold">LMS calendar URL</Text>
        <Input
          placeholder="https://uvle.upd.edu.ph/calendar/export_execute.php?…"
          value={sourceUrl}
          onChangeText={setSourceUrl}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="LMS calendar URL"
        />
      </View>

      <View className="mt-6 gap-1">
        <Text className="mb-1 text-sm font-semibold">What to import</Text>
        <View role="radiogroup" aria-label="What to import">
          {IMPORT_SCOPES.map((o) => {
            const on = scope === o;
            return (
              <Pressable
                key={o}
                onPress={() => setScope(o)}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                className="flex-row items-center gap-3 rounded-md px-2 py-2 web:transition-colors web:hover:bg-accent active:bg-accent"
              >
                <View className={cn("size-4 items-center justify-center rounded-full border", on ? "border-primary" : "border-input")}>
                  {on ? <View className="bg-primary size-2 rounded-full" /> : null}
                </View>
                <Text className="text-sm">{o}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <ComingSoonButton label="Import" style={{ marginTop: 24 }} />
      <Text className="text-muted-foreground mt-4 text-center text-sm">Not connected to an LMS yet.</Text>
    </ScrollView>
  );
}
