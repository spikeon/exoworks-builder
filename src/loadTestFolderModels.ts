import type { AssemblyManifest } from './assemblyPartGroups';
import type { MateConnectorsSidecar } from './interfaceFrames';
import { encodeModelUrlForFetch } from './modelUrl';

export type TestModelEntry = {
  id: string;
  label: string;
  url: string;
  mateSidecar: MateConnectorsSidecar | null;
  assemblyManifest: AssemblyManifest | null;
};

function displayLabelFromGlobKey(key: string): string {
  const file = key.replace(/^.*\//, '').replace(/\.(gltf|glb)$/i, '');
  try {
    return decodeURIComponent(file);
  } catch {
    return file;
  }
}

/**
 * `.glb` / `.gltf` under `test-models/`, optional `.mate-connectors.json`, optional `.assembly-manifest.json`.
 */
export function loadTestFolderModels(): TestModelEntry[] {
  const gltfModules = import.meta.glob('./test-models/**/*.glb', {
    eager: true,
    query: '?url',
    import: 'default',
  }) as Record<string, string>;
  const gltfModules2 = import.meta.glob('./test-models/**/*.gltf', {
    eager: true,
    query: '?url',
    import: 'default',
  }) as Record<string, string>;
  const mateModules = import.meta.glob('./test-models/**/*.mate-connectors.json', {
    eager: true,
    import: 'default',
  }) as Record<string, MateConnectorsSidecar>;
  const assemblyModules = import.meta.glob(
    './test-models/**/*.assembly-manifest.json',
    {
      eager: true,
      import: 'default',
    }
  ) as Record<string, AssemblyManifest>;

  const combined = { ...gltfModules, ...gltfModules2 };
  const entries: TestModelEntry[] = [];

  for (const [key, url] of Object.entries(combined)) {
    const stemKey = key.replace(/\.(gltf|glb)$/i, '');
    const mateKey = `${stemKey}.mate-connectors.json`;
    const asmKey = `${stemKey}.assembly-manifest.json`;
    const rawSidecar = mateModules[mateKey];
    const rawAsm = assemblyModules[asmKey];
    entries.push({
      id: key,
      label: displayLabelFromGlobKey(key),
      url: encodeModelUrlForFetch(url),
      mateSidecar: rawSidecar && typeof rawSidecar === 'object' ? rawSidecar : null,
      assemblyManifest:
        rawAsm && typeof rawAsm === 'object' ? rawAsm : null,
    });
  }

  return entries.sort((a, b) => a.label.localeCompare(b.label));
}

export function loadAllTestFolderModelUrls(): string[] {
  return loadTestFolderModels().map((e) => e.url);
}
