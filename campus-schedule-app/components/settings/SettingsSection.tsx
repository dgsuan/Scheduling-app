import { Pressable, View } from "react-native";

import { Checkbox } from "@/components/ui/checkbox";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

// Layout primitives for the Settings screen: a titled group of rows.

export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <View className="gap-3">
      <View className="gap-0.5 px-1">
        <Text role="heading" aria-level={2} className="font-display text-xl font-semibold">
          {title}
        </Text>
        {description ? <Text className="text-muted-foreground text-sm leading-5">{description}</Text> : null}
      </View>
      <View className="bg-card/80 border-border rounded-xl border">{children}</View>
    </View>
  );
}

export function SettingsRow({
  label,
  hint,
  children,
  stacked,
  last,
}: {
  label: string;
  hint?: string;
  children?: React.ReactNode;
  /** Put the control under the label (for wide controls). */
  stacked?: boolean;
  last?: boolean;
}) {
  return (
    <View
      className={cn(
        "gap-3 px-4 py-3.5",
        !last && "border-border/70 border-b",
        !stacked && "sm:flex-row sm:items-center sm:justify-between"
      )}
    >
      <View className={cn("gap-0.5", !stacked && "sm:flex-1")}>
        <Text className="text-[15px] font-medium">{label}</Text>
        {hint ? <Text className="text-muted-foreground text-[13px] leading-[18px]">{hint}</Text> : null}
      </View>
      {children ? <View className={cn(!stacked && "sm:items-end")}>{children}</View> : null}
    </View>
  );
}

export function SettingsToggleRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
  last,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  last?: boolean;
}) {
  return (
    <Pressable
      onPress={() => !disabled && onChange(!checked)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={label}
      className={cn(
        "flex-row items-start gap-3 px-4 py-3.5 web:transition-colors web:hover:bg-accent/40",
        !last && "border-border/70 border-b",
        disabled && "opacity-50"
      )}
    >
      <View className="pt-0.5" pointerEvents="none">
        <Checkbox checked={checked} onCheckedChange={onChange} className="size-5 rounded-md" />
      </View>
      <View className="flex-1 gap-0.5">
        <Text className="text-[15px] font-medium">{label}</Text>
        {hint ? <Text className="text-muted-foreground text-[13px] leading-[18px]">{hint}</Text> : null}
      </View>
    </Pressable>
  );
}
