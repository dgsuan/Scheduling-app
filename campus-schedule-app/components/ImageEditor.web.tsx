import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { EditedImage } from "@/components/ImageLightbox.types";
import { canvasToDataUrl, loadImage } from "@/lib/imageData.web";

// Canvas image editor (web): crop, rotate, pen/highlighter, brightness &
// contrast, with undo. Every operation bakes into a working canvas and
// pushes the previous one onto a history stack — simple to reason about,
// and good enough for note images. Pointer maths uses normalized (0–1)
// coordinates measured against on-screen size, so it works the same with
// mouse, touch, and the app's interface-size zoom.

type Tool = "none" | "crop" | "draw" | "adjust";
type Rect = { x: number; y: number; w: number; h: number };
type Corner = "nw" | "ne" | "sw" | "se";
type Stroke = { points: { x: number; y: number }[]; color: string; size: number; highlighter: boolean };

const MAX_HISTORY = 15;
const MIN_CROP = 0.05;
const PEN_COLORS = ["#1A1A1A", "#FFFFFF", "#E5484D", "#F2A20C", "#30A46C", "#4F8CFF"];
const HIGHLIGHT_COLORS = ["#FFE14D", "#7CF29A", "#7CC7FF", "#FF9ED0"];
const PEN_SIZES = [2, 4, 8];
const HIGHLIGHT_SIZES = [12, 20, 32];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function makeCanvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function rotated(src: HTMLCanvasElement, dir: 1 | -1) {
  const c = makeCanvas(src.height, src.width);
  const ctx = c.getContext("2d")!;
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((dir * Math.PI) / 2);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

function cropped(src: HTMLCanvasElement, r: Rect) {
  const sx = Math.round(r.x * src.width);
  const sy = Math.round(r.y * src.height);
  const sw = Math.max(1, Math.round(r.w * src.width));
  const sh = Math.max(1, Math.round(r.h * src.height));
  const c = makeCanvas(sw, sh);
  c.getContext("2d")!.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
  return c;
}

function adjusted(src: HTMLCanvasElement, brightness: number, contrast: number) {
  const out = makeCanvas(src.width, src.height);
  const ctx = out.getContext("2d")!;
  const b = 1 + brightness / 100;
  const k = 1 + contrast / 100;
  // Canvas filters where supported; otherwise the same maths per pixel (Safari).
  if (typeof (ctx as CanvasRenderingContext2D & { filter?: string }).filter === "string") {
    ctx.filter = `brightness(${b}) contrast(${k})`;
    ctx.drawImage(src, 0, 0);
    ctx.filter = "none";
    return out;
  }
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, out.width, out.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    for (let j = 0; j < 3; j++) {
      const v = (d[i + j] / 255) * b;
      d[i + j] = clamp(((v - 0.5) * k + 0.5) * 255, 0, 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

function paintStroke(ctx: CanvasRenderingContext2D, s: Stroke, w: number, h: number) {
  if (!s.points.length) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = s.color;
  ctx.lineWidth = Math.max(1, s.size * w);
  if (s.highlighter) {
    ctx.globalAlpha = 0.38;
    ctx.globalCompositeOperation = "multiply";
  }
  ctx.beginPath();
  const [first, ...rest] = s.points;
  ctx.moveTo(first.x * w, first.y * h);
  if (!rest.length) ctx.lineTo(first.x * w + 0.01, first.y * h + 0.01);
  for (const p of rest) ctx.lineTo(p.x * w, p.y * h);
  ctx.stroke();
  ctx.restore();
}

function resizeRect(r0: Rect, corner: Corner, dx: number, dy: number, square: boolean, aspect: number): Rect {
  const left = corner === "nw" || corner === "sw";
  const top = corner === "nw" || corner === "ne";
  let { x, y, w, h } = r0;
  if (left) {
    x = clamp(r0.x + dx, 0, r0.x + r0.w - MIN_CROP);
    w = r0.w + (r0.x - x);
  } else w = clamp(r0.w + dx, MIN_CROP, 1 - r0.x);
  if (top) {
    y = clamp(r0.y + dy, 0, r0.y + r0.h - MIN_CROP);
    h = r0.h + (r0.y - y);
  } else h = clamp(r0.h + dy, MIN_CROP, 1 - r0.y);
  if (square) {
    // Square in pixels: h (normalized) = w × width/height.
    const maxH = top ? r0.y + r0.h : 1 - r0.y;
    const maxW = left ? r0.x + r0.w : 1 - r0.x;
    w = Math.min(w, maxW, maxH / aspect);
    h = w * aspect;
    if (left) x = r0.x + r0.w - w;
    if (top) y = r0.y + r0.h - h;
  }
  return { x, y, w, h };
}

function squareInside(r: Rect, aspect: number): Rect {
  const w = Math.min(r.w, r.h / aspect);
  const h = w * aspect;
  return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
}

const Icon = ({ d, size = 18 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);

const ICONS = {
  crop: "M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2",
  rotL: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5",
  rotR: "M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5",
  draw: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z",
  adjust: "M12 3a9 9 0 1 0 0 18V3Z M12 3a9 9 0 0 1 0 18",
  undo: "M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11",
};

function ToolButton({
  label,
  active,
  onClick,
  children,
  disabled,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-11 min-w-12 flex-col items-center justify-center gap-0.5 rounded-lg px-2 text-[11px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70 disabled:opacity-40 ${
        active ? "bg-white text-neutral-900" : "text-white/85 hover:bg-white/15 active:bg-white/25"
      }`}
    >
      {children}
    </button>
  );
}

function TextButton({
  children,
  onClick,
  primary,
  disabled,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`h-9 rounded-lg px-3.5 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70 disabled:opacity-40 ${
        primary ? "bg-white text-neutral-900 hover:bg-white/90" : "text-white/90 hover:bg-white/15"
      }`}
    >
      {children}
    </button>
  );
}

export default function ImageEditor({
  uri,
  title,
  onCancel,
  onSave,
}: {
  uri: string;
  title?: string;
  onCancel: () => void;
  onSave: (next: EditedImage) => void;
}) {
  const work = useRef<HTMLCanvasElement | null>(null);
  const history = useRef<HTMLCanvasElement[]>([]);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("none");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [saving, setSaving] = useState(false);

  const [crop, setCrop] = useState<Rect>({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
  const [square, setSquare] = useState(false);
  const [highlighter, setHighlighter] = useState(false);
  const [color, setColor] = useState(PEN_COLORS[2]);
  const [size, setSize] = useState(PEN_SIZES[1]);
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);

  const stageRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const stroke = useRef<Stroke | null>(null);
  const drag = useRef<{ corner: Corner | "move"; r0: Rect; sx: number; sy: number; bw: number; bh: number } | null>(null);

  const dirty = history.current.length > 0;
  const pendingAdjust = brightness !== 0 || contrast !== 0;

  useEffect(() => {
    let cancelled = false;
    loadImage(uri)
      .then((img) => {
        if (cancelled) return;
        const c = makeCanvas(img.naturalWidth, img.naturalHeight);
        c.getContext("2d")!.drawImage(img, 0, 0);
        work.current = c;
        setVersion((v) => v + 1);
      })
      .catch(() => !cancelled && setError("This image couldn't be opened for editing."));
    return () => {
      cancelled = true;
    };
  }, [uri]);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setStage({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const W = work.current?.width ?? 1;
  const H = work.current?.height ?? 1;
  const fit = stage.w && stage.h ? Math.min((stage.w - 32) / W, (stage.h - 32) / H, 3) : 0;
  const cssW = Math.max(1, Math.floor(W * fit));
  const cssH = Math.max(1, Math.floor(H * fit));

  // Repaint the on-screen canvas whenever the working image or its size changes.
  useEffect(() => {
    const view = viewRef.current;
    const src = work.current;
    if (!view || !src || !fit) return;
    const dpr = window.devicePixelRatio || 1;
    view.width = Math.round(cssW * dpr);
    view.height = Math.round(cssH * dpr);
    const ctx = view.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, view.width, view.height);
    const overlay = overlayRef.current;
    if (overlay) {
      overlay.width = view.width;
      overlay.height = view.height;
    }
  }, [version, cssW, cssH, fit]);

  const commit = useCallback((next: HTMLCanvasElement) => {
    if (work.current) {
      history.current.push(work.current);
      if (history.current.length > MAX_HISTORY) history.current.shift();
    }
    work.current = next;
    setVersion((v) => v + 1);
  }, []);

  const undo = () => {
    const prev = history.current.pop();
    if (!prev) return;
    work.current = prev;
    setVersion((v) => v + 1);
  };

  const chooseTool = (next: Tool) => {
    // Leaving Adjust without applying discards the preview.
    if (tool === "adjust" && next !== "adjust") {
      setBrightness(0);
      setContrast(0);
    }
    if (next === "crop") setCrop(square ? squareInside({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, W / H) : { x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
    setTool((t) => (t === next ? "none" : next));
  };

  const applyCrop = () => {
    if (!work.current) return;
    commit(cropped(work.current, crop));
    setTool("none");
  };

  const applyAdjust = () => {
    if (!work.current || !pendingAdjust) return;
    commit(adjusted(work.current, brightness, contrast));
    setBrightness(0);
    setContrast(0);
    setTool("none");
  };

  const save = () => {
    let src = work.current;
    if (!src) return;
    setSaving(true);
    if (tool === "adjust" && pendingAdjust) src = adjusted(src, brightness, contrast);
    // requestAnimationFrame lets the "Saving…" state paint before encoding.
    requestAnimationFrame(() => {
      const preferPng = uri.startsWith("data:image/png");
      onSave({ uri: canvasToDataUrl(src!, preferPng), width: src!.width, height: src!.height });
    });
  };

  const requestCancel = () => (dirty || pendingAdjust ? setConfirmDiscard(true) : onCancel());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === "INPUT" && (e.target as HTMLInputElement).type !== "range";
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (confirmDiscard) setConfirmDiscard(false);
        else if (tool !== "none") chooseTool(tool);
        else requestCancel();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  // --- Drawing -------------------------------------------------------------
  const norm = (e: React.PointerEvent, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) };
  };

  const redrawOverlay = () => {
    const o = overlayRef.current;
    if (!o) return;
    const ctx = o.getContext("2d")!;
    ctx.clearRect(0, 0, o.width, o.height);
    if (stroke.current) paintStroke(ctx, stroke.current, o.width, o.height);
  };

  const onDrawDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    stroke.current = {
      points: [norm(e, e.currentTarget)],
      color,
      // Pen size is in on-screen pixels; store it relative to the image width.
      size: size / rect.width,
      highlighter,
    };
    redrawOverlay();
  };
  const onDrawMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!stroke.current) return;
    const p = norm(e, e.currentTarget);
    const last = stroke.current.points[stroke.current.points.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) < 0.0015) return;
    stroke.current.points.push(p);
    redrawOverlay();
  };
  const onDrawUp = () => {
    const s = stroke.current;
    stroke.current = null;
    redrawOverlay();
    if (!s || !work.current) return;
    const next = makeCanvas(work.current.width, work.current.height);
    const ctx = next.getContext("2d")!;
    ctx.drawImage(work.current, 0, 0);
    paintStroke(ctx, s, next.width, next.height);
    commit(next);
  };

  // --- Crop box ---------------------------------------------------------------
  const onCropDown = (corner: Corner | "move") => (e: React.PointerEvent<HTMLElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const box = (e.currentTarget.closest("[data-crop-area]") as HTMLElement).getBoundingClientRect();
    drag.current = { corner, r0: crop, sx: e.clientX, sy: e.clientY, bw: box.width, bh: box.height };
  };
  const onCropMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / d.bw;
    const dy = (e.clientY - d.sy) / d.bh;
    if (d.corner === "move") {
      setCrop({ ...d.r0, x: clamp(d.r0.x + dx, 0, 1 - d.r0.w), y: clamp(d.r0.y + dy, 0, 1 - d.r0.h) });
    } else {
      setCrop(resizeRect(d.r0, d.corner, dx, dy, square, W / H));
    }
  };
  const onCropUp = () => {
    drag.current = null;
  };

  const nudgeCrop = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    const map: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = map[e.key];
    if (!delta) return;
    e.preventDefault();
    setCrop((r) => ({ ...r, x: clamp(r.x + delta[0], 0, 1 - r.w), y: clamp(r.y + delta[1], 0, 1 - r.h) }));
  };

  const cropPx = { w: Math.round(crop.w * W), h: Math.round(crop.h * H) };
  const handles: Corner[] = ["nw", "ne", "sw", "se"];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 px-2 py-2 sm:px-4">
        <TextButton onClick={requestCancel}>Cancel</TextButton>
        <p className="min-w-0 flex-1 truncate text-center text-sm font-medium text-white/80">
          {title ? `Edit · ${title}` : "Edit image"}
        </p>
        <button
          type="button"
          onClick={undo}
          disabled={!dirty}
          aria-label="Undo"
          title="Undo (Ctrl+Z)"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-white/90 transition-colors hover:bg-white/15 disabled:opacity-40"
        >
          <Icon d={ICONS.undo} />
        </button>
        <TextButton primary onClick={save} disabled={!work.current || saving || (!dirty && !pendingAdjust)}>
          {saving ? "Saving…" : "Save"}
        </TextButton>
      </div>

      <div ref={stageRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        {error ? (
          <p className="text-sm text-white/75">{error}</p>
        ) : !work.current || !fit ? (
          <p className="text-sm text-white/60">Loading…</p>
        ) : (
          <div className="relative" style={{ width: cssW, height: cssH }} data-crop-area>
            <canvas
              ref={viewRef}
              aria-label="Image being edited"
              style={{
                width: cssW,
                height: cssH,
                display: "block",
                borderRadius: 3,
                boxShadow: "0 10px 40px rgba(0,0,0,.45)",
                filter: tool === "adjust" && pendingAdjust ? `brightness(${1 + brightness / 100}) contrast(${1 + contrast / 100})` : undefined,
              }}
            />
            <canvas
              ref={overlayRef}
              aria-hidden
              onPointerDown={tool === "draw" ? onDrawDown : undefined}
              onPointerMove={tool === "draw" ? onDrawMove : undefined}
              onPointerUp={tool === "draw" ? onDrawUp : undefined}
              onPointerCancel={tool === "draw" ? onDrawUp : undefined}
              className="absolute inset-0 touch-none"
              style={{ width: cssW, height: cssH, cursor: tool === "draw" ? "crosshair" : "default", pointerEvents: tool === "draw" ? "auto" : "none" }}
            />
            {tool === "crop" ? (
              <div
                className="absolute inset-0 overflow-hidden touch-none"
                onPointerMove={onCropMove}
                onPointerUp={onCropUp}
                onPointerCancel={onCropUp}
              >
                <div
                  role="group"
                  aria-label={`Crop area, ${cropPx.w} by ${cropPx.h} pixels. Use arrow keys to move.`}
                  tabIndex={0}
                  onKeyDown={nudgeCrop}
                  onPointerDown={onCropDown("move")}
                  className="absolute cursor-move outline-none focus-visible:ring-2 focus-visible:ring-white"
                  style={{
                    left: `${crop.x * 100}%`,
                    top: `${crop.y * 100}%`,
                    width: `${crop.w * 100}%`,
                    height: `${crop.h * 100}%`,
                    boxShadow: "0 0 0 9999px rgba(0,0,0,.55)",
                    border: "1.5px solid rgba(255,255,255,.95)",
                  }}
                >
                  {/* Rule-of-thirds guides */}
                  <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: "linear-gradient(to right, transparent 33.2%, rgba(255,255,255,.35) 33.3%, transparent 33.5%, transparent 66.5%, rgba(255,255,255,.35) 66.6%, transparent 66.8%), linear-gradient(to bottom, transparent 33.2%, rgba(255,255,255,.35) 33.3%, transparent 33.5%, transparent 66.5%, rgba(255,255,255,.35) 66.6%, transparent 66.8%)" }} />
                  {handles.map((c) => (
                    <div
                      key={c}
                      role="presentation"
                      onPointerDown={onCropDown(c)}
                      className="absolute h-7 w-7"
                      style={{
                        left: c.includes("w") ? -14 : undefined,
                        right: c.includes("e") ? -14 : undefined,
                        top: c.includes("n") ? -14 : undefined,
                        bottom: c.includes("s") ? -14 : undefined,
                        cursor: c === "nw" || c === "se" ? "nwse-resize" : "nesw-resize",
                      }}
                    >
                      <div className="absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-neutral-900 bg-white" />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {confirmDiscard ? (
          <div role="alertdialog" aria-label="Discard edits?" className="absolute inset-x-0 top-3 mx-auto flex w-[min(92%,380px)] items-center gap-2 rounded-xl bg-white p-3 text-neutral-900 shadow-2xl">
            <p className="flex-1 text-sm font-medium">Discard your edits?</p>
            <button type="button" onClick={() => setConfirmDiscard(false)} className="h-9 rounded-lg px-3 text-sm font-medium hover:bg-neutral-100" autoFocus>
              Keep editing
            </button>
            <button type="button" onClick={onCancel} className="h-9 rounded-lg bg-red-600 px-3 text-sm font-semibold text-white hover:bg-red-700">
              Discard
            </button>
          </div>
        ) : null}
      </div>

      {/* Tool options */}
      <div className="flex min-h-12 flex-wrap items-center justify-center gap-2 px-3 pt-2">
        {tool === "crop" ? (
          <>
            <div className="flex rounded-lg bg-white/10 p-0.5" role="radiogroup" aria-label="Crop shape">
              {(["Free", "Square"] as const).map((label) => {
                const on = (label === "Square") === square;
                return (
                  <button
                    key={label}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => {
                      const sq = label === "Square";
                      setSquare(sq);
                      if (sq) setCrop((r) => squareInside(r, W / H));
                    }}
                    className={`h-8 rounded-md px-3 text-sm ${on ? "bg-white text-neutral-900" : "text-white/85 hover:bg-white/10"}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <span className="text-xs tabular-nums text-white/60">
              {cropPx.w} × {cropPx.h}
            </span>
            <TextButton primary onClick={applyCrop}>
              Apply crop
            </TextButton>
          </>
        ) : tool === "draw" ? (
          <>
            <div className="flex rounded-lg bg-white/10 p-0.5" role="radiogroup" aria-label="Brush">
              {(["Pen", "Highlighter"] as const).map((label) => {
                const on = (label === "Highlighter") === highlighter;
                return (
                  <button
                    key={label}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => {
                      const hl = label === "Highlighter";
                      setHighlighter(hl);
                      setColor(hl ? HIGHLIGHT_COLORS[0] : PEN_COLORS[2]);
                      setSize(hl ? HIGHLIGHT_SIZES[1] : PEN_SIZES[1]);
                    }}
                    className={`h-8 rounded-md px-3 text-sm ${on ? "bg-white text-neutral-900" : "text-white/85 hover:bg-white/10"}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Color">
              {(highlighter ? HIGHLIGHT_COLORS : PEN_COLORS).map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={color === c}
                  aria-label={`Color ${c}`}
                  onClick={() => setColor(c)}
                  className="h-7 w-7 rounded-full transition-transform hover:scale-110"
                  style={{ backgroundColor: c, boxShadow: color === c ? "0 0 0 2px #111, 0 0 0 4px #fff" : "inset 0 0 0 1px rgba(255,255,255,.35)" }}
                />
              ))}
            </div>
            <div className="flex items-center gap-1" role="radiogroup" aria-label="Size">
              {(highlighter ? HIGHLIGHT_SIZES : PEN_SIZES).map((s, i) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={size === s}
                  aria-label={["Thin", "Medium", "Thick"][i]}
                  onClick={() => setSize(s)}
                  className={`flex h-8 w-8 items-center justify-center rounded-md ${size === s ? "bg-white/25" : "hover:bg-white/10"}`}
                >
                  <span className="rounded-full bg-white" style={{ width: Math.min(18, 3 + i * 5), height: Math.min(18, 3 + i * 5) }} />
                </button>
              ))}
            </div>
          </>
        ) : tool === "adjust" ? (
          <>
            {(
              [
                ["Brightness", brightness, setBrightness],
                ["Contrast", contrast, setContrast],
              ] as const
            ).map(([label, value, set]) => (
              <label key={label} className="flex items-center gap-2 text-sm text-white/85">
                <span className="w-20 text-right">{label}</span>
                <input
                  type="range"
                  min={-60}
                  max={60}
                  step={1}
                  value={value}
                  onChange={(e) => set(Number(e.target.value))}
                  className="w-32 accent-white sm:w-40"
                />
                <span className="w-8 tabular-nums text-white/60">{value > 0 ? `+${value}` : value}</span>
              </label>
            ))}
            <TextButton
              onClick={() => {
                setBrightness(0);
                setContrast(0);
              }}
              disabled={!pendingAdjust}
            >
              Reset
            </TextButton>
            <TextButton primary onClick={applyAdjust} disabled={!pendingAdjust}>
              Apply
            </TextButton>
          </>
        ) : (
          <span className="text-xs text-white/55">Choose a tool below</span>
        )}
      </div>

      <div className="flex items-center justify-center px-3 pb-4 pt-2">
        <div className="flex items-center gap-1 rounded-xl bg-white/10 p-1" role="toolbar" aria-label="Editing tools">
          <ToolButton label="Crop" active={tool === "crop"} onClick={() => chooseTool("crop")} disabled={!work.current}>
            <Icon d={ICONS.crop} />
            Crop
          </ToolButton>
          <ToolButton label="Rotate left" onClick={() => work.current && commit(rotated(work.current, -1))} disabled={!work.current || tool === "crop"}>
            <Icon d={ICONS.rotL} />
            Left
          </ToolButton>
          <ToolButton label="Rotate right" onClick={() => work.current && commit(rotated(work.current, 1))} disabled={!work.current || tool === "crop"}>
            <Icon d={ICONS.rotR} />
            Right
          </ToolButton>
          <ToolButton label="Draw" active={tool === "draw"} onClick={() => chooseTool("draw")} disabled={!work.current}>
            <Icon d={ICONS.draw} />
            Draw
          </ToolButton>
          <ToolButton label="Adjust" active={tool === "adjust"} onClick={() => chooseTool("adjust")} disabled={!work.current}>
            <Icon d={ICONS.adjust} />
            Adjust
          </ToolButton>
        </div>
      </div>
    </div>
  );
}
