# Block/32 — decimal spatial planner

A static 3D occupancy planner for GitHub Pages. No backend or build step.

## Using the planner

The room is a fixed 10 × 10 × 10 meter volume. Every view contains 10 × 10 × 10 cells. Cell sizes progress from 1 meter to 10 cm, 1 cm, and 1 mm.

1. Choose or create a named object, then mark it fixed or movable.
2. Place solid cells using one of 32 colors. Erase removes only the active object's occupancy.
3. Choose Select cell, click a cell, and choose Enter cell. Use X/Y/Z coordinates (0–9) to select hidden or empty cells precisely.
4. Build or carve at the finer scale. Use the breadcrumbs to jump to an ancestor or the whole room. Escape exits one level and selects the cell you left.
5. Use the editing layer to place in empty space above the floor.
6. Move a movable object with X/Y/Z buttons. Each move is one cell at the current scale and moves the entire object, even outside the current view. Collisions and room boundaries block moves.
7. Optionally show fixed objects in gray and movable objects in blue, or isolate the active object.

Entering a region does not subdivide or change saved geometry. A solid region remains filled until carved. Parent views show the actual occupied geometry, preserving openings. Views retain fixed outer boundaries.

Dimensions are bounding width, height, and depth, including space between disconnected parts; they are not occupied volume. The origin is one room corner; Y is up.

## Saving

Autosave is local to the current browser and site origin. Export JSON for backups or transfer. Loading validates the entire file before replacement.

The original builder's version-1 browser save remains untouched under its original storage key. This planner uses version 2 and starts a separate room. Version-1 JSON is not imported into the differently sized room. Original app code remains in app.js for reference.

## Storage and rendering

JSON stores disjoint occupied rectangular regions in integer millimeters. Boxes compress uniform space; empty space is implicit. Decimal navigation is independent of object ownership, so objects can cross grid boundaries.

Carving subtracts exact volumes without allocating millions of leaf cubes. Object IDs link all regions that move together. Rendering clips geometry to the current view and uses instanced meshes grouped by color. It does not replace detail with solid bounding boxes or apply distance-based simplification.

Prototype limits: 10-meter room, 1-mm minimum editing cell, 30,000 occupied regions, 1,000 objects, translation only (no rotation), and no undo. Dense scenes may slow down. Browser interaction and performance have not been tested in this environment.

## Run

Serve dist with any static server, for example:

    python3 -m http.server 8000 --directory dist

Open http://localhost:8000. Internet access is needed for the pinned Three.js dependency on jsDelivr.

## GitHub Pages

Push this archive's contents into a GitHub repository on main. In Settings → Pages, choose GitHub Actions. The included workflow publishes dist. Local imports are relative and support repository subpaths.

## Verification

    node test-space.mjs

Checks exact carving volume, millimeter precision, non-mutating views, whole-object translation, collision and boundary rejection, JSON validation and round-trip.

## Repeat and fill

Select a cell, choose the active object, and click Copy cell. Set the Paste destination X, Y and Z (0–9) beside Paste cell here. Y controls height. Each change immediately selects and outlines that cell in yellow and moves the editing plane to its height. Click Paste cell here to apply. You can also select the destination in the viewport; its coordinates appear in these fields. Stay at the copied scale. Paste replaces the active object's contents in the destination, including empty spaces, and preserves colors and exact details. Other objects in the destination block the operation. The clipboard is a snapshot; edits do not change other copies. Pasted regions belong to the active object; use New object first if the copy should move separately. The clipboard lasts until page reload.

Open Rectangular fill, select a starting cell, and enter width (X), height (Y), and depth (Z) in meters, centimeters, or millimeters. A 4 m × 0.03 m × 3 m rectangle makes a floor. The selected cell's lower corner is the origin; fills extend in positive directions across cell boundaries. Select a finer cell for a more precise origin. Other objects and room boundaries block fills. Current color and active object apply. Existing version-2 JSON and autosaves remain compatible.

## Protection, patterns, exports, and views

The editor starts in Select mode and shows the current mode over the viewport. Warn before replacing detailed contents is enabled by default. Place, erase, paste, fill, and pattern operations ask for confirmation before replacing finer active-object geometry inside their target. Simple empty or completely solid cells do not trigger the warning.

Built-in patterns create a floor, ceiling, or wall against any of the six cell faces. Each is one-tenth of the current cell thick: 10 cm in a 1 m cell, 1 cm in a 10 cm cell, or 1 mm in a 1 cm cell. The editor's minimum resolution remains 1 mm. Save selected cell stores a custom pattern for reuse at the same scale; saved patterns keep their colors and are independent copies. They persist in the browser and travel with exported JSON files.

Exported JSON filenames include the local date and time. Front, Back, Left, Right, Top, and Bottom buttons place the camera on the corresponding axis; the home button restores the perspective view.

The palette includes a native custom color picker and an editable six-digit hex value. Rectangular erase shares the fill tool's selected origin, width, height, depth, and units. It subtracts only from the active object and preserves all other objects.
