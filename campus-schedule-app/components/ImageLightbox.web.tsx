import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { ImageLightboxProps } from "@/components/ImageLightbox.types";

// Web image viewer: a full-window overlay on <body> (outside the app's
// stacking contexts). Wheel / pinch / buttons / keys zoom, drag pans,
// double-click toggles zoom. Escape, the × button, or a click on the
// backdrop close it, and focus returns to whatever opened it.

export type { ImageLightboxProps } from "@/components/ImageLightbox.types";

const ImageEditor = lazy(() => import("@/components/ImageEditor.web"));

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const STEP = 1.25;
const CHROME_H = 132; // top bar + bottom toolbar + breathing room
const SIDE_PAD = 24;

type View2D = { zoom: number; x: number; y: number };
const FIT: View2D = { zoom: 1, x: 0, y: 0 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function Btn(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; ref?: React.Ref<HTMLButtonElement> }
) {
  const { label, className, children, ...rest } = props;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`flex h-10 min-w-10 items-center justify-center rounded-lg px-2.5 text-sm font-medium text-white/90 transition-colors hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70 active:bg-white/25 disabled:opacity-40 ${className ?? ""}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function ImageLightbox(props: ImageLightboxProps) {
  const { uri, width, height, title, originalUri, onClose, onSave, onRevert } = props;
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [view, setView] = useState<View2D>(FIT);
  const [win, setWin] = useState({ w: window.innerWidth, h: window.innerHeight });
  const stageRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; zoom: number; mid: { x: number; y: number }; view: View2D } | null>(null);
  const moved = useRef(false);

  // Focus management: remember the opener, focus the close button, restore on unmount.
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onResize = () => setWin({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Image size at zoom 1: fit inside the stage.
  const ratio = width && height ? width / height : 4 / 3;
  const maxW = Math.max(120, win.w - SIDE_PAD * 2);
  const maxH = Math.max(120, win.h - CHROME_H);
  const fitW = Math.min(maxW, maxH * ratio, Math.max(width, 1) * 2);
  const fitH = fitW / ratio;

  const clampView = useCallback(
    (v: View2D): View2D => {
      const zoom = clamp(v.zoom, MIN_ZOOM, MAX_ZOOM);
      const limX = Math.max(0, (fitW * zoom - maxW) / 2);
      const limY = Math.max(0, (fitH * zoom - maxH) / 2);
      return { zoom, x: clamp(v.x, -limX, limX), y: clamp(v.y, -limY, limY) };
    },
    [fitW, fitH, maxW, maxH]
  );

  /** Zoom to `next`, keeping the point (px, py) (relative to stage centre) fixed. */
  const zoomAt = useCallback(
    (next: number, px = 0, py = 0, from: View2D = view) => {
      const z = clamp(next, MIN_ZOOM, MAX_ZOOM);
      const k = z / from.zoom;
      setView(clampView({ zoom: z, x: px - (px - from.x) * k, y: py - (py - from.y) * k }));
    },
    [view, clampView]
  );

  const stagePoint = (clientX: number, clientY: number) => {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: clientX - (r.left + r.width / 2), y: clientY - (r.top + r.height / 2) };
  };

  useEffect(() => {
    if (mode !== "view") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "+" || e.key === "=") zoomAt(view.zoom * STEP);
      else if (e.key === "-" || e.key === "_") zoomAt(view.zoom / STEP);
      else if (e.key === "0") setView(FIT);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, onClose, view.zoom, zoomAt]);

  // Wheel zoom needs a non-passive listener to prevent page scroll.
  useEffect(() => {
    const el = stageRef.current;
    if (!el || mode !== "view") return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = stagePoint(e.clientX, e.clientY);
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022));
      setView((v) => {
        const z = clamp(v.zoom * factor, MIN_ZOOM, MAX_ZOOM);
        const k = z / v.zoom;
        return clampView({ zoom: z, x: p.x - (p.x - v.x) * k, y: p.y - (p.y - v.y) * k });
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [mode, clampView]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;
    const pts = [...pointers.current.values()];
    if (pts.length === 2) {
      const mid = stagePoint((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
      gesture.current = { dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), zoom: view.zoom, mid, view };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    if (pts.length >= 2 && gesture.current) {
      moved.current = true;
      const g = gesture.current;
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      zoomAt(g.zoom * (dist / g.dist), g.mid.x, g.mid.y, g.view);
      return;
    }
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    if (Math.abs(dx) + Math.abs(dy) > 1) moved.current = true;
    if (view.zoom > 1) setView((v) => clampView({ ...v, x: v.x + dx, y: v.y + dy }));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
  };

  const onStageClick = (e: React.MouseEvent) => {
    // A click on the backdrop (not the image, not after a drag) closes.
    if (!moved.current && e.target === e.currentTarget) onClose();
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const p = stagePoint(e.clientX, e.clientY);
    if (view.zoom > 1.01) setView(FIT);
    else zoomAt(2.5, p.x, p.y);
  };

  const pct = Math.round(view.zoom * 100);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title ?? "Image"}
      className="fixed inset-0 z-[1000] flex flex-col"
      style={{ backgroundColor: "rgba(12, 10, 8, 0.975)", animation: "lightbox-in 160ms ease-out" }}
    >
      <style>{`@keyframes lightbox-in{from{opacity:0}to{opacity:1}}@keyframes lightbox-img{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}@media (prefers-reduced-motion: reduce){[role=dialog]{animation:none!important}}`}</style>
      {mode === "edit" && onSave ? (
        <Suspense fallback={<div className="m-auto text-sm text-white/70">Loading editor…</div>}>
          <ImageEditor
            uri={uri}
            title={title}
            onCancel={() => setMode("view")}
            onSave={(next) => {
              onSave(next);
              setView(FIT);
              setMode("view");
            }}
          />
        </Suspense>
      ) : (
        <>
          <div className="flex items-center gap-2 px-3 py-2 sm:px-4">
            <p className="min-w-0 flex-1 truncate text-sm text-white/75">{title ?? "Image"}</p>
            {originalUri && onRevert ? (
              <Btn label="Revert to original" onClick={onRevert}>
                Revert
              </Btn>
            ) : null}
            {onSave ? (
              <Btn label="Edit image" onClick={() => setMode("edit")} className="bg-white/10">
                Edit
              </Btn>
            ) : null}
            <Btn label="Close image" onClick={onClose} ref={closeRef}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </Btn>
          </div>

          <div
            ref={stageRef}
            className="relative flex min-h-0 flex-1 touch-none select-none items-center justify-center overflow-hidden"
            style={{ cursor: view.zoom > 1 ? "grab" : "zoom-in" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onClick={onStageClick}
            onDoubleClick={onDoubleClick}
          >
            <img
              src={uri}
              alt={title ?? "Image"}
              draggable={false}
              width={Math.round(fitW)}
              height={Math.round(fitH)}
              style={{
                width: fitW,
                height: fitH,
                transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
                transition: gesture.current || pointers.current.size ? "none" : "transform 140ms ease-out",
                animation: "lightbox-img 180ms ease-out",
                borderRadius: 4,
                boxShadow: "0 10px 40px rgba(0,0,0,.45)",
              }}
            />
          </div>

          <div className="flex items-center justify-center gap-1 px-3 pb-4 pt-2">
            <div className="flex items-center gap-1 rounded-xl bg-white/10 p-1">
              <Btn label="Zoom out" onClick={() => zoomAt(view.zoom / STEP)} disabled={view.zoom <= MIN_ZOOM}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <path d="M5 12h14" />
                </svg>
              </Btn>
              <Btn label="Fit to screen" onClick={() => setView(FIT)} className="w-16 tabular-nums">
                {pct}%
              </Btn>
              <Btn label="Zoom in" onClick={() => zoomAt(view.zoom * STEP)} disabled={view.zoom >= MAX_ZOOM}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </Btn>
            </div>
          </div>
        </>
      )}
    </div>,
    document.body
  );
}
