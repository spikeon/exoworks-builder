# exoworks-builder — Claude Code

Read-only R3F viewer. Consumes GLBs + optional JSON sidecars. Local only — NOT a git repo, cannot push. See workspace `../CLAUDE.md`.

## Key constraint

**No catalog-specific logic** in this repo. It receives URLs + JSON; callers decide what to show.

## Public API surface (`src/index.ts` only)

```ts
import {
  InterfaceAssemblyView,        // R3F canvas component
  type AssemblyModelInput,      // { url, label?, mateSidecar?, assemblyManifest?, legacyIfaceAssembly? }
  type InterfaceAssemblyViewProps,
  type PartCatalogFile,
  type AssemblyManifest,        // *.assembly-manifest.json shape
  type MateConnectorsSidecar,   // *.mate-connectors.json shape
} from 'exoworks-builder';
```

**Never import** `src/loadTestFolderModels.ts` — dev-only.

## Schema change rule

Sidecar schema change → update **parser here** (`src/`) AND **writer** in `../exoguitar/scripts/onshape-pull-part.mjs` in the same change.

## Dev

```
npm install
npm run dev   # :5173, loads src/test-models/*.glb (gitignored)
```

Drop `.glb` + optional `.assembly-manifest.json` / `.mate-connectors.json` into `src/test-models/`.

## Consumed from exoworks

`exoworks/package.json`: `"exoworks-builder": "file:../exoworks-builder"` + Vite alias. No package build step needed — SPA compiles from source.

## Cross-repo links

- SPA consumer: `../exoworks/AGENTS.md`
- Pull scripts: `../exoguitar/AGENTS.md`
- Workspace: `../CLAUDE.md`
