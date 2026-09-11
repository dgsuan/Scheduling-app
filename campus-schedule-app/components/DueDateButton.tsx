import type { TriggerRef } from "@rn-primitives/popover";
import { CalendarDays } from "lucide-react-native";
import { useRef } from "react";
import { Pressable, View } from "react-native";

import { MiniCalendar } from "@/components/DatePickerField";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Text } from "@/components/ui/text";
import { addDaysIso } from "@/lib/calendar";
import { friendlyDue, todayIso } from "@/lib/tasks";
import { cn } from "@/lib/utils";

// Due-date menu for the task composer: the common picks one tap away,
// a month calendar underneath for anything else.

export function DueDateButton({
  value,
  onChange,
}: {
  value?: string;
  onChange: (iso: string | undefined) => void;
}) {
  const trigger = useRef<TriggerRef>(null);
  const today = todayIso();
  const quick: { label: string; iso: string | undefined }[] = [
    { label: "Today", iso: today },
    { label: "Tomorrow", iso: addDaysIso(today, 1) },
    { label: "Next week", iso: addDaysIso(today, 7) },
    { label: "No date", iso: undefined },
  ];
  const pick = (iso: string | undefined) => {
    onChange(iso);
    trigger.current?.close();
  };

  return (
    <Popover>
      <PopoverTrigger ref={trigger} asChild>
        <Button variant="ghost" size="sm" accessibilityLabel={`Due date: ${friendlyDue(value)}`}>
          <Icon as={CalendarDays} size={14} className={value ? "text-primary" : "text-muted-foreground"} />
          <Text className={cn(value ? "text-foreground" : "text-muted-foreground")}>{friendlyDue(value)}</Text>
        </Button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-72 p-2">
        <View className="flex-row flex-wrap gap-1.5 p-1">
          {quick.map((q) => (
            <Pressable
              key={q.label}
              onPress={() => pick(q.iso)}
              accessibilityRole="button"
              className={cn(
                "rounded-full border border-border px-3 py-1 web:transition-colors web:hover:bg-accent active:bg-accent",
                value === q.iso && "border-primary bg-primary/10"
              )}
            >
              <Text className="text-xs font-medium">{q.label}</Text>
            </Pressable>
          ))}
        </View>
        <Separator className="my-2" />
        <View className="px-1">
          <MiniCalendar value={value} onChange={pick} />
        </View>
      </PopoverContent>
    </Popover>
  );
}
