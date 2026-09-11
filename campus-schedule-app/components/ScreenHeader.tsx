import { View } from "react-native";

import { Text } from "@/components/ui/text";
import { ThemeToggle } from "@/context/theme";
import { useBreakpoint } from "@/lib/useBreakpoint";
import { cn } from "@/lib/utils";

// Page title block shared by every tab. Wide screens: actions sit beside
// the title (the theme toggle lives in the sidebar). Narrow screens: a
// smaller title with the toggle top-right and actions on their own row,
// so long titles never wrap into the buttons.

export function ScreenHeader({
  title,
  eyebrow,
  subtitle,
  right,
}: {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  const { wide } = useBreakpoint();
  return (
    <View className="mb-6 gap-3">
      <View className={cn("flex-row justify-between gap-4", wide ? "items-end" : "items-start")}>
        <View className="flex-1 gap-1">
          {eyebrow ? (
            <Text className="text-muted-foreground text-[13px] font-medium">{eyebrow}</Text>
          ) : null}
          <Text
            role="heading"
            aria-level={1}
            className={cn("font-display font-semibold", wide ? "text-[30px] leading-9" : "text-[26px] leading-8")}
          >
            {title}
          </Text>
          {subtitle ? <Text className="text-muted-foreground text-sm leading-5">{subtitle}</Text> : null}
        </View>
        {wide ? (
          right ? <View className="flex-row items-center gap-1">{right}</View> : null
        ) : (
          <ThemeToggle />
        )}
      </View>
      {!wide && right ? <View className="-ml-2 flex-row flex-wrap items-center gap-1">{right}</View> : null}
    </View>
  );
}
