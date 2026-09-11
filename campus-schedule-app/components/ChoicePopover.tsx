import type { TriggerRef } from "@rn-primitives/popover";
import { Check, type LucideIcon } from "lucide-react-native";
import { useRef } from "react";
import { Pressable, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

// Quiet single-choice menu: a ghost trigger showing the current value, a
// small list in a popover. Used by the task composer (priority, course).

export type Choice<T> = { value: T; label: string; color?: string; iconClassName?: string };

export function ChoicePopover<T>({
  value,
  options,
  onChange,
  icon,
  accessibilityLabel,
  triggerClassName,
}: {
  value: T;
  options: Choice<T>[];
  onChange: (value: T) => void;
  icon?: LucideIcon;
  accessibilityLabel: string;
  triggerClassName?: string;
}) {
  const trigger = useRef<TriggerRef>(null);
  const current = options.find((o) => o.value === value) ?? options[0];
  return (
    <Popover>
      <PopoverTrigger ref={trigger} asChild>
        <Button variant="ghost" size="sm" accessibilityLabel={`${accessibilityLabel}: ${current.label}`} className={triggerClassName}>
          {icon ? <Icon as={icon} size={14} className={current.iconClassName ?? "text-muted-foreground"} /> : null}
          {current.color ? <View className="size-2 rounded-full" style={{ backgroundColor: current.color }} /> : null}
          <Text className="text-muted-foreground">{current.label}</Text>
        </Button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-52 p-1">
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={String(o.value ?? "none")}
              onPress={() => {
                onChange(o.value);
                trigger.current?.close();
              }}
              accessibilityRole="menuitem"
              accessibilityState={{ selected: on }}
              className="flex-row items-center gap-2.5 rounded-md px-2.5 py-2 web:transition-colors web:hover:bg-accent active:bg-accent"
            >
              {icon ? <Icon as={icon} size={14} className={o.iconClassName ?? "text-muted-foreground"} /> : null}
              {o.color ? <View className="size-2 rounded-full" style={{ backgroundColor: o.color }} /> : null}
              <Text className={cn("flex-1 text-sm", on && "font-semibold")}>{o.label}</Text>
              {on ? <Icon as={Check} size={14} className="text-primary" /> : null}
            </Pressable>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
