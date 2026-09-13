import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

import {
  CalendarDayPopover,
  type EditableAgendaItem,
} from "@/components/calendar/CalendarDayPopover";
import { KindMark } from "@/components/calendar/KindMark";
import { Text } from "@/components/ui/text";
import { colors } from "@/constants/theme";
import { holidayMap } from "@/constants/holidays";
import type { Task } from "@/context/store";
import {
  WEEKDAY_INITIALS,
  agendaForDate,
  buildMonthCells,
  formatDayLong,
  type AgendaItem,
  type AgendaSources,
  type MonthCell,
} from "@/lib/calendar";
import { WEEKDAY_SHORT, type DatedOccurrence } from "@/lib/schedule";
import { todayIso } from "@/lib/tasks";
import { cn } from "@/lib/utils";

// Month grid with macOS-Calendar-style interactions:
//  • click a day → a small agenda popover anchored to it
//  • press and drag across days → range highlight → onCreateRange
// Mouse drags start after a few pixels; on touch, hold briefly first so
// normal scrolling still works. Neighbouring months' days fill the grid
// (faded) so it reads as a calendar, not a spreadsheet with holes.

const WIDE_MIN_WIDTH = 640; // grid width where cells show text labels
const DRAG_START_PX = 4;
const TOUCH_HOLD_MS = 280;
const POPOVER_MAX_W = 300;
const MAX_LABELS = 3;

type Props = {
  year: number;
  month: number;
  sources: Omit<AgendaSources, "holidays">;
  /** Range to keep highlighted (e.g. while the create dialog is open). */
  highlight?: { start: string; end: string } | null;
  onCreateRange: (start: string, end: string) => void;
  onEdit: (item: EditableAgendaItem) => void;
  onToggleTask: (task: Task, done: boolean) => void;
  onCancelClass: (occ: DatedOccurrence) => void;
  onRestoreClass: (occ: DatedOccurrence) => void;
};

export function CalendarMonth({
  year,
  month,
  sources,
  highlight,
  onCreateRange,
  onEdit,
  onToggleTask,
  onCancelClass,
  onRestoreClass,
}: Props) {
  const [gridW, setGridW] = useState(0);
  const [drag, setDrag] = useState<{ anchor: number; current: number } | null>(null);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const today = todayIso();

  const cells = useMemo(() => buildMonthCells(year, month, true) as MonthCell[], [year, month]);
  const rows = cells.length / 7;

  const agenda = useMemo(() => {
    const byYear = new Map<number, ReturnType<typeof holidayMap>>();
    const holidaysFor = (iso: string) => {
      const y = Number(iso.slice(0, 4));
      if (!byYear.has(y)) byYear.set(y, holidayMap(y));
      return byYear.get(y)!.get(iso) ?? [];
    };
    return cells.map((c) => agendaForDate(c.iso, c.weekday, { ...sources, holidays: holidaysFor(c.iso) }));
  }, [cells, sources]);

  // Close the popover when the month changes.
  useEffect(() => setOpenIdx(null), [year, month]);

  const wide = gridW >= WIDE_MIN_WIDTH;
  const cellW = gridW / 7 || 1;
  const cellH = wide ? Math.round(Math.min(118, Math.max(92, cellW * 0.74))) : Math.round(Math.max(48, Math.min(cellW, 64)));

  // Gesture callbacks read the latest values through refs.
  const live = useRef({ cellW, cellH, rows });
  live.current = { cellW, cellH, rows };
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const originRef = useRef<number | null>(null);
  const suppressPressUntil = useRef(0);

  const cellAt = (x: number, y: number) => {
    const g = live.current;
    const col = Math.min(6, Math.max(0, Math.floor(x / g.cellW)));
    const row = Math.min(g.rows - 1, Math.max(0, Math.floor(y / g.cellH)));
    return row * 7 + col;
  };

  const onCreateRef = useRef(onCreateRange);
  onCreateRef.current = onCreateRange;

  const pan = useMemo(() => {
    let g = Gesture.Pan()
      .runOnJS(true)
      .onBegin((e) => {
        originRef.current = cellAt(e.x, e.y);
      })
      .onStart((e) => {
        const origin = originRef.current ?? cellAt(e.x, e.y);
        setOpenIdx(null);
        setDrag({ anchor: origin, current: cellAt(e.x, e.y) });
      })
      .onUpdate((e) => {
        const d = dragRef.current;
        const c = cellAt(e.x, e.y);
        if (d && c !== d.current) setDrag({ ...d, current: c });
      })
      .onEnd(() => {
        const d = dragRef.current;
        if (!d) return;
        suppressPressUntil.current = Date.now() + 400;
        const lo = Math.min(d.anchor, d.current);
        const hi = Math.max(d.anchor, d.current);
        if (lo === hi && Platform.OS === "web") setOpenIdx(lo);
        else onCreateRef.current(cells[lo].iso, cells[hi].iso);
      })
      .onFinalize(() => setDrag(null));
    g = Platform.OS === "web" ? g.minDistance(DRAG_START_PX) : g.activateAfterLongPress(TOUCH_HOLD_MS);
    return g;
    // cellAt reads refs only; cells drives which dates the indices map to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells]);

  const pressDay = (idx: number) => {
    if (Date.now() < suppressPressUntil.current) return;
    setOpenIdx((cur) => (cur === idx ? null : idx));
  };

  // Web: Escape or a click outside the grid/popover closes the popover.
  const gridRef = useRef<View>(null);
  const popRef = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS !== "web" || openIdx == null) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenIdx(null);
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      const inside = [gridRef.current, popRef.current].some(
        (el) => el && (el as unknown as HTMLElement).contains?.(target)
      );
      // Dialogs/popovers portal outside the grid; leave those alone.
      const inPortal = (target as HTMLElement).closest?.("[role=dialog],[data-radix-popper-content-wrapper]");
      if (!inside && !inPortal) setOpenIdx(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [openIdx]);

  // Which indices are highlighted as a range (live drag wins).
  const range = useMemo(() => {
    if (drag) return [Math.min(drag.anchor, drag.current), Math.max(drag.anchor, drag.current)] as const;
    if (!highlight) return null;
    const lo = cells.findIndex((c) => c.iso === highlight.start);
    const hi = cells.findIndex((c) => c.iso === highlight.end);
    if (lo < 0 && hi < 0) return null;
    return [lo < 0 ? 0 : lo, hi < 0 ? cells.length - 1 : hi] as const;
  }, [drag, highlight, cells]);

  const openCell = openIdx != null ? cells[openIdx] : null;
  const popover = openCell ? (
    <CalendarDayPopover
      key={openCell.iso}
      popoverRef={popRef}
      iso={openCell.iso}
      items={agenda[openIdx!]}
      onClose={() => setOpenIdx(null)}
      onAdd={() => onCreateRange(openCell.iso, openCell.iso)}
      onEdit={onEdit}
      onToggleTask={onToggleTask}
      onCancelClass={onCancelClass}
      onRestoreClass={onRestoreClass}
      style={Platform.OS === "web" ? anchoredStyle(openIdx!, gridW, cellW, cellH, rows) : { marginTop: 12 }}
    />
  ) : null;

  return (
    <View>
      <View className="mb-1 flex-row">
        {(wide ? WEEKDAY_SHORT : WEEKDAY_INITIALS).map((d, i) => (
          <Text
            key={i}
            className={cn(
              "flex-1 text-[11px] font-semibold uppercase tracking-[1px]",
              wide ? "px-3 text-left" : "text-center",
              i === 0 || i === 6 ? "text-muted-foreground/70" : "text-muted-foreground"
            )}
          >
            {d}
          </Text>
        ))}
      </View>

      <View style={{ position: "relative", zIndex: 10 }} onLayout={(e) => setGridW(e.nativeEvent.layout.width)}>
        <GestureDetector gesture={pan}>
          <View ref={gridRef} className="select-none flex-row flex-wrap" role="grid">
            {gridW > 0 &&
              cells.map((cell, i) => {
                const items = agenda[i];
                const inRange = !!range && i >= range[0] && i <= range[1];
                const col = i % 7;
                const isToday = cell.iso === today;
                const isOpen = openIdx === i;
                const holiday = items.find((it) => it.kind === "holiday");
                const classes = items.filter((it) => it.kind === "class" && it.occ.status === "scheduled");
                const labeled = items.filter((it) => it.kind !== "class" && it.kind !== "holiday");
                const weekend = cell.weekday === 0 || cell.weekday === 6;
                return (
                  <View
                    key={cell.iso}
                    style={{ width: `${100 / 7}%`, height: cellH }}
                    className={cn(i >= 7 && "border-border/60 border-t")}
                  >
                    {inRange ? (
                      <View
                        pointerEvents="none"
                        className={cn(
                          "bg-primary/15 absolute inset-y-1 left-0 right-0",
                          (i === range![0] || col === 0) && "left-1 rounded-l-lg",
                          (i === range![1] || col === 6) && "right-1 rounded-r-lg"
                        )}
                      />
                    ) : null}
                    <Pressable
                      onPress={() => pressDay(i)}
                      accessibilityRole="button"
                      accessibilityLabel={`${formatDayLong(cell.iso)}${isToday ? ", today" : ""}${items.length ? `, ${items.length} item${items.length === 1 ? "" : "s"}` : ""}`}
                      accessibilityState={{ selected: isOpen }}
                      className={cn(
                        "m-1 flex-1 rounded-lg border border-transparent web:cursor-pointer web:transition-colors web:duration-150",
                        !inRange && !isOpen && "web:hover:bg-accent/70",
                        isOpen && "border-primary/40 bg-primary/10",
                        wide ? "items-stretch px-1.5 pt-1.5" : "items-center justify-center"
                      )}
                    >
                      <View className={cn("flex-row items-center", wide ? "gap-1.5" : "justify-center")}>
                        <View
                          className={cn(
                            "size-7 items-center justify-center rounded-full",
                            isToday && "bg-primary"
                          )}
                        >
                          <Text
                            className={cn(
                              "text-[13px] tabular-nums",
                              isToday
                                ? "text-primary-foreground font-bold"
                                : cell.outside
                                  ? "text-muted-foreground/50"
                                  : weekend
                                    ? "text-muted-foreground font-medium"
                                    : "font-medium"
                            )}
                            style={
                              !isToday && !cell.outside && holiday && holiday.kind === "holiday"
                                ? { color: holiday.holiday.type === "regular" ? colors.holidayRegular : colors.holidaySpecial }
                                : undefined
                            }
                          >
                            {cell.day}
                          </Text>
                        </View>
                        {wide ? (
                          <View className="flex-row gap-[3px]">
                            {classes.slice(0, 4).map((it) => (
                              <KindMark key={it.key} item={it} />
                            ))}
                          </View>
                        ) : null}
                      </View>

                      {wide ? (
                        <View className={cn("mt-1 gap-[3px]", cell.outside && "opacity-50")}>
                          {holiday && holiday.kind === "holiday" ? (
                            <Text
                              numberOfLines={1}
                              className="px-0.5 text-[11px] font-medium leading-4"
                              style={{ color: holiday.holiday.type === "regular" ? colors.holidayRegular : colors.holidaySpecial }}
                            >
                              {holiday.title}
                            </Text>
                          ) : null}
                          {labeled.slice(0, MAX_LABELS).map((it) => (
                            <View
                              key={it.key}
                              className={cn(
                                "flex-row items-center gap-1.5 rounded px-1 py-px",
                                it.kind === "event" && "bg-primary/10"
                              )}
                            >
                              <KindMark item={it} />
                              <Text
                                className={cn(
                                  "flex-1 text-[11.5px] leading-4",
                                  it.kind === "event" ? "text-foreground font-medium" : "text-foreground/85",
                                  it.kind === "task" && it.task.done && "text-muted-foreground line-through",
                                  it.kind === "note" && "text-muted-foreground italic"
                                )}
                                numberOfLines={1}
                              >
                                {it.title}
                              </Text>
                            </View>
                          ))}
                          {labeled.length > MAX_LABELS ? (
                            <Text className="text-muted-foreground px-1 text-[10.5px]">
                              +{labeled.length - MAX_LABELS} more
                            </Text>
                          ) : null}
                        </View>
                      ) : (
                        <View className={cn("mt-0.5 h-[7px] flex-row items-center gap-[3px]", cell.outside && "opacity-40")}>
                          {dedupeMarks(items.filter((it) => it.kind !== "class" || it.occ.status === "scheduled"))
                            .slice(0, 4)
                            .map((it) => (
                            <KindMark key={it.key} item={it} />
                          ))}
                        </View>
                      )}
                    </Pressable>
                  </View>
                );
              })}
          </View>
        </GestureDetector>

        {Platform.OS === "web" ? popover : null}
      </View>

      {Platform.OS !== "web" ? popover : null}
    </View>
  );
}

/** One mark per kind (per course for classes) so tiny cells stay tidy. */
function dedupeMarks(items: AgendaItem[]): AgendaItem[] {
  const seen = new Set<string>();
  return items.filter((it) => {
    const k = it.kind === "class" ? `c-${it.occ.course.id}` : it.kind;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Position the popover beside its cell, flipping above for lower rows. */
function anchoredStyle(idx: number, gridW: number, cellW: number, cellH: number, rows: number) {
  const width = Math.min(POPOVER_MAX_W, gridW - 8);
  const col = idx % 7;
  const row = Math.floor(idx / 7);
  const left = Math.min(Math.max(4, col * cellW + cellW / 2 - width / 2), gridW - width - 4);
  const below = row < rows / 2;
  return {
    position: "absolute" as const,
    width,
    left,
    zIndex: 50,
    ...(below ? { top: (row + 1) * cellH + 2 } : { bottom: (rows - row) * cellH + 2 }),
  };
}
