import { useMemo, useRef, useState } from "react";
import { FileUp, ImagePlus, Lock, PanelLeftClose, Search, Sparkles } from "lucide-react";
import type { Annotation, ProjectImage } from "@/lib/pid/types";
import type { Layers } from "./PidCanvas";
import { annotationBBox } from "@/lib/pid/geometry";

interface Props {
  image: ProjectImage | null;
  annotations: Annotation[];
  selectedIds: string[];
  layers: Layers;
  onSelect: (ids: string[]) => void;
  onOpenImage: (file: File) => void;
  onImportCsv: (file: File) => void;
  onImportJson: (file: File) => void;
  onLoadDemo: () => void;
  onToggleLayer: (key: keyof Layers) => void;
  onCollapse: () => void;
}

const FILTERS = ["All", "View", "Component", "Text", "Pipe", "Locked", "Unlocked"] as const;

export function LeftSidebar({
  image,
  annotations,
  selectedIds,
  layers,
  onSelect,
  onOpenImage,
  onImportCsv,
  onImportJson,
  onLoadDemo,
  onToggleLayer,
  onCollapse,
}: Props) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const [query, setQuery] = useState("");
  const imgInput = useRef<HTMLInputElement>(null);
  const csvInput = useRef<HTMLInputElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return annotations.filter((a) => {
      const passFilter =
        filter === "All" ||
        (filter === "Locked" && a.locked) ||
        (filter === "Unlocked" && !a.locked) ||
        (filter === "Pipe" && a.subLabel === "Pipe") ||
        a.mainLabel === filter;
      const passQuery =
        !q || a.subLabel.toLowerCase().includes(q) || (a.value ?? "").toLowerCase().includes(q);
      return passFilter && passQuery;
    });
  }, [annotations, filter, query]);

  const btn =
    "flex w-full items-center gap-2 rounded-md bg-white/5 px-3 py-2 text-sm text-neutral-200 transition-colors hover:bg-white/10";

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-white/10 bg-[#1e1e2e] text-neutral-200">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-widest text-neutral-400">Project</span>
        <button onClick={onCollapse} title="Collapse sidebar" className="rounded p-1 hover:bg-white/10">
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-2 border-b border-white/10 p-3">
        <button className={btn} onClick={() => imgInput.current?.click()}>
          <ImagePlus className="h-4 w-4" /> Open Image
        </button>
        <button className={btn} onClick={() => csvInput.current?.click()}>
          <FileUp className="h-4 w-4" /> Import CSV
        </button>
        <button className={btn} onClick={() => jsonInput.current?.click()}>
          <FileUp className="h-4 w-4" /> Import JSON
        </button>
        <button className={btn} onClick={onLoadDemo}>
          <Sparkles className="h-4 w-4" /> Load demo
        </button>
        <input
          ref={imgInput}
          type="file"
          accept="image/png,image/jpeg"
          hidden
          onChange={(e) => e.target.files?.[0] && onOpenImage(e.target.files[0])}
        />
        <input
          ref={csvInput}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => e.target.files?.[0] && onImportCsv(e.target.files[0])}
        />
        <input
          ref={jsonInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => e.target.files?.[0] && onImportJson(e.target.files[0])}
        />
      </div>

      {image && (
        <div className="flex items-center gap-2 border-b border-white/10 p-3">
          <img src={image.dataUrl} alt="" className="h-10 w-14 rounded border border-white/10 object-cover" />
          <div className="min-w-0">
            <p className="truncate text-xs font-medium">{image.name}</p>
            <p className="text-[11px] text-neutral-400">
              {image.width} × {image.height}
            </p>
          </div>
        </div>
      )}

      <div className="space-y-2 border-b border-white/10 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Layers</p>
        {(
          [
            ["view", "View"],
            ["components", "Components"],
            ["text", "Text"],
            ["pipes", "Pipes"],
            ["markers", "Branch / Crossing / Port"],
            ["labels", "Labels"],
            ["links", "Link lines"],
          ] as [keyof Layers, string][]
        ).map(([key, label]) => (
          <label key={key} className="flex cursor-pointer items-center gap-2 text-xs text-neutral-300">
            <input type="checkbox" checked={layers[key]} onChange={() => onToggleLayer(key)} className="accent-[#2563eb]" />
            {label}
          </label>
        ))}
      </div>

      <div className="space-y-2 border-b border-white/10 p-3">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as (typeof FILTERS)[number])}
          className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-neutral-200"
        >
          {FILTERS.map((f) => (
            <option key={f} value={f} className="bg-[#1e1e2e]">
              {f}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2">
          <Search className="h-3.5 w-3.5 text-neutral-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search label or value"
            className="w-full bg-transparent py-1.5 text-xs outline-none placeholder:text-neutral-500"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 && <p className="p-3 text-xs text-neutral-500">No annotations</p>}
        {rows.map((a) => {
          const b = annotationBBox(a);
          const preview =
            a.geometry.type === "polyline"
              ? `${a.geometry.points.length} pts`
              : a.value || `${Math.round(b.minX)},${Math.round(b.minY)}`;
          const selected = selectedIds.includes(a.id);
          return (
            <button
              key={a.id}
              onClick={(e) =>
                onSelect(
                  e.shiftKey
                    ? selected
                      ? selectedIds.filter((i) => i !== a.id)
                      : [...selectedIds, a.id]
                    : [a.id],
                )
              }
              className={`flex w-full items-center gap-2 border-b border-white/5 px-3 py-2 text-left text-xs transition-colors ${
                selected ? "bg-[#2563eb]/25" : "hover:bg-white/5"
              }`}
            >
              <span className="flex-1 truncate">
                <span className="text-neutral-400">{a.mainLabel}</span>{" "}
                <span className="font-medium">{a.subLabel}</span>
                <span className="block truncate text-[11px] text-neutral-500">{preview}</span>
              </span>
              {a.locked && <Lock className="h-3 w-3 shrink-0 text-amber-400" />}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
