import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GENERAL_CANVAS, useAllCanvases, useCanvas, useCanvasEditor, useCourses, useScheduleRules, useSettings, useTasks } from "@/context/store";
import { useTheme } from "@/context/theme";
import { classesOnDate, display12h } from "@/lib/schedule";
import { isoDate } from "@/lib/dates";

type PipApi = { requestWindow: (options: { width: number; height: number }) => Promise<Window> };
const pipApi = () => (window as Window & { documentPictureInPicture?: PipApi }).documentPictureInPicture;

// Plain DOM keeps this small window independent of the main document's
// React Native Web stylesheet registry. The portal shares the live app store.
const css = `
.sticky-board { font: 15px/1.5 system-ui, sans-serif; height: 100%; overflow-y: auto; padding: 20px; box-sizing: border-box; }
.sticky-board * { box-sizing: border-box; }
.sticky-board .sticky-inner { width: 100%; max-width: 540px; margin: 0 auto; }
.sticky-board header, .sticky-board .sticky-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.sticky-board header { justify-content: space-between; margin-bottom: 18px; }
.sticky-board h1 { font-size: 24px; margin: 0; letter-spacing: -.6px; }
.sticky-board h2 { font-size: 15px; margin: 22px 0 8px; }
.sticky-board p { margin: 6px 0; }
.sticky-board .hint { color: var(--sticky-muted); font-size: 12px; }
.sticky-board button, .sticky-board select { font: inherit; color: inherit; background: var(--sticky-card); border: 1px solid var(--sticky-border); border-radius: 9px; min-height: 44px; padding: 8px 12px; cursor: pointer; }
.sticky-board button:disabled { opacity: .55; cursor: default; }
.sticky-board button:focus-visible, .sticky-board select:focus-visible, .sticky-board textarea:focus-visible { outline: 3px solid var(--sticky-accent); outline-offset: 2px; }
.sticky-board .primary { background: var(--sticky-accent); color: var(--sticky-on-accent); border-color: transparent; }
.sticky-board select { flex: 1; min-width: 0; width: 100%; }
.sticky-board textarea { display: block; width: 100%; min-height: 180px; resize: vertical; margin-top: 10px; padding: 18px; border: 1px solid #c5b577; border-radius: 3px 3px 16px 3px; background: #fff3bd; color: #302b1d; font: 17px/1.6 system-ui, sans-serif; box-shadow: 0 6px 16px #0000000d; }
.sticky-board ul { list-style: none; padding: 0; margin: 0; }
.sticky-board li { padding: 10px 0; border-bottom: 1px solid var(--sticky-border); overflow-wrap: anywhere; }
.sticky-board .class-time { display: block; color: var(--sticky-muted); font-size: 13px; }
.sticky-board .task { display: flex; gap: 10px; align-items: flex-start; }
.sticky-board .task input { width: 20px; height: 20px; flex-shrink: 0; margin-top: 4px; accent-color: var(--sticky-accent); }
.sticky-board .task label { cursor: pointer; flex: 1; min-height: 32px; }
@media (max-width: 360px) { .sticky-board { padding: 12px; } }
`;

export function StickyBoard() {
  const theme = useTheme();
  const { ready, settings, updateSettings, storageError } = useSettings();
  const canvases = useAllCanvases();
  const { addItem } = useCanvas(GENERAL_CANVAS);
  const { updateItem } = useCanvasEditor();
  const { courses } = useCourses();
  const rules = useScheduleRules();
  const { tasks, updateTask } = useTasks();
  const [now, setNow] = useState(() => new Date());
  const [supported, setSupported] = useState(false);
  const [floating, setFloating] = useState<Window | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const floatingRef = useRef<Window | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    setSupported(!!pipApi() && window.isSecureContext);
    const refresh = () => setNow(new Date());
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      floatingRef.current?.close();
    };
  }, []);

  const notes = Object.entries(canvases).flatMap(([canvasId, canvas]) =>
    canvas.items.flatMap((item) => item.kind === "text" ? [{ ...item, canvasId }] : [])
  );
  const note = notes.find((n) => n.id === settings.stickyNoteId) ?? notes[0];
  const today = isoDate(now);
  const classes = classesOnDate(courses, today, rules);
  const minutes = now.getHours() * 60 + now.getMinutes();
  const pending = tasks.filter((t) => !t.done).sort((a, b) =>
    (a.due ?? "9999").localeCompare(b.due ?? "9999") || (a.dueTime ?? "23:59").localeCompare(b.dueTime ?? "23:59") || a.createdAt - b.createdAt
  );

  async function openFloating() {
    if (floatingRef.current && !floatingRef.current.closed) { floatingRef.current.focus(); return; }
    setError("");
    setOpening(true);
    try {
      const api = pipApi();
      if (!api) throw new Error("unsupported");
      // Keep requestWindow directly inside the click's user activation.
      const win = await api.requestWindow({ width: 380, height: 620 });
      if (!mounted.current) { win.close(); return; }
      win.document.title = "Isked · Sticky view";
      win.document.body.style.margin = "0";
      win.document.documentElement.style.height = "100%";
      win.document.body.style.height = "100%";
      floatingRef.current = win;
      win.addEventListener("pagehide", () => {
        if (floatingRef.current === win) {
          floatingRef.current = null;
          if (mounted.current) setFloating(null);
        }
      }, { once: true });
      setFloating(win);
    } catch {
      if (mounted.current) setError("Couldn't open a floating window. Try again in a supported desktop browser, or keep using this compact view.");
    } finally {
      if (mounted.current) setOpening(false);
    }
  }

  const board = (
    <section className="sticky-board" aria-label="Sticky view" style={{
      background: theme.bg, color: theme.text, colorScheme: theme.scheme,
      "--sticky-muted": theme.muted, "--sticky-card": theme.card,
      "--sticky-border": theme.border, "--sticky-accent": theme.accent, "--sticky-on-accent": theme.onAccent,
    } as React.CSSProperties}>
      <style>{css}</style>
      <div className="sticky-inner">
        <header>
          <div><h1>Sticky view</h1><p className="hint">{now.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</p></div>
          {floating ? <button onClick={() => floating.close()}>Dock back</button> : <button onClick={() => router.replace("/notes")}>Back to Notes</button>}
        </header>
        {!ready ? <p role="status">Loading your notes…</p> : <>
          <div className="sticky-tools">
            <select aria-label="Sticky note" value={note?.id ?? ""} disabled={!notes.length} onChange={(e) => updateSettings({ stickyNoteId: e.target.value })}>
              {!notes.length && <option value="">No notes yet</option>}
              {notes.map((n) => <option key={n.id} value={n.id}>{n.text.trim().split("\n")[0].slice(0, 65) || "Untitled note"}</option>)}
            </select>
            <button onClick={() => {
              const id = addItem({ kind: "text", text: "", color: "#FFF7C2", x: 40 + (notes.length % 6) * 18, y: 40 + (notes.length % 6) * 18 });
              updateSettings({ stickyNoteId: id });
            }}>New note</button>
          </div>
          {note ? <textarea key={note.id} aria-label="Note text" placeholder="Something to remember…" value={note.text} onChange={(e) => updateItem(note.canvasId, note.id, { text: e.target.value })} /> : <p className="hint">Create a note, or choose one from your Notes canvases.</p>}
          <p className="hint">Edits save automatically to Notes.</p>
          {storageError && <p role="alert">Changes couldn&apos;t be saved: {storageError}</p>}
          <h2>Today&apos;s classes</h2>
          {classes.length ? <ul>{classes.map((c) => <li key={`${c.course.id}-${c.meeting.start}-${c.meeting.end}`}>
            <strong>{c.course.code}</strong>{minutes >= c.startMin && minutes < c.endMin ? " · Now" : minutes >= c.endMin ? " · Finished" : ""}
            <span className="class-time">{display12h(c.meeting.start)}–{display12h(c.meeting.end)}{c.meeting.room ? ` · ${c.meeting.room}` : ""}</span>
          </li>)}</ul> : <p className="hint">No classes scheduled today.</p>}
          <h2>Tasks · {pending.length} remaining</h2>
          {pending.length ? <ul>{pending.slice(0, 5).map((task) => <li className="task" key={task.id}>
            <input id={`sticky-task-${task.id}`} type="checkbox" checked={false} onChange={() => updateTask(task.id, { done: true })} />
            <label htmlFor={`sticky-task-${task.id}`}>{task.title}<span className="class-time">{task.due ? `${task.due < today ? "Overdue · " : task.due === today ? "Today · " : ""}${task.due}${task.dueTime ? ` · ${display12h(task.dueTime)}` : ""}` : "No due date"}</span></label>
          </li>)}</ul> : <p className="hint">All caught up.</p>}
          {pending.length > 5 && <p className="hint">Showing the next 5 tasks.</p>}
        </>}
        {!floating && <>
          <div className="sticky-tools" style={{ marginTop: 22 }}>
            {supported && <button className="primary" disabled={opening || !ready} onClick={openFloating}>{opening ? "Opening…" : "Float on desktop"}</button>}
          </div>
          <p className="hint">{supported ? "Floats above other windows. Keep this app page open; closing or leaving it closes the floating view." : "Use this compact view on your phone or laptop. Floating above other apps needs a desktop browser with Document Picture-in-Picture support."}</p>
          <p className="hint">On supported devices, long-press or right-click the installed Isked icon → Sticky view. This is an app shortcut, not a live phone home-screen widget.</p>
          {error && <p role="alert">{error}</p>}
        </>}
      </div>
    </section>
  );

  if (!floating) return board;
  return <>
    <div style={{ padding: 24, background: theme.bg, color: theme.text, flex: 1 }}>
      <h1>Sticky view is floating</h1>
      <p>Keep this page open while you work in other apps.</p>
      <button onClick={() => floating.close()} style={{ padding: 12 }}>Dock back</button>
    </div>
    {createPortal(board, floating.document.body)}
  </>;
}
