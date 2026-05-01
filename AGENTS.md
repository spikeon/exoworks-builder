# exoworks-builder – Agent & contributor context

> **For AI agents:** Whenever you change the Onshape pull pipeline, the GLB optimization step, the `assembly-manifest.json` schema, or the viewer's interface-frame logic, **update this file in the same PR** so future agents stay aligned. Cross-link to the platform repos for product/catalog context — don't duplicate it here.

## ExoGuitar Character Creator (added 2026-04-28)

`App.tsx` was upgraded from a simple "show all models" viewer to a **character creator** UI:
- Left sidebar: select from pre-pulled complete guitar configurations (Warlock, Arrow Head, CyberWings v2, Acoustic Core, Neck, ExoBass)
- Right panel: React Three Fiber 3D viewer (`InterfaceAssemblyView`) showing the selected assembly
- Part visibility toggles: per-part-group show/hide driven by `partVisibility` prop

`onshape-sources.json` now contains all ExoGuitar assembly entries (Warlock, Arrow Head, CyberWings v2, Acoustic Core, Neck, Bearing Bridge, Arch Top Bridge). Run `npm run onshape:pull:all` to pull them.

`scripts/onshape-pull-manifest.mjs` was updated to support **assembly entries** (in addition to Part Studio entries). Assembly entries need `did`, `wvmid`, `eid`, and `elementKind: "assembly"` — the script builds a full document URL and passes `--composed` automatically. Part Studio entries (with `documentName` + `partStudioName`) work exactly as before.

**Roadmap for true per-module swapping:** Currently, the character creator shows pre-assembled complete guitar GLBs. To enable true module swapping (pick any wing set + any neck + any bridge), each slot module needs `iface_*` mate connectors added in OnShape, then the mate-connector pull flow can be used. The `InterfaceAssemblyView` already supports this via `legacyIfaceAssembly: true` and `mateSidecar` sidecars.

This is a **standalone Vite + React Three Fiber app** that:

1. Pulls **composed assemblies** and **interface frames** from **Onshape** via REST (`scripts/onshape-pull-part.mjs`, `scripts/onshape-pull-manifest.mjs`).
2. Optimizes the resulting `.glb` for web (`scripts/gltf-web-optimize.mjs` — meshopt compression + texture removal + mesh simplification).
3. Renders the assembly with **R3F** so designers can preview how parts will combine in-place.

It is **not** the same thing as the SPA's part-page model viewer (that one is `online-3d-viewer` inside the **[exoworks](https://github.com/spikeon/exoworks)** repo). This app is a **separate** R3F preview + the source-of-truth for `.glb` artifacts that ship into `src/test-models/` here.

## Repo layout

| Path | Purpose |
|---|---|
| `src/main.tsx`, `src/App.tsx`, `src/index.css` | Vite app entry + root view. |
| `src/InterfaceAssemblyView.tsx` | R3F viewer that aligns multiple GLBs by their `iface_*` mate-connector frames. |
| `src/loadTestFolderModels.ts` | Vite glob-imports `.glb`/`.gltf` + sidecars from `src/test-models/`. |
| `src/interfaceFrames.ts` | Parses `*.mate-connectors.json` (`iface_*` named mate connectors → frames). |
| `src/assemblyPartGroups.ts` | Parses `*.assembly-manifest.json` (composed assembly grouping + flags like `legacyIfaceAssembly`). |
| `src/modelUrl.ts` | URL helpers for served test-model assets. |
| `src/test-models/` | **Output target** for `npm run onshape:pull*`. Holds the `.glb`/`.gltf`, `.mate-connectors.json`, `.assembly-manifest.json` artifacts the viewer loads. Gitignored except `.gitkeep` and committed reference exports. |
| `scripts/onshape-pull-part.mjs` | Pull a **single** Onshape document → glTF + sidecars. CLI entry point: `npm run onshape:pull -- …`. |
| `scripts/onshape-pull-manifest.mjs` | Pull **everything** listed in `onshape-sources.json`. CLI entry point: `npm run onshape:pull:all`. |
| `scripts/gltf-web-optimize.mjs` | Post-process `.glb`: remove textures, simplify mesh, apply `EXT_meshopt_compression`. Run automatically by `onshape-pull-part.mjs`. |
| `onshape-sources.json` | Tracked manifest of Onshape sources (`did`, `wvm`, `wvmid`, `eid`, `elementKind`, `tabName`, `assemblyName`, `documentName`) keyed by output filename. Updated automatically by the pull scripts. |
| `onshape-sources.example.json` | Schema reference (commit-safe template). |
| `index.html`, `vite.config.ts`, `tsconfig.json` | Vite/TS config. |
| `.cursor/skills/onshape-composed-assembly-export/` | Detailed pull-flow runbook (composed assemblies). Read this when wiring up a new Onshape source. |
| `.cursor/skills/onshape-mate-connector-export/` | Pull-flow runbook for **multi-document** mate-connector alignment (`iface_*`). |
| `.env`, `.env.example` | Local secrets — `ONSHAPE_ACCESS_KEY`, `ONSHAPE_SECRET_KEY`, optional `ONSHAPE_API_BASE_URL` (default `https://cad.onshape.com/api/v10`). |

## Two pull flows

There are **two** different ways to pull from Onshape, and they emit different sidecars. Pick based on how the source document is structured.

### 1. Composed assembly export (default for new sources)

- **When**: One Part Studio (or one Assembly tab) where every part is **positioned** in place. Top-level instance/group names form the scene's direct children.
- **What it produces**: `<name>.glb` + `<name>.assembly-manifest.json` (no `iface_*` mate sidecar).
- **Command**:
  ```
  npm run onshape:pull -- "Doc Name" --studio="Tab Name" --composed --file="Output.glb"
  npm run onshape:pull -- "https://cad.onshape.com/documents/DID/w/WID/e/EID" --composed --file="Output.glb"
  ```
- Default export path is **sync GET** (`…/gltf`) — reflects the Part Studio as displayed (visible vs hidden depends on the tab). Use `--composed-async` to allow the async POST `…/export/gltf` (visible-only via `excludeHiddenEntities=true`, returns ZIP that the script merges).
- Read the full runbook in `.cursor/skills/onshape-composed-assembly-export/SKILL.md` before adding a new composed source.

### 2. Mate-connector interface export (multi-document alignment)

- **When**: Multiple Onshape documents that need to **snap together** at runtime via named mate connectors (`iface_*`).
- **What it produces**: `<name>.glb` + `<name>.mate-connectors.json` (one entry per `iface_*` mate connector, with frame transforms).
- **Default export path** is async POST `…/export/gltf` with `excludeHiddenEntities=true`. Falls back to sync GET if the async path fails for that document. Force sync GET only with `--sync`.
- glTF tessellation (async only): `--gltf-quality=coarse` (default; smallest files, COARSE + relaxed tolerances), `medium`, or `fine`.
- Read the full runbook in `.cursor/skills/onshape-mate-connector-export/SKILL.md`.

### Output post-processing (always)

`.glb` outputs from either flow are post-processed by `scripts/gltf-web-optimize.mjs`:
- Textures removed.
- Mesh simplified (meshoptimizer).
- `EXT_meshopt_compression` applied.

This keeps file sizes small for the viewer load and makes the artifacts safe to commit when the user wants a baseline reference export.

## Viewer behavior

- `App.tsx` glob-loads everything under `src/test-models/` via `loadTestFolderModels()` and renders them through `InterfaceAssemblyView`.
- For each model entry, the viewer combines (in priority order):
  - `assemblyManifest` (`*.assembly-manifest.json`) — composed-assembly grouping; flag `legacyIfaceAssembly: true` opts that file into the legacy iface frame alignment behavior.
  - `mateSidecar` (`*.mate-connectors.json`) — `iface_*` mate frames.
  - The `.glb` / `.gltf` itself.
- Empty state when `src/test-models/` has no `.glb` / `.gltf` artifacts: shows a hint to add files there.
- This is a **dev-only preview app** — `Dockerfile` exists but production hosting is out of scope here; see the SPA repo for the user-facing model viewer.

## Local dev

```
npm install
cp .env.example .env   # add ONSHAPE_ACCESS_KEY + ONSHAPE_SECRET_KEY
npm run onshape:pull -- "Doc Name" --composed --file="Doc Name.glb"
npm run dev
```

`npm run dev` starts Vite (default port). `npm run build` / `npm run preview` for production bundle.

## Editing rules of thumb

- **Don't** edit files under `src/test-models/` by hand — they are pull-script outputs. Re-run the pull script and let it overwrite + update `onshape-sources.json`.
- **Do** commit the updated `onshape-sources.json` so other contributors can re-pull the same artifacts.
- **Don't** commit `.env` (gitignored). Use `.env.example` for new variables.
- When changing `assembly-manifest.json` or `mate-connectors.json` schema, update **both** the parser (`src/assemblyPartGroups.ts` / `src/interfaceFrames.ts`) **and** the writer in the relevant `scripts/onshape-pull-*.mjs` in the same change.
- Pull scripts are Node ESM (`.mjs`); they use Onshape REST v10 with Basic auth. Stay on the `v10` API base unless a new endpoint requires bumping (and update both the script default and any `.env.example` notes).

## What this repo is **not**

- Not the SPA's part-page 3D viewer (that's `frontend/src/components/ModelViewer.tsx` in **[exoworks](https://github.com/spikeon/exoworks)**, using `online-3d-viewer`).
- Not a catalog (no `models/`, no `BOM.txt`, no `meta.json` schema, no `partUid`).
- Not part of the API or DB. Nothing here writes to `parts`, `materials`, etc.
- Not deployed to App Platform. (No coordination with `start-api.js` post-deploy pipeline.)

## Cross-repo links

- SPA + scripts (the user-facing app this previews against): **`../exoworks/AGENTS.md`**.
- API + DB + post-deploy: **`../exoworks-api/AGENTS.md`**.
- Catalogs (where the printable part files live): **`../exoguitar/AGENTS.md`**, **`../exobass/AGENTS.md`**, **`../shared/AGENTS.md`**.
- Multi-repo orientation: **`../AGENTS.md`** (workspace root).

---

*Update this file in the same PR as any change to the Onshape pull pipeline, GLB optimization step, sidecar schemas, or the R3F viewer's alignment logic.*
