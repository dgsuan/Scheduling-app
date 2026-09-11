import { View } from "react-native";

import { colors } from "@/constants/theme";
import type { AgendaItem } from "@/lib/calendar";
import { cn } from "@/lib/utils";

// Tiny shape per item kind so the month grid stays calm and color is
// never the only cue: class ● (course color), event ▬, task ▢, note ○,
// holiday ◆.

export function KindMark({ item, className }: { item: AgendaItem; className?: string }) {
  switch (item.kind) {
    case "class":
      return <View className={cn("size-1.5 rounded-full", className)} style={{ backgroundColor: item.occ.course.color }} />;
    case "event":
      return <View className={cn("bg-primary h-[3px] w-2 rounded-full", className)} />;
    case "task":
      return (
        <View
          className={cn(
            "size-[7px] rounded-[2px] border border-foreground/70",
            item.task.done && "bg-muted-foreground border-muted-foreground",
            className
          )}
        />
      );
    case "note":
      return <View className={cn("size-[7px] rounded-full border border-muted-foreground", className)} />;
    case "holiday":
      return (
        <View
          className={cn("size-[6px] rotate-45", className)}
          style={{
            backgroundColor: item.holiday.type === "regular" ? colors.holidayRegular : colors.holidaySpecial,
          }}
        />
      );
  }
}
