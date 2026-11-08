import { useMemo, useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { addDaysIso } from "@/lib/dates";
import { canDownloadFiles, downloadText } from "@/lib/download";
import { activeHabitLogs, currentZone, habitDate, type HabitData } from "@/lib/habits";
import { habitCsv, habitMilestones, habitReport } from "@/lib/habitReports";
import { HabitGrowth } from "@/components/habits/HabitGrowth";

export function HabitInsights({ data, now }: { data: HabitData; now: number }) {
  const [days, setDays] = useState(30);
  const [growth, setGrowth] = useState(false);
  const [message, setMessage] = useState("");
  const reports = useMemo(() => habitReport(data, days, now), [data, days, now]);
  const milestones = useMemo(() => habitMilestones(data), [data]);
  const activeDays = new Set(activeHabitLogs(data.logs).filter(l => l.amount > 0 || l.confirmed).map(l => l.date));
  const today = habitDate(currentZone(), now);
  const total = reports.reduce((sum, r) => sum + r.opportunities, 0);
  const done = reports.reduce((sum, r) => sum + r.completed, 0);
  return <View className="gap-4">
    <View className="flex-row flex-wrap gap-2">{[7, 30, 365].map(value => <Button key={value} size="sm" variant={days === value ? "default" : "outline"} onPress={() => setDays(value)}><Text>{value === 7 ? "Week" : value === 30 ? "Month" : "Year"}</Text></Button>)}</View>
    <View className="bg-card border-border gap-3 rounded-xl border p-5">
      <Text className="text-xl font-semibold">{total ? `${Math.round(done / total * 100)}% of closed goals completed` : "Your story starts here"}</Text>
      <Text className="text-muted-foreground">{total ? `${done} of ${total} scheduled goals over the past ${days} days. Today's open goals are still yours to work on.` : "Check in when you're ready. Your progress will appear as scheduled periods finish."}</Text>
      {reports.map(r => <View key={r.habit.id} className="flex-row justify-between gap-3"><Text className="flex-1">{r.habit.title}</Text><Text>{r.rate === null ? "Still getting started" : `${r.completed}/${r.opportunities} · ${r.rate}%`}</Text></View>)}
    </View>
    <View className="bg-card border-border gap-3 rounded-xl border p-5">
      <Text className="font-semibold">Days you showed up</Text>
      <Text className="text-muted-foreground text-sm">Last 28 days. A check means you recorded activity; blank days are simply part of your story.</Text>
      <View className="flex-row flex-wrap gap-2">{Array.from({ length: 28 }, (_, i) => addDaysIso(today, i - 27)).map(date => <View key={date} accessibilityLabel={`${date}: ${activeDays.has(date) ? "Activity recorded" : "No activity recorded"}`} className={`min-w-12 items-center rounded-lg border p-2 ${activeDays.has(date) ? "bg-primary/10 border-primary" : "border-border"}`}><Text className="text-xs">{date.slice(5)}</Text><Text>{activeDays.has(date) ? "✓" : "–"}</Text></View>)}</View>
    </View>
    <Button className="self-start" variant="outline" accessibilityState={{ expanded: growth }} onPress={() => setGrowth(!growth)}><Text>{growth ? "Hide milestones" : "Explore milestones"}</Text></Button>
    {growth && <View className="bg-card border-border gap-3 rounded-xl border p-5">
      <Text className="text-xl font-semibold">Level {milestones.level} · {milestones.points} activity points</Text>
      <Text className="text-muted-foreground">{milestones.days} days showing up. Earn 10 points per habit per day you record activity. Taking a break never deducts points.</Text>
      {milestones.badges.map(b => <View key={b.title}><Text className="font-medium">{b.earned ? "✓" : "○"} {b.title}</Text><Text className="text-muted-foreground text-sm">{b.description}</Text></View>)}
      <Text className="text-muted-foreground text-xs">Milestones reflect your current records. Correcting or deleting records recalculates them. They are encouragement, not a measure of your worth.</Text>
    </View>}
    <HabitGrowth data={data} />
    <View className="border-border gap-2 border-t pt-4"><Button variant="ghost" className="self-start" disabled={!canDownloadFiles} onPress={() => { const ok = downloadText(`habits-${today}.csv`, habitCsv(data), "text/csv"); setMessage(ok ? "Your activity export is ready." : "Could not download. Please try again."); }}><Text>Export activity as CSV</Text></Button><Text className="text-muted-foreground text-xs">{canDownloadFiles ? "Includes habit names and recorded activity. For a restorable backup, use Settings → Backup." : "CSV download is available in the web app. Use Settings → Backup for recovery options."}</Text>{!!message && <Text accessibilityLiveRegion="polite">{message}</Text>}</View>
  </View>;
}
