import type { Stroke } from "@/context/store";

// Helpers for turning a batch of freehand strokes (in canvas coordinates)
// into a self-contained, movable drawing object whose strokes are stored
// relative to its own top-left corner.

export type DrawingShape = {
  x: number;
  y: number;
  width: number;
  height: number;
  strokes: Stroke[];
};

function bounds(strokes: Stroke[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of strokes) {
    for (const p of s.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!isFinite(minX)) return null;
  const pad = Math.max(2, ...strokes.map((s) => s.width));
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

/** Group strokes (canvas coords) into one drawing with local-space points. */
export function strokesToDrawing(strokes: Stroke[]): DrawingShape | null {
  const b = bounds(strokes);
  if (!b) return null;
  return {
    x: b.minX,
    y: b.minY,
    width: b.maxX - b.minX,
    height: b.maxY - b.minY,
    strokes: strokes.map((s) => ({
      ...s,
      points: s.points.map((p) => ({ x: p.x - b.minX, y: p.y - b.minY })),
    })),
  };
}

export function strokePath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) {
    const p = points[0];
    return `M${p.x} ${p.y} L${p.x + 0.1} ${p.y + 0.1}`;
  }
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
}
