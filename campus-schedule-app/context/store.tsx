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
// notes. Everything lives on-device (AsyncStorage) — no account, no
// network — matching ARCHITECTURE.md's "start local-first" MVP call.
// This is the single place both the Schedule, Calendar, Courses and
// Notes screens read/write shared state.

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday

export type Meeting = {
  /** Weekdays this block recurs on. */
  days: Weekday[];
  /** 24h "HH:MM". */
  start: string;
  /** 24h "HH:MM". */
  end: string;
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

export type Note = {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
};

type StoreShape = {
  ready: boolean;

  courses: Course[];
  addCourse: (course: Omit<Course, "id">) => void;
  updateCourse: (id: string, patch: Partial<Omit<Course, "id">>) => void;
  removeCourse: (id: string) => void;

  notes: Note[];
  addNote: (note: Omit<Note, "id">) => void;
  updateNote: (id: string, patch: Partial<Omit<Note, "id">>) => void;
  removeNote: (id: string) => void;
};

const COURSES_KEY = "campus-schedule:courses:v1";
const NOTES_KEY = "campus-schedule:notes:v1";

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
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);

  // Load once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [rawCourses, rawNotes] = await Promise.all([
          AsyncStorage.getItem(COURSES_KEY),
          AsyncStorage.getItem(NOTES_KEY),
        ]);
        if (cancelled) return;
        setCourses(rawCourses ? (JSON.parse(rawCourses) as Course[]) : SEED_COURSES);
        setNotes(rawNotes ? (JSON.parse(rawNotes) as Note[]) : []);
      } catch {
        if (!cancelled) {
          setCourses(SEED_COURSES);
          setNotes([]);
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist on change (after the initial load has populated state).
  const persisted = useRef(false);
  useEffect(() => {
    if (!ready) return;
    if (!persisted.current) {
      persisted.current = true;
      return;
    }
    AsyncStorage.setItem(COURSES_KEY, JSON.stringify(courses)).catch(() => {});
    AsyncStorage.setItem(NOTES_KEY, JSON.stringify(notes)).catch(() => {});
  }, [ready, courses, notes]);

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

  const addNote = useCallback((note: Omit<Note, "id">) => {
    setNotes((prev) => [...prev, { ...note, id: uid("note") }]);
  }, []);

  const updateNote = useCallback((id: string, patch: Partial<Omit<Note, "id">>) => {
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }, []);

  const removeNote = useCallback((id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const value = useMemo<StoreShape>(
    () => ({
      ready,
      courses,
      addCourse,
      updateCourse,
      removeCourse,
      notes,
      addNote,
      updateNote,
      removeNote,
    }),
    [
      ready,
      courses,
      addCourse,
      updateCourse,
      removeCourse,
      notes,
      addNote,
      updateNote,
      removeNote,
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

export function useNotes() {
  const { ready, notes, addNote, updateNote, removeNote } = useStore();
  return { ready, notes, addNote, updateNote, removeNote };
}
