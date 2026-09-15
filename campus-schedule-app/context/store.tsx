import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { colors } from "@/constants/theme";
import { addDaysIso, daysBetween, isoDate } from "@/lib/dates";
import type { ImportedEvent, ImportedTask } from "@/lib/ics";
import { nextRepeatDate, repeatStop } from "@/lib/recurrence";
import type { ScheduleRules } from "@/lib/schedule";
import { buildArchive, type ArchivedTerm } from "@/lib/semester";
import { emitLocalWrite } from "@/lib/syncEvents";
import { applyToSlice, type RemoteItem } from "@/lib/syncItems";

// App-wide local data store: courses, per-canvas notes/drawings, tasks,
// events, planner settings, class cancellations and grades. Everything
// lives on-device (AsyncStorage → localStorage on web) — no account, no
// network — matching ARCHITECTURE.md's "start local-first" MVP call.

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday

export type Meeting = {
  days: Weekday[];
  start: string; // stored 24h "HH:MM"
  end: string; // stored 24h "HH:MM"
  room?: string;
};

export type Course = {
  id: string;
  code: string;
  title?: string;
  section?: string;
  instructor?: string;
  color: string;
  meetings: Meeting[];
  /** Academic units, for GWA. Absent = 3. */
  units?: number;
};

// --- Canvas (Notes tab) --------------------------------------------------

export type Stroke = {
  color: string;
  width: number;
  /** Points in canvas coordinates. */
  points: { x: number; y: number }[];
};

export type TodoEntry = { id: string; text: string; done: boolean };

type CanvasBase = { id: string; x: number; y: number };

export type CanvasItem =
  | (CanvasBase & {
      kind: "text";
      text: string;
      color: string;
      /** Optional ISO dates — a dated note also shows on the Calendar. */
      date?: string;
      endDate?: string;
    })
  | (CanvasBase & {
      kind: "todo";
      title: string;
      color: string;
      entries: TodoEntry[];
    })
  | (CanvasBase & {
      kind: "image";
      uri: string;
      width: number;
      height: number;
      /** The image as first added, kept after edits so they can be reverted. */
      originalUri?: string;
      originalWidth?: number;
      originalHeight?: number;
      /** Text recognized in the image on-device, for search. */
      ocrText?: string;
      /** Fingerprint of the image `ocrText` was read from (re-read when it changes). */
      ocrOf?: string;
    })
  | (CanvasBase & {
      kind: "document";
      uri: string;
      name: string;
      mimeType?: string;
      size?: number;
    })
  // A folder is an item whose contents live in canvases[<folder id>].
  | (CanvasBase & { kind: "folder"; name: string });

export type CanvasItemKind = CanvasItem["kind"];

type DistributiveOmit<T, K extends keyof any> = T extends unknown
  ? Omit<T, K>
  : never;
export type NewCanvasItem = DistributiveOmit<CanvasItem, "id">;

export type Drawing = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Display scale (1 = natural size). */
  scale?: number;
  /** Points relative to this drawing's own top-left corner. */
  strokes: Stroke[];
};

export type CanvasData = { items: CanvasItem[]; drawings: Drawing[] };

export const GENERAL_CANVAS = "general";

// --- Tasks -------------------------------------------------------------

export type Priority = "low" | "medium" | "high";

export type Subtask = { id: string; text: string; done: boolean };

export type TaskRepeat = {
  freq: "daily" | "weekdays" | "weekly";
  /** For "weekly": which weekdays. */
  weekdays?: Weekday[];
  /** Inclusive last possible date. */
  until?: string;
};

/** Where an item came from; `key` de-duplicates re-imports. */
export type ImportSource =
  | { kind: "ics"; key: string }
  /** A deadline posted to a class section (key = post id). */
  | { kind: "section"; key: string; sectionId: string };

export type Task = {
  id: string;
  title: string;
  due?: string; // ISO "YYYY-MM-DD"
  /** Optional deadline time, stored 24h "HH:MM". Absent = end of day. */
  dueTime?: string;
  /** Optional ISO start date when the task spans several days. */
  start?: string;
  priority: Priority;
  done: boolean;
  courseId?: string;
  createdAt: number;
  /** Recurring series: the task holds its *current* occurrence. */
  repeat?: TaskRepeat;
  /** On a completed occurrence copy: the series it came from. */
  seriesId?: string;
  completedAt?: number;
  subtasks?: Subtask[];
  /** Accumulated focus-timer time. */
  timeSpentSec?: number;
  /** Focus seconds per day ("YYYY-MM-DD" → seconds), for weekly stats. */
  focusLog?: Record<string, number>;
  /** Notes canvas (General, a course, or a folder) this task works from. */
  noteRef?: { canvasId: string };
  /** On the task board: being worked on now (shown in Friend activity when shared). */
  status?: "doing";
  /** When it moved to Doing. */
  startedAt?: number;
  /** Never shown in Friend activity. */
  private?: boolean;
  source?: ImportSource;
};

// --- Calendar events ---------------------------------------------------

export type CalendarEvent = {
  id: string;
  title: string;
  start: string; // ISO "YYYY-MM-DD"
  end: string; // ISO "YYYY-MM-DD", inclusive, >= start
  /** Both times set = timed event (stored 24h "HH:MM"); otherwise all-day. */
  startTime?: string;
  endTime?: string;
  createdAt: number;
  source?: ImportSource;
};

/** A text note (from any canvas) that carries a date. */
export type DatedNote = Extract<CanvasItem, { kind: "text" }> & {
  canvasId: string;
  date: string;
};

// --- Schedule settings & exceptions ------------------------------------

/** A single class occurrence the user marked as not happening. */
export type Cancellation = {
  id: string;
  courseId: string;
  date: string; // ISO
  /** The meeting's start "HH:MM" — identifies which meeting that day. */
  start: string;
  createdAt: number;
};

export type ReminderSettings = {
  enabled: boolean;
  classLeadMin: number;
  taskLeadMin: number;
};

export type PlannerSettings = {
  term?: { start: string; end: string };
  skipRegularHolidays: boolean;
  skipSpecialHolidays: boolean;
  reminders: ReminderSettings;
  /** Class-section deadlines the user deleted, so refreshes don't bring them back. */
  dismissedSectionPosts?: string[];
  /** Semesters ended with "End semester": courses and grades, kept for GWA. */
  archivedTerms?: ArchivedTerm[];
  /** The Home "Get set up" checklist was hidden. */
  onboardingDismissed?: boolean;
  /** Recognize text in note images so search can find it. */
  imageTextSearch?: boolean;
  /** Last Guide version seen (hides the "New in this update" banner). */
  seenGuideVersion?: number;
  /** Tasks screen layout. */
  tasksView?: "list" | "board";
  /** Friend activity: share the Doing task with sections and share-code contacts. */
  shareActivity?: boolean;
  /** Name shown in Friend activity (defaults to a section display name). */
  activityName?: string;
};

export const DEFAULT_SETTINGS: PlannerSettings = {
  skipRegularHolidays: true,
  skipSpecialHolidays: true,
  reminders: { enabled: false, classLeadMin: 10, taskLeadMin: 60 },
};

// --- Grades ------------------------------------------------------------

export type GradeComponent = { id: string; name: string; weight: number };
export type GradeEntry = { id: string; componentId: string; name: string; score: number; total: number };
export type CourseGrades = {
  components: GradeComponent[];
  entries: GradeEntry[];
  /** Recorded final grade (UP scale); overrides the estimate. */
  finalGrade?: number;
};

// --- Store shape -----------------------------------------------------

export type StoreSlices = {
  courses: Course[];
  canvases: Record<string, CanvasData>;
  tasks: Task[];
  events: CalendarEvent[];
  settings: PlannerSettings;
  cancellations: Cancellation[];
  grades: Record<string, CourseGrades>;
};
export type StoreSliceName = keyof StoreSlices;

/** A class-section deadline, as mirrored into the task list. */
export type SectionPostTask = {
  postId: string;
  sectionId: string;
  title: string;
  due: string;
  dueTime?: string;
  courseCode: string | null;
  createdAt: number;
};

type StoreShape = {
  ready: boolean;

  courses: Course[];
  addCourse: (course: Omit<Course, "id">) => string;
  updateCourse: (id: string, patch: Partial<Omit<Course, "id">>) => void;
  removeCourse: (id: string) => void;

  canvases: Record<string, CanvasData>;
  addItem: (canvasId: string, item: NewCanvasItem) => void;
  updateItem: (canvasId: string, id: string, patch: Partial<CanvasItem>) => void;
  removeItem: (canvasId: string, id: string) => void;
  restoreItem: (canvasId: string, item: CanvasItem) => void;
  /** Move an item (with its id) from one canvas into another (e.g. a folder). */
  moveItem: (fromCanvasId: string, toCanvasId: string, itemId: string) => void;
  /** Remove a folder item and every canvas nested beneath it. */
  removeFolder: (parentCanvasId: string, folderId: string) => void;
  addDrawing: (canvasId: string, drawing: Omit<Drawing, "id">) => void;
  updateDrawing: (canvasId: string, id: string, patch: Partial<Omit<Drawing, "id">>) => void;
  removeDrawing: (canvasId: string, id: string) => void;

  tasks: Task[];
  addTask: (task: Omit<Task, "id" | "createdAt">) => string;
  updateTask: (id: string, patch: Partial<Omit<Task, "id">>) => void;
  removeTask: (id: string) => void;
  restoreTask: (task: Task) => void;
  /** Recurring: move the series to its next date without logging a completion. */
  skipTaskOccurrence: (id: string) => void;
  setSubtaskDone: (taskId: string, subtaskId: string, done: boolean) => void;
  addTimeSpent: (taskId: string, seconds: number) => void;
  clearCompletedTasks: () => void;

  events: CalendarEvent[];
  addEvent: (event: Omit<CalendarEvent, "id" | "createdAt">) => void;
  updateEvent: (id: string, patch: Partial<Omit<CalendarEvent, "id">>) => void;
  removeEvent: (id: string) => void;
  restoreEvent: (event: CalendarEvent) => void;

  upsertImported: (items: { tasks: ImportedTask[]; events: ImportedEvent[] }) => void;

  settings: PlannerSettings;
  updateSettings: (patch: Partial<PlannerSettings>) => void;

  cancellations: Cancellation[];
  cancelClass: (c: Pick<Cancellation, "courseId" | "date" | "start">) => void;
  restoreClass: (id: string) => void;

  grades: Record<string, CourseGrades>;
  setCourseGrades: (courseId: string, grades: CourseGrades) => void;

  /** Last persistence failure (usually storage quota), for the UI to surface. */
  storageError: string | null;

  /** Replace one slice (by storage key) with data from elsewhere, e.g. cloud sync. */
  applyStored: (storageKey: string, value: unknown) => void;
  /** The latest value of every slice, including changes not rendered yet. */
  snapshot: () => StoreSlices;
  /** Apply per-item changes from cloud sync to one slice. */
  applySliceChanges: (name: StoreSliceName, rows: RemoteItem[]) => void;
  /** Mirror class-section deadlines (all of them, from every joined section) into tasks. */
  applySectionPosts: (posts: SectionPostTask[]) => void;
  /** Archive this term's courses and grades, then clear them for a fresh start. */
  endSemester: (opts: { label: string; keepNotes: boolean }) => ArchivedTerm;
};

export const STORAGE_KEYS = {
  courses: "campus-schedule:courses:v1",
  canvases: "campus-schedule:canvases:v2",
  tasks: "campus-schedule:tasks:v1",
  events: "campus-schedule:events:v1",
  settings: "campus-schedule:settings:v1",
  cancellations: "campus-schedule:cancellations:v1",
  grades: "campus-schedule:grades:v1",
} as const;

// Migration: an earlier build stored loose `strokes` per canvas. Fold any
// such strokes into a single movable drawing so old notes aren't lost.
function normalizeCanvases(raw: unknown): Record<string, CanvasData> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, CanvasData> = {};
  for (const [key, value] of Object.entries(raw as Record<string, any>)) {
    const items: CanvasItem[] = Array.isArray(value?.items) ? value.items : [];
    let drawings: Drawing[] = Array.isArray(value?.drawings) ? value.drawings : [];
    const legacy: Stroke[] = Array.isArray(value?.strokes) ? value.strokes : [];
    if (legacy.length) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const s of legacy)
        for (const p of s.points ?? []) {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        }
      if (isFinite(minX)) {
        drawings = [
          ...drawings,
          {
            id: uid("draw"),
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
            strokes: legacy.map((s) => ({
              ...s,
              points: (s.points ?? []).map((p) => ({ x: p.x - minX, y: p.y - minY })),
            })),
          },
        ];
      }
    }
    out[key] = { items, drawings };
  }
  return out;
}

function normalizeSettings(raw: unknown): PlannerSettings {
  const s = (raw && typeof raw === "object" ? raw : {}) as Partial<PlannerSettings>;
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    reminders: { ...DEFAULT_SETTINGS.reminders, ...(s.reminders ?? {}) },
  };
}

const SEED_COURSES: Course[] = [
  {
    id: "seed-cmsc13",
    code: "CMSC 13",
    title: "Programming in C",
    section: "N",
    instructor: "",
    color: colors.courseColors[0],
    meetings: [
      { days: [1, 3], start: "14:30", end: "16:00", room: "CS Laboratory 2" },
    ],
  },
];

const EMPTY_CANVAS: CanvasData = { items: [], drawings: [] };

const StoreContext = createContext<StoreShape | null>(null);

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

/**
 * Completing a recurring task: log a done copy of this occurrence and move
 * the series to its next date (or simply finish it after the last one).
 */
function rollSeries(task: Task, merged: Task, settings: PlannerSettings, logCompletion: boolean): Task[] {
  const stop = repeatStop(merged, settings.term?.end);
  const next = merged.repeat && merged.due ? nextRepeatDate(merged.repeat, merged.due, stop) : null;
  if (!next) return logCompletion ? [{ ...merged, done: true, completedAt: Date.now() }] : [];
  const span = merged.start && merged.due ? daysBetween(merged.start, merged.due) : 0;
  const series: Task = {
    ...merged,
    done: false,
    completedAt: undefined,
    due: next,
    start: merged.start ? addDaysIso(next, -span) : undefined,
    subtasks: merged.subtasks?.map((s) => ({ ...s, done: false })),
    timeSpentSec: undefined,
    focusLog: undefined,
  };
  if (!logCompletion) return [series];
  const copy: Task = {
    ...merged,
    id: uid("task"),
    done: true,
    completedAt: Date.now(),
    repeat: undefined,
    seriesId: task.id,
  };
  return [copy, series];
}

/** Persist one slice whenever it changes (after the initial load). */
function usePersist(key: string, value: unknown, ready: boolean, onError: (e: unknown) => void) {
  const first = useRef(true);
  useEffect(() => {
    if (!ready) return;
    if (first.current) {
      first.current = false;
      return;
    }
    const json = JSON.stringify(value);
    AsyncStorage.setItem(key, json)
      .then(() => emitLocalWrite(key, json))
      .catch(onError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key, value]);
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [canvases, setCanvases] = useState<Record<string, CanvasData>>({});
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [settings, setSettings] = useState<PlannerSettings>(DEFAULT_SETTINGS);
  const [cancellations, setCancellations] = useState<Cancellation[]>([]);
  const [grades, setGrades] = useState<Record<string, CourseGrades>>({});
  const [storageError, setStorageError] = useState<string | null>(null);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const keys = Object.values(STORAGE_KEYS);
        const pairs = await AsyncStorage.multiGet(keys);
        if (cancelled) return;
        const raw = Object.fromEntries(pairs) as Record<string, string | null>;
        const parse = <T,>(key: string, fallback: T): T => {
          const v = raw[key];
          if (v == null) return fallback;
          try {
            return JSON.parse(v) as T;
          } catch {
            return fallback;
          }
        };
        setCourses(raw[STORAGE_KEYS.courses] ? parse(STORAGE_KEYS.courses, SEED_COURSES) : SEED_COURSES);
        setCanvases(normalizeCanvases(parse(STORAGE_KEYS.canvases, {})));
        setTasks(parse(STORAGE_KEYS.tasks, []));
        setEvents(parse(STORAGE_KEYS.events, []));
        setSettings(normalizeSettings(parse(STORAGE_KEYS.settings, {})));
        setCancellations(parse(STORAGE_KEYS.cancellations, []));
        setGrades(parse(STORAGE_KEYS.grades, {}));
      } catch {
        if (!cancelled) setCourses(SEED_COURSES);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onPersistError = useCallback((e: unknown) => {
    const quota = e instanceof Error && /quota|exceeded/i.test(`${e.name} ${e.message}`);
    setStorageError(
      quota
        ? "Storage is full — your latest changes couldn't be saved. Remove large images or export a backup."
        : "Couldn't save your latest changes."
    );
  }, []);

  usePersist(STORAGE_KEYS.courses, courses, ready, onPersistError);
  usePersist(STORAGE_KEYS.canvases, canvases, ready, onPersistError);
  usePersist(STORAGE_KEYS.tasks, tasks, ready, onPersistError);
  usePersist(STORAGE_KEYS.events, events, ready, onPersistError);
  usePersist(STORAGE_KEYS.settings, settings, ready, onPersistError);
  usePersist(STORAGE_KEYS.cancellations, cancellations, ready, onPersistError);
  usePersist(STORAGE_KEYS.grades, grades, ready, onPersistError);

  // Courses ----------------------------------------------------------
  const addCourse = useCallback((course: Omit<Course, "id">) => {
    const id = uid("course");
    setCourses((prev) => [...prev, { ...course, id }]);
    return id;
  }, []);
  const updateCourse = useCallback(
    (id: string, patch: Partial<Omit<Course, "id">>) => {
      setCourses((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    },
    []
  );
  const removeCourse = useCallback((id: string) => {
    setCourses((prev) => prev.filter((c) => c.id !== id));
    setCanvases((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setTasks((prev) => prev.map((t) => (t.courseId === id ? { ...t, courseId: undefined } : t)));
    setCancellations((prev) => prev.filter((c) => c.courseId !== id));
    setGrades((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  // Canvas ----------------------------------------------------------
  const mutateCanvas = useCallback(
    (canvasId: string, fn: (c: CanvasData) => CanvasData) => {
      setCanvases((prev) => {
        const current = prev[canvasId] ?? EMPTY_CANVAS;
        return { ...prev, [canvasId]: fn(current) };
      });
    },
    []
  );

  const addItem = useCallback(
    (canvasId: string, item: NewCanvasItem) => {
      mutateCanvas(canvasId, (c) => ({
        ...c,
        items: [...c.items, { ...(item as CanvasItem), id: uid("item") }],
      }));
    },
    [mutateCanvas]
  );
  const updateItem = useCallback(
    (canvasId: string, id: string, patch: Partial<CanvasItem>) => {
      mutateCanvas(canvasId, (c) => ({
        ...c,
        items: c.items.map((it) =>
          it.id === id ? ({ ...it, ...patch } as CanvasItem) : it
        ),
      }));
    },
    [mutateCanvas]
  );
  const removeItem = useCallback(
    (canvasId: string, id: string) => {
      mutateCanvas(canvasId, (c) => ({
        ...c,
        items: c.items.filter((it) => it.id !== id),
      }));
    },
    [mutateCanvas]
  );
  const restoreItem = useCallback(
    (canvasId: string, item: CanvasItem) => {
      mutateCanvas(canvasId, (c) =>
        c.items.some((it) => it.id === item.id) ? c : { ...c, items: [...c.items, item] }
      );
    },
    [mutateCanvas]
  );
  const moveItem = useCallback(
    (fromCanvasId: string, toCanvasId: string, itemId: string) => {
      if (fromCanvasId === toCanvasId) return;
      setCanvases((prev) => {
        const from = prev[fromCanvasId] ?? EMPTY_CANVAS;
        const item = from.items.find((it) => it.id === itemId);
        if (!item) return prev;
        const to = prev[toCanvasId] ?? EMPTY_CANVAS;
        const step = to.items.length % 6;
        return {
          ...prev,
          [fromCanvasId]: { ...from, items: from.items.filter((it) => it.id !== itemId) },
          [toCanvasId]: {
            ...to,
            items: [...to.items, { ...item, x: 40 + step * 18, y: 40 + step * 18 }],
          },
        };
      });
    },
    []
  );
  const removeFolder = useCallback((parentCanvasId: string, folderId: string) => {
    setCanvases((prev) => {
      // Breadth-first collect every canvas nested under this folder.
      const doomed: string[] = [];
      const queue: string[] = [folderId];
      while (queue.length) {
        const cid = queue.shift() as string;
        doomed.push(cid);
        const data = prev[cid];
        if (!data) continue;
        for (const it of data.items) {
          if (it.kind === "folder") queue.push(it.id);
        }
      }
      const next: Record<string, CanvasData> = { ...prev };
      for (const cid of doomed) delete next[cid];
      const parent = next[parentCanvasId] ?? EMPTY_CANVAS;
      next[parentCanvasId] = {
        ...parent,
        items: parent.items.filter((it) => it.id !== folderId),
      };
      return next;
    });
  }, []);
  const addDrawing = useCallback(
    (canvasId: string, drawing: Omit<Drawing, "id">) => {
      mutateCanvas(canvasId, (c) => ({
        ...c,
        drawings: [...c.drawings, { ...drawing, id: uid("draw") }],
      }));
    },
    [mutateCanvas]
  );
  const updateDrawing = useCallback(
    (canvasId: string, id: string, patch: Partial<Omit<Drawing, "id">>) => {
      mutateCanvas(canvasId, (c) => ({
        ...c,
        drawings: c.drawings.map((d) => (d.id === id ? { ...d, ...patch } : d)),
      }));
    },
    [mutateCanvas]
  );
  const removeDrawing = useCallback(
    (canvasId: string, id: string) => {
      mutateCanvas(canvasId, (c) => ({
        ...c,
        drawings: c.drawings.filter((d) => d.id !== id),
      }));
    },
    [mutateCanvas]
  );

  // Tasks ----------------------------------------------------------
  const addTask = useCallback((task: Omit<Task, "id" | "createdAt">) => {
    const id = uid("task");
    setTasks((prev) => [...prev, { ...task, id, createdAt: Date.now() }]);
    return id;
  }, []);
  const updateTask = useCallback((id: string, patch: Partial<Omit<Task, "id">>) => {
    setTasks((prev) =>
      prev.flatMap((t) => {
        if (t.id !== id) return [t];
        const merged: Task = { ...t, ...patch };
        if (patch.done === true && !t.done) {
          // Finishing leaves the board's Doing column and records when.
          merged.status = undefined;
          merged.startedAt = undefined;
          merged.completedAt = patch.completedAt ?? Date.now();
        } else if (patch.done === false && t.done) {
          merged.completedAt = undefined;
        }
        if (patch.done === true && !t.done && t.repeat && t.due) {
          return rollSeries(t, merged, settingsRef.current, true);
        }
        return [merged];
      })
    );
  }, []);
  const removeTask = useCallback((id: string) => {
    const task = tasksRef.current.find((t) => t.id === id);
    if (task?.source?.kind === "section") {
      // Remember it, or the next refresh of the section would bring it back.
      const postId = task.source.key;
      setSettings((prev) =>
        normalizeSettings({
          ...prev,
          dismissedSectionPosts: [...(prev.dismissedSectionPosts ?? []).filter((p) => p !== postId), postId].slice(-500),
        })
      );
    }
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);
  const restoreTask = useCallback((task: Task) => {
    if (task.source?.kind === "section") {
      const postId = task.source.key;
      setSettings((prev) =>
        prev.dismissedSectionPosts?.includes(postId)
          ? normalizeSettings({ ...prev, dismissedSectionPosts: prev.dismissedSectionPosts.filter((p) => p !== postId) })
          : prev
      );
    }
    setTasks((prev) => (prev.some((t) => t.id === task.id) ? prev : [...prev, task]));
  }, []);
  const skipTaskOccurrence = useCallback((id: string) => {
    setTasks((prev) =>
      prev.flatMap((t) => (t.id === id && t.repeat ? rollSeries(t, t, settingsRef.current, false) : [t]))
    );
  }, []);
  const setSubtaskDone = useCallback(
    (taskId: string, subtaskId: string, done: boolean) => {
      const task = tasksRef.current.find((t) => t.id === taskId);
      if (!task?.subtasks) return;
      const subtasks = task.subtasks.map((s) => (s.id === subtaskId ? { ...s, done } : s));
      const allDone = subtasks.length > 0 && subtasks.every((s) => s.done);
      // Finishing the last step finishes the task; unticking a step reopens it.
      updateTask(taskId, {
        subtasks,
        ...(allDone && !task.done ? { done: true } : !done && task.done ? { done: false } : {}),
      });
    },
    [updateTask]
  );
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const addTimeSpent = useCallback((taskId: string, seconds: number) => {
    if (seconds <= 0) return;
    const day = isoDate(new Date());
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t;
        const focusLog = { ...(t.focusLog ?? {}) };
        focusLog[day] = Math.round((focusLog[day] ?? 0) + seconds);
        // Keep about four months of days.
        const days = Object.keys(focusLog).sort();
        for (const old of days.slice(0, Math.max(0, days.length - 120))) delete focusLog[old];
        return { ...t, timeSpentSec: Math.round((t.timeSpentSec ?? 0) + seconds), focusLog };
      })
    );
  }, []);
  const clearCompletedTasks = useCallback(() => {
    setTasks((prev) => prev.filter((t) => !t.done));
  }, []);

  // Events ---------------------------------------------------------
  const addEvent = useCallback((event: Omit<CalendarEvent, "id" | "createdAt">) => {
    setEvents((prev) => [...prev, { ...event, id: uid("event"), createdAt: Date.now() }]);
  }, []);
  const updateEvent = useCallback(
    (id: string, patch: Partial<Omit<CalendarEvent, "id">>) => {
      setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    },
    []
  );
  const removeEvent = useCallback((id: string) => {
    setEvents((prev) => prev.filter((e) => e.id !== id));
  }, []);
  const restoreEvent = useCallback((event: CalendarEvent) => {
    setEvents((prev) => (prev.some((e) => e.id === event.id) ? prev : [...prev, event]));
  }, []);

  // Import: update items already imported (matched by source key), add new ones.
  const upsertImported = useCallback((items: { tasks: ImportedTask[]; events: ImportedEvent[] }) => {
    if (items.tasks.length) {
      setTasks((prev) => {
        const byKey = new Map(items.tasks.map((t) => [t.source.key, t]));
        const seen = new Set<string>();
        const updated = prev.map((t) => {
          const incoming = t.source && byKey.get(t.source.key);
          if (!incoming) return t;
          seen.add(t.source!.key);
          return { ...t, title: incoming.title, due: incoming.due, dueTime: incoming.dueTime, courseId: t.courseId ?? incoming.courseId };
        });
        const added = items.tasks
          .filter((t) => !seen.has(t.source.key))
          .map((t) => ({ ...t, id: uid("task"), createdAt: Date.now(), done: false }));
        return [...updated, ...added];
      });
    }
    if (items.events.length) {
      setEvents((prev) => {
        const byKey = new Map(items.events.map((e) => [e.source.key, e]));
        const seen = new Set<string>();
        const updated = prev.map((e) => {
          const incoming = e.source && byKey.get(e.source.key);
          if (!incoming) return e;
          seen.add(e.source!.key);
          return { ...e, ...incoming };
        });
        const added = items.events
          .filter((e) => !seen.has(e.source.key))
          .map((e) => ({ ...e, id: uid("event"), createdAt: Date.now() }));
        return [...updated, ...added];
      });
    }
  }, []);

  // Settings, cancellations, grades ----------------------------------
  const updateSettings = useCallback((patch: Partial<PlannerSettings>) => {
    setSettings((prev) => normalizeSettings({ ...prev, ...patch }));
  }, []);
  const cancelClass = useCallback((c: Pick<Cancellation, "courseId" | "date" | "start">) => {
    setCancellations((prev) =>
      prev.some((x) => x.courseId === c.courseId && x.date === c.date && x.start === c.start)
        ? prev
        : [...prev, { ...c, id: uid("cancel"), createdAt: Date.now() }]
    );
  }, []);
  const restoreClass = useCallback((id: string) => {
    setCancellations((prev) => prev.filter((c) => c.id !== id));
  }, []);
  const setCourseGrades = useCallback((courseId: string, g: CourseGrades) => {
    setGrades((prev) => ({ ...prev, [courseId]: g }));
  }, []);

  // Sync --------------------------------------------------------------
  const applyStored = useCallback((storageKey: string, value: unknown) => {
    const list = <T,>(v: unknown) => (Array.isArray(v) ? (v as T[]) : []);
    const obj = <T,>(v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as T) : ({} as T));
    switch (storageKey) {
      case STORAGE_KEYS.courses:
        setCourses(list<Course>(value));
        break;
      case STORAGE_KEYS.canvases:
        setCanvases(normalizeCanvases(value));
        break;
      case STORAGE_KEYS.tasks:
        setTasks(list<Task>(value));
        break;
      case STORAGE_KEYS.events:
        setEvents(list<CalendarEvent>(value));
        break;
      case STORAGE_KEYS.settings:
        setSettings(normalizeSettings(value));
        break;
      case STORAGE_KEYS.cancellations:
        setCancellations(list<Cancellation>(value));
        break;
      case STORAGE_KEYS.grades:
        setGrades(obj<Record<string, CourseGrades>>(value));
        break;
    }
  }, []);

  // Latest values, updated on render and eagerly by applySliceChanges, so
  // sync never reads a slice that's older than what it just applied.
  const slicesRef = useRef<StoreSlices>({ courses, canvases, tasks, events, settings, cancellations, grades });
  slicesRef.current = { courses, canvases, tasks, events, settings, cancellations, grades };
  const snapshot = useCallback(() => slicesRef.current, []);

  const applySliceChanges = useCallback((name: StoreSliceName, rows: RemoteItem[]) => {
    if (!rows.length) return;
    const next = (prev: unknown): any => {
      const v = applyToSlice(name, prev, rows);
      return name === "canvases" ? normalizeCanvases(v) : name === "settings" ? normalizeSettings(v) : v;
    };
    slicesRef.current = { ...slicesRef.current, [name]: next(slicesRef.current[name]) };
    const setters: Record<StoreSliceName, (fn: (prev: any) => any) => void> = {
      courses: setCourses,
      canvases: setCanvases,
      tasks: setTasks,
      events: setEvents,
      settings: setSettings,
      cancellations: setCancellations,
      grades: setGrades,
    };
    setters[name](next);
  }, []);

  const applySectionPosts = useCallback((posts: SectionPostTask[]) => {
    const normalizeCode = (s: string) => s.replace(/\s+/g, " ").trim().toUpperCase();
    setTasks((prev) => {
      const dismissed = new Set(slicesRef.current.settings.dismissedSectionPosts ?? []);
      const byPost = new Map(posts.filter((p) => !dismissed.has(p.postId)).map((p) => [p.postId, p]));
      const courseByCode = new Map(slicesRef.current.courses.map((c) => [normalizeCode(c.code), c.id]));
      const seen = new Set<string>();
      let changed = false;
      const next = prev.flatMap((t) => {
        if (t.source?.kind !== "section") return [t];
        const post = byPost.get(t.source.key);
        if (!post) {
          // Deleted post, or no longer a member. Finished ones stay as history.
          if (t.done) return [t];
          changed = true;
          return [];
        }
        seen.add(post.postId);
        if (t.title === post.title && t.due === post.due && t.dueTime === post.dueTime) return [t];
        changed = true;
        return [{ ...t, title: post.title, due: post.due, dueTime: post.dueTime }];
      });
      for (const post of byPost.values()) {
        if (seen.has(post.postId)) continue;
        changed = true;
        next.push({
          // Deterministic, so every device creates the identical task.
          id: `task-sec-${post.postId}`,
          title: post.title,
          due: post.due,
          dueTime: post.dueTime,
          priority: "medium",
          done: false,
          courseId: post.courseCode ? courseByCode.get(normalizeCode(post.courseCode)) : undefined,
          createdAt: post.createdAt,
          source: { kind: "section", key: post.postId, sectionId: post.sectionId },
        });
      }
      return changed ? next : prev;
    });
  }, []);

  const endSemester = useCallback(({ label, keepNotes }: { label: string; keepNotes: boolean }) => {
    const s = slicesRef.current;
    const archive = buildArchive({
      id: uid("term"),
      label,
      term: s.settings.term,
      courses: s.courses,
      grades: s.grades,
      tasks: s.tasks,
      archivedAt: Date.now(),
    });
    const courseIds = new Set(s.courses.map((c) => c.id));
    setCanvases((prev) => {
      const next = { ...prev };
      for (const course of s.courses) {
        const data = next[course.id];
        delete next[course.id];
        if (!keepNotes || !data || (!data.items.length && !data.drawings.length)) continue;
        // The course notebook becomes a folder in General, contents untouched.
        const folderId = uid("item");
        next[folderId] = data;
        const general = next[GENERAL_CANVAS] ?? EMPTY_CANVAS;
        const step = general.items.length % 6;
        next[GENERAL_CANVAS] = {
          ...general,
          items: [...general.items, { id: folderId, kind: "folder", name: `${course.code} · ${archive.label}`.slice(0, 80), x: 40 + step * 18, y: 40 + step * 18 }],
        };
      }
      return next;
    });
    setCourses([]);
    setGrades({});
    setCancellations([]);
    setTasks((prev) =>
      prev.filter((t) => !t.done).map((t) => (t.courseId && courseIds.has(t.courseId) ? { ...t, courseId: undefined } : t))
    );
    setSettings((prev) =>
      normalizeSettings({ ...prev, term: undefined, archivedTerms: [...(prev.archivedTerms ?? []), archive].slice(-20) })
    );
    return archive;
  }, []);

  const value = useMemo<StoreShape>(
    () => ({
      ready,
      courses,
      addCourse,
      updateCourse,
      removeCourse,
      canvases,
      addItem,
      updateItem,
      removeItem,
      restoreItem,
      moveItem,
      removeFolder,
      addDrawing,
      updateDrawing,
      removeDrawing,
      tasks,
      addTask,
      updateTask,
      removeTask,
      restoreTask,
      skipTaskOccurrence,
      setSubtaskDone,
      addTimeSpent,
      clearCompletedTasks,
      events,
      addEvent,
      updateEvent,
      removeEvent,
      restoreEvent,
      upsertImported,
      settings,
      updateSettings,
      cancellations,
      cancelClass,
      restoreClass,
      grades,
      setCourseGrades,
      storageError,
      applyStored,
      snapshot,
      applySliceChanges,
      applySectionPosts,
      endSemester,
    }),
    [
      ready,
      courses,
      addCourse,
      updateCourse,
      removeCourse,
      canvases,
      addItem,
      updateItem,
      removeItem,
      restoreItem,
      moveItem,
      removeFolder,
      addDrawing,
      updateDrawing,
      removeDrawing,
      tasks,
      addTask,
      updateTask,
      removeTask,
      restoreTask,
      skipTaskOccurrence,
      setSubtaskDone,
      addTimeSpent,
      clearCompletedTasks,
      events,
      addEvent,
      updateEvent,
      removeEvent,
      restoreEvent,
      upsertImported,
      settings,
      updateSettings,
      cancellations,
      cancelClass,
      restoreClass,
      grades,
      setCourseGrades,
      storageError,
      applyStored,
      snapshot,
      applySliceChanges,
      applySectionPosts,
      endSemester,
    ]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

function useStore(): StoreShape {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside <AppProvider>");
  return ctx;
}

export function useCourses() {
  const { ready, courses, addCourse, updateCourse, removeCourse } = useStore();
  return { ready, courses, addCourse, updateCourse, removeCourse };
}

export function useCanvas(canvasId: string) {
  const s = useStore();
  const data = s.canvases[canvasId] ?? EMPTY_CANVAS;
  return {
    ready: s.ready,
    items: data.items,
    drawings: data.drawings,
    addItem: (item: NewCanvasItem) => s.addItem(canvasId, item),
    updateItem: (id: string, patch: Partial<CanvasItem>) =>
      s.updateItem(canvasId, id, patch),
    removeItem: (id: string) => s.removeItem(canvasId, id),
    restoreItem: (item: CanvasItem) => s.restoreItem(canvasId, item),
    moveItemTo: (toCanvasId: string, id: string) => s.moveItem(canvasId, toCanvasId, id),
    removeFolder: (folderId: string) => s.removeFolder(canvasId, folderId),
    addDrawing: (drawing: Omit<Drawing, "id">) => s.addDrawing(canvasId, drawing),
    updateDrawing: (id: string, patch: Partial<Omit<Drawing, "id">>) =>
      s.updateDrawing(canvasId, id, patch),
    removeDrawing: (id: string) => s.removeDrawing(canvasId, id),
  };
}

/** Every canvas (for search and for resolving a note's folder path). */
export function useAllCanvases() {
  return useStore().canvases;
}

/** Edit an item on any canvas by id (for background work like OCR). */
export function useCanvasEditor() {
  const { updateItem } = useStore();
  return { updateItem };
}

export function useTasks() {
  const {
    ready,
    tasks,
    addTask,
    updateTask,
    removeTask,
    restoreTask,
    skipTaskOccurrence,
    setSubtaskDone,
    addTimeSpent,
    clearCompletedTasks,
  } = useStore();
  return {
    ready,
    tasks,
    addTask,
    updateTask,
    removeTask,
    restoreTask,
    skipTaskOccurrence,
    setSubtaskDone,
    addTimeSpent,
    clearCompletedTasks,
  };
}

export function useEvents() {
  const { ready, events, addEvent, updateEvent, removeEvent, restoreEvent } = useStore();
  return { ready, events, addEvent, updateEvent, removeEvent, restoreEvent };
}

export function useImport() {
  const { tasks, events, courses, upsertImported } = useStore();
  return { tasks, events, courses, upsertImported };
}

export function useSettings() {
  const { ready, settings, updateSettings, storageError } = useStore();
  return { ready, settings, updateSettings, storageError };
}

export function useCancellations() {
  const { cancellations, cancelClass, restoreClass } = useStore();
  return { cancellations, cancelClass, restoreClass };
}

export function useGrades() {
  const { grades, setCourseGrades } = useStore();
  return { grades, setCourseGrades };
}

export function useStoreSync() {
  const { ready, snapshot, applySliceChanges } = useStore();
  return { ready, snapshot, applySliceChanges };
}

export function useSemester() {
  const { settings, endSemester } = useStore();
  return { archivedTerms: settings.archivedTerms ?? [], endSemester };
}

export function useSectionTasks() {
  const { applySectionPosts } = useStore();
  return { applySectionPosts };
}

export function useStoreApply() {
  const { ready, applyStored } = useStore();
  return { ready, applyStored };
}

/** The rules every schedule computation should use (term, holidays, cancellations). */
export function useScheduleRules(): ScheduleRules {
  const { settings, cancellations } = useStore();
  return useMemo(
    () => ({
      term: settings.term,
      skipRegularHolidays: settings.skipRegularHolidays,
      skipSpecialHolidays: settings.skipSpecialHolidays,
      cancellations,
    }),
    [settings.term, settings.skipRegularHolidays, settings.skipSpecialHolidays, cancellations]
  );
}

/**
 * Dated text notes gathered from every canvas (General, courses, folders),
 * so the Calendar can show them without a separate notes model. New ones
 * land on the General canvas as ordinary sticky notes.
 */
export function useDatedNotes() {
  const s = useStore();
  const notes = useMemo(() => {
    const out: DatedNote[] = [];
    for (const [canvasId, data] of Object.entries(s.canvases)) {
      for (const it of data.items) {
        if (it.kind === "text" && it.date) out.push({ ...it, canvasId, date: it.date });
      }
    }
    return out;
  }, [s.canvases]);

  const addNote = useCallback(
    (text: string, date: string, endDate?: string) => {
      const step = (s.canvases[GENERAL_CANVAS]?.items.length ?? 0) % 6;
      s.addItem(GENERAL_CANVAS, {
        kind: "text",
        text,
        color: colors.noteColors[0],
        date,
        endDate,
        x: 40 + step * 18,
        y: 40 + step * 18,
      });
    },
    [s]
  );

  return {
    notes,
    addNote,
    updateNote: (note: DatedNote, patch: Partial<Pick<DatedNote, "text" | "date" | "endDate">>) =>
      s.updateItem(note.canvasId, note.id, patch),
    removeNote: (note: DatedNote) => s.removeItem(note.canvasId, note.id),
    restoreNote: (note: DatedNote) => {
      const { canvasId, ...item } = note;
      s.restoreItem(canvasId, item as CanvasItem);
    },
  };
}
