import type { TriggerRef } from "@rn-primitives/popover";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react-native";
import { useRef, useState } from "react";
import { View } from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Text } from "@/components/ui/text";
import {
  MONTH_NAMES,
  WEEKDAY_INITIALS,
  buildMonthCells,
  formatShortDate,
  isoToDate,
} from "@/lib/calendar";
import { todayIso } from "@/lib/tasks";
import { cn } from "@/lib/utils";

// Button that opens a compact month calendar in a popover.

export function MiniCalendar({
  value,
  onChange,
}: {
  value?: string;
  onChange: (iso: string) => void;
}) {
  const initial = value ? isoToDate(value) : new Date();
  const [year, setYear] = useState(initial.getFullYear());
  const [month, setMonth] = useState(initial.getMonth());
  const today = todayIso();

  const shift = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  };

  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between">
        <Button variant="ghost" size="icon" className="h-8 w-8" onPress={() => shift(-1)} accessibilityLabel="Previous month">
          <Icon as={ChevronLeft} size={16} />
        </Button>
        <Text className="text-sm font-semibold">
          {MONTH_NAMES[month]} {year}
        </Text>
        <Button variant="ghost" size="icon" className="h-8 w-8" onPress={() => shift(1)} accessibilityLabel="Next month">
          <Icon as={ChevronRight} size={16} />
        </Button>
      </View>
      <View className="flex-row">
        {WEEKDAY_INITIALS.map((d, i) => (
          <Text key={i} className="text-muted-foreground w-[14.28%] text-center text-xs font-medium">
            {d}
          </Text>
        ))}
      </View>
      <View className="flex-row flex-wrap">
        {buildMonthCells(year, month).map((cell, i) =>
          cell ? (
            <View key={cell.iso} className="aspect-square w-[14.28%] p-0.5">
              <PressableScale
                onPress={() => onChange(cell.iso)}
                accessibilityRole="button"
                accessibilityLabel={cell.iso}
                accessibilityState={{ selected: cell.iso === value }}
                className={cn(
                  "flex-1 items-center justify-center rounded-md web:hover:bg-accent",
                  cell.iso === today && "border border-primary/50",
                  cell.iso === value && "bg-primary web:hover:bg-primary"
                )}
              >
                <Text
                  className={cn(
                    "text-sm",
                    cell.iso === value && "text-primary-foreground font-semibold"
                  )}
                >
                  {cell.day}
                </Text>
              </PressableScale>
            </View>
          ) : (
            <View key={`b-${i}`} className="aspect-square w-[14.28%]" />
          )
        )}
      </View>
    </View>
  );
}

export function DatePickerField({
  value,
  onChange,
  placeholder = "Pick a date",
  accessibilityLabel,
}: {
  value?: string;
  onChange: (iso: string) => void;
  placeholder?: string;
  accessibilityLabel?: string;
}) {
  const trigger = useRef<TriggerRef>(null);
  return (
    <Popover>
      <PopoverTrigger ref={trigger} asChild>
        <Button variant="outline" size="sm" className="justify-start" accessibilityLabel={accessibilityLabel}>
          <Icon as={CalendarDays} size={14} className="text-muted-foreground" />
          <Text className={cn(!value && "text-muted-foreground")}>
            {value ? formatShortDate(value) : placeholder}
          </Text>
        </Button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-72 p-3">
        <MiniCalendar
          value={value}
          onChange={(iso) => {
            onChange(iso);
            trigger.current?.close();
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
