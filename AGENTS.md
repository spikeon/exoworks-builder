# exoworks-builder – Agent & contributor context

> **For AI agents:** Public API, `assembly-manifest.json` schema, interface-frame logic → update **this** `AGENTS.md` same PR. Onshape pull lives in catalog repos.

## What this repo is

**Read-only R3F viewer.** No catalogs / Onshape / sourcing — you pass GLB URLs + optional JSON; it draws.

- Onshape pulls: `../exoguitar/scripts/onshape-pull-*.mjs` (etc.).
- `onshapeSource` in part `meta.json`.
- SPA: `exoworks/package.json` `"file:../exoworks-builder"` + Vite alias → `src/index.ts`.

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
| `InterfaceAssemblyView` | R3F canvas: `models`, optional `partVisibility`, `onPartCatalogChange`, `className`, `style`. |
| `AssemblyModelInput` | `{ url, label?, mateSidecar?, assemblyManifest?, legacyIfaceAssembly? }` |
| `InterfaceAssemblyViewProps` | Props for above. |
| `PartCatalogFile` | Per-file catalog summary from `onPartCatalogChange`. |
| `AssemblyManifest` | `*.assembly-manifest.json` shape. |
| `MateConnectorsSidecar` | `*.mate-connectors.json` shape. |
| Helpers | `collectPartGroupsForSceneRoot`, `PART_GROUP_NAME_SEPARATOR`, `groupNameFromPartNodeName`, … |

**Don’t import** `src/loadTestFolderModels.ts` — dev-only.

## Repo layout

| Path | Purpose |
|---|---|
| `src/index.ts` | **Public surface** |
| `src/InterfaceAssemblyView.tsx` | Viewer |
| `src/interfaceFrames.ts` | `iface_*` frames |
| `src/assemblyPartGroups.ts` | Composed grouping + manifest parse |
| `src/modelUrl.ts` | GLB URL helpers |
| `src/App.tsx`, `src/main.tsx` | Dev shell |
| `src/loadTestFolderModels.ts`, `src/test-models/` | Dev-only (test-models gitignored) |
| `vite.config.ts` | Dev Vite |
| `.cursor/skills/` | Onshape runbooks (point to catalogs) |

## Consuming from `../exoworks/`

`"exoworks-builder": "file:../exoworks-builder"` + `resolve.alias` → compile TS from source; **no** package build step for SPA.

## Dev app

```
npm install
npm run dev   # :5173, loads src/test-models/*.glb
```

Drop `.glb` + optional `.assembly-manifest.json` / `.mate-connectors.json`. Generate GLBs via catalog `npm run onshape:pull:all`.

## Sidecars

- **`*.assembly-manifest.json`**: `onshape-pull-part.mjs --composed` → `composedDocument: true`, `legacyIfaceAssembly: false` default; optional `partVisibilityBuckets`.
- **`*.mate-connectors.json`**: non-composed multi-doc `iface_*`; `legacyIfaceAssembly: true`. Prefer composed flow.

## Editing rules

- **No** catalog-specific logic.
- Schema changes → update **parser here** + **writer** in `../exoguitar/scripts/onshape-pull-part.mjs` same change.
- **Don’t** re-home `onshape-pull-*` / `gltf-web-optimize` into this repo.
- Stable import surface = **`src/index.ts`** only.

## Cross-repo links

- SPA consumer: **`../exoworks/AGENTS.md`** (`exoworks-dep` alias)
- Pull scripts: **`../exoguitar/AGENTS.md`**, **`../exobass/AGENTS.md`**
- Workspace: **`../AGENTS.md`**

---

*Update same PR as public API / sidecar schema / R3F alignment changes.*
