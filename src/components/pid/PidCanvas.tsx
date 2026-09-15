import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  annotationBBox,
  bboxOfPoints,
  distToSegment,
  nearestOnPolyline,
  normalizeBBox,
  polylineBBox,
  pointsToValue,
  refreshPolyline,
  strokeWidthOf,
  translateAnnotation,
} from "@/lib/pid/geometry";
import { idLabel } from "@/lib/pid/ids";
import type { Annotation, Point } from "@/lib/pid/types";
import { uuid } from "@/lib/pid/types";

export type Tool = "select" | "rect" | "polyline" | "branch" | "crossing" | "port" | "split" | "pan";

export interface Layers {
  view: boolean;
  components: boolean;
  text: boolean;
  pipes: boolean;
  markers: boolean;
  labels: boolean;
  links: boolean;
  ids: boolean;
}

export interface Viewport {
  scale: number;
  tx: number;
  ty: number;
}

export interface SplitRequest {
  id: string;
  point: Point;
  segIndex: number;
  vertexIndex: number | null;
}

interface Props {
  image: HTMLImageElement | null;
  annotations: Annotation[];
  selectedIds: string[];
  hoveredId: string | null;
  exportRows: Record<string, number>;
  tool: Tool;
  layers: Layers;
  viewport: Viewport;
  defaults: { mainLabel: Annotation["mainLabel"]; subLabel: string; pipeStrokeWidth: number };
  setViewport: (v: Viewport | ((v: Viewport) => Viewport)) => void;
  onSelect: (ids: string[]) => void;
  onHover: (id: string | null) => void;
  onUpdate: (updated: Annotation[]) => void;
  onCommit: (updated: Annotation[]) => void;
  onCreate: (a: Annotation) => void;
  onSplit: (req: SplitRequest) => void;
  onDeleteSelected: () => void;
  onCursor: (p: { x: number; y: number } | null) => void;
}

const COLORS = {
  view: "#3b82f6",
  component: "#16a34a",
  text: "#f97316",
  pipe: "#dc2626",
  branch: "#d946ef",
  crossing: "#eab308",
  port: "#06b6d4",
  select: "#2563eb",
};

function colorOf(a: Annotation): string {
  if (a.mainLabel === "View") return COLORS.view;
  if (a.mainLabel === "Text") return COLORS.text;
  if (a.subLabel === "Pipe") return COLORS.pipe;
  if (a.subLabel === "BranchSymbol") return COLORS.branch;
  if (a.subLabel === "RouteCrossing") return COLORS.crossing;
  if (a.subLabel === "PipingPort") return COLORS.port;
  return COLORS.component;
}

function visible(a: Annotation, l: Layers): boolean {
  if (a.mainLabel === "View") return l.view;
  if (a.mainLabel === "Text") return l.text;
  if (a.subLabel === "Pipe") return l.pipes;
  if (["BranchSymbol", "RouteCrossing", "PipingPort"].includes(a.subLabel)) return l.markers;
  return l.components;
}

type Drag =
  | { kind: "none" }
  | { kind: "pan"; sx: number; sy: number; tx: number; ty: number }
  | { kind: "move"; sx: number; sy: number; originals: Annotation[] }
  | { kind: "resize"; corner: number; original: Annotation }
  | { kind: "vertex"; id: string; index: number }
  | { kind: "rect"; start: Point; current: Point };

interface Ghost {
  id: string;
  point: Point;
  segIndex: number;
}

interface SplitHint {
  id: string;
  point: Point;
  segIndex: number;
  vertexIndex: number | null;
}

export function PidCanvas({
  image,
  annotations,
  selectedIds,
  hoveredId,
  exportRows,
  tool,
  layers,
  viewport,
  defaults,
  setViewport,
  onSelect,
  onHover,
  onUpdate,
  onCommit,
  onCreate,
  onSplit,
  onDeleteSelected,
  onCursor,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag>({ kind: "none" });
  const dirtyRef = useRef<Annotation[] | null>(null);
  const spaceRef = useRef(false);
  const [draft, setDraft] = useState<Point[]>([]);
  const [hover, setHover] = useState<Point | null>(null);
  const [rectPreview, setRectPreview] = useState<[Point, Point] | null>(null);
  const [shift, setShift] = useState(false);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [splitHint, setSplitHint] = useState<SplitHint | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; ghost: Ghost } | null>(null);

  const toImage = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return [0, 0];
      return [
        (clientX - rect.left - viewport.tx) / viewport.scale,
        (clientY - rect.top - viewport.ty) / viewport.scale,
      ];
    },
    [viewport],
  );

  /* ---------- rendering ---------- */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#f5f5f5";
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(viewport.tx, viewport.ty);
    ctx.scale(viewport.scale, viewport.scale);

    if (image) {
      ctx.drawImage(image, 0, 0);
      ctx.strokeStyle = "#9ca3af";
      ctx.lineWidth = 1 / viewport.scale;
      ctx.strokeRect(0, 0, image.width, image.height);
    }

    const s = viewport.scale;
    const byId = new Map(annotations.map((a) => [a.id, a]));

    // link lines
    if (layers.links) {
      ctx.strokeStyle = "rgba(37,99,235,0.5)";
      ctx.setLineDash([4 / s, 4 / s]);
      ctx.lineWidth = 1 / s;
      for (const a of annotations) {
        if (!a.linkedElementId) continue;
        const t = byId.get(a.linkedElementId);
        if (!t) continue;
        const ab = annotationBBox(a);
        const tb = annotationBBox(t);
        ctx.beginPath();
        ctx.moveTo((ab.minX + ab.maxX) / 2, (ab.minY + ab.maxY) / 2);
        ctx.lineTo((tb.minX + tb.maxX) / 2, (tb.minY + tb.maxY) / 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    for (const a of annotations) {
      if (!visible(a, layers)) continue;
      const selected = selectedIds.includes(a.id);
      const hovered = hoveredId === a.id;
      const color = colorOf(a);
      ctx.globalAlpha = a.locked ? 0.5 : 1;
      ctx.lineWidth = (selected ? 3 : hovered ? 2.5 : 1.5) / s;
      ctx.strokeStyle = selected ? COLORS.select : hovered ? "#0ea5e9" : color;
      const b = annotationBBox(a);

      if (a.geometry.type === "polyline") {
        const pts = a.geometry.points;
        const sw = strokeWidthOf(a);
        ctx.save();
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.lineWidth = sw;
        ctx.strokeStyle = selected ? COLORS.select : hovered ? "#0ea5e9" : COLORS.pipe;
        ctx.globalAlpha = (a.locked ? 0.5 : 1) * 0.65;
        ctx.beginPath();
        pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])));
        ctx.stroke();
        ctx.restore();

        // centerline
        ctx.lineWidth = (selected ? 2.5 : 1.5) / s;
        ctx.strokeStyle = selected ? COLORS.select : COLORS.pipe;
        ctx.beginPath();
        pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])));
        ctx.stroke();

        if (selected) {
          // dashed derived bounding box
          const pb = polylineBBox(pts, sw);
          ctx.save();
          ctx.setLineDash([6 / s, 4 / s]);
          ctx.strokeStyle = "rgba(37,99,235,0.7)";
          ctx.lineWidth = 1 / s;
          ctx.strokeRect(pb.minX, pb.minY, pb.maxX - pb.minX, pb.maxY - pb.minY);
          ctx.restore();

          ctx.fillStyle = "#ffffff";
          ctx.strokeStyle = COLORS.select;
          ctx.lineWidth = 2 / s;
          for (const p of pts) {
            ctx.beginPath();
            ctx.arc(p[0], p[1], 5 / s, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        }
      } else if (a.subLabel === "BranchSymbol") {
        ctx.fillStyle = COLORS.branch;
        ctx.fillRect(b.minX, b.minY, Math.max(b.maxX - b.minX, 6), Math.max(b.maxY - b.minY, 6));
        if (selected) ctx.strokeRect(b.minX - 2 / s, b.minY - 2 / s, b.maxX - b.minX + 4 / s, b.maxY - b.minY + 4 / s);
      } else if (a.subLabel === "RouteCrossing") {
        const cx = (b.minX + b.maxX) / 2;
        const cy = (b.minY + b.maxY) / 2;
        const r = Math.max((b.maxX - b.minX) / 2, 5);
        ctx.fillStyle = COLORS.crossing;
        ctx.beginPath();
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx + r, cy);
        ctx.lineTo(cx, cy + r);
        ctx.lineTo(cx - r, cy);
        ctx.closePath();
        ctx.fill();
        if (selected) ctx.stroke();
      } else if (a.subLabel === "PipingPort") {
        const cx = (b.minX + b.maxX) / 2;
        const cy = (b.minY + b.maxY) / 2;
        ctx.fillStyle = COLORS.port;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max((b.maxX - b.minX) / 2, 5), 0, Math.PI * 2);
        ctx.fill();
        if (selected) ctx.stroke();
      } else {
        if (a.mainLabel === "View") {
          ctx.setLineDash([8 / s, 6 / s]);
          ctx.fillStyle = "rgba(59,130,246,0.08)";
          ctx.fillRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
        }
        ctx.strokeRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
        ctx.setLineDash([]);
        if (layers.labels && a.mainLabel === "Text" && a.value) {
          ctx.fillStyle = COLORS.text;
          ctx.font = `${12 / s}px ui-sans-serif, system-ui`;
          ctx.fillText(a.value, b.minX, b.minY - 4 / s);
        }
      }

      // resize handles for selected bboxes
      if (selected && a.geometry.type === "bbox" && !a.locked) {
        const hs = 4 / s;
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = COLORS.select;
        ctx.lineWidth = 1.5 / s;
        for (const [hx, hy] of corners(b)) {
          ctx.fillRect(hx - hs, hy - hs, hs * 2, hs * 2);
          ctx.strokeRect(hx - hs, hy - hs, hs * 2, hs * 2);
        }
      }

      if (a.locked) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#111827";
        ctx.font = `${11 / s}px ui-sans-serif, system-ui`;
        ctx.fillText("🔒", b.maxX + 2 / s, b.minY + 10 / s);
      }
      ctx.globalAlpha = 1;
    }

    // ghost bend vertex
    if (ghost) {
      ctx.strokeStyle = COLORS.select;
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 2 / s;
      ctx.beginPath();
      ctx.arc(ghost.point[0], ghost.point[1], 6 / s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // split marker
    if (splitHint) {
      const r = (splitHint.vertexIndex != null ? 8 : 6) / s;
      ctx.strokeStyle = splitHint.vertexIndex != null ? "#f59e0b" : "#111827";
      ctx.lineWidth = 2 / s;
      ctx.beginPath();
      ctx.moveTo(splitHint.point[0] - r, splitHint.point[1] - r);
      ctx.lineTo(splitHint.point[0] + r, splitHint.point[1] + r);
      ctx.moveTo(splitHint.point[0] + r, splitHint.point[1] - r);
      ctx.lineTo(splitHint.point[0] - r, splitHint.point[1] + r);
      ctx.stroke();
    }

    // drafts
    if (draft.length > 0) {
      const pts = hover ? [...draft, snap(draft[draft.length - 1] as Point, hover, shift)] : draft;
      ctx.strokeStyle = COLORS.pipe;
      ctx.lineWidth = 3 / s;
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])));
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      for (const p of draft) {
        ctx.beginPath();
        ctx.arc(p[0], p[1], 4 / s, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    if (rectPreview) {
      const [p0, p1] = rectPreview;
      ctx.setLineDash([6 / s, 4 / s]);
      ctx.strokeStyle = COLORS.select;
      ctx.lineWidth = 1.5 / s;
      ctx.strokeRect(Math.min(p0[0], p1[0]), Math.min(p0[1], p1[1]), Math.abs(p1[0] - p0[0]), Math.abs(p1[1] - p0[1]));
      ctx.setLineDash([]);
    }

    ctx.restore();

    // ---- id badges (screen space) ----
    if (layers.ids && s >= 0.4) {
      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textBaseline = "top";
      for (const a of annotations) {
        if (!visible(a, layers)) continue;
        const anchor: Point =
          a.geometry.type === "polyline"
            ? ((a.geometry.points[0] ?? [0, 0]) as Point)
            : [annotationBBox(a).minX, annotationBBox(a).minY];
        const sx = anchor[0] * s + viewport.tx;
        const sy = anchor[1] * s + viewport.ty;
        if (sx < -80 || sy < -30 || sx > w + 80 || sy > h + 30) continue;
        const text = idLabel(a, exportRows);
        const tw = ctx.measureText(text).width;
        ctx.globalAlpha = 0.7;
        ctx.fillStyle = colorOf(a);
        roundRect(ctx, sx, sy - 16, tw + 4, 14, 3);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#ffffff";
        ctx.fillText(text, sx + 2, sy - 14);
      }
      ctx.textBaseline = "alphabetic";
    }
  }, [
    image,
    annotations,
    selectedIds,
    hoveredId,
    exportRows,
    layers,
    viewport,
    draft,
    hover,
    rectPreview,
    shift,
    ghost,
    splitHint,
  ]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [draw]);

  /* ---------- keyboard ---------- */
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if (e.key === "Shift") setShift(true);
      if (e.code === "Space" && !typing) {
        spaceRef.current = true;
        e.preventDefault();
      }
      if (typing) return;
      if (e.key === "Enter" && draft.length >= 2) finishPolyline();
      if (e.key === "Escape") {
        setDraft([]);
        setMenu(null);
      }
      if (e.key === "Delete" || e.key === "Backspace") onDeleteSelected();
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShift(false);
      if (e.code === "Space") spaceRef.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  });

  /* ---------- helpers ---------- */
  function hitTest(p: Point): Annotation | null {
    const tol = 6 / viewport.scale;
    for (let i = annotations.length - 1; i >= 0; i--) {
      const a = annotations[i];
      if (!a || !visible(a, layers)) continue;
      if (a.geometry.type === "polyline") {
        const pts = a.geometry.points;
        const half = strokeWidthOf(a) / 2;
        for (let j = 0; j + 1 < pts.length; j++) {
          if (distToSegment(p[0], p[1], pts[j] as Point, pts[j + 1] as Point) <= tol + half) return a;
        }
      } else {
        const b = annotationBBox(a);
        if (p[0] >= b.minX - tol && p[0] <= b.maxX + tol && p[1] >= b.minY - tol && p[1] <= b.maxY + tol) return a;
      }
    }
    return null;
  }

  function hitHandle(p: Point): { corner: number; ann: Annotation } | null {
    const tol = 7 / viewport.scale;
    for (const id of selectedIds) {
      const a = annotations.find((x) => x.id === id);
      if (!a || a.locked || a.geometry.type !== "bbox") continue;
      const cs = corners(annotationBBox(a));
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i] as Point;
        if (Math.abs(p[0] - c[0]) <= tol && Math.abs(p[1] - c[1]) <= tol) return { corner: i, ann: a };
      }
    }
    return null;
  }

  function hitVertex(p: Point): { id: string; index: number } | null {
    const tol = 8 / viewport.scale;
    for (const id of selectedIds) {
      const a = annotations.find((x) => x.id === id);
      if (!a || a.locked || a.geometry.type !== "polyline") continue;
      for (let i = 0; i < a.geometry.points.length; i++) {
        const v = a.geometry.points[i] as Point;
        if (Math.hypot(p[0] - v[0], p[1] - v[1]) <= tol) return { id, index: i };
      }
    }
    return null;
  }

  /** Closest point on a selected, unlocked pipe (for the insert-bend ghost). */
  function ghostAt(p: Point): Ghost | null {
    const tol = Math.max(10 / viewport.scale, 4);
    for (const id of selectedIds) {
      const a = annotations.find((x) => x.id === id);
      if (!a || a.geometry.type !== "polyline") continue;
      if (a.locked) continue;
      const near = nearestOnPolyline(a.geometry.points, p);
      if (!near || near.dist > tol + strokeWidthOf(a) / 2) continue;
      // don't shadow an existing vertex handle
      const vtol = 8 / viewport.scale;
      const onVertex = a.geometry.points.some((v) => Math.hypot(p[0] - v[0], p[1] - v[1]) <= vtol);
      if (onVertex) return null;
      return { id, point: near.point, segIndex: near.segIndex };
    }
    return null;
  }

  function anyPipeGhost(p: Point): Ghost | null {
    const tol = Math.max(12 / viewport.scale, 4);
    for (let i = annotations.length - 1; i >= 0; i--) {
      const a = annotations[i];
      if (!a || a.geometry.type !== "polyline" || !visible(a, layers)) continue;
      const near = nearestOnPolyline(a.geometry.points, p);
      if (near && near.dist <= tol + strokeWidthOf(a) / 2) return { id: a.id, point: near.point, segIndex: near.segIndex };
    }
    return null;
  }

  function splitAt(p: Point): SplitHint | null {
    const g = anyPipeGhost(p);
    if (!g) return null;
    const a = annotations.find((x) => x.id === g.id);
    if (!a || a.geometry.type !== "polyline") return null;
    const snapTol = 10 / viewport.scale;
    let vertexIndex: number | null = null;
    a.geometry.points.forEach((v, i) => {
      if (Math.hypot(p[0] - v[0], p[1] - v[1]) <= snapTol) vertexIndex = i;
    });
    const point = vertexIndex != null ? ((a.geometry.points[vertexIndex] as Point) ?? g.point) : g.point;
    return { id: g.id, point, segIndex: g.segIndex, vertexIndex };
  }

  function insertBend(g: Ghost) {
    const a = annotations.find((x) => x.id === g.id);
    if (!a || a.geometry.type !== "polyline") return;
    if (a.locked) {
      toast.error("Pipe is locked — unlock to edit");
      return;
    }
    const pts = [...a.geometry.points];
    pts.splice(g.segIndex + 1, 0, [g.point[0], g.point[1]] as Point);
    const next = refreshPolyline({ ...a, geometry: { type: "polyline", points: pts, bbox: bboxOfPoints(pts) } });
    onCommit([next]);
    onSelect([a.id]);
    setGhost(null);
    dragRef.current = { kind: "vertex", id: a.id, index: g.segIndex + 1 };
  }

  function makeAnnotation(mainLabel: Annotation["mainLabel"], subLabel: string, bbox: Annotation["geometry"]): Annotation {
    return {
      id: uuid(),
      mainLabel,
      subLabel,
      geometry: bbox,
      value: "",
      subType: "",
      linkedElementId: null,
      linkedElementLine: null,
      locked: false,
      source: "manual",
    };
  }

  function placeMarker(p: Point, subLabel: string, size: number) {
    const half = size / 2;
    const a = makeAnnotation("Component", subLabel, {
      type: "bbox",
      bbox: { minX: p[0] - half, minY: p[1] - half, maxX: p[0] + half, maxY: p[1] + half },
    });
    onCreate(a);
  }

  function finishPolyline() {
    if (draft.length >= 2) {
      const sw = defaults.pipeStrokeWidth;
      const a = makeAnnotation("Component", "Pipe", {
        type: "polyline",
        points: draft,
        bbox: polylineBBox(draft, sw),
      });
      a.strokeWidth = sw;
      a.value = pointsToValue(draft);
      onCreate(a);
    }
    setDraft([]);
  }

  /* ---------- pointer ---------- */
  function onPointerDown(e: React.PointerEvent) {
    setMenu(null);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const p = toImage(e.clientX, e.clientY);

    if (e.button === 1 || spaceRef.current || tool === "pan") {
      dragRef.current = { kind: "pan", sx: e.clientX, sy: e.clientY, tx: viewport.tx, ty: viewport.ty };
      return;
    }
    if (e.button !== 0) return;

    if (tool === "split") {
      const hint = splitAt(p);
      if (!hint) return;
      const a = annotations.find((x) => x.id === hint.id);
      if (a?.locked) {
        toast.error("Pipe is locked — unlock to edit");
        return;
      }
      onSplit(hint);
      return;
    }

    if (tool === "select") {
      const handle = hitHandle(p);
      if (handle) {
        dragRef.current = { kind: "resize", corner: handle.corner, original: handle.ann };
        return;
      }
      const vtx = hitVertex(p);
      if (vtx) {
        dragRef.current = { kind: "vertex", id: vtx.id, index: vtx.index };
        return;
      }
      if (ghost) {
        insertBend(ghost);
        return;
      }
      const hit = hitTest(p);
      if (!hit) {
        onSelect([]);
        return;
      }
      let next: string[];
      if (e.shiftKey) {
        next = selectedIds.includes(hit.id) ? selectedIds.filter((i) => i !== hit.id) : [...selectedIds, hit.id];
      } else {
        next = selectedIds.includes(hit.id) ? selectedIds : [hit.id];
      }
      onSelect(next);
      const originals = annotations.filter((a) => next.includes(a.id) && !a.locked);
      dragRef.current = { kind: "move", sx: p[0], sy: p[1], originals };
      return;
    }

    if (tool === "rect") {
      dragRef.current = { kind: "rect", start: p, current: p };
      setRectPreview([p, p]);
      return;
    }
    if (tool === "polyline") {
      const last = draft[draft.length - 1];
      setDraft((d) => [...d, last ? snap(last, p, e.shiftKey) : p]);
      return;
    }
    if (tool === "branch") placeMarker(p, "BranchSymbol", 6);
    if (tool === "crossing") placeMarker(p, "RouteCrossing", 10);
    if (tool === "port") placeMarker(p, "PipingPort", 10);
  }

  function onPointerMove(e: React.PointerEvent) {
    const p = toImage(e.clientX, e.clientY);
    onCursor({ x: Math.round(p[0]), y: Math.round(p[1]) });
    setHover(p);
    const d = dragRef.current;

    if (d.kind === "none") {
      if (tool === "split") {
        setSplitHint(splitAt(p));
        setGhost(null);
      } else if (tool === "select") {
        setSplitHint(null);
        setGhost(ghostAt(p));
      } else {
        setGhost(null);
        setSplitHint(null);
      }
      if (tool === "select" || tool === "split") {
        const hit = hitTest(p);
        onHover(hit ? hit.id : null);
      }
      return;
    }

    if (d.kind === "pan") {
      setViewport({ ...viewport, tx: d.tx + (e.clientX - d.sx), ty: d.ty + (e.clientY - d.sy) });
    } else if (d.kind === "move") {
      const dx = p[0] - d.sx;
      const dy = p[1] - d.sy;
      const next = d.originals.map((o) => translateAnnotation(o, dx, dy));
      dirtyRef.current = next;
      onUpdate(next);
    } else if (d.kind === "resize") {
      const b = normalizeBBox(annotationBBox(d.original));
      const nb = { ...b };
      if (d.corner === 0 || d.corner === 3) nb.minX = p[0];
      else nb.maxX = p[0];
      if (d.corner === 0 || d.corner === 1) nb.minY = p[1];
      else nb.maxY = p[1];
      const next = [{ ...d.original, geometry: { type: "bbox" as const, bbox: normalizeBBox(nb) } }];
      dirtyRef.current = next;
      onUpdate(next);
    } else if (d.kind === "vertex") {
      const a = annotations.find((x) => x.id === d.id);
      if (a && a.geometry.type === "polyline") {
        const prev = (a.geometry.points[d.index === 0 ? 1 : d.index - 1] ?? [p[0], p[1]]) as Point;
        const target = e.shiftKey ? snap(prev, p, true) : ([p[0], p[1]] as Point);
        const pts = a.geometry.points.map((v, i) => (i === d.index ? target : v));
        const next = [refreshPolyline({ ...a, geometry: { type: "polyline", points: pts, bbox: bboxOfPoints(pts) } })];
        dirtyRef.current = next;
        onUpdate(next);
      }
    } else if (d.kind === "rect") {
      dragRef.current = { ...d, current: p };
      setRectPreview([d.start, p]);
    }
  }

  function onPointerUp() {
    const d = dragRef.current;
    if (d.kind === "rect") {
      const [p0, p1] = [d.start, d.current];
      if (Math.abs(p1[0] - p0[0]) > 3 && Math.abs(p1[1] - p0[1]) > 3) {
        onCreate(
          makeAnnotation(defaults.mainLabel, defaults.subLabel, {
            type: "bbox",
            bbox: normalizeBBox({ minX: p0[0], minY: p0[1], maxX: p1[0], maxY: p1[1] }),
          }),
        );
      }
      setRectPreview(null);
    }
    if ((d.kind === "vertex" || d.kind === "move" || d.kind === "resize") && dirtyRef.current) {
      onCommit(dirtyRef.current);
    }
    dirtyRef.current = null;
    dragRef.current = { kind: "none" };
  }

  function onWheel(e: React.WheelEvent) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.0015);
    setViewport((v) => {
      const scale = Math.min(20, Math.max(0.05, v.scale * factor));
      const k = scale / v.scale;
      return { scale, tx: mx - (mx - v.tx) * k, ty: my - (my - v.ty) * k };
    });
  }

  function onDoubleClick(e: React.MouseEvent) {
    if (draft.length >= 2) {
      finishPolyline();
      return;
    }
    if (tool !== "select") return;
    const p = toImage(e.clientX, e.clientY);
    const g = ghostAt(p) ?? anyPipeGhost(p);
    if (g) insertBend(g);
  }

  function onContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    const p = toImage(e.clientX, e.clientY);
    const g = anyPipeGhost(p);
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!g || !rect) {
      setMenu(null);
      return;
    }
    setMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, ghost: g });
  }

  const cursor =
    tool === "pan"
      ? "grab"
      : tool === "select"
        ? ghost
          ? "crosshair"
          : "default"
        : "crosshair";

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-[#f5f5f5]">
      <canvas
        ref={canvasRef}
        style={{ cursor, touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          onCursor(null);
          setHover(null);
          setGhost(null);
          setSplitHint(null);
          onHover(null);
        }}
        onDoubleClick={onDoubleClick}
        onWheel={onWheel}
        onContextMenu={onContextMenu}
      />
      {menu && (
        <div
          className="absolute z-10 min-w-[160px] overflow-hidden rounded-md border border-neutral-300 bg-white text-xs shadow-lg"
          style={{ left: menu.x, top: menu.y }}
          onMouseLeave={() => setMenu(null)}
        >
          <button
            className="block w-full px-3 py-2 text-left hover:bg-neutral-100"
            onClick={() => {
              insertBend(menu.ghost);
              setMenu(null);
            }}
          >
            Insert bend here
          </button>
          <button
            className="block w-full px-3 py-2 text-left hover:bg-neutral-100"
            onClick={() => {
              const hint = splitAt(menu.ghost.point);
              setMenu(null);
              if (!hint) return;
              const a = annotations.find((x) => x.id === hint.id);
              if (a?.locked) {
                toast.error("Pipe is locked — unlock to edit");
                return;
              }
              onSplit(hint);
            }}
          >
            Split pipe here
          </button>
        </div>
      )}
      {!image && annotations.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="rounded-md bg-white/80 px-4 py-2 text-sm text-neutral-500">
            Open a P&amp;ID image or load the demo project to start annotating
          </p>
        </div>
      )}
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function corners(b: { minX: number; minY: number; maxX: number; maxY: number }): Point[] {
  return [
    [b.minX, b.minY],
    [b.maxX, b.minY],
    [b.maxX, b.maxY],
    [b.minX, b.maxY],
  ];
}

function snap(from: Point, to: Point, ortho: boolean): Point {
  if (!ortho) return to;
  return Math.abs(to[0] - from[0]) > Math.abs(to[1] - from[1]) ? [to[0], from[1]] : [from[0], to[1]];
}
