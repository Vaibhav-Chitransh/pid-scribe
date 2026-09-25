# P&ID Annotator Pro

Build a single-page web application (React + TypeScript preferred) for a P&ID (Piping & Instrumentation Diagram) annotation tool. This is a FRONTEND-ONLY interactive prototype — all state lives in the browser (use React state + optional localStorage). No backend, no API calls, no ML models.

## Purpose
A manual labeling workspace where a user can:
1. Import a P&ID image (PNG/JPG)
2. Optionally import an existing annotation CSV
3. View annotations overlaid on the image
4. Create, edit, delete, and lock annotations manually
5. Export annotations as CSV or JSON and download the file

This prototype is for testing UX and basic CRUD — not production inference.

## Layout (desktop-first, min width 1280px)

Three-column layout:

LEFT SIDEBAR (240px, collapsible):
- "Open Image" button (file picker)
- "Import CSV" button (file picker, optional if image already loaded)
- Image thumbnail + filename
- Annotation list (scrollable): each row shows MainLabel, SubLabel, short preview (Value or point count), lock icon if locked
- Clicking a list item selects that annotation on canvas
- Filter dropdown: All | View | Component | Text | Pipe | Locked | Unlocked
- Search box to filter list by SubLabel or Value

CENTER (flex, main workspace):
- Top toolbar (horizontal):
 - Tab switcher: [ Manual ] [ Text ] [ Route ] [ Export ] — only Manual tab needs to be fully functional; others can show "Coming soon" placeholder panels
 - Tool buttons (icon + label): Select | Rectangle | Polyline | Branch Point | Crossing Point | Port Point | Pan
 - Zoom: − | 100% | + | Fit to screen
 - Undo | Redo (can be stubbed with toast "not implemented" if hard)
- Canvas area:
 - Large pan/zoom canvas with the P&ID image as background
 - Annotations rendered on top
 - Mouse wheel zoom toward cursor
 - Space + drag OR middle-mouse drag to pan
 - Crosshair showing image coordinates (x, y) in bottom-left of canvas
- Status bar: "N annotations | M selected | Zoom: 85%"

RIGHT PANEL (300px, collapsible) — Properties:
- When nothing selected: show project summary (image name, dimensions, annotation counts by type)
- When annotation selected:
 - MainLabel (dropdown): View, Component, Text
 - SubLabel (dropdown, depends on MainLabel):
   - View: MainView
   - Component: Equipment, Pipe, PipingValve, PipingInstrument, PipingMiscellaneousPart, PipingReducer, BranchSymbol, RouteCrossing, PipingPort, OnOffSheetSymbol, Equipment, ...
   - Text: EquipmentText, PipingValveText, MainViewText, PipingInstrumentText, ...
 - Value (text input) — for Text rows and Pipe polylines (show as read-only comma-separated coords for pipes, editable for Text)
 - SubType (text input, optional)
 - LinkedElement (number input or dropdown of other annotations by row index)
 - Locked (toggle)
 - Geometry readout: MinX, MinY, MaxX, MaxY, CenterX, CenterY, Width, Height (auto-computed, read-only)
 - Delete button (disabled if locked)
 - Duplicate button

## Canvas rendering rules

Use an HTML Canvas or SVG overlay (Konva.js or Fabric.js acceptable) with transform for pan/zoom.

Annotation visual styles (distinct colors):
- View/MainView: dashed blue rectangle, semi-transparent fill
- Component (bbox types): solid green rectangle
- Text: solid orange rectangle + small text label showing Value
- Pipe (polyline): thick red line with circular vertex handles when selected; faint axis-aligned bbox optional
- BranchSymbol: small magenta square (~6px default)
- RouteCrossing: small yellow diamond
- PipingPort: small cyan circle
- Locked annotations: 50% opacity + lock badge, not draggable

Selection: highlighted stroke, resize handles for rectangles, vertex handles for polylines.

## Drawing tools (Manual tab)

SELECT tool:
- Click to select one annotation
- Shift+click to multi-select
- Drag selected bbox to move (unless locked)
- Drag corner handles to resize bbox (unless locked)
- Drag polyline vertex to move bend (unless locked)
- Delete key removes selected (unless locked)

RECTANGLE tool:
- Click-drag to draw axis-aligned box
- On mouse up, create new annotation with current MainLabel/SubLabel from a "New annotation defaults" section in right panel
- Default: Component / Equipment

POLYLINE tool (for Pipe routes):
- Click to place each vertex (bend)
- Double-click or press Enter to finish polyline
- Creates Component / Pipe with geometry type polyline
- Show live preview line while drawing
- Hold Shift to constrain segments to horizontal or vertical (orthogonal snap)

BRANCH POINT tool:
- Single click places small bbox (~6×6 centered on click)
- Creates Component / BranchSymbol

CROSSING POINT tool:
- Single click places small diamond marker
- Creates Component / RouteCrossing
- Prompt user to pick parent Pipe from dropdown in properties (LinkedElement)

PORT POINT tool:
- Single click on canvas
- Creates Component / PipingPort (small circle)

PAN tool:
- Drag to pan canvas (alternative to space+drag)

## CSV import format

Parse UTF-8 CSV with header row:

MainLabel,SubLabel,MinX,MinY,MaxX,MaxY,CenterX,CenterY,Width,Height,Value,LinkedElement,SubType

Import rules:
- Each row becomes one annotation object with a stable internal UUID (generate on import)
- Remember original CSV row line number (1-based, header = line 1) for LinkedElement round-trip
- If SubLabel is "Pipe" and Value contains comma-separated x,y pairs, parse as polyline geometry; bbox is envelope of points
- Otherwise treat as axis-aligned bbox from MinX, MinY, MaxX, MaxY
- If no image loaded yet, still import CSV into state (annotations float until image loaded)

## CSV export format

Export same columns as import. Regenerate:
- CenterX, CenterY, Width, Height from geometry
- LinkedElement as 1-based row number in the exported file (recompute after sorting rows):
 - Row order: View first, then all Components (including Pipe, BranchSymbol, etc.), then all Text rows
 - When exporting, map internal link UUIDs to the target row's 1-based line number
- For Pipe: Value = comma-separated "x,y" pairs along polyline (no spaces)
- Quote Value field if it contains commas (RFC 4180)

Provide "Download CSV" button on Export tab.

## JSON export format

Export full project state:

{
 "version": "1.0",
 "image": { "name": "...", "width": 3144, "height": 2344, "dataUrl": "..." },
 "annotations": [
   {
     "id": "uuid",
     "mainLabel": "Component",
     "subLabel": "Equipment",
     "geometry": { "type": "bbox", "bbox": { "minX", "minY", "maxX", "maxY" } },
     "value": "",
     "subType": "EQT_3",
     "linkedElementId": "uuid-of-target",
     "linkedElementLine": 3,
     "locked": false,
     "source": "manual"
   },
   {
     "id": "uuid",
     "mainLabel": "Component",
     "subLabel": "Pipe",
     "geometry": { "type": "polyline", "points": [[x,y], ...], "bbox": {...} },
     "value": "x1,y1,x2,y2,...",
     "locked": false
   }
 ]
}

Provide "Download JSON" button. Also "Import JSON" to restore full session.

## Export tab UI

- Format checkboxes: CSV (enabled), JSON (enabled), COCO (disabled/grayed "Coming soon"), Pascal-VOC (disabled), TXT (disabled)
- Export scope: All annotations | Selected only | Unlocked only
- Validation panel (client-side checks before export):
 - Warning if no View/MainView
 - Warning if Text row has empty Value
 - Warning if Pipe has fewer than 2 points
 - Warning if LinkedElement points to missing row
- "Download" primary button

## Layer visibility toggles (above canvas or in left sidebar)

Checkboxes to show/hide:
- View
- Components
- Text
- Pipes
- Branch/Crossing/Port markers
- Labels (text values on canvas)
- Link lines (optional: draw thin line from Text to linked Component when both exist)

## Sample data for demo

Include a "Load demo" button that loads a built-in tiny mock project:
- 1 View bbox
- 2 Equipment components
- 2 Text labels linked to equipment
- 1 Pipe polyline with 3 points
- 1 BranchSymbol

## Visual design

- Clean industrial/technical tool aesthetic (dark sidebar #1e1e2e, light canvas area #f5f5f5, accent color #2563eb)
- Use lucide-react or similar icons
- Responsive tooltips on toolbar buttons
- Toast notifications for: image loaded, CSV imported (N rows), export complete, delete blocked (locked)

## Technical constraints

- Single HTML page or Vite React app, runnable with npm run dev
- No backend, no fetch to external APIs
- Image loaded via FileReader as object URL or data URL
- CSV parsed with PapaParse or manual parser
- All annotation CRUD must update React state immediately and re-render canvas
- TypeScript interfaces for Annotation, Project, Geometry types

## Out of scope (do NOT build)

- OCR / route detection model buttons (show disabled "Run OCR" / "Run Route Detection" with tooltip "Requires backend")
- User authentication
- Multi-user collaboration
- COCO / Pascal-VOC / TXT export implementation (UI stubs only)

## Acceptance criteria

1. User can open a P&ID image and see it on a zoomable/pannable canvas
2. User can draw rectangles and polylines and see them immediately
3. User can select, move, resize, edit properties, delete annotations
4. User can lock an annotation and confirm it cannot be moved or deleted
5. User can import a CSV matching the schema above and see all annotations rendered correctly
6. User can export CSV and JSON downloads that reflect current canvas state
7. Re-importing exported JSON restores the session
8. Manual tab is fully usable; other tabs exist but may be placeholders

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/a692fdc7-56a5-4db3-b250-501478d7495d).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
