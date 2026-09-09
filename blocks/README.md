# Block/32

A deliberately small 3D cube-building app. It runs entirely in the browser and needs no backend.

## What it does

- Places cubes on the ground or on any exposed cube face
- Removes cubes
- Offers 32 solid colors
- Autosaves the current world in browser storage
- Exports and imports portable JSON world files
- Supports mouse, touch, orbit, and zoom controls

## Run locally

Serve the `dist` directory with any static file server. Opening `index.html` directly may not work because the app uses JavaScript modules.

For example:

```bash
python3 -m http.server 8000 --directory dist
```

Then open `http://localhost:8000`.

## Publish on GitHub Pages

Push this repository to GitHub, then open **Settings → Pages** and set the source to **GitHub Actions**. The included workflow publishes the contents of `dist` whenever `main` changes.

The app uses Three.js from jsDelivr. Everything else is contained in `dist`.

## JSON format

```json
{
  "version": 1,
  "size": 20,
  "cubes": [
    { "x": 0, "y": 0, "z": 0, "color": "#ff5349" }
  ]
}
```

Coordinates and colors are validated during import. The current world supports a 20 × 20 base, 20 layers, and up to 5,000 cubes.
