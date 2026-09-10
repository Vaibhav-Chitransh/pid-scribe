import type { Annotation, BBox, Point } from "./types";

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
  return a.geometry.type === "polyline" ? bboxOfPoints(a.geometry.points) : normalizeBBox(a.geometry.bbox);
}

export function translateAnnotation(a: Annotation, dx: number, dy: number): Annotation {
  if (a.geometry.type === "polyline") {
    const points = a.geometry.points.map((p) => [p[0] + dx, p[1] + dy] as Point);
    return { ...a, geometry: { type: "polyline", points, bbox: bboxOfPoints(points) } };
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
  return points.map((p) => `${Math.round(p[0])},${Math.round(p[1])}`).join(",");
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
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - a[0]) * dx + (py - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = a[0] + t * dx;
  const cy = a[1] + t * dy;
  return Math.hypot(px - cx, py - cy);
}
