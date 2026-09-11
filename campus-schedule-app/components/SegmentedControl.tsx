import type { LucideIcon } from "lucide-react-native";
import { View } from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

// Small pill-style single choice (exposed as a radio group).

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  accessibilityLabel,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; icon?: LucideIcon }[];
  accessibilityLabel?: string;
  className?: string;
}) {
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      className={cn("bg-muted flex-row rounded-lg p-[3px]", className)}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <PressableScale
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            className={cn(
              "flex-1 flex-row items-center justify-center gap-1.5 rounded-md px-3 py-1.5",
              on ? "bg-background shadow-sm shadow-black/10" : "web:hover:bg-background/60"
            )}
          >
            {o.icon ? (
              <Icon as={o.icon} size={14} className={on ? "text-primary" : "text-muted-foreground"} />
            ) : null}
            <Text className={cn("text-sm font-medium", !on && "text-muted-foreground")}>
              {o.label}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}
