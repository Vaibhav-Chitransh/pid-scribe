import type { Annotation } from "./types";

export function prefixOf(a: Pick<Annotation, "mainLabel" | "subLabel">): string {
  if (a.mainLabel === "View") return "V";
  if (a.mainLabel === "Text") return "T";
  if (a.subLabel === "Pipe") return "P";
  if (a.subLabel === "BranchSymbol") return "B";
  if (a.subLabel === "RouteCrossing") return "X";
  if (a.subLabel === "PipingPort") return "O";
  return "C";
}

/** Session-stable counters: they only ever grow, so ids are never reused. */
const counters: Record<string, number> = {};

function seed(list: Annotation[]) {
  for (const a of list) {
    if (!a.shortId) continue;
    const [p, n] = a.shortId.split("-");
    const v = Number(n);
    if (p && Number.isFinite(v)) counters[p] = Math.max(counters[p] ?? 0, v);
  }
}

export function allocateShortId(a: Pick<Annotation, "mainLabel" | "subLabel">): string {
  const p = prefixOf(a);
  counters[p] = (counters[p] ?? 0) + 1;
  return `${p}-${counters[p]}`;
}

/** Returns the same array reference when nothing needed an id. */
export function ensureShortIds(list: Annotation[]): Annotation[] {
  seed(list);
  let changed = false;
  const out = list.map((a) => {
    if (a.shortId) return a;
    changed = true;
    return { ...a, shortId: allocateShortId(a) };
  });
  return changed ? out : list;
}

const ORDER: Record<string, number> = { View: 0, Component: 1, Text: 2 };

export function exportOrder(list: Annotation[]): Annotation[] {
  return [...list].sort((a, b) => (ORDER[a.mainLabel] ?? 1) - (ORDER[b.mainLabel] ?? 1));
}

/** 1-based CSV line number (header is line 1) per annotation id. */
export function exportRowMap(list: Annotation[]): Record<string, number> {
  const map: Record<string, number> = {};
  exportOrder(list).forEach((a, i) => (map[a.id] = i + 2));
  return map;
}

export function idLabel(a: Annotation, rows: Record<string, number>): string {
  return `${a.shortId ?? "—"} · #${rows[a.id] ?? "?"}`;
}
