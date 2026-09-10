import { bboxOfPoints, pointsToValue } from "./geometry";
import type { Annotation, Point } from "./types";
import { uuid } from "./types";

/** Tiny built-in mock project: 1 view, 2 equipment, 2 texts, 1 pipe, 1 branch. */
export function buildDemoAnnotations(): Annotation[] {
  const eq1 = uuid();
  const eq2 = uuid();
  const pipePts: Point[] = [
    [340, 300],
    [640, 300],
    [640, 520],
  ];

  const mk = (a: Partial<Annotation> & Pick<Annotation, "mainLabel" | "subLabel">): Annotation => ({
    id: uuid(),
    value: "",
    subType: "",
    linkedElementId: null,
    linkedElementLine: null,
    locked: false,
    source: "demo",
    geometry: { type: "bbox", bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 } },
    ...a,
  });

  return [
    mk({
      mainLabel: "View",
      subLabel: "MainView",
      geometry: { type: "bbox", bbox: { minX: 80, minY: 80, maxX: 1120, maxY: 760 } },
    }),
    mk({
      id: eq1,
      mainLabel: "Component",
      subLabel: "Equipment",
      subType: "EQT_1",
      geometry: { type: "bbox", bbox: { minX: 200, minY: 240, maxX: 340, maxY: 360 } },
    }),
    mk({
      id: eq2,
      mainLabel: "Component",
      subLabel: "Equipment",
      subType: "EQT_2",
      geometry: { type: "bbox", bbox: { minX: 560, minY: 520, maxX: 720, maxY: 650 } },
    }),
    mk({
      mainLabel: "Component",
      subLabel: "Pipe",
      geometry: { type: "polyline", points: pipePts, bbox: bboxOfPoints(pipePts) },
      value: pointsToValue(pipePts),
    }),
    mk({
      mainLabel: "Component",
      subLabel: "BranchSymbol",
      geometry: { type: "bbox", bbox: { minX: 637, minY: 297, maxX: 643, maxY: 303 } },
    }),
    mk({
      mainLabel: "Text",
      subLabel: "EquipmentText",
      value: "P-101A",
      linkedElementId: eq1,
      geometry: { type: "bbox", bbox: { minX: 210, minY: 200, maxX: 320, maxY: 230 } },
    }),
    mk({
      mainLabel: "Text",
      subLabel: "EquipmentText",
      value: "V-204",
      linkedElementId: eq2,
      geometry: { type: "bbox", bbox: { minX: 570, minY: 480, maxX: 670, maxY: 510 } },
    }),
  ];
}
