# Reference: composed assembly export

## URL pattern

Regex used by the pull script:

```
documents/<did>/w/<wid>(/e/<eid>)?
```

- **`/e/<eid>`** must point to a **Part Studio** element. If omitted, use `--studio=TabNameSubstring` to pick the tab.

## API paths (v10)

- Document: `GET /documents/d/{did}`
- Contents: `GET /documents/d/{did}/w/{wid}/contents`
- Sync glTF: `GET /partstudios/d/{did}/w/{wid}/e/{eid}/gltf?rollbackBarIndex=-1` (+ optional `&configuration=…`)

## Viewer contract

- **Part toggles** = **direct children** of the glTF `scene` root (`listPartGroupObjects` in `assemblyPartGroups.ts`).
- If the exporter wraps everything in one extra node, toggles may show a single group—fix grouping in Onshape so named parts are immediate children of the export root, or adjust export settings.

## Troubleshooting

| Issue | Check |
|-------|--------|
| Empty part list | Scene root has no direct mesh/object children; flatten hierarchy in Onshape. |
| Still see hidden bodies | Re-export with `--composed` (sync). Confirm bodies are hidden/suppressed in the Part Studio before pull. |
| Need iface snap again | Use mate-connector skill pull **without** `--composed`, or set `legacyIfaceAssembly: true`. |
