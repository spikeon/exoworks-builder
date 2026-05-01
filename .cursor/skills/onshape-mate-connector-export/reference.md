# Reference: FeatureScript and API details

## World transform from one mate connector

Replace `FEATURE_ID` with the string id from the Part Studio feature list (the id used with `makeId("...")` in FeatureScript).

```javascript
function(context is Context, queries) {
    const mc = qBodyType(qCreatedBy(makeId("FEATURE_ID")), BodyType.MATE_CONNECTOR);
    const csys = evMateConnector(context, { "mateConnector": mc });
    const w = toWorld(csys);
    const L = w.linear;
    const t = w.translation;
    const m = 1 * meter;
    return {
        "rotationMatrixRowMajor": [
            L[0][0], L[0][1], L[0][2],
            L[1][0], L[1][1], L[1][2],
            L[2][0], L[2][1], L[2][2]
        ],
        "originMeters": [t[0] / m, t[1] / m, t[2] / m],
        "xAxis": [L[0][0], L[1][0], L[2][0]],
        "yAxis": [L[0][1], L[1][1], L[2][1]],
        "zAxis": [L[0][2], L[1][2], L[2][2]]
    };
}
```

Axes above are the **columns** of the rotation matrix (right-handed orthonormal basis in world).

## `libraryVersion` for `evalFeatureScript`

If POST returns an error about library / microversion:

1. Call **`getFeatureScriptRepresentation`** for the same `did`, `wvm`, `wvmid`, `eid`.
2. Inspect the JSON root and common locations for an integer `libraryVersion` / `featureScriptLibraryVersion` (exact field name varies by API version)—use that value in the eval body.
3. Retry with body shape:

```json
{
  "libraryVersion": 1234,
  "script": "function(context is Context, queries) { ... }"
}
```

Optional fields per OpenAPI: `serializationVersion`, `sourceMicroversion`, `rejectMicroversionSkew`—add only if the explorer or error message requires them.

## Parsing eval output

Responses are often wrapped as `result.message.value` with nested `{ "message": { "key": ..., "value": ... } }` trees. Recursively collect primitives or map keys `rotationMatrixRowMajor`, `originMeters`, etc., when present at any depth.

## `onshape-sources.json` entry shape

```json
{
  "sources": {
    "MyPart.glb": {
      "did": "…",
      "wvm": "w",
      "wvmid": "…",
      "eid": "…",
      "linkDocumentId": ""
    }
  }
}
```

Use the same string the user uses for “file name” (including extension) as the key, or normalize once and document in the sidecar `sourceFile`.

## Repo script: full pull

- **Path:** `scripts/onshape-pull-part.mjs`  
- **npm:** `npm run onshape:pull -- "<document search>" [--studio=TabSubstring] [--configuration=ENCODED]`  
- **Env:** `ONSHAPE_ACCESS_KEY`, `ONSHAPE_SECRET_KEY` (Basic auth). Optional `ONSHAPE_API_BASE_URL` (default `https://cad.onshape.com/api/v10`).

Synchronous **GET** `exportPartStudioGltf` returns **307**; the client must follow `Location` and send the same `Authorization` header on each hop until the glTF bytes arrive.

The `--configuration` value is the **Onshape-encoded** string (from `encodeConfigurationMap.queryParam` after stripping the leading `configuration=`), e.g. `length%3D930+mm` or `HeadAngle%3D-0.05+rad%3B…` — append it raw to the URL as `&configuration=…`, do not `encodeURIComponent` the whole token again.
