---
name: onshape-mate-connector-export
description: >-
  Pulls Part Studios from Onshape (glTF download + iface_* mate connector poses) or
  updates sidecars only. Use when the user asks to pull, grab, import, or sync a part
  from Onshape (e.g. "Hipbone Head"), to export glTF, to fetch iface_ mate connectors,
  or to persist mate connector transforms next to a model file.
---

# Onshape: pull part + `iface_*` sidecars

## When this applies

- **Full pull:** User wants a named document/part (e.g. *"pull in Hipbone Head"*, *"grab Loop Head from Onshape"*) → download **glTF** into `src/test-models/`, write **all** `iface_*` mate connectors into `<same basename>.mate-connectors.json`, and merge **`onshape-sources.json`**.
- **Sidecar only:** User already has a model file and wants one or more mate poses (original flow below).

## Conventions (this repo)

| Item | Location / rule |
|------|------------------|
| Downloaded models | `src/test-models/<Document> - <Part Studio>.gltf` (default from script) |
| Sidecar | `<basename>.mate-connectors.json` next to the glTF |
| Routing manifest | Repo root `onshape-sources.json` |
| `iface_*` rule | Part Studio features: `featureType === "mateConnector"` and name matches `/^iface_/i` (see `interfaceFrames.ts` in app) |

---

## Workflow A — Full pull (download + all `iface_*`)

**Preferred automation:** repo script (handles **307 redirect** export chain and binary glTF).

1. **Resolve target**  
   - Document search string from the user (e.g. `Hipbone`, `Loop Head - Copy`).  
   - Optional **Part Studio** disambiguation: substring of tab name (e.g. `Loop Head` when the document has several tabs).  
   - Optional **configuration:** Onshape-encoded query value (see below).

2. **Configuration string**  
   - Call **`getConfiguration`** (Element API) to list `parameterId`s.  
   - Call **`encodeConfigurationMap`** with `{ "parameters": [ { "parameterId", "parameterValue" }, ... ] }` using human values (`930 mm`, `-0.05 rad`, `5`, …).  
   - Use the response’s **encoded payload only** (the substring after `configuration=` in `queryParam`) as `--configuration` — **do not** run `encodeURIComponent` on it again (avoids double-encoding `%`).

3. **Run the pull script** from repo root (requires API keys in the environment):

   ```bash
   export ONSHAPE_ACCESS_KEY="…"
   export ONSHAPE_SECRET_KEY="…"
   npm run onshape:pull -- "Document name" [--studio=PartStudioSubstring] [--configuration=ENCODED_FROM_STEP_2]
   ```

   - If keys are **not** available in the shell, tell the user to add them (Onshape → **My account** → **Developer** → API keys) or run the command locally, then continue with **Workflow B** via MCP only.

4. **Script behavior** (`scripts/onshape-pull-part.mjs`)  
   - `getDocuments` (`filter=0`, `q=…`) → pick best name match.  
   - `getDocumentContents` → choose **Part Studio** (default first, or `--studio`).  
   - **GET** `exportPartStudioGltf` → follow redirects → write `.gltf`.  
   - `getPartStudioFeatures` (same `configuration`) → every **`mateConnector`** with name `/^iface_/i`.  
   - `evalFeatureScript` per connector (lambda in [reference.md](reference.md)); `libraryVersion` from eval or `getConfiguration`.  
   - Write sidecar + merge `onshape-sources.json`.

5. **Dry run** (IDs only):  
   `node scripts/onshape-pull-part.mjs "Name" --dry-run`

6. **Confirm**  
   List paths written, connector keys found, and remind: glTF and sidecar share the same **configuration**.

---

## Workflow B — Sidecar only (existing file)

Use when the user names a **file** + connector(s) or only needs poses without re-export.

1. **Resolve the model path** under `src/test-models/`. Use **full filename** as key in `onshape-sources.json`.

2. Read **`onshape-sources.json`**. If missing, create from [onshape-sources.example.json](../../../onshape-sources.example.json) after the user supplies URL or `did` / `wvm` / `wvmid` / `eid`.

3. **MCP auth** if calls fail.

4. **`getPartStudioFeatures`** with `rollbackBarIndex=-1` and optional `configuration` (encoded string, not double-encoded).

5. For each **`iface_*`** mate connector (or a specific name if the user asked for one): get `featureId`, then **`evalFeatureScript`** as in [reference.md](reference.md).

6. **Merge** into `<basename>.mate-connectors.json` (normalize keys to `iface_…`).

---

## Sidecar schema (minimal)

```json
{
  "sourceFile": "src/test-models/….gltf",
  "document": { "did": "", "wvm": "w", "wvmid": "", "eid": "", "linkDocumentId": "" },
  "queriedAt": "2026-03-30T12:00:00.000Z",
  "mateConnectors": {
    "iface_neck_top": {
      "featureId": "",
      "originMeters": [0, 0, 0],
      "xAxis": [1, 0, 0],
      "yAxis": [0, 1, 0],
      "zAxis": [0, 0, 1],
      "rotationMatrixRowMajor": [1, 0, 0, 0, 1, 0, 0, 0, 1]
    }
  }
}
```

---

## Errors

- **No Part Studio** → List `elements` from contents; user picks tab name.  
- **Export 401/403** → Keys or stack (`cad.onshape.com` vs enterprise host); set `ONSHAPE_API_BASE_URL` if needed.  
- **eval `CANNOT_RESOLVE_ENTITIES`** → Wrong `configuration` encoding or stale `featureId` (re-run features with same config).  
- **No `iface_*` connectors** → Report all mate connector names; user renames in Onshape.

## Do not

- Store API **secrets** in `onshape-sources.json` or commit them.  
- Double-URL-encode the `configuration` query value.

## More detail

- FeatureScript lambda: [reference.md](reference.md)
