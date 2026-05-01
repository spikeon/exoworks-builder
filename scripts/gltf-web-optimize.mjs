/**
 * Shrink glb exports for the web viewer: drop textures, simplify mesh, EXT_meshopt_compression.
 * Used by onshape-pull-part.mjs after Onshape export. The React app must use GLTFLoader +
 * MeshoptDecoder (see InterfaceAssemblyView).
 */

import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import {
  dedup,
  meshopt,
  prune,
  simplify,
  weld,
} from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

/** @param {import('node:buffer').Buffer} buf */
export function isBinaryGlbBuffer(buf) {
  return (
    Buffer.isBuffer(buf) &&
    buf.length >= 4 &&
    buf.toString('ascii', 0, 4) === 'glTF'
  );
}

/**
 * Clear every `setSomethingTexture(null)` we can find on a material extension (clearcoat, specular, …).
 * @param {object} ext
 */
function clearTextureSettersOnExtension(ext) {
  let proto = ext;
  const tried = new Set();
  while (proto && proto !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (!/^set[A-Za-z0-9]+Texture$/.test(name) || tried.has(name)) continue;
      tried.add(name);
      const fn = ext[name];
      if (typeof fn !== 'function') continue;
      try {
        fn.call(ext, null);
      } catch {
        /* ignore */
      }
    }
    proto = Object.getPrototypeOf(proto);
  }
}

function stripAllMaterialTextures(doc) {
  for (const mat of doc.getRoot().listMaterials()) {
    mat
      .setBaseColorTexture(null)
      .setEmissiveTexture(null)
      .setNormalTexture(null)
      .setOcclusionTexture(null)
      .setMetallicRoughnessTexture(null);
    for (const ext of mat.listExtensions()) {
      clearTextureSettersOnExtension(ext);
    }
  }
}

/**
 * Tunables for meshoptimizer simplify (see @gltf-transform/functions simplify).
 * `ratio` is a target fraction of **triangle indices** to keep (not vertex count).
 * Very low values (e.g. 0.14) strip CAD solids into holes, ragged caps, and “see‑through” shells.
 */
export const WEB_OPTIMIZE_PRESET = {
  /** Target fraction of triangle indices to retain after simplification. */
  simplifyRatio: 0.82,
  /** Max error vs mesh scale; lower stops edge collapses sooner (keeps shape cleaner). */
  simplifyError: 0.01,
  /** Preserve border edges where the simplifier supports it (helps open caps / seams). */
  simplifyLockBorder: true,
  /** `high` quantizes vertices more aggressively than `medium` (smaller files, slight snapping). */
  meshoptLevel: 'medium',
};

/**
 * @param {import('node:buffer').Buffer} buffer
 * @returns {Promise<import('node:buffer').Buffer>}
 */
export async function optimizeGlbForWeb(buffer) {
  await Promise.all([MeshoptEncoder.ready, MeshoptSimplifier.ready]);

  const io = new NodeIO()
    .registerExtensions([EXTMeshoptCompression])
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  await io.init();

  const doc = await io.readBinary(new Uint8Array(buffer));
  stripAllMaterialTextures(doc);

  await doc.transform(
    dedup(),
    weld({ overwrite: true }),
    simplify({
      simplifier: MeshoptSimplifier,
      ratio: WEB_OPTIMIZE_PRESET.simplifyRatio,
      error: WEB_OPTIMIZE_PRESET.simplifyError,
      lockBorder: WEB_OPTIMIZE_PRESET.simplifyLockBorder,
    }),
    meshopt({
      encoder: MeshoptEncoder,
      level: WEB_OPTIMIZE_PRESET.meshoptLevel,
    }),
    prune()
  );

  const out = await io.writeBinary(doc);
  return Buffer.from(out);
}
