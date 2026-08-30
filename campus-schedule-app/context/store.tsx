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

// App-wide local data store: courses, per-canvas notes/drawings, and
// tasks. Everything lives on-device (AsyncStorage) — no account, no
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
  | (CanvasBase & { kind: "text"; text: string; color: string })
  | (CanvasBase & {
      kind: "todo";
      title: string;
      color: string;
      entries: TodoEntry[];
    })
  | (CanvasBase & { kind: "image"; uri: string; width: number; height: number })
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

export type Task = {
  id: string;
  title: string;
  due?: string; // ISO "YYYY-MM-DD"
  priority: Priority;
  done: boolean;
  courseId?: string;
  createdAt: number;
};

// --- Store shape -----------------------------------------------------

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
  /** Move an item (with its id) from one canvas into another (e.g. a folder). */
  moveItem: (fromCanvasId: string, toCanvasId: string, itemId: string) => void;
  /** Remove a folder item and every canvas nested beneath it. */
  removeFolder: (parentCanvasId: string, folderId: string) => void;
  addDrawing: (canvasId: string, drawing: Omit<Drawing, "id">) => void;
  updateDrawing: (canvasId: string, id: string, patch: Partial<Omit<Drawing, "id">>) => void;
  removeDrawing: (canvasId: string, id: string) => void;

  tasks: Task[];
  addTask: (task: Omit<Task, "id" | "createdAt">) => void;
  updateTask: (id: string, patch: Partial<Omit<Task, "id">>) => void;
  removeTask: (id: string) => void;
  clearCompletedTasks: () => void;
};

const COURSES_KEY = "campus-schedule:courses:v1";
const CANVASES_KEY = "campus-schedule:canvases:v2";
const TASKS_KEY = "campus-schedule:tasks:v1";

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

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [canvases, setCanvases] = useState<Record<string, CanvasData>>({});
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [rawCourses, rawCanvases, rawTasks] = await Promise.all([
          AsyncStorage.getItem(COURSES_KEY),
          AsyncStorage.getItem(CANVASES_KEY),
          AsyncStorage.getItem(TASKS_KEY),
        ]);
        if (cancelled) return;
        setCourses(rawCourses ? (JSON.parse(rawCourses) as Course[]) : SEED_COURSES);
        setCanvases(rawCanvases ? normalizeCanvases(JSON.parse(rawCanvases)) : {});
        setTasks(rawTasks ? (JSON.parse(rawTasks) as Task[]) : []);
      } catch {
        if (!cancelled) {
          setCourses(SEED_COURSES);
          setCanvases({});
          setTasks([]);
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persisted = useRef(false);
  useEffect(() => {
    if (!ready) return;
    if (!persisted.current) {
      persisted.current = true;
      return;
    }
    AsyncStorage.setItem(COURSES_KEY, JSON.stringify(courses)).catch(() => {});
    AsyncStorage.setItem(CANVASES_KEY, JSON.stringify(canvases)).catch(() => {});
    AsyncStorage.setItem(TASKS_KEY, JSON.stringify(tasks)).catch(() => {});
  }, [ready, courses, canvases, tasks]);

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
    setTasks((prev) => [
      ...prev,
      { ...task, id: uid("task"), createdAt: Date.now() },
    ]);
  }, []);
  const updateTask = useCallback(
    (id: string, patch: Partial<Omit<Task, "id">>) => {
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    },
    []
  );
  const removeTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);
  const clearCompletedTasks = useCallback(() => {
    setTasks((prev) => prev.filter((t) => !t.done));
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
      moveItem,
      removeFolder,
      addDrawing,
      updateDrawing,
      removeDrawing,
      tasks,
      addTask,
      updateTask,
      removeTask,
      clearCompletedTasks,
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
      moveItem,
      removeFolder,
      addDrawing,
      updateDrawing,
      removeDrawing,
      tasks,
      addTask,
      updateTask,
      removeTask,
      clearCompletedTasks,
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
    moveItemTo: (toCanvasId: string, id: string) => s.moveItem(canvasId, toCanvasId, id),
    removeFolder: (folderId: string) => s.removeFolder(canvasId, folderId),
    addDrawing: (drawing: Omit<Drawing, "id">) => s.addDrawing(canvasId, drawing),
    updateDrawing: (id: string, patch: Partial<Omit<Drawing, "id">>) =>
      s.updateDrawing(canvasId, id, patch),
    removeDrawing: (id: string) => s.removeDrawing(canvasId, id),
  };
}

export function useTasks() {
  const {
    ready,
    tasks,
    addTask,
    updateTask,
    removeTask,
    clearCompletedTasks,
  } = useStore();
  return { ready, tasks, addTask, updateTask, removeTask, clearCompletedTasks };
}
