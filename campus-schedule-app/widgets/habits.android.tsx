import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { FlexWidget, TextWidget, type WidgetTaskHandlerProps } from "react-native-android-widget";
import { emptyHabits, validateHabitData, type HabitData } from "@/lib/habits";
import { widgetHabits } from "@/lib/widgetHabits";
export const WIDGET_CACHE = "isked:widget:habits:v1";
export function HabitsWidget({ data, height = 240 }: { data: HabitData; height?: number }) {
  const model = widgetHabits(data, Date.now());
  const rows = model.rows.slice(0, Math.max(1, Math.min(4, Math.floor((height - 100) / 45))));
  return <FlexWidget accessibilityLabel={`Isked habits. ${model.completed} of ${model.total} goals complete. Open Habits.`} style={{ width: "match_parent", height: "match_parent", backgroundColor: "#152925", borderRadius: 20, padding: 16 }} clickAction="OPEN_URI" clickActionData={{ uri: "campusschedule://habits" }}>
    <TextWidget text="Isked · Habits today" style={{ fontSize: 17, fontWeight: "bold", color: "#F3F8F6" }} />
    <TextWidget text={model.total ? `${model.completed} of ${model.total} goals complete` : data.habits.length ? "No habits due today" : "Open Isked to get started"} style={{ fontSize: 12, color: "#BCD3CC", marginBottom: 10 }} />
    {rows.map(row => <FlexWidget key={row.id} accessibilityLabel={`${row.title}. ${row.progress}. Open habit.`} style={{ width: "match_parent", paddingVertical: 5 }} clickAction="OPEN_URI" clickActionData={{ uri: `campusschedule://habits?habitId=${encodeURIComponent(row.id)}` }}>
      <TextWidget text={`${row.done ? "✓ " : ""}${row.title}`} maxLines={1} truncate="END" style={{ fontSize: 14, color: "#FFFFFF" }} />
      <TextWidget text={row.progress} maxLines={1} style={{ fontSize: 11, color: "#BCD3CC" }} />
    </FlexWidget>)}
    <TextWidget text="Tap a habit to check in" style={{ fontSize: 11, color: "#8DDCC5", marginTop: 8 }} />
  </FlexWidget>;
}
export async function habitWidgetTask(props: WidgetTaskHandlerProps) {
  if (props.widgetInfo.widgetName !== "IskedHabits" || props.widgetAction === "WIDGET_DELETED") return;
  let data = emptyHabits();
  try { const raw = JSON.parse(await AsyncStorage.getItem(WIDGET_CACHE) ?? "null"); if (validateHabitData(raw)) data = raw; } catch {}
  props.renderWidget(<HabitsWidget data={data} height={props.widgetInfo.height} />);
}
