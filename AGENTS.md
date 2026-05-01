# exoworks-builder – Agent & contributor context

> **For AI agents:** Whenever you change the viewer component's public API, the `assembly-manifest.json` schema, or the viewer's interface-frame logic, **update this file in the same PR** so future agents stay aligned. The Onshape pull pipeline has moved to each catalog repo — cross-link there.

## What this repo is now

**`exoworks-builder` is a read-only R3F viewer library.** It knows nothing about catalogs, Onshape, or how models are sourced. You pass it GLB URLs and optional sidecar JSON — it renders.

- **Onshape pull scripts** have been moved to each catalog repo (e.g. `../exoguitar/scripts/onshape-pull-*.mjs`).
- **Catalog → Onshape correlation** is stored in each part's `meta.json` `onshapeSource` field.
- The SPA (`../exoworks/`) consumes this package via `file:../exoworks-builder` and a Vite alias pointing at `src/index.ts`.

## Public API (`src/index.ts`)

```ts
import {
  InterfaceAssemblyView,
  type AssemblyModelInput,
  type InterfaceAssemblyViewProps,
  type PartCatalogFile,
  type AssemblyManifest,
  type MateConnectorsSidecar,
  // … assembly grouping helpers
} from 'exoworks-builder';
```

| Export | Description |
|---|---|
| `InterfaceAssemblyView` | R3F canvas component. Accepts `models: AssemblyModelInput[]`, optional `partVisibility`, `onPartCatalogChange`, `className`, `style`. |
| `AssemblyModelInput` | `{ url, label?, mateSidecar?, assemblyManifest?, legacyIfaceAssembly? }` |
| `InterfaceAssemblyViewProps` | Props for `InterfaceAssemblyView`. |
| `PartCatalogFile` | Per-file part catalog summary emitted by `onPartCatalogChange`. |
| `AssemblyManifest` | Shape of `*.assembly-manifest.json` sidecar. |
| `MateConnectorsSidecar` | Shape of `*.mate-connectors.json` sidecar. |
| Assembly grouping helpers | `collectPartGroupsForSceneRoot`, `PART_GROUP_NAME_SEPARATOR`, `groupNameFromPartNodeName`, etc. |

**Do not import from `src/loadTestFolderModels.ts`** — that is internal to the dev app.

## Repo layout

| Path | Purpose |
|---|---|
| `src/index.ts` | **Public API** — the only stable import surface. |
| `src/InterfaceAssemblyView.tsx` | R3F viewer component. |
| `src/interfaceFrames.ts` | `iface_*` mate-connector frame parsing + alignment. |
| `src/assemblyPartGroups.ts` | Composed-assembly part grouping + manifest parsing. |
| `src/modelUrl.ts` | URL helpers for GLB asset fetches. |
| `src/App.tsx`, `src/main.tsx` | Dev app only — not part of the public API. |
| `src/loadTestFolderModels.ts` | Dev app only — Vite glob-imports from `src/test-models/`. |
| `src/test-models/` | Dev app demo data (`.glb` + sidecars). Gitignored. |
| `vite.config.ts` | Plain Vite + React dev-app config. No catalog-scanning code. |
| `.cursor/skills/` | Onshape pull-flow runbooks (still useful reference for the catalog scripts). |

## Consuming as a package (from `../exoworks/`)

`exoworks/package.json` lists `"exoworks-builder": "file:../exoworks-builder"`.
`exoworks/frontend/vite.config.ts` maps the package name to `src/index.ts` via a `resolve.alias`
so Vite compiles the TypeScript source directly — no separate `npm run build` step needed.

## Dev app (internal only)

```
npm install
npm run dev   # Vite dev server on :5173; loads GLBs from src/test-models/
```

Place `.glb` + optional `.assembly-manifest.json` / `.mate-connectors.json` sidecars in `src/test-models/` to preview them. See the catalog repos' `npm run onshape:pull:all` for how to generate those files from Onshape.

## Sidecar schemas

### `*.assembly-manifest.json`

Written by `onshape-pull-part.mjs --composed` in each catalog's `scripts/`. `composedDocument: true`, `legacyIfaceAssembly: false` (default new-style). Optional `partVisibilityBuckets` preserved across re-exports.

### `*.mate-connectors.json`

Written by `onshape-pull-part.mjs` (no `--composed`) for multi-document `iface_*` connector alignment. `legacyIfaceAssembly: true` inside. Generally deprecated in favor of single composed assembly exports.

## Editing rules of thumb

- **Never add catalog-specific logic** to this repo. It must remain a dumb viewer that accepts data and displays it.
- When changing `assembly-manifest.json` or `mate-connectors.json` **schema**, update the **parser** (`src/assemblyPartGroups.ts` / `src/interfaceFrames.ts`) **and** the **writer** in the catalog script (`../exoguitar/scripts/onshape-pull-part.mjs`) in the same change.
- **Do not re-add** `onshape-pull-*.mjs` or `gltf-web-optimize.mjs` here — those now live in each catalog repo.
- The **public API surface** is `src/index.ts` only. Internal modules (`loadTestFolderModels.ts`, `App.tsx`) must not be imported by downstream consumers.

## Cross-repo links

- SPA that consumes this library: **`../exoworks/AGENTS.md`** (see `exoworks-dep` alias).
- Catalog repos that hold Onshape pull scripts: **`../exoguitar/AGENTS.md`**, **`../exobass/AGENTS.md`**.
- Multi-repo orientation: **`../AGENTS.md`** (workspace root).

---

*Update this file in the same PR as any change to the public API surface, sidecar schemas, or the R3F viewer's alignment logic.*
