#!/usr/bin/env node
/**
 * Find a document by name, export a Part Studio to glTF (sync + redirect),
 * evaluate all iface_* mate connectors, write <name>.mate-connectors.json,
 * and merge onshape-sources.json.
 *
 * Env (Basic auth — same as Onshape API quickstart):
 *   ONSHAPE_ACCESS_KEY, ONSHAPE_SECRET_KEY
 * Optional:
 *   ONSHAPE_API_BASE_URL (default https://cad.onshape.com/api/v10)
 *
 * Usage:
 *   node scripts/onshape-pull-part.mjs "Hipbone Head"
 *   node scripts/onshape-pull-part.mjs "Loop Head - Copy" --studio "Loop Head"
 *   node scripts/onshape-pull-part.mjs "2020 Extrusion" --studio "Configurable" --configuration "length%3D930+mm"
 *
 * Default: POST …/export/gltf async with excludeHiddenEntities=true (visible bodies only).
 * If that fails for a document, falls back to sync GET …/gltf (may include hidden).
 * Use --sync to force the sync GET path only.
 *
 * Composed assembly (single doc, parts grouped in Onshape):
 *   --composed          Skip iface mate sidecars; write .assembly-manifest.json; default sync export.
 *   --composed-async    Same as --composed but allow async visible-only export (ZIP merge).
 *
 * glTF tessellation (async POST …/export/gltf only; sync GET …/gltf ignores this):
 *   --gltf-quality=coarse   Default. Smallest files (COARSE + relaxed tolerances).
 *   --gltf-quality=medium   Previous script default.
 *   --gltf-quality=fine     Heavier mesh (FINE).
 *
 * Document URL as query (optional): paste cad.onshape.com/documents/DID/w/WID/... to skip name search.
 *
 * Binary `.glb` outputs are post-processed for the web viewer: textures removed, mesh simplified,
 * `EXT_meshopt_compression` applied (see scripts/gltf-web-optimize.mjs).
 */

import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isBinaryGlbBuffer,
  optimizeGlbForWeb,
  WEB_OPTIMIZE_PRESET,
} from './gltf-web-optimize.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const BASE = process.env.ONSHAPE_API_BASE_URL || 'https://cad.onshape.com/api/v10';
const ACCESS = process.env.ONSHAPE_ACCESS_KEY;
const SECRET = process.env.ONSHAPE_SECRET_KEY;

function basicAuthHeader() {
  if (!ACCESS || !SECRET) {
    console.error(
      'Missing ONSHAPE_ACCESS_KEY or ONSHAPE_SECRET_KEY (Basic auth for cad.onshape.com).'
    );
    process.exit(1);
  }
  return `Basic ${Buffer.from(`${ACCESS}:${SECRET}`, 'utf8').toString('base64')}`;
}

function parseArgs(argv) {
  const out = {
    query: '',
    studioSub: '',
    configuration: '',
    outDir: join(REPO_ROOT, 'src', 'test-models'),
    fileName: '',
    dryRun: false,
    syncGltf: false,
    composed: false,
    composedAsync: false,
    /** @type {'coarse' | 'medium' | 'fine'} */
    gltfQuality: 'coarse',
  };
  const rest = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--sync') out.syncGltf = true;
    else if (a === '--composed') out.composed = true;
    else if (a === '--composed-async') {
      out.composed = true;
      out.composedAsync = true;
    } else if (a.startsWith('--studio=')) out.studioSub = a.slice('--studio='.length);
    else if (a.startsWith('--configuration='))
      out.configuration = a.slice('--configuration='.length);
    else if (a.startsWith('--out=')) out.outDir = a.slice('--out='.length);
    else if (a.startsWith('--file=')) out.fileName = a.slice('--file='.length);
    else if (a.startsWith('--gltf-quality=')) {
      const v = a.slice('--gltf-quality='.length).toLowerCase();
      if (v === 'coarse' || v === 'medium' || v === 'fine') {
        out.gltfQuality = v;
      } else {
        console.error('Invalid --gltf-quality (use coarse, medium, fine):', v);
        process.exit(1);
      }
    } else if (!a.startsWith('-')) rest.push(a);
    else {
      console.error('Unknown option:', a);
      process.exit(1);
    }
  }
  out.query = rest.join(' ').trim();
  if (!out.query) {
    console.error(
      'Usage: node scripts/onshape-pull-part.mjs "<document search or Onshape URL>" [--studio=Substring] [--configuration=ENCODED] [--out=dir] [--file=Name.gltf] [--gltf-quality=coarse|medium|fine] [--composed] [--composed-async] [--sync]'
    );
    process.exit(1);
  }
  return out;
}

async function fetchJson(pathAndQuery, init = {}) {
  const method = init.method || 'GET';
  const url = pathAndQuery.startsWith('http') ? pathAndQuery : `${BASE}${pathAndQuery}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: basicAuthHeader(),
      Accept: 'application/json;charset=UTF-8; qs=0.09',
      'Content-Type': 'application/json;charset=UTF-8; qs=0.09',
      ...init.headers,
    },
    redirect: 'manual',
  });
  if (
    method === 'GET' &&
    (res.status === 307 || res.status === 302 || res.status === 301)
  ) {
    const loc = res.headers.get('location');
    if (!loc) throw new Error(`${res.status} without Location`);
    const next = new URL(loc, url).href;
    return fetchJson(next, { ...init, method: 'GET', body: undefined });
  }
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`HTTP ${res.status} ${url}\n${t.slice(0, 2000)}`);
  }
  return res.json();
}

async function postJson(pathAndQuery, jsonBody) {
  const url = pathAndQuery.startsWith('http') ? pathAndQuery : `${BASE}${pathAndQuery}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      Accept: 'application/json;charset=UTF-8; qs=0.09',
      'Content-Type': 'application/json;charset=UTF-8; qs=0.09',
    },
    body: JSON.stringify(jsonBody),
    redirect: 'manual',
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`POST ${res.status} ${url}\n${t.slice(0, 2000)}`);
  }
  return res.json();
}

async function waitForTranslationDone(tid) {
  const maxAttempts = 600;
  for (let i = 0; i < maxAttempts; i++) {
    const t = await fetchJson(`/translations/${tid}`);
    const state = t.requestState;
    if (state === 'DONE') return t;
    if (state === 'FAILED') {
      throw new Error(
        `Translation failed: ${t.failureReason || JSON.stringify(t).slice(0, 500)}`
      );
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Translation ${tid} timed out after ${maxAttempts}s`);
}

async function fetchBinaryFollow(url) {
  const headers = { Authorization: basicAuthHeader(), Accept: '*/*' };
  let current = url;
  for (let hop = 0; hop < 25; hop++) {
    const res = await fetch(current, { method: 'GET', headers, redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error('Redirect without Location');
      current = new URL(loc, current).href;
      continue;
    }
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Binary GET failed HTTP ${res.status}\n${t.slice(0, 2000)}`);
    }
    const ct = res.headers.get('content-type') || '';
    const buf = Buffer.from(await res.arrayBuffer());
    return { buffer: buf, contentType: ct };
  }
  throw new Error('Too many redirects (binary)');
}

/**
 * Presets for POST …/export/gltf `meshParams` (see OpenAPI `BTBExportMeshParams` / `GBTExportResolution`).
 * Default is **coarse** to keep web assets small; use `--gltf-quality=medium` for the old behavior.
 */
const GLTF_MESH_PRESETS = {
  coarse: {
    angularTolerance: 0.06,
    distanceTolerance: 0.04,
    maximumChordLength: 0.2,
    resolution: 'COARSE',
    unit: 'METER',
  },
  medium: {
    angularTolerance: 0.01,
    distanceTolerance: 0.01,
    maximumChordLength: 0.05,
    resolution: 'MEDIUM',
    unit: 'METER',
  },
  fine: {
    angularTolerance: 0.005,
    distanceTolerance: 0.003,
    maximumChordLength: 0.025,
    resolution: 'FINE',
    unit: 'METER',
  },
};

/** @param {'coarse' | 'medium' | 'fine'} q */
function meshParamsForQuality(q) {
  const p = GLTF_MESH_PRESETS[q];
  if (!p) throw new Error(`Invalid gltf quality: ${q}`);
  return { ...p };
}

/**
 * Async Part Studio glTF export with hidden / non-shown bodies omitted.
 * Uses POST …/export/gltf (not generic translations — that rejects GLTF without meshParams).
 */
async function fetchExportGltfTranslationVisibleOnly(did, wid, eid, cfg, meshParams) {
  const path = withConfigurationQuery(
    `/partstudios/d/${did}/w/${wid}/e/${eid}/export/gltf`,
    cfg
  );
  const started = await postJson(path, {
    meshParams,
    excludeHiddenEntities: true,
    storeInDocument: false,
    /** `true` (API default) wraps the export in a ZIP — GLTFLoader expects raw JSON/binary. */
    grouping: false,
  });
  const tid = started.id;
  if (!tid) {
    throw new Error(`No translation id: ${JSON.stringify(started).slice(0, 400)}`);
  }
  const done = await waitForTranslationDone(tid);

  const extIds = done.resultExternalDataIds;
  if (Array.isArray(extIds) && extIds.length > 0) {
    if (extIds.length > 1) {
      console.warn(
        `Note: ${extIds.length} external data blobs; using the first.`
      );
    }
    return fetchBinaryFollow(`${BASE}/documents/d/${did}/externaldata/${extIds[0]}`);
  }

  const blobEids = done.resultElementIds;
  if (Array.isArray(blobEids) && blobEids.length > 0) {
    if (blobEids.length > 1) {
      console.warn(`Note: ${blobEids.length} blob elements; downloading the first.`);
    }
    return fetchBinaryFollow(
      `${BASE}/blobelements/d/${did}/w/${wid}/e/${blobEids[0]}`
    );
  }

  throw new Error(
    `Translation done but no download ids: ${JSON.stringify(done).slice(0, 800)}`
  );
}

/** Async Assembly glTF export (POST …/assemblies/…/export/gltf). */
async function fetchExportAssemblyGltf(did, wid, eid, cfg, meshParams) {
  const path = withConfigurationQuery(
    `/assemblies/d/${did}/w/${wid}/e/${eid}/export/gltf`,
    cfg
  );
  /**
   * `grouping: false` → ZIP of one .gltf per part, often in **part-local** space with no assembly
   * instance transform. Merging those files stacks meshes near the origin (tiny spread in X/Y).
   * `grouping: true` → Onshape emits a **grouped** glTF with instance transforms preserved (often a
   * single main .gltf in the ZIP). Part Studio export above still uses `grouping: false` so small
   * part-studio pulls stay a single stream when the API allows.
   */
  const started = await postJson(path, {
    meshParams,
    excludeHiddenEntities: true,
    storeInDocument: false,
    grouping: true,
  });
  const tid = started.id;
  if (!tid) {
    throw new Error(`No translation id: ${JSON.stringify(started).slice(0, 400)}`);
  }
  const done = await waitForTranslationDone(tid);

  const extIds = done.resultExternalDataIds;
  if (Array.isArray(extIds) && extIds.length > 0) {
    if (extIds.length > 1) {
      console.warn(`Note: ${extIds.length} external data blobs; using the first.`);
    }
    return fetchBinaryFollow(`${BASE}/documents/d/${did}/externaldata/${extIds[0]}`);
  }

  const blobEids = done.resultElementIds;
  if (Array.isArray(blobEids) && blobEids.length > 0) {
    return fetchBinaryFollow(
      `${BASE}/blobelements/d/${did}/w/${wid}/e/${blobEids[0]}`
    );
  }

  throw new Error(
    `Assembly translation done but no download ids: ${JSON.stringify(done).slice(0, 800)}`
  );
}

async function resolveTabGltfExport(
  did,
  wid,
  eid,
  cfg,
  forceSync,
  elementKind,
  meshParams,
  gltfQuality
) {
  if (elementKind === 'assembly') {
    const { buffer, contentType } = await fetchExportAssemblyGltf(
      did,
      wid,
      eid,
      cfg,
      meshParams
    );
    return {
      buffer,
      contentType,
      exportMethod: 'asyncPOST_assembly_export_gltf',
      excludeHiddenEntities: true,
      gltfMeshQuality: gltfQuality,
      meshParams,
    };
  }
  return resolveGltfExport(did, wid, eid, cfg, forceSync, meshParams, gltfQuality);
}

function bufferLooksLikeZip(buf) {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b;
}

/** Assembly `grouping:true` can return one self-contained `.gltf` JSON (buffers as data: URIs). */
function bufferLooksLikeGltfJson(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 80) return false;
  // Onshape puts huge `accessors` / `bufferViews` before `"asset"` (often many MB in).
  const scan = Math.min(buf.length, 16 * 1024 * 1024);
  const head = buf.slice(0, scan).toString('utf8').trimStart();
  if (!head.startsWith('{')) return false;
  return (
    /"asset"\s*:\s*\{/.test(head) &&
    /"version"\s*:\s*"2\.0"/.test(head)
  );
}

/**
 * Package embedded JSON glTF into a single binary `.glb` so {@link optimizeGlbForWeb} and static hosting work.
 * @param {Buffer} buf
 * @returns {Promise<Buffer>}
 */
async function gltfJsonBufferToGlb(buf) {
  const dir = await mkdtemp(join(tmpdir(), 'osh-gltfjson-'));
  try {
    const gltfPath = join(dir, 'export.gltf');
    await writeFile(gltfPath, buf);
    const { NodeIO } = await import('@gltf-transform/core');
    const io = new NodeIO();
    await io.init();
    const doc = await io.read(gltfPath);
    const glb = await io.writeBinary(doc);
    console.warn(
      `Embedded .gltf JSON (${(buf.length / 1e6).toFixed(2)} MB) → .glb (${(glb.byteLength / 1e6).toFixed(2)} MB)`
    );
    return Buffer.from(glb);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Onshape `grouping:true` assembly export often uses one scene root (e.g. assembly name) with parts
 * as node children. The viewer toggles **direct** scene children — hoist parts out, baking each
 * {@link Node#getWorldMatrix} into local TRS so placement is unchanged.
 *
 * @param {import('@gltf-transform/core').Document} document
 * @returns {boolean} Whether the graph was modified.
 */
function hoistSingleAssemblyWrapperToScene(document) {
  const scene = document.getRoot().getDefaultScene();
  if (!scene) return false;
  const roots = scene.listChildren();
  if (roots.length !== 1) return false;
  const wrapper = roots[0];
  const parts = wrapper.listChildren().slice();
  if (parts.length === 0) return false;

  for (const node of parts) {
    const world = node.getWorldMatrix();
    wrapper.removeChild(node);
    scene.addChild(node);
    node.setMatrix(world);
  }
  scene.removeChild(wrapper);
  wrapper.dispose();
  return true;
}

/**
 * @param {Buffer} glbBuf
 * @returns {Promise<Buffer>}
 */
async function maybeHoistSingleAssemblyWrapperInGlbBuffer(glbBuf) {
  const { NodeIO } = await import('@gltf-transform/core');
  const io = new NodeIO();
  await io.init();
  const doc = await io.readBinary(new Uint8Array(glbBuf));
  if (!hoistSingleAssemblyWrapperToScene(doc)) return glbBuf;
  console.warn(
    'Hoisted single assembly root → direct scene children (part names / toggles; world poses unchanged).'
  );
  return Buffer.from(await io.writeBinary(doc));
}

/**
 * After mergeDocuments(), each merged part often keeps its own {@link Scene} with one root node.
 * GLTFLoader only builds the default scene, so all other parts stay invisible.
 * Reparent every root node into the default scene and drop empty scenes (see gltf-transform mergeDocuments docs).
 *
 * @param {import('@gltf-transform/core').Document} document
 */
function flattenMergedScenesIntoDefault(document) {
  const root = document.getRoot();
  const scenes = root.listScenes();
  if (scenes.length <= 1) return;

  const main = root.getDefaultScene() ?? scenes[0];
  if (!main) return;

  for (const scene of scenes) {
    if (scene === main) continue;
    for (const node of scene.listChildren().slice()) {
      scene.removeChild(node);
      main.addChild(node);
    }
  }

  for (const scene of root.listScenes().slice()) {
    if (scene !== main && scene.listChildren().length === 0) {
      scene.dispose();
    }
  }
}

/**
 * Onshape often returns a ZIP (even with grouping:false). Browsers pass `.gltf` through JSON.parse → PK error.
 * Extract to disk, merge every `.gltf` into one asset, emit a single `.glb` (embeds buffers; works with GLTFLoader).
 */
async function normalizeIfZipGltfBuffer(buf) {
  if (!bufferLooksLikeZip(buf)) {
    return { buffer: buf, switchedToGlb: false };
  }
  const { unzipSync } = await import('fflate');
  const files = unzipSync(new Uint8Array(buf));
  const gltfRel = Object.keys(files).filter(
    (p) => /\.gltf$/i.test(p) && !p.endsWith('/')
  );
  const glbRel = Object.keys(files).filter(
    (p) => /\.glb$/i.test(p) && !p.endsWith('/')
  );
  if (gltfRel.length === 0 && glbRel.length === 1) {
    console.warn(`ZIP export: single embedded .glb "${glbRel[0]}".`);
    return {
      buffer: Buffer.from(files[glbRel[0]]),
      switchedToGlb: true,
    };
  }
  if (gltfRel.length === 0) {
    throw new Error(
      `ZIP has no .gltf (and not exactly one .glb). Entries: ${Object.keys(files).slice(0, 20).join(', ')}`
    );
  }

  gltfRel.sort((a, b) => a.localeCompare(b));
  const dir = await mkdtemp(join(tmpdir(), 'osh-gltf-'));
  try {
    for (const [relPath, data] of Object.entries(files)) {
      if (relPath.endsWith('/')) continue;
      const fp = join(dir, relPath);
      await mkdir(dirname(fp), { recursive: true });
      await writeFile(fp, Buffer.from(data));
    }

    const { NodeIO } = await import('@gltf-transform/core');
    const { mergeDocuments, unpartition } = await import(
      '@gltf-transform/functions'
    );
    const io = new NodeIO();
    await io.init();

    let doc = await io.read(join(dir, gltfRel[0]));
    for (let i = 1; i < gltfRel.length; i++) {
      const other = await io.read(join(dir, gltfRel[i]));
      mergeDocuments(doc, other);
    }
    flattenMergedScenesIntoDefault(doc);
    await doc.transform(unpartition());
    const glb = await io.writeBinary(doc);
    console.warn(
      `ZIP export → merged ${gltfRel.length} .gltf part(s) into one .glb (${gltfRel.map((n) => n.split('/').pop()).join(', ')})`
    );
    return { buffer: Buffer.from(glb), switchedToGlb: true };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function resolveGltfExport(did, wid, eid, cfg, forceSync, meshParams, gltfQuality) {
  const syncPath = withConfigurationQuery(
    `/partstudios/d/${did}/w/${wid}/e/${eid}/gltf?rollbackBarIndex=-1`,
    cfg
  );
  if (forceSync) {
    console.warn(
      'Sync GET …/gltf ignores --gltf-quality (Onshape does not accept meshParams on this path).'
    );
    const { buffer, contentType } = await fetchExportGltf(syncPath);
    return {
      buffer,
      contentType,
      exportMethod: 'syncGET_partStudio_gltf',
      excludeHiddenEntities: false,
      gltfMeshQuality: gltfQuality,
      meshParams,
      syncExportIgnoresMeshQuality: true,
    };
  }
  try {
    const { buffer, contentType } = await fetchExportGltfTranslationVisibleOnly(
      did,
      wid,
      eid,
      cfg,
      meshParams
    );
    return {
      buffer,
      contentType,
      exportMethod: 'asyncPOST_partStudio_export_gltf',
      excludeHiddenEntities: true,
      gltfMeshQuality: gltfQuality,
      meshParams,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      'Async glTF (excludeHiddenEntities) failed; falling back to sync GET …/gltf:',
      msg.split('\n')[0]
    );
    console.warn('Fallback sync export ignores --gltf-quality.');
    const { buffer, contentType } = await fetchExportGltf(syncPath);
    return {
      buffer,
      contentType,
      exportMethod: 'syncGET_partStudio_gltf_fallback',
      excludeHiddenEntities: false,
      exportFallbackReason: msg.slice(0, 500),
      gltfMeshQuality: gltfQuality,
      meshParams,
      syncExportIgnoresMeshQuality: true,
    };
  }
}

async function fetchExportGltf(pathAndQuery) {
  const url = `${BASE}${pathAndQuery}`;
  const headers = { Authorization: basicAuthHeader(), Accept: '*/*' };
  let current = url;
  for (let hop = 0; hop < 20; hop++) {
    const res = await fetch(current, { method: 'GET', headers, redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error('Redirect without Location');
      current = new URL(loc, current).href;
      continue;
    }
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Export failed HTTP ${res.status}\n${t.slice(0, 2000)}`);
    }
    const ct = res.headers.get('content-type') || '';
    const buf = Buffer.from(await res.arrayBuffer());
    return { buffer: buf, contentType: ct };
  }
  throw new Error('Too many redirects');
}

/** Append configuration query; value must already be Onshape-encoded (e.g. from encodeConfigurationMap), not double-URL-encoded. */
function withConfigurationQuery(baseQuery, configuration) {
  if (!configuration) return baseQuery;
  const sep = baseQuery.includes('?') ? '&' : '?';
  return `${baseQuery}${sep}configuration=${configuration}`;
}

function sanitizeFileBase(s) {
  return s.replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, ' ').trim();
}

/** cad.onshape.com/documents/DID/w/WID or .../e/EID */
function parseOnshapeDocumentUrl(query) {
  const t = query.trim();
  const m = t.match(
    /documents\/([a-f0-9]{20,})\/w\/([a-f0-9]{20,})(?:\/e\/([a-f0-9]{20,}))?/i
  );
  if (!m) return null;
  return { did: m[1], wid: m[2], eid: m[3] || null };
}

function pickDocument(items, query) {
  const q = query.toLowerCase();
  const exact = items.find((d) => (d.name || '').toLowerCase() === q);
  if (exact) return exact;
  const sub = items.find((d) => (d.name || '').toLowerCase().includes(q));
  if (sub) return sub;
  return items[0] || null;
}

function pickPartStudio(elements, studioSub) {
  const ps = elements.filter((e) => e.elementType === 'PARTSTUDIO');
  if (!studioSub) return ps[0] || null;
  const s = studioSub.toLowerCase();
  return (
    ps.find((e) => (e.name || '').toLowerCase().includes(s)) || ps[0] || null
  );
}

function pickAssembly(elements, studioSub) {
  const asms = elements.filter((e) => e.elementType === 'ASSEMBLY');
  if (!studioSub) return asms[0] || null;
  const s = studioSub.toLowerCase();
  return (
    asms.find((e) => (e.name || '').toLowerCase().includes(s)) || asms[0] || null
  );
}

function parseEvalFsMap(apiJson) {
  const map = {};
  const entries = apiJson.result?.value;
  if (!Array.isArray(entries)) return map;
  for (const ent of entries) {
    const k = ent.key?.value;
    const vals = ent.value?.value;
    if (!k || !Array.isArray(vals)) continue;
    map[k] = vals.map((v) => v.value);
  }
  return map;
}

function fsScriptForMc(featureId) {
  return `function(context is Context, queries) { var mc = qBodyType(qCreatedBy(makeId("${featureId}")), BodyType.MATE_CONNECTOR); var csys = evMateConnector(context, { "mateConnector": mc }); var w = toWorld(csys); var L = w.linear; var t = w.translation; var m = 1 * meter; return { "rotationMatrixRowMajor": [ L[0][0], L[0][1], L[0][2], L[1][0], L[1][1], L[1][2], L[2][0], L[2][1], L[2][2] ], "originMeters": [t[0] / m, t[1] / m, t[2] / m], "xAxis": [L[0][0], L[1][0], L[2][0]], "yAxis": [L[0][1], L[1][1], L[2][1]], "zAxis": [L[0][2], L[1][2], L[2][2]] }; }`;
}

async function main() {
  const args = parseArgs(process.argv);
  const urlIds = parseOnshapeDocumentUrl(args.query);

  let doc;
  let did;
  let wid;
  /** Part Studio or Assembly tab */
  let tabElement;
  let eid;
  /** @type {'partStudio' | 'assembly'} */
  let elementKind;

  if (urlIds) {
    did = urlIds.did;
    wid = urlIds.wid;
    doc = await fetchJson(`/documents/${did}`);
    const contents = await fetchJson(`/documents/d/${did}/w/${wid}/contents`);
    if (urlIds.eid) {
      const el = (contents.elements || []).find((e) => e.id === urlIds.eid);
      if (!el) {
        throw new Error(`URL element ${urlIds.eid} not found in document contents.`);
      }
      if (el.elementType === 'PARTSTUDIO') {
        tabElement = el;
        elementKind = 'partStudio';
      } else if (el.elementType === 'ASSEMBLY') {
        tabElement = el;
        elementKind = 'assembly';
      } else {
        throw new Error(
          `URL element must be a Part Studio or Assembly tab (got ${el.elementType}).`
        );
      }
      eid = el.id;
    } else {
      tabElement = pickPartStudio(contents.elements || [], args.studioSub);
      if (tabElement) {
        elementKind = 'partStudio';
      } else {
        tabElement = pickAssembly(contents.elements || [], args.studioSub);
        elementKind = tabElement ? 'assembly' : null;
      }
      if (!tabElement) {
        throw new Error(
          'No Part Studio or Assembly tab (use --studio=TabNameSubstring)'
        );
      }
      eid = tabElement.id;
    }
  } else {
    const qParam = encodeURIComponent(args.query);
    const docList = await fetchJson(`/documents?q=${qParam}&filter=0&limit=20`);
    doc = pickDocument(docList.items || [], args.query);
    if (!doc) throw new Error(`No documents found for "${args.query}"`);

    wid = doc.defaultWorkspace?.id;
    if (!wid) throw new Error('Document has no defaultWorkspace.id');
    did = doc.id;

    const contents = await fetchJson(`/documents/d/${did}/w/${wid}/contents`);
    tabElement = pickPartStudio(contents.elements || [], args.studioSub);
    if (tabElement) {
      elementKind = 'partStudio';
    } else {
      tabElement = pickAssembly(contents.elements || [], args.studioSub);
      elementKind = tabElement ? 'assembly' : null;
    }
    if (!tabElement) {
      throw new Error('No Part Studio or Assembly tab in document');
    }
    eid = tabElement.id;
  }

  if (elementKind === 'assembly' && !args.composed) {
    throw new Error(
      'Assembly tabs require --composed (no Part Studio iface mate export).'
    );
  }

  const cfg = args.configuration;

  if (args.dryRun) {
    console.log(
      JSON.stringify(
        {
          documentName: doc.name,
          did,
          wvmid: wid,
          eid,
          elementKind,
          tabName: tabElement.name,
          configuration: cfg || null,
          composed: args.composed,
          fromDocumentUrl: Boolean(urlIds),
        },
        null,
        2
      )
    );
    return;
  }

  await mkdir(args.outDir, { recursive: true });

  const meshParams = meshParamsForQuality(args.gltfQuality);
  console.warn(
    `glTF mesh quality: ${args.gltfQuality} (resolution ${meshParams.resolution}, chord ≤ ${meshParams.maximumChordLength} m)`
  );

  const forceSyncExport =
    args.syncGltf ||
    (args.composed && !args.composedAsync && elementKind === 'partStudio');
  const exportResult = await resolveTabGltfExport(
    did,
    wid,
    eid,
    cfg,
    forceSyncExport,
    elementKind,
    meshParams,
    args.gltfQuality
  );
  let { buffer, contentType } = exportResult;
  const zipNorm = await normalizeIfZipGltfBuffer(buffer);
  buffer = zipNorm.buffer;

  let switchedToGlb = zipNorm.switchedToGlb;
  if (!isBinaryGlbBuffer(buffer) && bufferLooksLikeGltfJson(buffer)) {
    buffer = await gltfJsonBufferToGlb(buffer);
    switchedToGlb = true;
  }

  /** @type {null | Record<string, unknown>} */
  let glbWebOptimize = null;
  if (isBinaryGlbBuffer(buffer)) {
    buffer = await maybeHoistSingleAssemblyWrapperInGlbBuffer(buffer);
    const before = buffer.length;
    try {
      buffer = await optimizeGlbForWeb(buffer);
      glbWebOptimize = {
        applied: true,
        inputBytes: before,
        outputBytes: buffer.length,
        simplifyRatio: WEB_OPTIMIZE_PRESET.simplifyRatio,
        simplifyError: WEB_OPTIMIZE_PRESET.simplifyError,
        simplifyLockBorder: WEB_OPTIMIZE_PRESET.simplifyLockBorder,
        meshoptLevel: WEB_OPTIMIZE_PRESET.meshoptLevel,
        extensionsUsed: ['EXT_meshopt_compression'],
      };
      console.warn(
        `glb web optimize: ${(before / 1e6).toFixed(2)} MB → ${(buffer.length / 1e6).toFixed(2)} MB (strip textures, simplify, meshopt)`
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(
        'glb web optimize failed, keeping raw export:',
        msg.split('\n')[0]
      );
    }
  }

  let baseName =
    args.fileName ||
    `${sanitizeFileBase(doc.name)} - ${sanitizeFileBase(tabElement.name)}.gltf`;
  const manifestKeyBeforeZip = baseName;
  if (switchedToGlb && /\.gltf$/i.test(baseName)) {
    await unlink(join(args.outDir, baseName)).catch(() => {});
    baseName = baseName.replace(/\.gltf$/i, '.glb');
  }

  const outPath = join(args.outDir, baseName);
  await writeFile(outPath, buffer);

  const relModel = `src/test-models/${baseName}`.replace(/\\/g, '/');

  const sidecarBase = baseName.replace(/\.(gltf|glb)$/i, '');
  const mateSidecarPath = join(args.outDir, `${sidecarBase}.mate-connectors.json`);
  const assemblyManifestPath = join(
    args.outDir,
    `${sidecarBase}.assembly-manifest.json`
  );

  let libraryVersion = 2815;
  let sourceMicroversion = '';
  let mateConnectors = {};

  if (args.composed) {
    // For assembly tabs, extract iface_* mate connectors from the assembly definition
    // and write a mate-connectors sidecar so the viewer can snap modules together.
    // For part-studio composed exports there are no assembly-level connectors, so we
    // still delete any stale sidecar.
    if (elementKind === 'assembly') {
      let assemblyIfaceConnectors = {};
      try {
        const asmDef = await fetchJson(
          `/assemblies/d/${did}/w/${wid}/e/${eid}?includeMateFeatures=true&includeMateConnectors=true`
        );
        const features = asmDef.rootAssembly?.features || asmDef.features || [];
        for (const f of features) {
          if (f.suppressed) continue;
          if (f.featureType !== 'mateConnector') continue;
          const name = f.featureData?.name || '';
          if (!/^iface_/i.test(name)) continue;
          const cs = f.featureData?.mateConnectorCS;
          if (!cs?.origin || !cs.xAxis || !cs.yAxis || !cs.zAxis) continue;
          assemblyIfaceConnectors[name] = {
            onshapeFeatureName: name,
            featureId: f.id,
            originMeters: cs.origin,
            xAxis: cs.xAxis,
            yAxis: cs.yAxis,
            zAxis: cs.zAxis,
          };
        }
      } catch (err) {
        console.warn(`  ⚠  Could not fetch assembly definition for iface connectors: ${err.message}`);
      }

      if (Object.keys(assemblyIfaceConnectors).length > 0) {
        const mateSidecar = {
          legacyIfaceAssembly: true,
          sourceFile: relModel,
          document: { did, wvm: 'w', wvmid: wid, eid, linkDocumentId: '' },
          elementKind,
          tabName: tabElement.name,
          assemblyName: tabElement.name,
          documentName: doc.name,
          queriedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
          frame: 'assemblyWorld',
          mateConnectors: assemblyIfaceConnectors,
        };
        await writeFile(mateSidecarPath, JSON.stringify(mateSidecar, null, 2));
        console.log(`  ✓ Wrote mate-connectors sidecar with ${Object.keys(assemblyIfaceConnectors).length} iface connector(s)`);
      } else {
        await unlink(mateSidecarPath).catch(() => {});
        console.log(`  ℹ  No iface_* connectors found in assembly — no mate-connectors sidecar written`);
      }
    } else {
      await unlink(mateSidecarPath).catch(() => {});
    }
    const configResp = await fetchJson(
      `/elements/d/${did}/w/${wid}/e/${eid}/configuration`
    );
    libraryVersion = configResp.libraryVersion ?? libraryVersion;
    sourceMicroversion = configResp.sourceMicroversion || '';

    let preservedPartVisibilityBuckets;
    try {
      const prevText = await readFile(assemblyManifestPath, 'utf8');
      const prev = JSON.parse(prevText);
      if (
        Array.isArray(prev.partVisibilityBuckets) &&
        prev.partVisibilityBuckets.length > 0
      ) {
        preservedPartVisibilityBuckets = prev.partVisibilityBuckets;
      }
    } catch {
      /* first export or unreadable */
    }

    const assemblyManifest = {
      schemaVersion: 1,
      composedDocument: true,
      legacyIfaceAssembly: false,
      sourceFile: relModel,
      ...(elementKind === 'assembly'
        ? {
            assemblyGltfGrouping: true,
          }
        : {}),
      document: { did, wvm: 'w', wvmid: wid, eid, linkDocumentId: '' },
      elementKind,
      tabName: tabElement.name,
      partStudioName:
        elementKind === 'partStudio' ? tabElement.name : undefined,
      assemblyName: elementKind === 'assembly' ? tabElement.name : undefined,
      documentName: doc.name,
      partGroupsNote:
        'Default: group by text before the first " - " in each scene child name (viewer expands Three.js _ in names). Optional partVisibilityBuckets overrides with substring rules. Re-export preserves partVisibilityBuckets if already present.',
      configuration: cfg
        ? {
            apiQueryValue: cfg,
            note: 'Omit configuration when the composed document has no variables.',
          }
        : undefined,
      queriedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      libraryVersion,
      sourceMicroversion,
      exportContentType: contentType,
      excludeHiddenEntities: exportResult.excludeHiddenEntities,
      exportMethod: exportResult.exportMethod,
      gltfMeshQuality: exportResult.gltfMeshQuality,
      meshParams: exportResult.meshParams,
      ...(exportResult.syncExportIgnoresMeshQuality
        ? { syncExportIgnoresMeshQuality: true }
        : {}),
      ...(exportResult.exportFallbackReason
        ? { exportFallbackReason: exportResult.exportFallbackReason }
        : {}),
      ...(glbWebOptimize ? { glbWebOptimize } : {}),
      ...(preservedPartVisibilityBuckets
        ? { partVisibilityBuckets: preservedPartVisibilityBuckets }
        : {}),
    };
    await writeFile(
      assemblyManifestPath,
      JSON.stringify(assemblyManifest, null, 2)
    );
  } else {
    const featuresPath = withConfigurationQuery(
      `/partstudios/d/${did}/w/${wid}/e/${eid}/features?rollbackBarIndex=-1`,
      cfg
    );
    const features = await fetchJson(featuresPath);
    const feats = [...(features.defaultFeatures || []), ...(features.features || [])];
    const ifaceMcs = feats.filter(
      (f) => f.featureType === 'mateConnector' && /^iface_/i.test(f.name || '')
    );

    const configResp = await fetchJson(
      `/elements/d/${did}/w/${wid}/e/${eid}/configuration`
    );
    libraryVersion = configResp.libraryVersion ?? 2815;
    sourceMicroversion = configResp.sourceMicroversion || '';

    mateConnectors = {};
    for (const mc of ifaceMcs) {
      const fid = mc.featureId;
      const body = JSON.stringify({
        libraryVersion,
        script: fsScriptForMc(fid),
      });
      const evalPath = withConfigurationQuery(
        `/partstudios/d/${did}/w/${wid}/e/${eid}/featurescript?rollbackBarIndex=-1`,
        cfg
      );
      const evalUrl = `${BASE}${evalPath}`;
      const res = await fetch(evalUrl, {
        method: 'POST',
        headers: {
          Authorization: basicAuthHeader(),
          Accept: 'application/json;charset=UTF-8; qs=0.09',
          'Content-Type': 'application/json;charset=UTF-8; qs=0.09',
        },
        body,
        redirect: 'manual',
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`evalFeatureScript ${mc.name}: ${res.status}\n${t.slice(0, 1500)}`);
      }
      const ej = await res.json();
      if (ej.notices?.some((n) => n.level === 'ERROR')) {
        throw new Error(`evalFeatureScript ${mc.name}: ${JSON.stringify(ej.notices)}`);
      }
      if (typeof ej.libraryVersion === 'number') libraryVersion = ej.libraryVersion;
      const m = parseEvalFsMap(ej);
      const key = (mc.name || '').replace(/^iface_/i, 'iface_');
      mateConnectors[key] = {
        onshapeFeatureName: mc.name,
        featureId: fid,
        originMeters: m.originMeters,
        xAxis: m.xAxis,
        yAxis: m.yAxis,
        zAxis: m.zAxis,
        rotationMatrixRowMajor: m.rotationMatrixRowMajor,
      };
    }

    const sidecar = {
      sourceFile: relModel,
      document: { did, wvm: 'w', wvmid: wid, eid, linkDocumentId: '' },
      elementKind,
      tabName: tabElement.name,
      partStudioName:
        elementKind === 'partStudio' ? tabElement.name : undefined,
      assemblyName: elementKind === 'assembly' ? tabElement.name : undefined,
      documentName: doc.name,
      configuration: cfg
        ? { apiQueryValue: cfg, note: 'Pass this string as the configuration query value (after decoding in logs).' }
        : undefined,
      queriedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      frame: 'partStudioWorld',
      libraryVersion,
      sourceMicroversion,
      exportContentType: contentType,
      excludeHiddenEntities: exportResult.excludeHiddenEntities,
      exportMethod: exportResult.exportMethod,
      gltfMeshQuality: exportResult.gltfMeshQuality,
      meshParams: exportResult.meshParams,
      ...(exportResult.syncExportIgnoresMeshQuality
        ? { syncExportIgnoresMeshQuality: true }
        : {}),
      ...(exportResult.exportFallbackReason
        ? { exportFallbackReason: exportResult.exportFallbackReason }
        : {}),
      ...(glbWebOptimize ? { glbWebOptimize } : {}),
      mateConnectors,
    };

    await writeFile(mateSidecarPath, JSON.stringify(sidecar, null, 2));
  }

  const sourcesPath = join(REPO_ROOT, 'onshape-sources.json');
  let sources = { sources: {} };
  try {
    sources = JSON.parse(await readFile(sourcesPath, 'utf8'));
  } catch {
    /* new */
  }
  sources.sources = sources.sources || {};
  if (
    manifestKeyBeforeZip !== baseName &&
    manifestKeyBeforeZip.toLowerCase().endsWith('.gltf')
  ) {
    delete sources.sources[manifestKeyBeforeZip];
  }
  sources.sources[baseName] = {
    did,
    wvm: 'w',
    wvmid: wid,
    eid,
    linkDocumentId: '',
    elementKind,
    tabName: tabElement.name,
    partStudioName:
      elementKind === 'partStudio' ? tabElement.name : undefined,
    assemblyName: elementKind === 'assembly' ? tabElement.name : undefined,
    documentName: doc.name,
    ...(cfg ? { defaultConfigurationQuery: cfg } : {}),
  };
  await writeFile(sourcesPath, JSON.stringify(sources, null, 2));

  console.log('Wrote model:', outPath);
  if (args.composed) {
    console.log('Wrote assembly manifest:', assemblyManifestPath);
  } else {
    console.log('Wrote mate sidecar:', mateSidecarPath);
    console.log('iface_ mate connectors:', Object.keys(mateConnectors).join(', ') || '(none)');
  }
  console.log('Updated:', sourcesPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
