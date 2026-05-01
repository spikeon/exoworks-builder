#!/usr/bin/env node
/**
 * Re-pull every glTF/GLB entry in onshape-sources.json.
 *
 * Supports three entry shapes:
 *
 * 1. Part Studio (original):
 *    { documentName, partStudioName, [defaultConfigurationQuery] }
 *    → node onshape-pull-part.mjs <documentName> --studio=<partStudioName> [--configuration=…] --file=<fileName>
 *
 * 2. Assembly (elementKind === "assembly"):
 *    { did, wvm, wvmid, eid, [assemblyName] }
 *    → node onshape-pull-part.mjs "https://cad.onshape.com/documents/DID/w/WID/e/EID" --composed --file=<fileName>
 *
 * 3. Part Studio by URL (elementKind === "partStudio"):
 *    { did, wvm, wvmid, eid, [tabName], [defaultConfigurationQuery] }
 *    → node onshape-pull-part.mjs "https://cad.onshape.com/documents/DID/w/WID/e/EID" [--configuration=…] --file=<fileName>
 *
 * Env: ONSHAPE_ACCESS_KEY, ONSHAPE_SECRET_KEY
 */
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const BASE_URL = 'https://cad.onshape.com/documents';

const manifest = JSON.parse(
  (await readFile(join(REPO_ROOT, 'onshape-sources.json'), 'utf8')).replace(/\0/g, '')
);
const sources = manifest.sources || {};
const entries = Object.entries(sources).filter(
  ([name]) => /\.gltf$/i.test(name) || /\.glb$/i.test(name)
);

if (entries.length === 0) {
  console.error('No .gltf/.glb entries in onshape-sources.json');
  process.exit(1);
}

for (const [fileName, meta] of entries) {
  let args;

  if (meta.elementKind === 'assembly' && meta.did && meta.wvmid && meta.eid) {
    // Assembly pull: use document URL + --composed
    const wvmType = meta.wvm ?? 'w';
    const docUrl = `${BASE_URL}/${meta.did}/${wvmType}/${meta.wvmid}/e/${meta.eid}`;
    console.log(`\nAssembly pull: ${meta.assemblyName ?? fileName}`);
    console.log(`  URL: ${docUrl}`);
    args = [
      join(REPO_ROOT, 'scripts/onshape-pull-part.mjs'),
      docUrl,
      '--composed',
      `--file=${fileName}`,
    ];
  } else if (meta.elementKind === 'partStudio' && meta.did && meta.wvmid && meta.eid) {
    // Part Studio pull by direct URL + optional configuration
    const wvmType = meta.wvm ?? 'w';
    const docUrl = `${BASE_URL}/${meta.did}/${wvmType}/${meta.wvmid}/e/${meta.eid}`;
    console.log(`\nPart Studio pull: ${meta.tabName ?? fileName}`);
    console.log(`  URL: ${docUrl}`);
    if (meta.defaultConfigurationQuery) {
      console.log(`  Config: ${decodeURIComponent(meta.defaultConfigurationQuery)}`);
    }
    args = [
      join(REPO_ROOT, 'scripts/onshape-pull-part.mjs'),
      docUrl,
      `--file=${fileName}`,
    ];
    if (meta.defaultConfigurationQuery) {
      args.push(`--configuration=${meta.defaultConfigurationQuery}`);
    }
  } else if (meta.documentName && meta.partStudioName) {
    // Part Studio pull (original behaviour)
    console.log(`\nPart Studio pull: ${meta.documentName} / ${meta.partStudioName}`);
    args = [
      join(REPO_ROOT, 'scripts/onshape-pull-part.mjs'),
      meta.documentName,
      `--studio=${meta.partStudioName}`,
      `--file=${fileName}`,
    ];
    if (meta.defaultConfigurationQuery) {
      args.push(`--configuration=${meta.defaultConfigurationQuery}`);
    }
  } else {
    console.error(
      `Skipping "${fileName}": needs one of:\n` +
      `  - elementKind=assembly + (did + wvmid + eid)\n` +
      `  - elementKind=partStudio + (did + wvmid + eid)\n` +
      `  - (documentName + partStudioName)`
    );
    continue;
  }

  const code = await new Promise((resolve) => {
    const p = spawn('node', args, {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      env: process.env,
    });
    p.on('close', resolve);
  });

  if (code !== 0) {
    process.exit(code ?? 1);
  }
}

console.log(`\nManifest pull complete: ${entries.length} model(s).`);
