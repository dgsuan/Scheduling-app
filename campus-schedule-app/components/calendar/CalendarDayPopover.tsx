import { CalendarClock, Plus, StickyNote, X } from "lucide-react-native";
import { Pressable, ScrollView, View, type StyleProp, type ViewStyle } from "react-native";

import { PopIn } from "@/components/PopIn";
import { TaskCheckbox } from "@/components/TaskCheckbox";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { colors } from "@/constants/theme";
import type { Task } from "@/context/store";
import { formatDayLong, type AgendaItem } from "@/lib/calendar";
import { isDueSoon, isOverdue } from "@/lib/tasks";
import { cn } from "@/lib/utils";

// Compact card listing one day's classes, events, tasks and notes.
// Events/tasks/notes open the editor; tasks can be ticked in place.

export type EditableAgendaItem = Extract<AgendaItem, { kind: "task" | "event" | "note" }>;

function Row({
  children,
  onPress,
  label,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  label: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : "text"}
      accessibilityLabel={label}
      className={cn(
        "flex-row items-start gap-2.5 rounded-md px-2 py-1.5",
        onPress && "web:hover:bg-accent web:transition-colors active:bg-accent"
      )}
    >
      {children}
    </Pressable>
  );
}

function Title({ children, done }: { children: string; done?: boolean }) {
  return (
    <Text className={cn("text-sm font-medium", done && "text-muted-foreground line-through")} numberOfLines={2}>
      {children}
    </Text>
  );
}

function Sub({ children, className }: { children: string; className?: string }) {
  return <Text className={cn("text-muted-foreground text-xs", className)}>{children}</Text>;
}

export function CalendarDayPopover({
  iso,
  items,
  onClose,
  onAdd,
  onEdit,
  onToggleTask,
  style,
  popoverRef,
}: {
  iso: string;
  items: AgendaItem[];
  onClose: () => void;
  onAdd: () => void;
  onEdit: (item: EditableAgendaItem) => void;
  onToggleTask: (task: Task, done: boolean) => void;
  style?: StyleProp<ViewStyle>;
  popoverRef?: React.Ref<View>;
}) {
  const now = new Date();
  return (
    // PopIn springs the card in; styling lives on the inner View (animated
    // views ignore className).
    <PopIn style={style} from={0.95} offsetY={-6}>
    <View
      ref={popoverRef}
      accessibilityRole="summary"
      accessibilityLabel={`Agenda for ${formatDayLong(iso)}`}
      className="bg-popover border-border rounded-xl border p-3 shadow-xl shadow-black/15"
    >
      <View className="mb-1 flex-row items-center justify-between pl-2">
        <Text className="text-sm font-semibold">{formatDayLong(iso)}</Text>
        <Button variant="ghost" size="icon" className="h-7 w-7" onPress={onClose} accessibilityLabel="Close">
          <Icon as={X} size={14} className="text-muted-foreground" />
        </Button>
      </View>

      <ScrollView style={{ maxHeight: 280 }} contentContainerClassName="gap-0.5">
        {items.length === 0 ? (
          <Text className="text-muted-foreground px-2 py-2 text-sm">Nothing planned.</Text>
        ) : (
          items.map((item) => {
            switch (item.kind) {
              case "holiday":
                return (
                  <Row key={item.key} label={item.title}>
                    <Text className="text-sm">🎉</Text>
                    <View className="flex-1">
                      <Title>{item.title}</Title>
                      <Sub
                        className={item.holiday.type === "regular" ? "text-destructive" : undefined}
                      >
                        {`${item.holiday.type === "regular" ? "Regular holiday" : "Special day"}${item.holiday.approx ? " · date approximate" : ""}`}
                      </Sub>
                    </View>
                  </Row>
                );
              case "class":
                return (
                  <Row key={item.key} label={`${item.title}, ${item.timeLabel}`}>
                    <View className="mt-1.5 size-2 rounded-full" style={{ backgroundColor: item.occ.course.color }} />
                    <View className="flex-1">
                      <Title>{item.occ.course.title ? `${item.title} · ${item.occ.course.title}` : item.title}</Title>
                      <Sub>{`${item.timeLabel}${item.occ.meeting.room ? ` · ${item.occ.meeting.room}` : ""}`}</Sub>
                    </View>
                  </Row>
                );
              case "event":
                return (
                  <Row key={item.key} label={`${item.title}, ${item.timeLabel}. Edit`} onPress={() => onEdit(item)}>
                    <Icon as={CalendarClock} size={15} className="text-primary mt-0.5" />
                    <View className="flex-1">
                      <Title>{item.title}</Title>
                      <Sub>{item.timeLabel}</Sub>
                    </View>
                  </Row>
                );
              case "task": {
                const overdue = isOverdue(item.task, now);
                const soon = isDueSoon(item.task, now);
                return (
                  <View key={item.key} className="flex-row items-start gap-2.5 px-2 py-1.5">
                    <View className="mt-0.5">
                      <TaskCheckbox
                        checked={item.task.done}
                        onCheckedChange={(done) => onToggleTask(item.task, done)}
                        label={item.title}
                      />
                    </View>
                    <Pressable
                      className="-my-1 flex-1 rounded-md px-1 py-1 web:hover:bg-accent web:transition-colors"
                      onPress={() => onEdit(item)}
                      accessibilityRole="button"
                      accessibilityLabel={`${item.title}, ${item.timeLabel}. Edit`}
                    >
                      <Title done={item.task.done}>{item.title}</Title>
                      <Text
                        className={cn("text-muted-foreground text-xs", !item.task.done && overdue && "text-destructive font-medium")}
                        style={!item.task.done && !overdue && soon ? { color: colors.holidaySpecial } : undefined}
                      >
                        {overdue && !item.task.done ? `Overdue · ${item.timeLabel}` : item.timeLabel}
                      </Text>
                    </Pressable>
                  </View>
                );
              }
              case "note":
                return (
                  <Row key={item.key} label={`Note: ${item.title}. Edit`} onPress={() => onEdit(item)}>
                    <Icon as={StickyNote} size={15} className="text-muted-foreground mt-0.5" />
                    <View className="flex-1">
                      <Title>{item.title}</Title>
                    </View>
                  </Row>
                );
            }
          })
        )}
      </ScrollView>

      <Button variant="ghost" size="sm" className="mt-1 self-start" onPress={onAdd} accessibilityLabel={`Add to ${formatDayLong(iso)}`}>
        <Icon as={Plus} size={14} className="text-primary" />
        <Text className="text-primary">Add</Text>
      </Button>
    </View>
    </PopIn>
  );
}
