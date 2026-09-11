import { useCallback, useEffect, useRef, useState } from "react";
import {
  annotationBBox,
  bboxOfPoints,
  distToSegment,
  normalizeBBox,
  pointsToValue,
  translateAnnotation,
} from "@/lib/pid/geometry";
import type { Annotation, Point } from "@/lib/pid/types";
import { uuid } from "@/lib/pid/types";

export type Tool = "select" | "rect" | "polyline" | "branch" | "crossing" | "port" | "pan";

export interface Layers {
  view: boolean;
  components: boolean;
  text: boolean;
  pipes: boolean;
  markers: boolean;
  labels: boolean;
  links: boolean;
}

export interface Viewport {
  scale: number;
  tx: number;
  ty: number;
}

interface Props {
  image: HTMLImageElement | null;
  annotations: Annotation[];
  selectedIds: string[];
  tool: Tool;
  layers: Layers;
  viewport: Viewport;
  defaults: { mainLabel: Annotation["mainLabel"]; subLabel: string };
  setViewport: (v: Viewport | ((v: Viewport) => Viewport)) => void;
  onSelect: (ids: string[]) => void;
  onUpdate: (updated: Annotation[]) => void;
  onCreate: (a: Annotation) => void;
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

export function PidCanvas({
  image,
  annotations,
  selectedIds,
  tool,
  layers,
  viewport,
  defaults,
  setViewport,
  onSelect,
  onUpdate,
  onCreate,
  onDeleteSelected,
  onCursor,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag>({ kind: "none" });
  const spaceRef = useRef(false);
  const [draft, setDraft] = useState<Point[]>([]);
  const [hover, setHover] = useState<Point | null>(null);
  const [rectPreview, setRectPreview] = useState<[Point, Point] | null>(null);
  const [shift, setShift] = useState(false);

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
      const color = colorOf(a);
      ctx.globalAlpha = a.locked ? 0.5 : 1;
      ctx.lineWidth = (selected ? 3 : 1.5) / s;
      ctx.strokeStyle = selected ? COLORS.select : color;
      const b = annotationBBox(a);

      if (a.geometry.type === "polyline") {
        const pts = a.geometry.points;
        ctx.lineWidth = (selected ? 5 : 3.5) / s;
        ctx.strokeStyle = selected ? COLORS.select : COLORS.pipe;
        ctx.beginPath();
        pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])));
        ctx.stroke();
        if (selected) {
          ctx.fillStyle = "#ffffff";
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
  }, [image, annotations, selectedIds, layers, viewport, draft, hover, rectPreview, shift]);

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
      if (e.key === "Escape") setDraft([]);
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
        for (let j = 0; j + 1 < pts.length; j++) {
          if (distToSegment(p[0], p[1], pts[j] as Point, pts[j + 1] as Point) <= tol + 3 / viewport.scale) return a;
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
      const a = makeAnnotation("Component", "Pipe", {
        type: "polyline",
        points: draft,
        bbox: bboxOfPoints(draft),
      });
      a.value = pointsToValue(draft);
      onCreate(a);
    }
    setDraft([]);
  }

  /* ---------- pointer ---------- */
  function onPointerDown(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const p = toImage(e.clientX, e.clientY);

    if (e.button === 1 || spaceRef.current || tool === "pan") {
      dragRef.current = { kind: "pan", sx: e.clientX, sy: e.clientY, tx: viewport.tx, ty: viewport.ty };
      return;
    }
    if (e.button !== 0) return;

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
    if (d.kind === "pan") {
      setViewport({ ...viewport, tx: d.tx + (e.clientX - d.sx), ty: d.ty + (e.clientY - d.sy) });
    } else if (d.kind === "move") {
      const dx = p[0] - d.sx;
      const dy = p[1] - d.sy;
      onUpdate(d.originals.map((o) => withValue(translateAnnotation(o, dx, dy))));
    } else if (d.kind === "resize") {
      const b = normalizeBBox(annotationBBox(d.original));
      const nb = { ...b };
      if (d.corner === 0 || d.corner === 3) nb.minX = p[0];
      else nb.maxX = p[0];
      if (d.corner === 0 || d.corner === 1) nb.minY = p[1];
      else nb.maxY = p[1];
      onUpdate([{ ...d.original, geometry: { type: "bbox", bbox: normalizeBBox(nb) } }]);
    } else if (d.kind === "vertex") {
      const a = annotations.find((x) => x.id === d.id);
      if (a && a.geometry.type === "polyline") {
        const pts = a.geometry.points.map((v, i) => (i === d.index ? ([p[0], p[1]] as Point) : v));
        onUpdate([withValue({ ...a, geometry: { type: "polyline", points: pts, bbox: bboxOfPoints(pts) } })]);
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

  const cursor =
    tool === "pan" ? "grab" : tool === "select" ? "default" : "crosshair";

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
        }}
        onDoubleClick={() => draft.length >= 2 && finishPolyline()}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      />
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

function withValue(a: Annotation): Annotation {
  if (a.geometry.type === "polyline") return { ...a, value: pointsToValue(a.geometry.points) };
  return a;
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
