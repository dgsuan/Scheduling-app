import type { CanvasData } from "@/context/store";

// Read-only notes shared with a class section: a snapshot of a notes canvas
// (text notes and to-do lists, top to bottom). Images, files and drawings
// stay private. Anything read back is re-validated before it's shown.

export type SharedNote =
  | { kind: "text"; text: string }
  | { kind: "todo"; title: string; entries: { text: string; done: boolean }[] };

/** Keep in step with supabase/migrations/0003. */
export const SHARED_NOTES_LIMIT = 200;
const TEXT_MAX = 5000;
const TITLE_MAX = 200;
const ENTRY_MAX = 300;
const ENTRIES_MAX = 100;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

function cleanNote(v: unknown): SharedNote | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.kind === "text") {
    const text = str(o.text, TEXT_MAX);
    return text.trim() ? { kind: "text", text } : null;
  }
  if (o.kind === "todo") {
    const entries = (Array.isArray(o.entries) ? o.entries : [])
      .slice(0, ENTRIES_MAX)
      .flatMap((e) => (e && typeof e === "object" ? [{ text: str((e as Record<string, unknown>).text, ENTRY_MAX), done: (e as Record<string, unknown>).done === true }] : []))
      .filter((e) => e.text.trim());
    const title = str(o.title, TITLE_MAX);
    return title.trim() || entries.length ? { kind: "todo", title, entries } : null;
  }
  return null;
}

/** Snapshot a canvas for sharing; `skipped` counts what stays private. */
export function snapshotNotes(canvas: CanvasData | undefined): { notes: SharedNote[]; skipped: number } {
  if (!canvas) return { notes: [], skipped: 0 };
  const ordered = [...canvas.items].sort((a, b) => a.y - b.y || a.x - b.x);
  const notes: SharedNote[] = [];
  let skipped = canvas.drawings.length;
  for (const it of ordered) {
    const note = it.kind === "text" || it.kind === "todo" ? cleanNote(it) : null;
    if (note && notes.length < SHARED_NOTES_LIMIT) notes.push(note);
    else if (!note) skipped++;
  }
  return { notes, skipped };
}

export function validateSharedNotes(v: unknown): SharedNote[] {
  return (Array.isArray(v) ? v : []).slice(0, SHARED_NOTES_LIMIT).flatMap((n) => {
    const note = cleanNote(n);
    return note ? [note] : [];
  });
}
