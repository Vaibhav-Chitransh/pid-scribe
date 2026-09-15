import type { Annotation, BBox, Point } from "./types";

export const DEFAULT_STROKE_WIDTH = 16;

export function normalizeBBox(b: BBox): BBox {
  return {
    minX: Math.min(b.minX, b.maxX),
    minY: Math.min(b.minY, b.maxY),
    maxX: Math.max(b.minX, b.maxX),
    maxY: Math.max(b.minY, b.maxY),
  };
}

export function bboxOfPoints(points: Point[]): BBox {
  if (points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

/** Envelope of every vertex, inflated by strokeWidth / 2 on all four sides. */
export function polylineBBox(points: Point[], strokeWidth = DEFAULT_STROKE_WIDTH): BBox {
  const b = bboxOfPoints(points);
  const h = (Number.isFinite(strokeWidth) ? strokeWidth : DEFAULT_STROKE_WIDTH) / 2;
  return { minX: b.minX - h, minY: b.minY - h, maxX: b.maxX + h, maxY: b.maxY + h };
}

export function strokeWidthOf(a: Annotation): number {
  return Number.isFinite(a.strokeWidth as number) ? (a.strokeWidth as number) : DEFAULT_STROKE_WIDTH;
}

export function metrics(bbox: BBox) {
  const b = normalizeBBox(bbox);
  return {
    ...b,
    centerX: (b.minX + b.maxX) / 2,
    centerY: (b.minY + b.maxY) / 2,
    width: b.maxX - b.minX,
    height: b.maxY - b.minY,
  };
}

export function annotationBBox(a: Annotation): BBox {
  return a.geometry.type === "polyline"
    ? polylineBBox(a.geometry.points, strokeWidthOf(a))
    : normalizeBBox(a.geometry.bbox);
}

/** Keeps a polyline annotation's cached bbox and Value in sync with its points. */
export function refreshPolyline(a: Annotation): Annotation {
  if (a.geometry.type !== "polyline") return a;
  const points = a.geometry.points;
  return {
    ...a,
    geometry: { type: "polyline", points, bbox: polylineBBox(points, strokeWidthOf(a)) },
    value: pointsToValue(points),
  };
}

export function translateAnnotation(a: Annotation, dx: number, dy: number): Annotation {
  if (a.geometry.type === "polyline") {
    const points = a.geometry.points.map((p) => [p[0] + dx, p[1] + dy] as Point);
    return refreshPolyline({ ...a, geometry: { type: "polyline", points, bbox: bboxOfPoints(points) } });
  }
  const b = a.geometry.bbox;
  return {
    ...a,
    geometry: {
      type: "bbox",
      bbox: { minX: b.minX + dx, minY: b.minY + dy, maxX: b.maxX + dx, maxY: b.maxY + dy },
    },
  };
}

export function pointsToValue(points: Point[]): string {
  return points.map((p) => `${round2(p[0])},${round2(p[1])}`).join(",");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function valueToPoints(value: string): Point[] {
  const nums = value
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
  const pts: Point[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i] as number, nums[i + 1] as number]);
  return pts;
}

export function distToSegment(px: number, py: number, a: Point, b: Point): number {
  return Math.hypot(px - closestOnSegment(px, py, a, b)[0], py - closestOnSegment(px, py, a, b)[1]);
}

export function closestOnSegment(px: number, py: number, a: Point, b: Point): Point {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - a[0]) * dx + (py - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return [a[0] + t * dx, a[1] + t * dy];
}

export interface NearestHit {
  point: Point;
  segIndex: number;
  dist: number;
}

export function nearestOnPolyline(points: Point[], p: Point): NearestHit | null {
  let best: NearestHit | null = null;
  for (let i = 0; i + 1 < points.length; i++) {
    const c = closestOnSegment(p[0], p[1], points[i] as Point, points[i + 1] as Point);
    const d = Math.hypot(p[0] - c[0], p[1] - c[1]);
    if (!best || d < best.dist) best = { point: c, segIndex: i, dist: d };
  }
  return best;
}
