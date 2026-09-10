import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Download } from "lucide-react";
import type { Annotation, ProjectImage, ProjectJson } from "@/lib/pid/types";
import { annotationsToCsv, download, sortForExport } from "@/lib/pid/csv";
import { toast } from "sonner";

interface Props {
  annotations: Annotation[];
  selectedIds: string[];
  image: ProjectImage | null;
}

type Scope = "all" | "selected" | "unlocked";

export function ExportTab({ annotations, selectedIds, image }: Props) {
  const [csv, setCsv] = useState(true);
  const [json, setJson] = useState(false);
  const [scope, setScope] = useState<Scope>("all");

  const rows = useMemo(() => {
    if (scope === "selected") return annotations.filter((a) => selectedIds.includes(a.id));
    if (scope === "unlocked") return annotations.filter((a) => !a.locked);
    return annotations;
  }, [annotations, selectedIds, scope]);

  const warnings = useMemo(() => {
    const w: string[] = [];
    if (!rows.some((a) => a.mainLabel === "View" && a.subLabel === "MainView"))
      w.push("No View / MainView annotation found.");
    const emptyText = rows.filter((a) => a.mainLabel === "Text" && !a.value.trim()).length;
    if (emptyText) w.push(`${emptyText} Text row(s) have an empty Value.`);
    const shortPipes = rows.filter(
      (a) => a.subLabel === "Pipe" && (a.geometry.type !== "polyline" || a.geometry.points.length < 2),
    ).length;
    if (shortPipes) w.push(`${shortPipes} Pipe(s) have fewer than 2 points.`);
    const ids = new Set(rows.map((a) => a.id));
    const broken = rows.filter((a) => a.linkedElementId && !ids.has(a.linkedElementId)).length;
    if (broken) w.push(`${broken} LinkedElement reference(s) point to a row outside this export.`);
    return w;
  }, [rows]);

  function doExport() {
    if (rows.length === 0) {
      toast.error("Nothing to export for this scope");
      return;
    }
    if (!csv && !json) {
      toast.error("Pick at least one format");
      return;
    }
    const base = (image?.name ?? "pid-annotations").replace(/\.[^.]+$/, "");
    if (csv) download(`${base}.csv`, annotationsToCsv(rows), "text/csv;charset=utf-8");
    if (json) {
      const sorted = sortForExport(rows);
      const lineOf = new Map(sorted.map((a, i) => [a.id, i + 2]));
      const payload: ProjectJson = {
        version: "1.0",
        image,
        annotations: sorted.map((a) => ({
          ...a,
          linkedElementLine: a.linkedElementId ? (lineOf.get(a.linkedElementId) ?? null) : null,
        })),
      };
      download(`${base}.json`, JSON.stringify(payload, null, 2), "application/json");
    }
    toast.success("Export complete");
  }

  const box = "flex items-center gap-2 text-sm";

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6 text-neutral-800">
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-neutral-500">Formats</h2>
        <div className="space-y-2">
          <label className={box}>
            <input type="checkbox" checked={csv} onChange={(e) => setCsv(e.target.checked)} className="accent-[#2563eb]" />
            CSV
          </label>
          <label className={box}>
            <input type="checkbox" checked={json} onChange={(e) => setJson(e.target.checked)} className="accent-[#2563eb]" />
            JSON (full session)
          </label>
          {["COCO", "Pascal-VOC", "TXT"].map((f) => (
            <label key={f} className={`${box} cursor-not-allowed text-neutral-400`} title="Coming soon">
              <input type="checkbox" disabled /> {f} — Coming soon
            </label>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-neutral-500">Scope</h2>
        <div className="flex gap-4">
          {(
            [
              ["all", "All annotations"],
              ["selected", "Selected only"],
              ["unlocked", "Unlocked only"],
            ] as [Scope, string][]
          ).map(([v, label]) => (
            <label key={v} className={box}>
              <input
                type="radio"
                name="scope"
                checked={scope === v}
                onChange={() => setScope(v)}
                className="accent-[#2563eb]"
              />
              {label}
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-neutral-500">{rows.length} row(s) will be exported.</p>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-neutral-500">Validation</h2>
        {warnings.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-green-700">
            <CheckCircle2 className="h-4 w-4" /> No issues found
          </p>
        ) : (
          <ul className="space-y-1">
            {warnings.map((w) => (
              <li key={w} className="flex items-start gap-2 text-sm text-amber-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {w}
              </li>
            ))}
          </ul>
        )}
      </section>

      <button
        onClick={doExport}
        className="flex items-center gap-2 rounded-md bg-[#2563eb] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1d4ed8]"
      >
        <Download className="h-4 w-4" /> Download
      </button>
    </div>
  );
}
