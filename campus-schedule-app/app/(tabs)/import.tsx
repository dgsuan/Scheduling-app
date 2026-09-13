import * as DocumentPicker from "expo-document-picker";
import { router } from "expo-router";
import { FileUp, Link2, TriangleAlert } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { CrsImport } from "@/components/import/CrsImport";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useToast } from "@/components/Toaster";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useImport } from "@/context/store";
import { formatShortDate } from "@/lib/calendar";
import { parseIcs, planImport, type IcsParseResult, type ImportRow } from "@/lib/ics";
import { display12h } from "@/lib/schedule";
import { useBreakpoint } from "@/lib/useBreakpoint";
import { cn } from "@/lib/utils";

// Import from an LMS (e.g. UVLE) or any calendar. Uploading the .ics file is
// the reliable path; fetching a link is attempted but browsers usually block
// it (CORS), in which case we say so and point to the upload.

type Source = { name: string; result: IcsParseResult };

function whenLabel(row: ImportRow): string {
  const { start, end } = row.item;
  if (row.as === "task") return `Due ${formatShortDate(start.date)}${start.time ? ` · ${display12h(start.time)}` : ""}`;
  if (end && end.date !== start.date) return `${formatShortDate(start.date)} – ${formatShortDate(end.date)}`;
  return `${formatShortDate(start.date)}${start.time ? ` · ${display12h(start.time)}${end?.time ? ` – ${display12h(end.time)}` : ""}` : " · all day"}`;
}

export default function ImportScreen() {
  const { desktop } = useBreakpoint();
  const { tasks, events, courses, upsertImported } = useImport();
  const { toast } = useToast();
  const [source, setSource] = useState<Source | null>(null);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [showSkipped, setShowSkipped] = useState(false);

  const rows = useMemo(
    () => (source ? planImport(source.result.items, { tasks, events }, courses) : []),
    [source, tasks, events, courses]
  );
  const courseById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);
  const selected = rows.filter((r) => r.status !== "unchanged" && !excluded.has(r.item.key));

  const load = (name: string, text: string) => {
    const result = parseIcs(text);
    if (result.error) {
      setSource(null);
      setError(result.error);
      return;
    }
    setError(null);
    setExcluded(new Set());
    setShowSkipped(false);
    setSource({ name: result.calendarName ?? name, result });
  };

  const pickFile = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: ["text/calendar", ".ics", "application/octet-stream"], copyToCacheDirectory: false });
    if (res.canceled) return;
    const asset = res.assets[0];
    try {
      const text = asset.file ? await asset.file.text() : await (await fetch(asset.uri)).text();
      load(asset.name, text);
    } catch {
      setError("Couldn't read that file.");
    }
  };

  const fetchLink = async () => {
    const trimmed = url.trim().replace(/^webcal:\/\//i, "https://");
    if (!/^https?:\/\//i.test(trimmed)) {
      setError("Paste a full link that starts with https:// (or webcal://).");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(trimmed);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      load("Calendar link", await res.text());
    } catch {
      setSource(null);
      setError(
        "Your browser couldn't load that link — calendar sites usually block direct access from other websites. Download the .ics file instead (in UVLE: Calendar → Export calendar → Export) and upload it above."
      );
    } finally {
      setLoading(false);
    }
  };

  const doImport = () => {
    const importTasks = selected.flatMap((r) => (r.as === "task" ? [r.task] : []));
    const importEvents = selected.flatMap((r) => (r.as === "event" ? [r.event] : []));
    upsertImported({ tasks: importTasks, events: importEvents });
    const added = selected.filter((r) => r.status === "new").length;
    const updated = selected.length - added;
    toast({
      message: `Imported ${added} new${updated ? `, updated ${updated}` : ""}`,
      description: `${importTasks.length} task${importTasks.length === 1 ? "" : "s"}, ${importEvents.length} event${importEvents.length === 1 ? "" : "s"}`,
      actionLabel: importTasks.length ? "View tasks" : "View calendar",
      onAction: () => router.navigate(importTasks.length ? "/tasks" : "/calendar"),
    });
    setSource(null);
  };

  const counts = {
    new: rows.filter((r) => r.status === "new").length,
    update: rows.filter((r) => r.status === "update").length,
    unchanged: rows.filter((r) => r.status === "unchanged").length,
  };
  const recurring = rows.some((r) => r.item.recurring);

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName={cn("w-full max-w-[720px] self-center pb-24", desktop ? "px-10 pt-10" : "px-5 pt-6")}
      keyboardShouldPersistTaps="handled"
    >
      <ScreenHeader
        title="Import"
        subtitle="Bring in your class schedule from CRS, and deadlines and events from UVLE or any calendar. Re-importing updates what's changed instead of duplicating."
      />

      <CrsImport />

      <View className="bg-card/80 border-border rounded-xl border">
        <View className="gap-3 p-4">
          <View className="flex-row items-center gap-2">
            <Icon as={FileUp} size={16} className="text-primary" />
            <Text className="text-[15px] font-semibold">Upload a calendar file</Text>
          </View>
          <Text className="text-muted-foreground text-sm leading-5">
            In UVLE, open Calendar → Export calendar, choose what to export, then Export. Upload the downloaded .ics file here.
          </Text>
          <View className="flex-row">
            <Button onPress={pickFile}>
              <Text>Choose .ics file…</Text>
            </Button>
          </View>
        </View>
        <View className="border-border/70 gap-3 border-t p-4">
          <View className="flex-row items-center gap-2">
            <Icon as={Link2} size={16} className="text-muted-foreground" />
            <Text className="text-[15px] font-semibold">Or paste a calendar link</Text>
          </View>
          <Text className="text-muted-foreground text-sm leading-5">
            Worth a try, but most browsers block loading calendar links directly. If it fails, use the file upload.
          </Text>
          <View className="flex-row items-center gap-2">
            <Input
              value={url}
              onChangeText={setUrl}
              onSubmitEditing={fetchLink}
              placeholder="https://uvle.upd.edu.ph/calendar/export_execute.php?…"
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Calendar link"
              className="flex-1"
            />
            <Button variant="outline" onPress={fetchLink} disabled={loading || !url.trim()}>
              <Text>{loading ? "Loading…" : "Load"}</Text>
            </Button>
          </View>
        </View>
      </View>

      {error ? (
        <View className="border-destructive/40 bg-destructive/10 mt-4 flex-row gap-2.5 rounded-xl border p-4" role="alert">
          <Icon as={TriangleAlert} size={16} className="text-destructive mt-0.5" />
          <Text className="flex-1 text-sm leading-5">{error}</Text>
        </View>
      ) : null}

      {source ? (
        <View className="mt-8 gap-3">
          <View className="flex-row flex-wrap items-end justify-between gap-2 px-1">
            <View className="gap-0.5">
              <Text className="font-display text-xl font-semibold">{source.name}</Text>
              <Text className="text-muted-foreground text-sm">
                {rows.length} item{rows.length === 1 ? "" : "s"} · {counts.new} new
                {counts.update ? ` · ${counts.update} changed` : ""}
                {counts.unchanged ? ` · ${counts.unchanged} already imported` : ""}
              </Text>
            </View>
            <Button onPress={doImport} disabled={!selected.length}>
              <Text>{selected.length ? `Import ${selected.length}` : "Nothing to import"}</Text>
            </Button>
          </View>

          {source.result.skipped.length ? (
            <View className="border-warning/40 bg-warning/10 rounded-lg border px-3 py-2">
              <Pressable onPress={() => setShowSkipped((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: showSkipped }}>
                <Text className="text-sm">
                  {source.result.skipped.length} entr{source.result.skipped.length === 1 ? "y" : "ies"} couldn&apos;t be read and will be skipped{" "}
                  <Text className="text-primary text-sm">{showSkipped ? "Hide" : "Show"}</Text>
                </Text>
              </Pressable>
              {showSkipped
                ? source.result.skipped.map((s, i) => (
                    <Text key={i} className="text-muted-foreground text-xs">
                      {s.title ? `"${s.title}"` : "Untitled entry"} — {s.reason}
                    </Text>
                  ))
                : null}
            </View>
          ) : null}
          {recurring ? (
            <Text className="text-muted-foreground px-1 text-xs">Repeating events are imported once, on their first date.</Text>
          ) : null}

          <View className="bg-card/80 border-border rounded-xl border">
            {rows.length === 0 ? (
              <Text className="text-muted-foreground p-4 text-sm">This calendar has no events.</Text>
            ) : (
              rows.map((row, i) => {
                const already = row.status === "unchanged";
                const on = !already && !excluded.has(row.item.key);
                const course = row.courseId ? courseById.get(row.courseId) : undefined;
                const toggle = () =>
                  setExcluded((prev) => {
                    const next = new Set(prev);
                    if (next.has(row.item.key)) next.delete(row.item.key);
                    else next.add(row.item.key);
                    return next;
                  });
                return (
                  <Pressable
                    key={row.item.key}
                    onPress={already ? undefined : toggle}
                    disabled={already}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on, disabled: already }}
                    accessibilityLabel={`${row.item.title}, ${whenLabel(row)}`}
                    className={cn(
                      "flex-row items-start gap-3 px-4 py-3 web:transition-colors",
                      i > 0 && "border-border/60 border-t",
                      !already && "web:hover:bg-accent/40",
                      already && "opacity-60"
                    )}
                  >
                    <View className="pt-0.5" pointerEvents="none">
                      <Checkbox checked={on} onCheckedChange={() => {}} disabled={already} className="size-5 rounded-md" />
                    </View>
                    <View className="flex-1 gap-0.5">
                      <Text className="text-[15px]" numberOfLines={2}>
                        {row.item.title}
                      </Text>
                      <View className="flex-row flex-wrap items-center gap-x-2.5 gap-y-1">
                        <Text className="text-muted-foreground text-[13px] tabular-nums">{whenLabel(row)}</Text>
                        {course ? (
                          <View className="flex-row items-center gap-1">
                            <View className="size-1.5 rounded-full" style={{ backgroundColor: course.color }} />
                            <Text className="text-muted-foreground text-[13px]">{course.code}</Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                    <View className="items-end gap-1">
                      <Badge variant="outline">
                        <Text>{row.as === "task" ? "Task" : "Event"}</Text>
                      </Badge>
                      <Text
                        className={cn(
                          "text-[11px] font-medium",
                          row.status === "new" ? "text-success" : row.status === "update" ? "text-warning" : "text-muted-foreground"
                        )}
                      >
                        {row.status === "new" ? "New" : row.status === "update" ? "Changed" : "Already imported"}
                      </Text>
                    </View>
                  </Pressable>
                );
              })
            )}
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}
