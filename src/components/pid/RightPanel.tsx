import { useState } from "react";
import { Copy, PanelRightClose, Trash2 } from "lucide-react";
import type { Annotation, MainLabel, ProjectImage } from "@/lib/pid/types";
import { SUB_LABELS } from "@/lib/pid/types";
import { annotationBBox, metrics } from "@/lib/pid/geometry";
import { idLabel } from "@/lib/pid/ids";

type Defaults = { mainLabel: MainLabel; subLabel: string; pipeStrokeWidth: number };

interface Props {
  image: ProjectImage | null;
  annotations: Annotation[];
  selectedIds: string[];
  exportRows: Record<string, number>;
  defaults: Defaults;
  setDefaults: (d: Defaults) => void;
  onPatch: (id: string, patch: Partial<Annotation>) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onCollapse: () => void;
}

const field = "w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-neutral-100 outline-none focus:border-[#2563eb]";

export function RightPanel({
  image,
  annotations,
  selectedIds,
  exportRows,
  defaults,
  setDefaults,
  onPatch,
  onDelete,
  onDuplicate,
  onCollapse,
}: Props) {
  const selected = annotations.find((a) => a.id === selectedIds[0]) ?? null;

  const counts = annotations.reduce<Record<string, number>>((acc, a) => {
    acc[a.subLabel] = (acc[a.subLabel] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <aside className="flex h-full w-[300px] shrink-0 flex-col overflow-y-auto border-l border-white/10 bg-[#1e1e2e] text-neutral-200">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-widest text-neutral-400">Properties</span>
        <button onClick={onCollapse} title="Collapse panel" className="rounded p-1 hover:bg-white/10">
          <PanelRightClose className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-2 border-b border-white/10 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">New annotation defaults</p>
        <select
          className={field}
          value={defaults.mainLabel}
          onChange={(e) => {
            const main = e.target.value as MainLabel;
            setDefaults({ ...defaults, mainLabel: main, subLabel: SUB_LABELS[main][0] ?? "" });
          }}
        >
          {(Object.keys(SUB_LABELS) as MainLabel[]).map((m) => (
            <option key={m} value={m} className="bg-[#1e1e2e]">
              {m}
            </option>
          ))}
        </select>
        <select
          className={field}
          value={defaults.subLabel}
          onChange={(e) => setDefaults({ ...defaults, subLabel: e.target.value })}
        >
          {SUB_LABELS[defaults.mainLabel].map((s) => (
            <option key={s} value={s} className="bg-[#1e1e2e]">
              {s}
            </option>
          ))}
        </select>
        <label className="block space-y-1">
          <span className="text-[11px] uppercase tracking-wider text-neutral-400">Pipe stroke width</span>
          <input
            type="number"
            min={1}
            className={field}
            value={defaults.pipeStrokeWidth}
            onChange={(e) =>
              setDefaults({ ...defaults, pipeStrokeWidth: Math.max(1, Number(e.target.value) || 1) })
            }
          />
        </label>
      </div>

      {!selected ? (
        <div className="space-y-2 p-3 text-xs text-neutral-300">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Project summary</p>
          <p>Image: {image ? image.name : "none"}</p>
          {image && (
            <p>
              Dimensions: {image.width} × {image.height}
            </p>
          )}
          <p>Total annotations: {annotations.length}</p>
          <div className="mt-2 space-y-1">
            {Object.entries(counts).map(([k, v]) => (
              <div key={k} className="flex justify-between border-b border-white/5 py-0.5 text-[11px]">
                <span className="text-neutral-400">{k}</span>
                <span>{v}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <SelectedEditor
          key={selected.id}
          annotation={selected}
          annotations={annotations}
          exportRows={exportRows}
          onPatch={onPatch}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
        />
      )}
    </aside>
  );
}

function SelectedEditor({
  annotation,
  annotations,
  exportRows,
  onPatch,
  onDelete,
  onDuplicate,
}: {
  annotation: Annotation;
  annotations: Annotation[];
  exportRows: Record<string, number>;
  onPatch: (id: string, patch: Partial<Annotation>) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
}) {
  const a = annotation;
  const m = metrics(annotationBBox(a));
  const isPipe = a.geometry.type === "polyline";
  const [linkQuery, setLinkQuery] = useState("");

  const linkOptions = annotations.filter((x) => {
    if (x.id === a.id) return false;
    const q = linkQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      (x.shortId ?? "").toLowerCase().includes(q) ||
      x.subLabel.toLowerCase().includes(q) ||
      (x.value ?? "").toLowerCase().includes(q) ||
      String(exportRows[x.id] ?? "").includes(q)
    );
  });

  return (
    <div className="space-y-3 p-3 text-xs">
      <div className="flex items-center justify-between rounded-md border border-white/10 bg-white/5 px-2 py-1.5">
        <span className="text-[11px] uppercase tracking-wider text-neutral-400">ID</span>
        <span className="font-mono text-[11px] text-neutral-100">{idLabel(a, exportRows)}</span>
      </div>

      <Row label="MainLabel">
        <select
          className={field}
          value={a.mainLabel}
          onChange={(e) => {
            const main = e.target.value as MainLabel;
            onPatch(a.id, { mainLabel: main, subLabel: SUB_LABELS[main][0] ?? a.subLabel });
          }}
        >
          {(Object.keys(SUB_LABELS) as MainLabel[]).map((x) => (
            <option key={x} value={x} className="bg-[#1e1e2e]">
              {x}
            </option>
          ))}
        </select>
      </Row>

      <Row label="SubLabel">
        <select className={field} value={a.subLabel} onChange={(e) => onPatch(a.id, { subLabel: e.target.value })}>
          {[...new Set([...SUB_LABELS[a.mainLabel], a.subLabel])].map((s) => (
            <option key={s} value={s} className="bg-[#1e1e2e]">
              {s}
            </option>
          ))}
        </select>
      </Row>

      <Row label="Value">
        <input
          className={field}
          readOnly={isPipe}
          value={a.value}
          onChange={(e) => onPatch(a.id, { value: e.target.value })}
        />
      </Row>

      <Row label="SubType">
        <input className={field} value={a.subType} onChange={(e) => onPatch(a.id, { subType: e.target.value })} />
      </Row>

      <Row label="LinkedElement">
        <select
          className={field}
          value={a.linkedElementId ?? ""}
          onChange={(e) => onPatch(a.id, { linkedElementId: e.target.value || null })}
        >
          <option value="" className="bg-[#1e1e2e]">
            — none —
          </option>
          {annotations
            .filter((x) => x.id !== a.id)
            .map((x, i) => (
              <option key={x.id} value={x.id} className="bg-[#1e1e2e]">
                #{i + 1} {x.subLabel} {x.value ? `(${x.value.slice(0, 14)})` : ""}
              </option>
            ))}
        </select>
      </Row>

      <label className="flex items-center gap-2 pt-1">
        <input
          type="checkbox"
          className="accent-[#2563eb]"
          checked={a.locked}
          onChange={(e) => onPatch(a.id, { locked: e.target.checked })}
        />
        Locked
      </label>

      <div className="rounded-md border border-white/10 bg-white/5 p-2">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Geometry</p>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-neutral-300">
          {(
            [
              ["MinX", m.minX],
              ["MinY", m.minY],
              ["MaxX", m.maxX],
              ["MaxY", m.maxY],
              ["CenterX", m.centerX],
              ["CenterY", m.centerY],
              ["Width", m.width],
              ["Height", m.height],
            ] as [string, number][]
          ).map(([k, v]) => (
            <div key={k} className="flex justify-between">
              <span className="text-neutral-500">{k}</span>
              <span>{Math.round(v)}</span>
            </div>
          ))}
        </div>
        {isPipe && a.geometry.type === "polyline" && (
          <p className="mt-2 text-[11px] text-neutral-400">{a.geometry.points.length} vertices</p>
        )}
      </div>

      <div className="flex gap-2 pt-1">
        <button
          disabled={a.locked}
          onClick={() => onDelete(a.id)}
          className="flex flex-1 items-center justify-center gap-1 rounded-md bg-red-600/80 px-2 py-1.5 text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </button>
        <button
          onClick={() => onDuplicate(a.id)}
          className="flex flex-1 items-center justify-center gap-1 rounded-md bg-white/10 px-2 py-1.5 transition-colors hover:bg-white/20"
        >
          <Copy className="h-3.5 w-3.5" /> Duplicate
        </button>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <span className="text-[11px] uppercase tracking-wider text-neutral-400">{label}</span>
      {children}
    </div>
  );
}
