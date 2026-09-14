import type { CanvasData, Course } from "@/context/store";

// Names for note canvases (General, each course, and folders inside them),
// so a task can link to "CMSC 21 › Lab 3" and open it.

/** Same id as GENERAL_CANVAS in context/store (kept type-only so plain Node tests can load this file). */
const GENERAL_CANVAS = "general";

export type CanvasOption = { id: string; label: string };

export function canvasOptions(canvases: Record<string, CanvasData>, courses: Course[]): CanvasOption[] {
  const roots = new Map<string, string>([[GENERAL_CANVAS, "General"], ...courses.map((c) => [c.id, c.code] as [string, string])]);
  const folders = new Map<string, { name: string; parent: string }>();
  for (const [canvasId, data] of Object.entries(canvases)) {
    for (const it of data.items) {
      if (it.kind === "folder") folders.set(it.id, { name: it.name.trim() || "Folder", parent: canvasId });
    }
  }
  const label = (id: string): string | null => {
    const parts: string[] = [];
    let cursor = id;
    for (let guard = 0; guard < 20; guard++) {
      const root = roots.get(cursor);
      if (root) return [root, ...parts].join(" › ");
      const folder = folders.get(cursor);
      if (!folder) return null;
      parts.unshift(folder.name);
      cursor = folder.parent;
    }
    return null;
  };
  const folderOptions = [...folders.keys()]
    .map((id) => ({ id, label: label(id) }))
    .filter((o): o is CanvasOption => !!o.label)
    .sort((a, b) => a.label.localeCompare(b.label));
  return [...[...roots.entries()].map(([id, l]) => ({ id, label: l })), ...folderOptions];
}

export function canvasLabels(canvases: Record<string, CanvasData>, courses: Course[]): Map<string, string> {
  return new Map(canvasOptions(canvases, courses).map((o) => [o.id, o.label]));
}
