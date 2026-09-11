import { CalendarClock, ListTodo, StickyNote } from "lucide-react-native";
import { useState } from "react";
import { ScrollView, View } from "react-native";

import { DatePickerField } from "@/components/DatePickerField";
import { PressableScale } from "@/components/PressableScale";
import { SegmentedControl } from "@/components/SegmentedControl";
import { TimePickerField } from "@/components/TimePickerField";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import {
  useCourses,
  useDatedNotes,
  useEvents,
  useTasks,
  type CalendarEvent,
  type DatedNote,
  type Priority,
  type Task,
} from "@/context/store";
import { formatShortDate } from "@/lib/calendar";
import { PRIORITY_LABEL } from "@/lib/tasks";
import { cn } from "@/lib/utils";

// One compact dialog for creating or editing a task, event or dated note.
// Opened by the Calendar (drag a range / "+ Add" / tap an item) and by
// the Tasks tab (edit a task's deadline).

export type ItemType = "task" | "event" | "note";

export type EditorTarget =
  | { mode: "create"; start: string; end: string; type?: ItemType }
  | { mode: "edit"; kind: "task"; task: Task }
  | { mode: "edit"; kind: "event"; event: CalendarEvent }
  | { mode: "edit"; kind: "note"; note: DatedNote };

const TYPE_OPTIONS = [
  { value: "task" as const, label: "Task", icon: ListTodo },
  { value: "event" as const, label: "Event", icon: CalendarClock },
  { value: "note" as const, label: "Note", icon: StickyNote },
];

const PRIORITY_OPTIONS = (["low", "medium", "high"] as Priority[]).map((p) => ({
  value: p,
  label: PRIORITY_LABEL[p],
}));

function targetKey(t: EditorTarget): string {
  if (t.mode === "create") return `new-${t.start}-${t.end}-${t.type ?? ""}`;
  return t.kind === "task" ? t.task.id : t.kind === "event" ? t.event.id : t.note.id;
}

export function ItemEditorDialog({
  target,
  onClose,
}: {
  target: EditorTarget | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      {target ? (
        <DialogContent className="gap-4 p-5 sm:max-w-md">
          <EditorForm key={targetKey(target)} target={target} onDone={onClose} />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function FieldLabel({ children }: { children: string }) {
  return <Text className="text-muted-foreground text-xs font-medium">{children}</Text>;
}

function EditorForm({ target, onDone }: { target: EditorTarget; onDone: () => void }) {
  const { addTask, updateTask, removeTask } = useTasks();
  const { addEvent, updateEvent, removeEvent } = useEvents();
  const { addNote, updateNote, removeNote } = useDatedNotes();
  const { courses } = useCourses();

  const init = initialState(target);
  const [type, setType] = useState<ItemType>(init.type);
  const [title, setTitle] = useState(init.title);
  const [start, setStart] = useState<string | undefined>(init.start);
  const [end, setEnd] = useState<string | undefined>(init.end);
  const [dueTime, setDueTime] = useState<string | undefined>(init.dueTime);
  const [allDay, setAllDay] = useState(init.allDay);
  const [startTime, setStartTime] = useState<string | undefined>(init.startTime);
  const [endTime, setEndTime] = useState<string | undefined>(init.endTime);
  const [priority, setPriority] = useState<Priority>(init.priority);
  const [courseId, setCourseId] = useState<string | undefined>(init.courseId);
  const [error, setError] = useState<string | null>(null);

  const creating = target.mode === "create";
  const noun = type === "task" ? "task" : type === "event" ? "event" : "note";

  // Keep the range valid: moving one end past the other drags it along.
  const changeStart = (iso: string) => {
    setStart(iso);
    if (!end || end < iso) setEnd(iso);
  };
  const changeEnd = (iso: string) => {
    setEnd(iso);
    if (!start || start > iso) setStart(iso);
  };

  const save = () => {
    const text = title.trim();
    if (!text) {
      setError("Give it a title.");
      return;
    }
    if (type !== "task" && !start) {
      setError("Pick a date.");
      return;
    }
    const s = start as string;
    const e = end ?? s;

    if (type === "task") {
      const patch = {
        title: text,
        due: end ?? start,
        start: start && end && start !== end ? start : undefined,
        dueTime: end ?? start ? dueTime : undefined,
        priority,
        courseId,
      };
      if (target.mode === "edit" && target.kind === "task") updateTask(target.task.id, patch);
      else addTask({ ...patch, done: false });
    } else if (type === "event") {
      const timed = !allDay && startTime && endTime;
      if (timed && s === e && endTime! <= startTime!) {
        setError("End time must be after the start time.");
        return;
      }
      const patch = {
        title: text,
        start: s,
        end: e,
        startTime: timed ? startTime : undefined,
        endTime: timed ? endTime : undefined,
      };
      if (target.mode === "edit" && target.kind === "event") updateEvent(target.event.id, patch);
      else addEvent(patch);
    } else {
      const endDate = e !== s ? e : undefined;
      if (target.mode === "edit" && target.kind === "note")
        updateNote(target.note, { text, date: s, endDate });
      else addNote(text, s, endDate);
    }
    onDone();
  };

  const remove = () => {
    if (target.mode !== "edit") return;
    if (target.kind === "task") removeTask(target.task.id);
    else if (target.kind === "event") removeEvent(target.event.id);
    else removeNote(target.note);
    onDone();
  };

  const rangeLabel =
    start && end && start !== end
      ? `${formatShortDate(start)} – ${formatShortDate(end)}`
      : start
        ? formatShortDate(start)
        : "No date";

  return (
    <>
      <DialogHeader>
        <DialogTitle>{creating ? "New item" : `Edit ${noun}`}</DialogTitle>
        <DialogDescription>{rangeLabel}</DialogDescription>
      </DialogHeader>

      <Input
        value={title}
        onChangeText={(v) => {
          setTitle(v);
          if (error) setError(null);
        }}
        placeholder={type === "task" ? "e.g. Study for Calculus" : type === "event" ? "e.g. Org meeting" : "e.g. Review notes"}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={save}
        accessibilityLabel="Title"
      />

      {creating ? (
        <SegmentedControl value={type} onChange={setType} options={TYPE_OPTIONS} accessibilityLabel="Item type" />
      ) : null}

      <View className="flex-row gap-3">
        <View className="flex-1 gap-1.5">
          <FieldLabel>Starts</FieldLabel>
          <DatePickerField
            value={start}
            onChange={changeStart}
            placeholder="No date"
            accessibilityLabel="Start date"
          />
        </View>
        <View className="flex-1 gap-1.5">
          <FieldLabel>{type === "task" ? "Due" : "Ends"}</FieldLabel>
          <DatePickerField
            value={end}
            onChange={changeEnd}
            placeholder="No date"
            accessibilityLabel={type === "task" ? "Due date" : "End date"}
          />
        </View>
      </View>

      {type === "task" ? (
        <>
          <View className="gap-1.5">
            <FieldLabel>Deadline time</FieldLabel>
            <View className="flex-row">
              <TimePickerField value={dueTime} onChange={setDueTime} placeholder="End of day" accessibilityLabel="Deadline time" />
            </View>
          </View>
          <View className="gap-1.5">
            <FieldLabel>Priority</FieldLabel>
            <SegmentedControl value={priority} onChange={setPriority} options={PRIORITY_OPTIONS} accessibilityLabel="Priority" />
          </View>
          {courses.length > 0 ? (
            <View className="gap-1.5">
              <FieldLabel>Course</FieldLabel>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-1.5">
                {[{ id: undefined, code: "None", color: undefined }, ...courses].map((c) => {
                  const on = courseId === c.id;
                  return (
                    <PressableScale
                      key={c.id ?? "none"}
                      onPress={() => setCourseId(c.id)}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on }}
                      className={cn(
                        "flex-row items-center gap-1.5 rounded-full border border-border px-2.5 py-1 web:hover:bg-accent",
                        on && "border-primary bg-primary/10"
                      )}
                    >
                      {c.color ? <View className="size-2 rounded-full" style={{ backgroundColor: c.color }} /> : null}
                      <Text className="text-xs font-medium">{c.code}</Text>
                    </PressableScale>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}
        </>
      ) : null}

      {type === "event" ? (
        <View className="gap-2">
          <View className="flex-row items-center gap-2">
            <Checkbox checked={allDay} onCheckedChange={setAllDay} accessibilityLabel="All day" />
            <Label onPress={() => setAllDay(!allDay)}>All day</Label>
          </View>
          {!allDay ? (
            <View className="flex-row items-center gap-2">
              <TimePickerField value={startTime} onChange={setStartTime} placeholder="Start" accessibilityLabel="Start time" />
              <Text className="text-muted-foreground">–</Text>
              <TimePickerField value={endTime} onChange={setEndTime} placeholder="End" accessibilityLabel="End time" />
            </View>
          ) : null}
        </View>
      ) : null}

      {error ? <Text className="text-destructive text-sm">{error}</Text> : null}

      <View className="flex-row items-center gap-2 pt-1">
        {!creating ? (
          <Button variant="ghost" size="sm" onPress={remove} accessibilityLabel={`Delete ${noun}`}>
            <Text className="text-destructive">Delete</Text>
          </Button>
        ) : null}
        <View className="flex-1" />
        <Button variant="outline" size="sm" onPress={onDone}>
          <Text>Cancel</Text>
        </Button>
        <Button size="sm" onPress={save}>
          <Text>{creating ? "Save" : "Save changes"}</Text>
        </Button>
      </View>
    </>
  );
}

function initialState(target: EditorTarget) {
  const base = {
    type: "task" as ItemType,
    title: "",
    start: undefined as string | undefined,
    end: undefined as string | undefined,
    dueTime: undefined as string | undefined,
    allDay: true,
    startTime: undefined as string | undefined,
    endTime: undefined as string | undefined,
    priority: "medium" as Priority,
    courseId: undefined as string | undefined,
  };
  if (target.mode === "create")
    return { ...base, type: target.type ?? "task", start: target.start, end: target.end };
  if (target.kind === "task") {
    const t = target.task;
    return {
      ...base,
      title: t.title,
      start: t.start ?? t.due,
      end: t.due,
      dueTime: t.dueTime,
      priority: t.priority,
      courseId: t.courseId,
    };
  }
  if (target.kind === "event") {
    const e = target.event;
    return {
      ...base,
      type: "event" as ItemType,
      title: e.title,
      start: e.start,
      end: e.end,
      allDay: !(e.startTime && e.endTime),
      startTime: e.startTime,
      endTime: e.endTime,
    };
  }
  const n = target.note;
  return { ...base, type: "note" as ItemType, title: n.text, start: n.date, end: n.endDate ?? n.date };
}
