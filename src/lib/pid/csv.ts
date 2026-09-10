import { annotationBBox, bboxOfPoints, metrics, pointsToValue, valueToPoints } from "./geometry";
import type { Annotation, MainLabel } from "./types";
import { uuid } from "./types";

export const CSV_COLUMNS = [
  "MainLabel",
  "SubLabel",
  "MinX",
  "MinY",
  "MaxX",
  "MaxY",
  "CenterX",
  "CenterY",
  "Width",
  "Height",
  "Value",
  "LinkedElement",
  "SubType",
];

/** Minimal RFC 4180 parser. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export function annotationsFromCsv(text: string): Annotation[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = (rows[0] ?? []).map((h) => h.trim());
  const idx = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const get = (r: string[], name: string) => {
    const i = idx(name);
    return i >= 0 ? (r[i] ?? "").trim() : "";
  };
  const num = (r: string[], name: string) => {
    const v = Number(get(r, name));
    return Number.isFinite(v) ? v : 0;
  };

  const byLine = new Map<number, Annotation>();
  const list: Annotation[] = [];

  rows.slice(1).forEach((r, i) => {
    const line = i + 2; // header is line 1
    const mainLabel = (get(r, "MainLabel") || "Component") as MainLabel;
    const subLabel = get(r, "SubLabel") || "Equipment";
    const value = get(r, "Value");
    const linkRaw = get(r, "LinkedElement");
    const linkedElementLine = linkRaw && Number.isFinite(Number(linkRaw)) ? Number(linkRaw) : null;

    let ann: Annotation;
    const points = subLabel === "Pipe" ? valueToPoints(value) : [];
    if (subLabel === "Pipe" && points.length >= 2) {
      ann = {
        id: uuid(),
        mainLabel,
        subLabel,
        geometry: { type: "polyline", points, bbox: bboxOfPoints(points) },
        value,
        subType: get(r, "SubType"),
        linkedElementId: null,
        linkedElementLine,
        locked: false,
        source: "csv",
      };
    } else {
      ann = {
        id: uuid(),
        mainLabel,
        subLabel,
        geometry: {
          type: "bbox",
          bbox: {
            minX: num(r, "MinX"),
            minY: num(r, "MinY"),
            maxX: num(r, "MaxX"),
            maxY: num(r, "MaxY"),
          },
        },
        value,
        subType: get(r, "SubType"),
        linkedElementId: null,
        linkedElementLine,
        locked: false,
        source: "csv",
      };
    }
    byLine.set(line, ann);
    list.push(ann);
  });

  // resolve links by original line numbers
  for (const a of list) {
    if (a.linkedElementLine != null) {
      const target = byLine.get(a.linkedElementLine);
      if (target) a.linkedElementId = target.id;
    }
  }
  return list;
}

const ORDER: Record<string, number> = { View: 0, Component: 1, Text: 2 };

export function sortForExport(annotations: Annotation[]): Annotation[] {
  return [...annotations].sort((a, b) => (ORDER[a.mainLabel] ?? 1) - (ORDER[b.mainLabel] ?? 1));
}

function escapeField(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function annotationsToCsv(annotations: Annotation[]): string {
  const sorted = sortForExport(annotations);
  const lineOf = new Map<string, number>();
  sorted.forEach((a, i) => lineOf.set(a.id, i + 2));

  const lines = [CSV_COLUMNS.join(",")];
  for (const a of sorted) {
    const m = metrics(annotationBBox(a));
    const value = a.geometry.type === "polyline" ? pointsToValue(a.geometry.points) : a.value;
    const link = a.linkedElementId ? (lineOf.get(a.linkedElementId) ?? "") : "";
    const row = [
      a.mainLabel,
      a.subLabel,
      Math.round(m.minX),
      Math.round(m.minY),
      Math.round(m.maxX),
      Math.round(m.maxY),
      Math.round(m.centerX),
      Math.round(m.centerY),
      Math.round(m.width),
      Math.round(m.height),
      value,
      link,
      a.subType,
    ].map((v) => escapeField(String(v ?? "")));
    lines.push(row.join(","));
  }
  return lines.join("\n");
}

export function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
