import { router } from "expo-router";
import { ArrowLeft, ChevronDown, Sparkles } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { ScreenHeader } from "@/components/ScreenHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { useSettings } from "@/context/store";
import { GUIDE_SECTIONS, GUIDE_VERSION, WHATS_NEW } from "@/lib/guide";
import { useBreakpoint } from "@/lib/useBreakpoint";
import { cn } from "@/lib/utils";

// The in-app guide: what's new in this update (each with a "Show me" link),
// then short how-tos for every part of the app.

export default function GuideScreen() {
  const { desktop } = useBreakpoint();
  const { ready, settings, updateSettings } = useSettings();
  const [open, setOpen] = useState<string | null>(GUIDE_SECTIONS[0].id);

  // Opening the guide counts as having seen this update's banner.
  useEffect(() => {
    if (ready && (settings.seenGuideVersion ?? 0) < GUIDE_VERSION) updateSettings({ seenGuideVersion: GUIDE_VERSION });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const go = (href: string) => router.navigate(href as never);

  return (
    <ScrollView
      className="bg-background flex-1"
      contentContainerClassName={cn("w-full max-w-[760px] gap-8 self-center pb-24", desktop ? "px-10 pt-8" : "px-5 pt-6")}
    >
      <View>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 mb-2 self-start"
          onPress={() => (router.canGoBack() ? router.back() : router.navigate("/"))}
        >
          <Icon as={ArrowLeft} size={15} className="text-muted-foreground" />
          <Text className="text-muted-foreground">Back</Text>
        </Button>
        <ScreenHeader title="Guide" subtitle="How everything fits together, and what's new in this update." />
      </View>

      <View className="gap-3">
        <View className="flex-row items-center gap-2 px-1">
          <Icon as={Sparkles} size={16} className="text-primary" />
          <Text role="heading" aria-level={2} className="text-[15px] font-semibold">
            New in this update
          </Text>
        </View>
        <View className="bg-card/80 border-border rounded-xl border">
          {WHATS_NEW.map((item, i) => (
            <View key={item.title} className={cn("flex-row flex-wrap items-center gap-3 px-4 py-3", i > 0 && "border-border/60 border-t")}>
              <View className="min-w-[200px] flex-1 gap-0.5">
                <Text className="text-[15px] font-medium">{item.title}</Text>
                <Text className="text-muted-foreground text-[13px] leading-[18px]">{item.body}</Text>
                <Text className="text-primary text-xs">{item.where}</Text>
              </View>
              {item.href ? (
                <Button size="sm" variant="outline" onPress={() => go(item.href!)} accessibilityLabel={`Show me: ${item.title}`}>
                  <Text>Show me</Text>
                </Button>
              ) : null}
            </View>
          ))}
        </View>
      </View>

      <View className="gap-3">
        <Text role="heading" aria-level={2} className="px-1 text-[15px] font-semibold">
          How it works
        </Text>
        {GUIDE_SECTIONS.map((section) => {
          const expanded = open === section.id;
          const newCount = section.steps.filter((s) => s.isNew).length;
          return (
            <View key={section.id} className="bg-card/80 border-border overflow-hidden rounded-xl border">
              <Pressable
                onPress={() => setOpen(expanded ? null : section.id)}
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                className="flex-row items-center gap-3 px-4 py-3.5 web:transition-colors web:hover:bg-accent/40"
              >
                <View className="flex-1 gap-0.5">
                  <View className="flex-row flex-wrap items-center gap-2">
                    <Text className="text-[15px] font-semibold">{section.title}</Text>
                    {newCount ? (
                      <Badge variant="secondary">
                        <Text>{newCount} new</Text>
                      </Badge>
                    ) : null}
                  </View>
                  <Text className="text-muted-foreground text-[13px] leading-[18px]">{section.summary}</Text>
                </View>
                <View style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }}>
                  <Icon as={ChevronDown} size={16} className="text-muted-foreground" />
                </View>
              </Pressable>
              {expanded ? (
                <View className="border-border/60 gap-3 border-t px-4 py-3.5">
                  {section.steps.map((step, i) => (
                    <View key={step.title} className="flex-row gap-3">
                      <Text className="text-muted-foreground w-5 text-right text-sm leading-5 tabular-nums">
                        {section.ordered ? `${i + 1}.` : "•"}
                      </Text>
                      <Text className="flex-1 text-sm leading-5">
                        <Text className="text-sm font-semibold">{step.title}</Text>
                        {step.isNew ? <Text className="text-primary text-xs font-semibold">{"  NEW"}</Text> : null}
                        {step.body ? <Text className="text-sm">{`\n${step.body}`}</Text> : null}
                      </Text>
                    </View>
                  ))}
                  {section.link ? (
                    <Button size="sm" variant="outline" className="self-start" onPress={() => go(section.link!.href)}>
                      <Text>{section.link.label}</Text>
                    </Button>
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}
