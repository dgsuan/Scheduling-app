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

// App-wide local data store: the student's courses and their canvas
// items. Everything lives on-device (AsyncStorage) — no account, no
// network — matching ARCHITECTURE.md's "start local-first" MVP call.

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday

export type Meeting = {
  days: Weekday[];
  start: string; // 24h "HH:MM"
  end: string; // 24h "HH:MM"
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
  /** Points in drawing-surface coordinates. */
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
  | (CanvasBase & {
      kind: "image";
      uri: string;
      width: number;
      height: number;
    })
  | (CanvasBase & {
      kind: "drawing";
      color: string;
      strokes: Stroke[];
      width: number;
      height: number;
    })
  | (CanvasBase & {
      kind: "document";
      uri: string;
      name: string;
      mimeType?: string;
      size?: number;
    });

export type CanvasItemKind = CanvasItem["kind"];

type DistributiveOmit<T, K extends keyof any> = T extends unknown
  ? Omit<T, K>
  : never;
export type NewCanvasItem = DistributiveOmit<CanvasItem, "id">;

type StoreShape = {
  ready: boolean;

  courses: Course[];
  addCourse: (course: Omit<Course, "id">) => void;
  updateCourse: (id: string, patch: Partial<Omit<Course, "id">>) => void;
  removeCourse: (id: string) => void;

  items: CanvasItem[];
  addItem: (item: NewCanvasItem) => void;
  updateItem: (id: string, patch: Partial<CanvasItem>) => void;
  removeItem: (id: string) => void;
};

const COURSES_KEY = "campus-schedule:courses:v1";
const CANVAS_KEY = "campus-schedule:canvas:v1";

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

const StoreContext = createContext<StoreShape | null>(null);

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [items, setItems] = useState<CanvasItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [rawCourses, rawCanvas] = await Promise.all([
          AsyncStorage.getItem(COURSES_KEY),
          AsyncStorage.getItem(CANVAS_KEY),
        ]);
        if (cancelled) return;
        setCourses(rawCourses ? (JSON.parse(rawCourses) as Course[]) : SEED_COURSES);
        setItems(rawCanvas ? (JSON.parse(rawCanvas) as CanvasItem[]) : []);
      } catch {
        if (!cancelled) {
          setCourses(SEED_COURSES);
          setItems([]);
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
    AsyncStorage.setItem(CANVAS_KEY, JSON.stringify(items)).catch(() => {});
  }, [ready, courses, items]);

  const addCourse = useCallback((course: Omit<Course, "id">) => {
    setCourses((prev) => [...prev, { ...course, id: uid("course") }]);
  }, []);
  const updateCourse = useCallback(
    (id: string, patch: Partial<Omit<Course, "id">>) => {
      setCourses((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    },
    []
  );
  const removeCourse = useCallback((id: string) => {
    setCourses((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const addItem = useCallback((item: NewCanvasItem) => {
    setItems((prev) => [...prev, { ...(item as CanvasItem), id: uid("item") }]);
  }, []);

  const updateItem = useCallback((id: string, patch: Partial<CanvasItem>) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? ({ ...it, ...patch } as CanvasItem) : it))
    );
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }, []);

  const value = useMemo<StoreShape>(
    () => ({
      ready,
      courses,
      addCourse,
      updateCourse,
      removeCourse,
      items,
      addItem,
      updateItem,
      removeItem,
    }),
    [
      ready,
      courses,
      addCourse,
      updateCourse,
      removeCourse,
      items,
      addItem,
      updateItem,
      removeItem,
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

export function useCanvas() {
  const { ready, items, addItem, updateItem, removeItem } = useStore();
  return { ready, items, addItem, updateItem, removeItem };
}
