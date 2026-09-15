export type MainLabel = "View" | "Component" | "Text";

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type Point = [number, number];

export type Geometry =
  | { type: "bbox"; bbox: BBox }
  | { type: "polyline"; points: Point[]; bbox: BBox };

export interface Annotation {
  id: string;
  /** Session-stable human id, e.g. "C-12". Assigned in creation order per prefix. */
  shortId?: string;
  /** Rendered stroke width for polyline pipes (image units). */
  strokeWidth?: number;
  mainLabel: MainLabel;
  subLabel: string;
  geometry: Geometry;
  value: string;
  subType: string;
  linkedElementId: string | null;
  linkedElementLine: number | null;
  locked: boolean;
  source: "manual" | "csv" | "json" | "demo";
}

export interface ProjectImage {
  name: string;
  width: number;
  height: number;
  dataUrl: string;
}

export interface ProjectJson {
  version: string;
  image: ProjectImage | null;
  annotations: Annotation[];
}

export const SUB_LABELS: Record<MainLabel, string[]> = {
  View: ["MainView"],
  Component: [
    "Equipment",
    "Pipe",
    "PipingValve",
    "PipingInstrument",
    "PipingMiscellaneousPart",
    "PipingReducer",
    "BranchSymbol",
    "RouteCrossing",
    "PipingPort",
    "OnOffSheetSymbol",
  ],
  Text: [
    "EquipmentText",
    "PipingValveText",
    "MainViewText",
    "PipingInstrumentText",
    "PipingMiscellaneousPartText",
    "NoteText",
  ],
};

export const MARKER_SUBLABELS = ["BranchSymbol", "RouteCrossing", "PipingPort"];

export function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
