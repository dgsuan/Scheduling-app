import type { TriggerRef } from "@rn-primitives/popover";
import { Clock } from "lucide-react-native";
import { useRef } from "react";
import { View } from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Text } from "@/components/ui/text";
import { display12h, parse12h, to12h, type Period } from "@/lib/schedule";
import { cn } from "@/lib/utils";

// Tap-only 12-hour time picker: presets, an hour grid, a minute grid and
// AM/PM. Reads/writes the app's stored 24h "HH:MM" format.

const PRESETS = ["09:00", "12:00", "17:00", "23:59"];
const HOURS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
const DEFAULT_PARTS = { hour: 12, minute: 0, period: "PM" as Period };

const pad2 = (n: number) => String(n).padStart(2, "0");

function GridButton({
  label,
  selected,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <View className="w-1/6 p-0.5">
      <PressableScale
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ selected }}
        className={cn(
          "h-8 items-center justify-center rounded-md web:hover:bg-accent",
          selected && "bg-primary web:hover:bg-primary"
        )}
      >
        <Text className={cn("text-sm", selected && "text-primary-foreground font-semibold")}>
          {label}
        </Text>
      </PressableScale>
    </View>
  );
}

export function TimePickerField({
  value,
  onChange,
  placeholder = "Add time",
  accessibilityLabel,
}: {
  value?: string;
  onChange: (v24: string | undefined) => void;
  placeholder?: string;
  accessibilityLabel?: string;
}) {
  const trigger = useRef<TriggerRef>(null);
  const parts = (value && to12h(value)) || DEFAULT_PARTS;

  const set = (next: Partial<typeof parts>) => {
    const p = { ...parts, ...next };
    onChange(parse12h(`${p.hour}:${pad2(p.minute)}`, p.period) ?? undefined);
  };

  return (
    <Popover>
      <PopoverTrigger ref={trigger} asChild>
        <Button variant="outline" size="sm" className="justify-start" accessibilityLabel={accessibilityLabel}>
          <Icon as={Clock} size={14} className="text-muted-foreground" />
          <Text className={cn(!value && "text-muted-foreground")}>
            {value ? display12h(value) : placeholder}
          </Text>
        </Button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-72 gap-3 p-3">
        <View className="flex-row flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <PressableScale
              key={p}
              onPress={() => {
                onChange(p);
                trigger.current?.close();
              }}
              className={cn(
                "rounded-full border border-border px-2.5 py-1 web:hover:bg-accent",
                value === p && "border-primary bg-primary/10"
              )}
            >
              <Text className="text-xs font-medium">{display12h(p)}</Text>
            </PressableScale>
          ))}
        </View>

        <View>
          <Text className="text-muted-foreground mb-1 text-xs font-medium">Hour</Text>
          <View className="flex-row flex-wrap">
            {HOURS.map((h) => (
              <GridButton
                key={h}
                label={String(h)}
                accessibilityLabel={`${h} o'clock`}
                selected={!!value && parts.hour === h}
                onPress={() => set({ hour: h })}
              />
            ))}
          </View>
        </View>

        <View>
          <Text className="text-muted-foreground mb-1 text-xs font-medium">Minute</Text>
          <View className="flex-row flex-wrap">
            {MINUTES.map((m) => (
              <GridButton
                key={m}
                label={`:${pad2(m)}`}
                accessibilityLabel={`${m} minutes`}
                selected={!!value && parts.minute === m}
                onPress={() => set({ minute: m })}
              />
            ))}
          </View>
        </View>

        <View className="flex-row items-center justify-between gap-2">
          <SegmentedControl
            value={parts.period}
            onChange={(period) => set({ period })}
            options={[
              { value: "AM", label: "AM" },
              { value: "PM", label: "PM" },
            ]}
            accessibilityLabel="AM or PM"
          />
          <View className="flex-row gap-1">
            {value ? (
              <Button
                variant="ghost"
                size="sm"
                onPress={() => {
                  onChange(undefined);
                  trigger.current?.close();
                }}
              >
                <Text>Clear</Text>
              </Button>
            ) : null}
            <Button size="sm" onPress={() => trigger.current?.close()}>
              <Text>Done</Text>
            </Button>
          </View>
        </View>
      </PopoverContent>
    </Popover>
  );
}
