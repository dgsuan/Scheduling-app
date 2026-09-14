import { router } from "expo-router";
import { Sparkles } from "lucide-react-native";
import { View } from "react-native";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { useCourses, useSettings, useTasks } from "@/context/store";
import { GUIDE_VERSION, WHATS_NEW } from "@/lib/guide";

// A one-time card on Home after an update (or on first use) pointing to the
// Guide. Dismissing it, or opening the Guide, hides it on every device.

const SEED_COURSE_ID = "seed-cmsc13";

export function WhatsNewBanner() {
  const { ready, settings, updateSettings } = useSettings();
  const { courses } = useCourses();
  const { tasks } = useTasks();
  if (!ready || (settings.seenGuideVersion ?? 0) >= GUIDE_VERSION) return null;

  const returning = courses.some((c) => c.id !== SEED_COURSE_ID) || tasks.length > 0;
  const dismiss = () => updateSettings({ seenGuideVersion: GUIDE_VERSION });

  return (
    <View className="border-primary/30 bg-primary/10 mb-6 flex-row flex-wrap items-center gap-3 rounded-xl border px-4 py-3">
      <Icon as={Sparkles} size={18} className="text-primary" />
      <View className="min-w-[200px] flex-1 gap-0.5">
        <Text className="text-[15px] font-semibold">{returning ? "New in this update" : "New here? Take the tour"}</Text>
        <Text className="text-muted-foreground text-[13px] leading-[18px]">
          {returning
            ? `${WHATS_NEW.length} new things, including heavy-day warnings, an enlistment planner and more for class sections.`
            : "A quick walkthrough of classes, tasks, notes and class sections."}
        </Text>
      </View>
      <View className="flex-row gap-2">
        <Button
          size="sm"
          onPress={() => {
            dismiss();
            router.navigate("/guide");
          }}
        >
          <Text>{returning ? "See what's new" : "Take the tour"}</Text>
        </Button>
        <Button size="sm" variant="ghost" onPress={dismiss}>
          <Text className="text-muted-foreground">Not now</Text>
        </Button>
      </View>
    </View>
  );
}
