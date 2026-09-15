import type { Course, Task } from "@/context/store";

// The task board's columns and Friend activity ("what I'm doing"). Pure, so
// the rules are testable: which task gets shared, what a friend's row may
// contain, and how the list is ordered.

export type BoardColumn = "todo" | "doing" | "done";

export const BOARD_COLUMNS: { key: BoardColumn; title: string }[] = [
  { key: "todo", title: "Not started" },
  { key: "doing", title: "Doing" },
  { key: "done", title: "Finished" },
];

export const ACTIVITY_LIMITS = { name: 40, title: 140, courseCode: 32 } as const;
/** A finished task stays on your activity this long. */
export const FINISHED_SHOWN_MS = 6 * 3600_000;
/** Friends' rows older than this are hidden. */
export const STALE_MS = 3 * 86400_000;

export function columnOf(task: Pick<Task, "done" | "status">): BoardColumn {
  if (task.done) return "done";
  return task.status === "doing" ? "doing" : "todo";
}

/** The change that moves a task into a column. */
export function patchForColumn(column: BoardColumn, now = Date.now()): Partial<Task> {
  if (column === "doing") return { done: false, status: "doing", startedAt: now };
  if (column === "done") return { done: true };
  return { done: false, status: undefined, startedAt: undefined };
}

export type MyActivity = { status: "doing" | "finished"; title: string; courseCode: string | null; since: number };

const clip = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);

/** What to share: the newest task in Doing, else a task finished in the last few hours. Private tasks never. */
export function currentActivity(tasks: Task[], courses: Pick<Course, "id" | "code">[], now: number): MyActivity | null {
  const codeOf = (id?: string) => {
    const course = id ? courses.find((c) => c.id === id) : undefined;
    return course ? clip(course.code, ACTIVITY_LIMITS.courseCode) || null : null;
  };
  const shareable = (t: Task) => !t.private && clip(t.title, ACTIVITY_LIMITS.title).length > 0;

  const doing = tasks
    .filter((t) => !t.done && t.status === "doing" && shareable(t))
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0];
  if (doing) {
    return { status: "doing", title: clip(doing.title, ACTIVITY_LIMITS.title), courseCode: codeOf(doing.courseId), since: Math.min(doing.startedAt ?? now, now) };
  }
  const finished = tasks
    .filter((t) => t.done && t.completedAt && t.completedAt <= now && now - t.completedAt <= FINISHED_SHOWN_MS && shareable(t))
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))[0];
  if (finished) {
    return { status: "finished", title: clip(finished.title, ACTIVITY_LIMITS.title), courseCode: codeOf(finished.courseId), since: finished.completedAt! };
  }
  return null;
}

export const activityKey = (a: MyActivity | null) => (a ? `${a.status}|${a.title}|${a.courseCode ?? ""}|${a.since}` : "");

export type FriendActivity = {
  userId: string;
  name: string;
  status: "doing" | "finished";
  title: string;
  courseCode: string | null;
  since: number;
};

/** Anything read back from the server is re-checked before it's shown. */
export function validateActivityRow(row: unknown): FriendActivity | null {
  if (!row || typeof row !== "object") return null;
  const o = row as Record<string, unknown>;
  const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.length <= max ? clip(v, max) : null);
  const userId = typeof o.user_id === "string" && o.user_id ? o.user_id : null;
  const name = text(o.display_name, ACTIVITY_LIMITS.name);
  const title = text(o.title, ACTIVITY_LIMITS.title);
  const status = o.status === "doing" || o.status === "finished" ? o.status : null;
  const since = typeof o.since === "string" ? Date.parse(o.since) : NaN;
  if (!userId || !name || !title || !status || !Number.isFinite(since)) return null;
  return { userId, name, status, title, courseCode: text(o.course_code, ACTIVITY_LIMITS.courseCode), since };
}

/** One row per person, recent ones only; people doing something first, newest first. */
export function visibleFriends(list: FriendActivity[], now: number): FriendActivity[] {
  const seen = new Set<string>();
  return list
    .filter((f) => {
      if (now - f.since > STALE_MS || seen.has(f.userId)) return false;
      seen.add(f.userId);
      return true;
    })
    .sort((a, b) => (a.status === b.status ? b.since - a.since : a.status === "doing" ? -1 : 1));
}

export function timeAgo(since: number, now: number): string {
  const min = Math.max(0, Math.floor((now - since) / 60_000));
  if (min < 1) return "now";
  if (min < 60) return `${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr`;
  return `${Math.floor(hr / 24)} d`;
}

export function initials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => [...w][0]?.toUpperCase() ?? "")
    .join("");
  return letters || "?";
}
