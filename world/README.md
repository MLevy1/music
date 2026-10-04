# BLOCK/64 · Sparse Studio

A static, mobile-friendly 3D sparse modeling experiment derived from BLOCK/32. It is designed for character-scale modeling, building exteriors, vegetation, terrain studies, and other scenes where the visible geometry matters more than filled internal volume.

## Core design

- **Sparse storage:** world size does not allocate a grid. Only geometry you create is saved.
- **Power-of-two world roots:** 1 m through 16.384 km.
- **Practical editing snaps:** 1 mm through 1.024 km; small scales use convenient metric increments and scales at/above 1 m favor powers of two.
- **Integer millimeter coordinates:** saved geometry uses integer mm values.
- **Floating render origin:** Focus can recenter rendering near a selected primitive to preserve millimeter precision far from world origin.
- **64-color indexed palette.**
- **Cheap fills:** a giant facade or solid region is stored as one box primitive instead of millions of voxels.
- **Sparse octree:** built in memory for context queries; it is not serialized into project files.
- **Context modes:** show the whole scene or only geometry near the selected primitive.
- **Mobile gestures:** browser page zoom is not disabled globally; touch handling is confined to the 3D viewport.
- **Local-first:** IndexedDB autosave + portable JSON. No backend, database, account, or paid hosting required.

## Tools

- **Select** geometry and inspect exact coordinates.
- **Block** adds one sparse cubic cell at the active editing snap. Tapping existing geometry places adjacent to the hit face; tapping empty space uses the working plane.
- **Surface** adds one square surface patch using the current snap and surface thickness.
- **Fill** is a two-tap region operation. It can create a thin surface patch or a solid region. Either way, the result is a single saved primitive.
- **Paint** changes a primitive's palette index.
- **Erase** removes a primitive.

## GitHub Pages

Upload the contents of this folder to a GitHub Pages directory. `index.html` uses relative local paths, so it works from a repository subfolder such as `/music/block64/`.

Three.js is loaded at runtime from jsDelivr; internet access is required to start the 3D viewport. Everything else is static.

## Mobile storage target

The UI reports approximate uncompressed JSON size. The intended project bands are:

- Typical: 1–20 MB
- Large but reasonable: 20–100 MB
- Warning zone: 100–250 MB
- Avoid on mobile: above 250 MB

Large world dimensions by themselves do **not** increase file size.

## Development checks

```bash
node tests/model.test.mjs
node --check app.js
node --check model.mjs
node --check store.mjs
```

## v0.2 interaction changes

- **World boundary:** the full root cube is shown as a stronger world cage, with center axes. The HUD always shows the negative and positive world limits.
- **Deterministic edit grid:** the working grid is a cursor-centered window of at most 16 × 16 current-snap cells. The HUD states the cell size and total physical span, so changing scale is explicit rather than visually ambiguous.
- **Persistent cursor:** navigate to exact X/Y/Z coordinates using mm, cm, m, or km. `Go + focus` recenters the local edit view. `Plane to cursor` moves the current XY/XZ/YZ plane through that point.
- **Coordinate rectangles:** set a rectangle start at the cursor, move the cursor to the opposite point, then create. This uses the current plane, fill type, thickness, snap, and color and remains one sparse primitive.
- **Local erase:** Erase now subtracts one cell at the current edit scale from existing geometry. A 1 cm erase on a 2 m block removes only that 1 cm region. Subtraction uses sparse rectangular pieces rather than exploding the entire block into tiny cells.
- **Selection scale:** the viewport HUD shows the exact dimensions of the selected primitive.

Older v0.1 JSON projects load automatically; their edit cursor starts at the world origin.
