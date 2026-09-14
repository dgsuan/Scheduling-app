import { Download } from "lucide-react-native";
import { useMemo, useState } from "react";
import { View } from "react-native";

import { SegmentedControl } from "@/components/SegmentedControl";
import { useToast } from "@/components/Toaster";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import { useCourses, useEvents, useScheduleRules, useTasks } from "@/context/store";
import { formatShortDate } from "@/lib/calendar";
import { addDaysIso, isoDate } from "@/lib/dates";
import { canDownloadFiles, downloadText } from "@/lib/download";
import { buildIcs, collectExportEvents } from "@/lib/ics";

// One-time .ics download for Google Calendar / Apple Calendar / Outlook.
// Not a subscription: there's no server to host a live feed.

type Range = "month" | "next30" | "semester" | "all";

/** Without term dates, "Everything" includes classes for this long. */
const CLASS_HORIZON_DAYS = 120;

export function ExportIcsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { tasks } = useTasks();
  const { events } = useEvents();
  const { courses } = useCourses();
  const rules = useScheduleRules();
  const { toast } = useToast();
  const [include, setInclude] = useState({ tasks: true, events: true, classes: false });
  const [range, setRange] = useState<Range>("month");

  const today = isoDate(new Date());
  const bounds = useMemo((): { from: string; to: string; classFrom: string; classTo: string } => {
    const now = new Date();
    if (range === "month") {
      const from = isoDate(new Date(now.getFullYear(), now.getMonth(), 1));
      const to = isoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
      return { from, to, classFrom: from, classTo: to };
    }
    if (range === "next30") {
      const to = addDaysIso(today, 30);
      return { from: today, to, classFrom: today, classTo: to };
    }
    if (range === "semester" && rules.term) {
      return { from: rules.term.start, to: rules.term.end, classFrom: rules.term.start, classTo: rules.term.end };
    }
    const dates = [...tasks.flatMap((t) => (t.due ? [t.due] : [])), ...events.flatMap((e) => [e.start, e.end]), today].sort();
    return {
      from: dates[0],
      to: dates[dates.length - 1],
      classFrom: rules.term?.start ?? today,
      classTo: rules.term?.end ?? addDaysIso(today, CLASS_HORIZON_DAYS),
    };
  }, [range, today, rules.term, tasks, events]);

  const items = useMemo(() => {
    const base = { tasks, events, courses, rules };
    return [
      ...collectExportEvents({ ...base, from: bounds.from, to: bounds.to, include: { tasks: include.tasks, events: include.events, classes: false } }),
      ...collectExportEvents({ ...base, from: bounds.classFrom, to: bounds.classTo, include: { tasks: false, events: false, classes: include.classes } }),
    ];
  }, [tasks, events, courses, rules, bounds, include]);

  const download = () => {
    const filename = `isked-${today}.ics`;
    if (downloadText(filename, buildIcs(items), "text/calendar")) {
      toast({ message: "Calendar file downloaded", description: `${items.length} item${items.length === 1 ? "" : "s"} · ${filename}` });
      onOpenChange(false);
    }
  };

  const toggle = (key: keyof typeof include, label: string, hint: string) => (
    <View className="flex-row items-start gap-3">
      <Checkbox
        checked={include[key]}
        onCheckedChange={(v) => setInclude((s) => ({ ...s, [key]: v }))}
        accessibilityLabel={label}
        className="mt-0.5 size-5 rounded-md"
      />
      <View className="flex-1">
        <Label onPress={() => setInclude((s) => ({ ...s, [key]: !s[key] }))}>{label}</Label>
        <Text className="text-muted-foreground mt-1 text-xs">{hint}</Text>
      </View>
    </View>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 p-5 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export to a calendar app</DialogTitle>
          <DialogDescription>
            Downloads a one-time .ics file you can import into Google Calendar, Apple Calendar or Outlook. It won&apos;t
            stay in sync — export again after you make changes.
          </DialogDescription>
        </DialogHeader>

        <View className="gap-3">
          {toggle("tasks", "Task deadlines", "At their due time, or all-day when there's no time.")}
          {toggle("events", "Events", "Everything you've added to the calendar.")}
          {toggle("classes", "Classes", "Each class meeting, skipping holidays, cancellations and days outside the term.")}
        </View>

        <View className="gap-2">
          <Text className="text-sm font-medium">Dates</Text>
          <SegmentedControl<Range>
            value={range}
            onChange={setRange}
            options={[
              { value: "month", label: "This month" },
              { value: "next30", label: "30 days" },
              ...(rules.term ? [{ value: "semester" as Range, label: "Semester" }] : []),
              { value: "all", label: "Everything" },
            ]}
            accessibilityLabel="Date range"
          />
          <Text className="text-muted-foreground text-xs">
            {formatShortDate(bounds.from)} – {formatShortDate(bounds.to)}
            {include.classes && range === "all" && !rules.term ? ` · classes for the next ${CLASS_HORIZON_DAYS} days` : ""}
          </Text>
        </View>

        <DialogFooter className="items-center">
          <Text className="text-muted-foreground mr-auto text-sm tabular-nums">
            {items.length} item{items.length === 1 ? "" : "s"}
          </Text>
          <Button variant="outline" size="sm" onPress={() => onOpenChange(false)}>
            <Text>Cancel</Text>
          </Button>
          <Button size="sm" onPress={download} disabled={!items.length || !canDownloadFiles}>
            <Icon as={Download} size={14} className="text-primary-foreground" />
            <Text>{canDownloadFiles ? "Download .ics" : "Web only"}</Text>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
