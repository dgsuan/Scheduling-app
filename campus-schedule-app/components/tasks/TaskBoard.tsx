import { Check, Flag, Lock, Pencil, Play, RotateCcw } from "lucide-react-native";
import { useMemo, useRef, useState } from "react";
import { Platform, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import type { Course, Task } from "@/context/store";
import { useUiScale } from "@/context/theme";
import { BOARD_COLUMNS, columnOf, type BoardColumn } from "@/lib/activity";
import { formatDue, isOverdue, sortTasks } from "@/lib/tasks";
import { cn } from "@/lib/utils";

// Tasks as a board: Not started → Doing → Finished. Drag a card to another
// column (mouse: just drag; touch: hold, then drag) or use its buttons.
// The task in Doing is what Friend activity shares.

const DRAG_START_PX = 4;
const TOUCH_HOLD_MS = 250;
const FINISHED_SHOWN = 30;
const SPRING = { damping: 22, stiffness: 260 };

const EMPTY_HINT: Record<BoardColumn, string> = {
  todo: "Nothing waiting.",
  doing: "Drag a task here when you start it.",
  done: "Finished tasks land here.",
};

type Rect = { x: number; y: number; w: number; h: number };

type DragApi = {
  measure: () => void;
  columnAt: (x: number, y: number) => BoardColumn | null;
  setHover: (c: BoardColumn | null) => void;
  setDragging: (id: string | null) => void;
  onMove: (task: Task, to: BoardColumn) => void;
};

const quote = (task: Task) => `“${task.title.trim() || "Untitled task"}”`;

function BoardCard({
  task,
  column,
  course,
  now,
  api,
  onEdit,
  onTogglePrivate,
}: {
  task: Task;
  column: BoardColumn;
  course?: Course;
  now: Date;
  api: React.RefObject<DragApi>;
  onEdit: (task: Task) => void;
  onTogglePrivate: (task: Task) => void;
}) {
  const scale = useUiScale();
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const lifted = useSharedValue(0);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { rotate: `${lifted.value * 1.5}deg` }],
    zIndex: lifted.value ? 50 : 0,
    opacity: 1 - lifted.value * 0.1,
  }));

  const pan = useMemo(() => {
    let g = Gesture.Pan()
      .runOnJS(true)
      .onStart(() => {
        api.current?.measure();
        api.current?.setDragging(task.id);
        lifted.value = 1;
      })
      .onUpdate((e) => {
        tx.value = e.translationX / scale;
        ty.value = e.translationY / scale;
        api.current?.setHover(api.current.columnAt(e.absoluteX, e.absoluteY));
      })
      .onEnd((e) => {
        const to = api.current?.columnAt(e.absoluteX, e.absoluteY);
        if (to && to !== column) {
          tx.value = 0;
          ty.value = 0;
          api.current?.onMove(task, to);
        }
      })
      .onFinalize(() => {
        tx.value = withSpring(0, SPRING);
        ty.value = withSpring(0, SPRING);
        lifted.value = 0;
        api.current?.setHover(null);
        api.current?.setDragging(null);
      });
    g = Platform.OS === "web" ? g.minDistance(DRAG_START_PX) : g.activateAfterLongPress(TOUCH_HOLD_MS);
    return g;
    // Shared values and the api ref are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task, column, scale]);

  const due = task.due ? formatDue(task, now) : null;
  const late = column !== "done" && isOverdue(task, now);
  const move = (to: BoardColumn) => api.current?.onMove(task, to);

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={style}>
        <View
          testID={`board-card-${task.id}`}
          className={cn(
            "bg-card border-border gap-2 rounded-lg border p-3 shadow-sm shadow-black/5 web:cursor-grab web:select-none",
            column === "doing" && "border-primary/40"
          )}
        >
          <Text className={cn("text-[14px] leading-5", column === "done" && "text-muted-foreground line-through")} numberOfLines={3}>
            {task.title.trim() || "Untitled task"}
          </Text>
          {course || due || task.private || (task.priority === "high" && column !== "done") ? (
            <View className="flex-row flex-wrap items-center gap-x-2.5 gap-y-1">
              {course ? (
                <View className="flex-row items-center gap-1.5">
                  <View className="size-1.5 rounded-full" style={{ backgroundColor: course.color }} />
                  <Text className="text-muted-foreground text-[12px]">{course.code}</Text>
                </View>
              ) : null}
              {due ? <Text className={cn("text-[12px] tabular-nums", late ? "text-destructive" : "text-muted-foreground")}>{due}</Text> : null}
              {task.priority === "high" && column !== "done" ? <Icon as={Flag} size={12} className="text-destructive" /> : null}
              {task.private ? (
                <View className="flex-row items-center gap-1">
                  <Icon as={Lock} size={11} className="text-muted-foreground" />
                  <Text className="text-muted-foreground text-[12px]">Private</Text>
                </View>
              ) : null}
            </View>
          ) : null}
          <View className="-mb-1 -ml-1 flex-row items-center">
            {column === "todo" ? (
              <Button variant="ghost" size="sm" className="h-7 gap-1 px-2" onPress={() => move("doing")} accessibilityLabel={`Move ${quote(task)} to Doing`}>
                <Icon as={Play} size={12} className="text-primary" />
                <Text className="text-primary text-[12px]">Start</Text>
              </Button>
            ) : null}
            {column !== "done" ? (
              <Button variant="ghost" size="sm" className="h-7 gap-1 px-2" onPress={() => move("done")} accessibilityLabel={`Move ${quote(task)} to Finished`}>
                <Icon as={Check} size={12} className="text-muted-foreground" />
                <Text className="text-muted-foreground text-[12px]">Done</Text>
              </Button>
            ) : null}
            {column !== "todo" ? (
              <Button variant="ghost" size="icon" className="h-7 w-7" onPress={() => move("todo")} accessibilityLabel={`Move ${quote(task)} to Not started`}>
                <Icon as={RotateCcw} size={12} className="text-muted-foreground" />
              </Button>
            ) : null}
            <View className="flex-1" />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onPress={() => onTogglePrivate(task)}
              accessibilityLabel={task.private ? `Show ${quote(task)} in Friend activity` : `Keep ${quote(task)} private`}
            >
              <Icon as={Lock} size={12} className={task.private ? "text-foreground" : "text-muted-foreground/60"} />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onPress={() => onEdit(task)} accessibilityLabel={`Edit ${quote(task)}`}>
              <Icon as={Pencil} size={12} className="text-muted-foreground" />
            </Button>
          </View>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

export function TaskBoard({
  tasks,
  courseById,
  now,
  stacked,
  onMove,
  onEdit,
  onTogglePrivate,
}: {
  tasks: Task[];
  courseById: Record<string, Course>;
  now: Date;
  /** Phones: columns one under another. */
  stacked: boolean;
  onMove: (task: Task, to: BoardColumn) => void;
  onEdit: (task: Task) => void;
  onTogglePrivate: (task: Task) => void;
}) {
  const [hover, setHover] = useState<BoardColumn | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const columns = useMemo(() => {
    const map: Record<BoardColumn, Task[]> = { todo: [], doing: [], done: [] };
    for (const t of sortTasks(tasks)) map[columnOf(t)].push(t);
    map.doing.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
    map.done = map.done.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)).slice(0, FINISHED_SHOWN);
    return map;
  }, [tasks]);
  const doneTotal = useMemo(() => tasks.filter((t) => t.done).length, [tasks]);

  const views = useRef<Partial<Record<BoardColumn, View | null>>>({});
  const rects = useRef<Partial<Record<BoardColumn, Rect>>>({});
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  const api = useRef<DragApi>({
    measure: () => {
      for (const { key } of BOARD_COLUMNS) {
        views.current[key]?.measureInWindow((x, y, w, h) => {
          rects.current[key] = { x, y, w, h };
        });
      }
    },
    columnAt: (x, y) => {
      for (const { key } of BOARD_COLUMNS) {
        const r = rects.current[key];
        if (r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return key;
      }
      return null;
    },
    setHover: (c) => setHover(c),
    setDragging: (id) => setDragging(id),
    onMove: (task, to) => onMoveRef.current(task, to),
  });

  const draggingFrom = dragging ? BOARD_COLUMNS.find(({ key }) => columns[key].some((t) => t.id === dragging))?.key : undefined;

  return (
    <View className={cn("gap-3", !stacked && "flex-row items-start")}>
      {BOARD_COLUMNS.map(({ key, title }) => {
        const list = columns[key];
        const count = key === "done" ? doneTotal : list.length;
        return (
          <View
            key={key}
            ref={(el) => {
              views.current[key] = el;
            }}
            onLayout={() => api.current.measure()}
            role="list"
            aria-label={title}
            style={{ zIndex: draggingFrom === key ? 10 : 0 }}
            className={cn(
              "bg-secondary/50 border-border min-h-[150px] gap-2 rounded-xl border p-2.5 web:transition-colors",
              !stacked && "flex-1",
              hover === key && draggingFrom !== key && "border-primary bg-primary/10"
            )}
          >
            <View className="flex-row items-center gap-2 px-1 pb-0.5">
              {key === "doing" ? <View className="bg-primary size-2 rounded-full" /> : null}
              <Text className="text-[13px] font-semibold">{title}</Text>
              <Text className="text-muted-foreground text-[13px] tabular-nums">{count}</Text>
            </View>
            {list.length ? (
              list.map((task) => (
                <BoardCard
                  key={task.id}
                  task={task}
                  column={key}
                  course={task.courseId ? courseById[task.courseId] : undefined}
                  now={now}
                  api={api}
                  onEdit={onEdit}
                  onTogglePrivate={onTogglePrivate}
                />
              ))
            ) : (
              <Text className="text-muted-foreground px-1 py-3 text-[12px]">{EMPTY_HINT[key]}</Text>
            )}
            {key === "done" && doneTotal > list.length ? (
              <Text className="text-muted-foreground px-1 text-[12px]">Showing the latest {list.length}.</Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
