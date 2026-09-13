import { router } from "expo-router";
import {
  BookOpen,
  CalendarClock,
  CalendarDays,
  CircleCheck,
  Download,
  Folder,
  ListChecks,
  Moon,
  NotebookPen,
  Plus,
  Search,
  Settings,
  StickyNote,
  type LucideIcon,
} from "lucide-react-native";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useAllCanvases, useCourses, useEvents, useTasks } from "@/context/store";
import { useThemeControls } from "@/context/theme";
import { formatShortDate } from "@/lib/calendar";
import { fuzzyScore } from "@/lib/fuzzy";
import { formatDue } from "@/lib/tasks";
import { cn } from "@/lib/utils";

// Ctrl/⌘+K command menu: fuzzy search across tasks, events, notes and
// courses, plus quick actions. Enter opens the highlighted result.

type Result = {
  id: string;
  group: "Actions" | "Tasks" | "Events" | "Notes" | "Courses";
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  /** Extra text that can match (e.g. a note's body) but isn't the title. */
  keywords?: string;
  run: () => void;
};

const PER_GROUP = 6;
const GROUP_ORDER: Result["group"][] = ["Actions", "Tasks", "Events", "Notes", "Courses"];

const PaletteContext = createContext<{ open: boolean; setOpen: (o: boolean) => void; toggle: () => void } | null>(null);

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  const value = useMemo(() => ({ open, setOpen, toggle }), [open, toggle]);
  return (
    <PaletteContext.Provider value={value}>
      {children}
      <CommandPalette open={open} onOpenChange={setOpen} />
    </PaletteContext.Provider>
  );
}

export function useCommandPalette() {
  const ctx = useContext(PaletteContext);
  if (!ctx) throw new Error("useCommandPalette must be used inside <CommandPaletteProvider>");
  return ctx;
}

function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <DialogContent className="top-[12%] gap-0 overflow-hidden p-0 sm:max-w-lg" style={Platform.OS === "web" ? { alignSelf: "flex-start" } : undefined}>
          <PaletteBody close={() => onOpenChange(false)} />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function PaletteBody({ close }: { close: () => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const { tasks } = useTasks();
  const { events } = useEvents();
  const { courses } = useCourses();
  const canvases = useAllCanvases();
  const { toggle: toggleTheme } = useThemeControls();

  const go = useCallback(
    (fn: () => void) => () => {
      close();
      // Let the dialog unmount before navigating.
      setTimeout(fn, 0);
    },
    [close]
  );

  const all = useMemo<Result[]>(() => {
    const actions: Result[] = [
      { id: "a-new-task", group: "Actions", title: "New task", icon: Plus, keywords: "add create todo", run: go(() => router.navigate({ pathname: "/tasks", params: { new: "1" } })) },
      { id: "a-today", group: "Actions", title: "Go to today in Calendar", icon: CalendarDays, keywords: "calendar today", run: go(() => router.navigate({ pathname: "/calendar", params: { today: "1" } })) },
      { id: "a-schedule", group: "Actions", title: "Go to Schedule", icon: CalendarClock, keywords: "home now next class", run: go(() => router.navigate("/")) },
      { id: "a-tasks", group: "Actions", title: "Go to Tasks", icon: ListChecks, run: go(() => router.navigate("/tasks")) },
      { id: "a-notes", group: "Actions", title: "Go to Notes", icon: NotebookPen, run: go(() => router.navigate("/notes")) },
      { id: "a-courses", group: "Actions", title: "Go to Courses & grades", icon: BookOpen, keywords: "gwa grades", run: go(() => router.navigate("/courses")) },
      { id: "a-import", group: "Actions", title: "Import a calendar (.ics)", icon: Download, keywords: "uvle ics", run: go(() => router.navigate("/import")) },
      { id: "a-settings", group: "Actions", title: "Open Settings", icon: Settings, keywords: "semester term reminders backup appearance theme", run: go(() => router.navigate("/settings")) },
      { id: "a-theme", group: "Actions", title: "Toggle dark mode", icon: Moon, keywords: "light dark theme", run: go(toggleTheme) },
    ];
    const taskResults: Result[] = tasks.map((t) => ({
      id: `t-${t.id}`,
      group: "Tasks",
      title: t.title || "Untitled task",
      subtitle: t.done ? "Done" : t.due ? `Due ${formatDue(t)}` : "No date",
      icon: CircleCheck,
      keywords: (t.subtasks ?? []).map((s) => s.text).join(" "),
      run: go(() => router.navigate({ pathname: "/tasks", params: { open: t.id } })),
    }));
    const eventResults: Result[] = events.map((e) => ({
      id: `e-${e.id}`,
      group: "Events",
      title: e.title,
      subtitle: e.start === e.end ? formatShortDate(e.start) : `${formatShortDate(e.start)} – ${formatShortDate(e.end)}`,
      icon: CalendarDays,
      run: go(() => router.navigate({ pathname: "/calendar", params: { event: e.id } })),
    }));
    const noteResults: Result[] = Object.entries(canvases).flatMap(([canvasId, data]) =>
      data.items.flatMap((it): Result[] => {
        const open = go(() => router.navigate({ pathname: "/notes", params: { canvas: canvasId, item: it.id } }));
        if (it.kind === "text" && it.text.trim())
          return [{ id: `n-${it.id}`, group: "Notes", title: it.text.trim().split("\n")[0].slice(0, 80), keywords: it.text, subtitle: it.date ? formatShortDate(it.date) : "Note", icon: StickyNote, run: open }];
        if (it.kind === "todo")
          return [{ id: `n-${it.id}`, group: "Notes", title: it.title || "To-do list", keywords: it.entries.map((e) => e.text).join(" "), subtitle: `To-do · ${it.entries.length} item${it.entries.length === 1 ? "" : "s"}`, icon: ListChecks, run: open }];
        if (it.kind === "folder") return [{ id: `n-${it.id}`, group: "Notes", title: it.name || "Folder", subtitle: "Folder", icon: Folder, run: open }];
        return [];
      })
    );
    const courseResults: Result[] = courses.map((c) => ({
      id: `c-${c.id}`,
      group: "Courses",
      title: c.code,
      subtitle: c.title,
      icon: BookOpen,
      keywords: `${c.title ?? ""} ${c.instructor ?? ""}`,
      run: go(() => router.navigate("/courses")),
    }));
    return [...actions, ...taskResults, ...eventResults, ...noteResults, ...courseResults];
  }, [tasks, events, courses, canvases, go, toggleTheme]);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) {
      const upcoming = all.filter((r) => r.group === "Tasks" && r.subtitle?.startsWith("Due")).slice(0, 4);
      return [...all.filter((r) => r.group === "Actions").slice(0, 5), ...upcoming];
    }
    const scored = all
      .map((r) => {
        const title = fuzzyScore(q, r.title);
        const extra = r.keywords ? fuzzyScore(q, r.keywords) : null;
        const score = Math.max(title ?? -Infinity, extra == null ? -Infinity : extra - 150);
        return { r, score };
      })
      .filter((x) => x.score > -Infinity)
      .sort((a, b) => b.score - a.score);
    return GROUP_ORDER.flatMap((g) => scored.filter((x) => x.r.group === g).slice(0, PER_GROUP).map((x) => x.r));
  }, [all, query]);

  useEffect(() => setActive(0), [query]);

  const onKeyPress = (e: { nativeEvent: { key: string }; preventDefault?: () => void }) => {
    const key = e.nativeEvent.key;
    if (key === "ArrowDown") {
      e.preventDefault?.();
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (key === "ArrowUp") {
      e.preventDefault?.();
      setActive((i) => Math.max(0, i - 1));
    } else if (key === "Enter") {
      results[active]?.run();
    }
  };

  let lastGroup: string | null = null;
  return (
    <View>
      <DialogTitle className="sr-only">Search</DialogTitle>
      <View className="border-border flex-row items-center gap-2.5 border-b px-4">
        <Icon as={Search} size={16} className="text-muted-foreground" />
        <Input
          value={query}
          onChangeText={setQuery}
          onKeyPress={onKeyPress}
          autoFocus
          placeholder="Search tasks, events, notes…"
          accessibilityLabel="Search"
          className="h-12 flex-1 border-0 bg-transparent px-0 text-base shadow-none dark:bg-transparent web:focus-visible:ring-0"
        />
        <Text className="text-muted-foreground border-border rounded border px-1.5 py-0.5 text-[10px] font-medium">Esc</Text>
      </View>
      <ScrollView style={{ maxHeight: 380 }} keyboardShouldPersistTaps="handled" contentContainerClassName="p-2" role="list" aria-label="Results">
        {results.length === 0 ? (
          <Text className="text-muted-foreground px-3 py-8 text-center text-sm">No matches for “{query}”.</Text>
        ) : (
          results.map((r, i) => {
            const header = r.group !== lastGroup ? r.group : null;
            lastGroup = r.group;
            const on = i === active;
            return (
              <View key={r.id}>
                {header ? <Text className="text-muted-foreground px-3 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-[1px]">{header}</Text> : null}
                <Pressable
                  onPress={r.run}
                  onHoverIn={() => setActive(i)}
                  role="option"
                  aria-selected={on}
                  className={cn("flex-row items-center gap-3 rounded-lg px-3 py-2", on && "bg-accent")}
                >
                  <Icon as={r.icon} size={16} className={on ? "text-primary" : "text-muted-foreground"} />
                  <Text className="flex-1 text-sm" numberOfLines={1}>
                    {r.title}
                  </Text>
                  {r.subtitle ? (
                    <Text className="text-muted-foreground max-w-[45%] text-xs" numberOfLines={1}>
                      {r.subtitle}
                    </Text>
                  ) : null}
                </Pressable>
              </View>
            );
          })
        )}
      </ScrollView>
      <View className="border-border flex-row flex-wrap gap-x-4 gap-y-1 border-t px-4 py-2">
        <Text className="text-muted-foreground text-[11px]">↑↓ to move · Enter to open</Text>
        {Platform.OS === "web" ? <Text className="text-muted-foreground text-[11px]">N new task · T today · ← → in Calendar</Text> : null}
      </View>
    </View>
  );
}
