---
name: onshape-composed-assembly-export
description: >-
  Download a single Onshape Part Studio where all parts are composed in one tab (imported
  instances, grouped by part name). Writes glTF/GLB plus .assembly-manifest.json for the
  exoworks-builder viewer. Use when the user gives an Onshape document link or name and wants
  composed-assembly export (not iface_* multi-document mate alignment).
---

# Onshape: composed assembly export

## When this applies

- User maintains **one Part Studio** *or* an **Assembly tab** (`ASSEMBLY` element) where every part is **positioned** in the right place.
- Parts are grouped by **name** (top-level groups / instances under the Part Studio so the glTF scene has **direct children** named per part).
- User pastes an **Onshape URL** (`…/documents/DID/w/WID/…`) or a **document search string** and wants glTF into `src/test-models/` **without** `iface_*` mate sidecars.

## Onshape modeling rules (match the app)

1. Each logical part should appear as a **direct child** of the exported scene root (named in the Feature list / instance name).
2. **Hide or delete** anything that must not ship; export uses **sync GET** by default (`--composed`), so the file reflects what the Part Studio shows.
3. Avoid Part Studio **configurations** for final layout when possible—bake the layout in this tab.

## Pull command (repo: exoworks-builder)

From repo root, with API keys in the environment:

```bash
export ONSHAPE_ACCESS_KEY="…"
export ONSHAPE_SECRET_KEY="…"

# By document name + Part Studio tab substring:
npm run onshape:pull -- "My Assembly Doc" --studio="Main" --composed --file="My Assembly Doc - Main.glb"

# Or paste the browser URL (Part Studio tab open — URL may include /e/EID):
npm run onshape:pull -- "https://cad.onshape.com/documents/DID/w/WID/e/EID" --composed --file="My Assembly Doc - Main.glb"
```

### Flags

| Flag | Meaning |
|------|---------|
| `--composed` | Skip mate connector eval; write `<same stem>.assembly-manifest.json`. **Part Studio:** default sync `GET …/gltf`. **Assembly tab:** always async `POST …/assemblies/…/export/gltf`. |
| `--composed-async` | With `--composed`, use async Part Studio export (visible-only + ZIP merge). Ignored for Assembly tabs (already async). |
| `--studio=…` | Disambiguate tab name when the URL omits `/e/EID` or multiple Part Studios / Assemblies exist. |
| `--configuration=…` | Only if this tab still uses encoded configuration (same rules as mate-export skill—no double-encoding). |

**Assembly tabs:** the script picks an **Assembly** if there is no Part Studio match. **Assembly export requires `--composed`** (mate `iface_*` pull is Part Studio only). Large assemblies can take **several minutes** (translation polling up to ~10 minutes in `onshape-pull-part.mjs`).

## Outputs

| File | Role |
|------|------|
| `src/test-models/<name>.glb` or `.gltf` | Mesh |
| `src/test-models/<name>.assembly-manifest.json` | Marks `composedDocument`; viewer uses **part-group toggles**, not `iface_*` snapping. |
| `onshape-sources.json` | Merged source entry (same as other pulls). |

**No** `.mate-connectors.json` for that basename after a `--composed` pull (previous mate sidecar is removed).

## Legacy multi-file `iface_*` mode

If the user still needs multi-file mate alignment, use **`onshape-mate-connector-export`** and/or set `"legacyIfaceAssembly": true` in `.assembly-manifest.json` or `.mate-connectors.json` (see `InterfaceAssemblyView` / `loadTestFolderModels.ts`).

## Reference

- [reference.md](reference.md) — URL shape, troubleshooting.
- Script: `scripts/onshape-pull-part.mjs` (`--composed` branch).
