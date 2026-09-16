import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Circle,
  Diamond,
  Hand,
  Maximize,
  MousePointer2,
  PanelLeftOpen,
  PanelRightOpen,
  Redo2,
  Spline,
  Square,
  Squircle,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";

import { PidCanvas, type Layers, type SplitRequest, type Tool, type Viewport } from "@/components/pid/PidCanvas";
import { LeftSidebar } from "@/components/pid/LeftSidebar";
import { RightPanel } from "@/components/pid/RightPanel";
import { ExportTab } from "@/components/pid/ExportTab";
import { annotationsFromCsv } from "@/lib/pid/csv";
import { buildDemoAnnotations } from "@/lib/pid/demo";
import { bboxOfPoints, refreshPolyline, translateAnnotation, metrics, annotationBBox } from "@/lib/pid/geometry";
import { allocateShortId, ensureShortIds, exportRowMap } from "@/lib/pid/ids";
import type { Annotation, MainLabel, ProjectImage, ProjectJson } from "@/lib/pid/types";
import { uuid } from "@/lib/pid/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "P&ID Annotator — Manual Diagram Labeling Workspace" },
      {
        name: "description",
        content:
          "Browser-based P&ID annotation workspace: draw boxes and pipe polylines, edit properties, and export CSV or JSON.",
      },
      { property: "og:title", content: "P&ID Annotator — Manual Diagram Labeling Workspace" },
      {
        property: "og:description",
        content:
          "Draw, edit, lock and export P&ID annotations entirely in your browser. Import images and CSV, export CSV and JSON.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const STORAGE_KEY = "pid-annotator-v1";

const DEFAULT_LAYERS: Layers = {
  view: true,
  components: true,
  text: true,
  pipes: true,
  markers: true,
  labels: true,
  links: true,
  ids: true,
};

type Tab = "manual" | "auto" | "review" | "export";

function Index() {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [image, setImage] = useState<ProjectImage | null>(null);
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [tab, setTab] = useState<Tab>("manual");
  const [layers, setLayers] = useState<Layers>(DEFAULT_LAYERS);
  const [viewport, setViewport] = useState<Viewport>({ scale: 1, tx: 0, ty: 0 });
  const [defaults, setDefaults] = useState<{
    mainLabel: MainLabel;
    subLabel: string;
    pipeStrokeWidth: number;
  }>({
    mainLabel: "Component",
    subLabel: "Equipment",
    pipeStrokeWidth: 16,
  });
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const exportRows = useMemo(() => exportRowMap(annotations), [annotations]);

  const past = useRef<Annotation[][]>([]);
  const future = useRef<Annotation[][]>([]);
  const restored = useRef(false);

  /* ---------- persistence ---------- */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ProjectJson;
        if (Array.isArray(parsed.annotations)) setAnnotations(parsed.annotations);
        if (parsed.image) setImage(parsed.image);
      }
    } catch {
      /* ignore */
    }
    restored.current = true;
  }, []);

  useEffect(() => {
    if (!restored.current) return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: "1.0", image, annotations } satisfies ProjectJson),
      );
    } catch {
      /* quota */
    }
  }, [annotations, image]);

  useEffect(() => {
    if (!image) {
      setImgEl(null);
      return;
    }
    const el = new Image();
    el.onload = () => setImgEl(el);
    el.src = image.dataUrl;
  }, [image]);

  /* ---------- history ---------- */
  const commit = useCallback(
    (next: Annotation[] | ((prev: Annotation[]) => Annotation[])) => {
      setAnnotations((prev) => {
        past.current = [...past.current.slice(-49), prev];
        future.current = [];
        return typeof next === "function" ? next(prev) : next;
      });
    },
    [],
  );

  const undo = useCallback(() => {
    setAnnotations((prev) => {
      const last = past.current.pop();
      if (!last) return prev;
      future.current = [prev, ...future.current.slice(0, 49)];
      return last;
    });
  }, []);

  const redo = useCallback(() => {
    setAnnotations((prev) => {
      const [next, ...rest] = future.current;
      if (!next) return prev;
      future.current = rest;
      past.current = [...past.current, prev];
      return next;
    });
  }, []);

  /* ---------- short ids ---------- */
  useEffect(() => {
    setAnnotations((prev) => {
      const next = ensureShortIds(prev);
      return next === prev ? prev : next;
    });
  }, [annotations]);

  /* ---------- annotation ops ---------- */
  const onCreate = (a: Annotation) => {
    commit((prev) => [...prev, a]);
    setSelectedIds([a.id]);
  };

  const onUpdate = (updated: Annotation[]) => {
    const map = new Map(updated.map((a) => [a.id, a]));
    setAnnotations((prev) => prev.map((a) => (map.has(a.id) && !a.locked ? map.get(a.id)! : a)));
  };

  const onCommit = (updated: Annotation[]) => {
    const map = new Map(updated.map((a) => [a.id, a]));
    commit((prev) => prev.map((a) => (map.has(a.id) && !a.locked ? map.get(a.id)! : a)));
  };

  const onSplit = (req: SplitRequest) => {
    const src = annotations.find((a) => a.id === req.id);
    if (!src || src.geometry.type !== "polyline") return;
    if (src.locked) {
      toast.error("Pipe is locked — unlock to edit");
      return;
    }
    const pts = src.geometry.points;
    let left: typeof pts;
    let right: typeof pts;
    if (req.vertexIndex != null) {
      if (req.vertexIndex <= 0 || req.vertexIndex >= pts.length - 1) {
        toast.error("Cannot split at an end point");
        return;
      }
      left = pts.slice(0, req.vertexIndex + 1);
      right = pts.slice(req.vertexIndex);
    } else {
      left = [...pts.slice(0, req.segIndex + 1), req.point];
      right = [req.point, ...pts.slice(req.segIndex + 1)];
    }
    if (left.length < 2 || right.length < 2) {
      toast.error("Split point is too close to an end");
      return;
    }

    const make = (points: typeof pts): Annotation =>
      refreshPolyline({
        ...src,
        id: uuid(),
        shortId: allocateShortId(src),
        geometry: { type: "polyline", points, bbox: bboxOfPoints(points) },
      });
    const a = make(left);
    const b = make(right);

    commit((prev) => {
      const withSplit = prev.flatMap((x) => (x.id === src.id ? [a, b] : [x]));
      // re-parent anything linked to the original pipe to the nearer half
      return withSplit.map((x) => {
        if (x.linkedElementId !== src.id) return x;
        const c = metrics(annotationBBox(x));
        const da = metrics(annotationBBox(a));
        const db = metrics(annotationBBox(b));
        const dist = (m: typeof da) => Math.hypot(c.centerX - m.centerX, c.centerY - m.centerY);
        return { ...x, linkedElementId: dist(da) <= dist(db) ? a.id : b.id, linkedElementLine: null };
      });
    });
    setSelectedIds([a.id, b.id]);
    toast.success(`Pipe split into ${a.shortId} and ${b.shortId}`);
  };


  const onPatch = (id: string, patch: Partial<Annotation>) =>
    commit((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));

  const onDelete = (id: string) =>
    commit((prev) => prev.filter((a) => !(a.id === id && !a.locked)));

  const onDeleteSelected = useCallback(() => {
    let blocked = 0;
    commit((prev) =>
      prev.filter((a) => {
        if (!selectedIds.includes(a.id)) return true;
        if (a.locked) {
          blocked++;
          return true;
        }
        return false;
      }),
    );
    if (blocked) toast.warning(`${blocked} locked annotation(s) were not deleted`);
    setSelectedIds([]);
  }, [commit, selectedIds]);

  const onDuplicate = (id: string) => {
    const src = annotations.find((a) => a.id === id);
    if (!src) return;
    const copy: Annotation = {
      ...translateAnnotation(src, 12, 12),
      id: uuid(),
      locked: false,
      linkedElementLine: null,
    };
    commit((prev) => [...prev, copy]);
    setSelectedIds([copy.id]);
  };

  /* ---------- imports ---------- */
  function openImage(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const el = new Image();
      el.onload = () => {
        setImage({ name: file.name, width: el.width, height: el.height, dataUrl });
        fitTo(el.width, el.height);
        toast.success(`Loaded ${file.name}`);
      };
      el.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  function importCsv(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const rows = annotationsFromCsv(String(reader.result));
        if (rows.length === 0) {
          toast.error("No annotation rows found in that CSV");
          return;
        }
        commit((prev) => [...prev, ...rows]);
        toast.success(`Imported ${rows.length} annotation(s)`);
      } catch {
        toast.error("Could not read that CSV");
      }
    };
    reader.readAsText(file);
  }

  function importJson(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as ProjectJson;
        if (!Array.isArray(parsed.annotations)) throw new Error("bad");
        commit(() => parsed.annotations);
        setSelectedIds([]);
        if (parsed.image) {
          setImage(parsed.image);
          fitTo(parsed.image.width, parsed.image.height);
        }
        toast.success(`Restored ${parsed.annotations.length} annotation(s)`);
      } catch {
        toast.error("That file is not a valid project JSON");
      }
    };
    reader.readAsText(file);
  }

  function loadDemo() {
    commit(() => buildDemoAnnotations());
    setSelectedIds([]);
    fitTo(1200, 840);
    toast.success("Demo project loaded");
  }

  /* ---------- viewport ---------- */
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const fitTo = useCallback((w: number, h: number) => {
    const el = wrapRef.current;
    const cw = el?.clientWidth ?? 900;
    const ch = el?.clientHeight ?? 600;
    const scale = Math.min((cw - 40) / w, (ch - 40) / h, 4);
    setViewport({ scale, tx: (cw - w * scale) / 2, ty: (ch - h * scale) / 2 });
  }, []);

  const zoom = (factor: number) =>
    setViewport((v) => {
      const el = wrapRef.current;
      const cx = (el?.clientWidth ?? 800) / 2;
      const cy = (el?.clientHeight ?? 600) / 2;
      const scale = Math.min(20, Math.max(0.05, v.scale * factor));
      const k = scale / v.scale;
      return { scale, tx: cx - (cx - v.tx) * k, ty: cy - (cy - v.ty) * k };
    });

  /* ---------- shortcuts ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
      }
      if (meta && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (meta) return;
      const map: Record<string, Tool> = {
        v: "select",
        r: "rect",
        p: "polyline",
        b: "branch",
        c: "crossing",
        o: "port",
        s: "split",
        h: "pan",
      };
      const next = map[e.key.toLowerCase()];
      if (next) setTool(next);
      if (e.key.toLowerCase() === "f" && image) fitTo(image.width, image.height);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, image, fitTo]);

  const tools: [Tool, string, React.ComponentType<{ className?: string }>][] = [
    ["select", "Select (V)", MousePointer2],
    ["rect", "Box (R)", Square],
    ["polyline", "Pipe polyline (P)", Spline],
    ["branch", "Branch (B)", Squircle],
    ["crossing", "Crossing (C)", Diamond],
    ["port", "Port (O)", Circle],
    ["split", "Split pipe (S)", Scissors],
    ["pan", "Pan (H)", Hand],
  ];

  const selectedCount = selectedIds.length;
  const counts = useMemo(
    () => ({
      total: annotations.length,
      locked: annotations.filter((a) => a.locked).length,
    }),
    [annotations],
  );

  return (
    <div className="flex h-screen w-full flex-col bg-[#15151f] text-neutral-200">
      <header className="flex items-center gap-3 border-b border-white/10 bg-[#1e1e2e] px-3 py-2">
        <h1 className="text-sm font-semibold tracking-tight text-white">P&amp;ID Annotator</h1>

        <nav className="ml-4 flex gap-1">
          {(
            [
              ["manual", "Manual"],
              ["auto", "Auto-detect"],
              ["review", "Review"],
              ["export", "Export"],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
                tab === id ? "bg-[#2563eb] text-white" : "text-neutral-300 hover:bg-white/10"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        {tab === "manual" && (
          <div className="ml-4 flex items-center gap-1">
            {tools.map(([id, title, Icon]) => (
              <button
                key={id}
                title={title}
                onClick={() => setTool(id)}
                className={`rounded-md p-1.5 transition-colors ${
                  tool === id ? "bg-[#2563eb] text-white" : "text-neutral-300 hover:bg-white/10"
                }`}
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
            <span className="mx-2 h-5 w-px bg-white/10" />
            <button title="Undo (Ctrl+Z)" onClick={undo} className="rounded-md p-1.5 hover:bg-white/10">
              <Undo2 className="h-4 w-4" />
            </button>
            <button title="Redo (Ctrl+Shift+Z)" onClick={redo} className="rounded-md p-1.5 hover:bg-white/10">
              <Redo2 className="h-4 w-4" />
            </button>
            <span className="mx-2 h-5 w-px bg-white/10" />
            <button title="Zoom out" onClick={() => zoom(1 / 1.2)} className="rounded-md p-1.5 hover:bg-white/10">
              <ZoomOut className="h-4 w-4" />
            </button>
            <button title="Zoom in" onClick={() => zoom(1.2)} className="rounded-md p-1.5 hover:bg-white/10">
              <ZoomIn className="h-4 w-4" />
            </button>
            <button
              title="Fit to screen (F)"
              onClick={() => fitTo(image?.width ?? 1200, image?.height ?? 840)}
              className="rounded-md p-1.5 hover:bg-white/10"
            >
              <Maximize className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="ml-auto flex items-center gap-1">
          {!leftOpen && (
            <button title="Show project panel" onClick={() => setLeftOpen(true)} className="rounded-md p-1.5 hover:bg-white/10">
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          )}
          {!rightOpen && (
            <button title="Show properties" onClick={() => setRightOpen(true)} className="rounded-md p-1.5 hover:bg-white/10">
              <PanelRightOpen className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {leftOpen && (
          <LeftSidebar
            image={image}
            annotations={annotations}
            selectedIds={selectedIds}
            hoveredId={hoveredId}
            exportRows={exportRows}
            layers={layers}
            onSelect={setSelectedIds}
            onHover={setHoveredId}
            onOpenImage={openImage}
            onImportCsv={importCsv}
            onImportJson={importJson}
            onLoadDemo={loadDemo}
            onToggleLayer={(k) => setLayers((l) => ({ ...l, [k]: !l[k] }))}
            onCollapse={() => setLeftOpen(false)}
          />
        )}

        <main ref={wrapRef} className="relative min-w-0 flex-1 bg-[#f5f5f5]">
          {tab === "manual" ? (
            <PidCanvas
              image={imgEl}
              annotations={annotations}
              selectedIds={selectedIds}
              hoveredId={hoveredId}
              exportRows={exportRows}
              tool={tool}
              layers={layers}
              viewport={viewport}
              defaults={defaults}
              setViewport={setViewport}
              onSelect={setSelectedIds}
              onHover={setHoveredId}
              onUpdate={onUpdate}
              onCommit={onCommit}
              onCreate={onCreate}
              onSplit={onSplit}
              onDeleteSelected={onDeleteSelected}
              onCursor={setCursor}
            />
          ) : tab === "export" ? (
            <div className="h-full overflow-y-auto bg-white">
              <ExportTab annotations={annotations} selectedIds={selectedIds} image={image} />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center bg-white">
              <div className="max-w-md text-center text-neutral-500">
                <h2 className="text-base font-semibold text-neutral-700">
                  {tab === "auto" ? "Auto-detect" : "Review"}
                </h2>
                <p className="mt-2 text-sm">
                  {tab === "auto"
                    ? "Automatic symbol detection is not part of this prototype. Use the Manual tab to label the diagram."
                    : "A dedicated review queue is planned. For now, use the list and filters in the Manual tab."}
                </p>
              </div>
            </div>
          )}
        </main>

        {rightOpen && (
          <RightPanel
            image={image}
            annotations={annotations}
            selectedIds={selectedIds}
            exportRows={exportRows}
            defaults={defaults}
            setDefaults={setDefaults}
            onPatch={onPatch}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            onCollapse={() => setRightOpen(false)}
          />
        )}
      </div>

      <footer className="flex items-center gap-4 border-t border-white/10 bg-[#1e1e2e] px-3 py-1.5 text-[11px] text-neutral-400">
        <span>Tool: {tool}</span>
        <span>Zoom: {Math.round(viewport.scale * 100)}%</span>
        <span>Cursor: {cursor ? `${cursor.x}, ${cursor.y}` : "—"}</span>
        <span>Annotations: {counts.total}</span>
        <span>Locked: {counts.locked}</span>
        <span>Selected: {selectedCount}</span>
        <span className="ml-auto">Enter finishes a pipe · Shift constrains · Del removes</span>
      </footer>
    </div>
  );
}
