import type { Object3D } from 'three';

/**
 * Split part instance names on this substring; the **left** side is the shared group name.
 * Example: `exobass - Head` and `exobass - Bridge` → one toggle **exobass** (2 children).
 */
export const PART_GROUP_NAME_SEPARATOR = ' - ';

/**
 * Returns true for nodes that are standard 2020 aluminum extrusion parts.
 * These are hidden from the GLB render and replaced by a procedural box in the viewer.
 */
const IS_2020_RE = /\b2020\b|aluminum[\s_]+extrusion/i;
export function is2020NodeName(rawName: string): boolean {
  return IS_2020_RE.test(expandSanitizedNodeNameForGrouping(rawName));
}

/** @deprecated Prefer {@link partGroupKeyForName} for dash-based groups. */
export function partGroupKey(fileIndex: number, childIndex: number): string {
  return `f${fileIndex}-g${childIndex}`;
}

export function partGroupKeyForName(fileIndex: number, groupName: string): string {
  return `f${fileIndex}-n:${encodeURIComponent(groupName)}`;
}

export type PartGroupBucket = {
  key: string;
  label: string;
  objects: Object3D[];
};

/** @deprecated Use {@link PartGroupBucket} */
export type PartGroupRef = {
  key: string;
  label: string;
  object: Object3D;
};

export function listPartGroupObjects(sceneRoot: Object3D): Object3D[] {
  return sceneRoot.children.slice();
}

/**
 * {@link GLTFLoader} turns spaces and hyphens in node names into `_`. Expand those back so
 * dash-based grouping sees the same ` - ` boundaries as in Onshape / the glTF JSON.
 */
export function expandSanitizedNodeNameForGrouping(name: string): string {
  return name.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Onshape prefixes assembly instance names with "Occurrence of " in exports / catalogs. */
const OCCURRENCE_OF_PREFIX = /^occurrence\s+of\s+/i;

/** Sidebar-friendly label; leaves suffixes like "(59)" intact. */
export function stripOccurrenceOfPrefixForDisplay(text: string): string {
  const t = text.trim();
  const stripped = t.replace(OCCURRENCE_OF_PREFIX, '').trim();
  return stripped || t;
}

export function groupNameFromPartNodeName(
  nodeName: string | undefined,
  fileIndex: number,
  childIndex: number
): string {
  const raw = nodeName?.trim() || '';
  const expanded = expandSanitizedNodeNameForGrouping(raw);
  const sep = PART_GROUP_NAME_SEPARATOR;
  const i = expanded.indexOf(sep);
  if (i === -1) {
    return expanded || `unnamed-${fileIndex}-${childIndex}`;
  }
  const head = expanded.slice(0, i).trim();
  return head || expanded || `unnamed-${fileIndex}-${childIndex}`;
}

export function labelForPartGroup(obj: Object3D, childIndex: number): string {
  const n = obj.name?.trim();
  if (n) return n;
  return `Part ${childIndex + 1}`;
}

/**
 * One row per **group name** (text before the first ` - ` after {@link expandSanitizedNodeNameForGrouping}).
 * All direct scene children sharing that prefix toggle together.
 */
export function collectDashNamedPartGroups(
  sceneRoot: Object3D,
  fileIndex: number
): PartGroupBucket[] {
  const children = listPartGroupObjects(sceneRoot);
  const buckets = new Map<string, Object3D[]>();
  const order: string[] = [];

  children.forEach((child, childIndex) => {
    // Skip 2020 extrusion nodes (rendered procedurally) and their replacement meshes
    if (child.userData?.is2020Replacement || is2020NodeName(child.name)) return;
    const gname = groupNameFromPartNodeName(child.name, fileIndex, childIndex);
    if (!buckets.has(gname)) {
      buckets.set(gname, []);
      order.push(gname);
    }
    buckets.get(gname).push(child);
  });

  return order.map((gname) => {
    const objects = buckets.get(gname)!;
    const key = partGroupKeyForName(fileIndex, gname);
    const label =
      objects.length > 1 ? `${gname} (${objects.length})` : gname;
    return { key, label, objects };
  });
}

/** Rule order matters: the first matching `nameContainsAny` wins for each scene child. */
export type PartVisibilityBucketRule = {
  id: string;
  label: string;
  nameContainsAny: string[];
};

const OTHER_BUCKET_ID = 'other';

/**
 * Lowercase form of {@link expandSanitizedNodeNameForGrouping} for case-insensitive manifest rules.
 */
export function normalizeNodeNameForPartMatching(name: string): string {
  return expandSanitizedNodeNameForGrouping(name).toLowerCase();
}

/**
 * Bucket direct scene children using manifest rules (case-insensitive substring match).
 * Unmatched objects go in an **Other** group when present.
 */
export function collectManifestPartGroups(
  sceneRoot: Object3D,
  fileIndex: number,
  rules: PartVisibilityBucketRule[]
): PartGroupBucket[] {
  const children = listPartGroupObjects(sceneRoot);
  const byId = new Map<string, Object3D[]>();
  for (const r of rules) {
    byId.set(r.id, []);
  }
  const other: Object3D[] = [];

  for (const child of children) {
    // Skip 2020 extrusion nodes (rendered procedurally) and their replacement meshes
    if (child.userData?.is2020Replacement || is2020NodeName(child.name)) continue;
    const hay = normalizeNodeNameForPartMatching(child.name || '');
    let placed = false;
    for (const r of rules) {
      if (
        r.nameContainsAny.some((needle) =>
          hay.includes(normalizeNodeNameForPartMatching(needle))
        )
      ) {
        byId.get(r.id)!.push(child);
        placed = true;
        break;
      }
    }
    if (!placed) other.push(child);
  }

  const out: PartGroupBucket[] = [];
  for (const r of rules) {
    const objects = byId.get(r.id)!;
    if (objects.length === 0) continue;
    out.push({
      key: partGroupKeyForName(fileIndex, r.id),
      label:
        objects.length > 1 ? `${r.label} (${objects.length})` : r.label,
      objects,
    });
  }
  if (other.length > 0) {
    out.push({
      key: partGroupKeyForName(fileIndex, OTHER_BUCKET_ID),
      label:
        other.length > 1 ? `Other (${other.length})` : 'Other',
      objects: other,
    });
  }
  return out;
}

/**
 * Uses {@link AssemblyManifest.partVisibilityBuckets} when set; otherwise
 * {@link collectDashNamedPartGroups} (` - ` prefix grouping).
 */
export function collectPartGroupsForSceneRoot(
  sceneRoot: Object3D,
  fileIndex: number,
  manifest: AssemblyManifest | null | undefined
): PartGroupBucket[] {
  const rules = manifest?.partVisibilityBuckets;
  if (Array.isArray(rules) && rules.length > 0) {
    return collectManifestPartGroups(sceneRoot, fileIndex, rules);
  }
  return collectDashNamedPartGroups(sceneRoot, fileIndex);
}

/** @deprecated Use {@link collectDashNamedPartGroups} */
export function collectPartGroupsForRoot(
  sceneRoot: Object3D,
  fileIndex: number
): PartGroupRef[] {
  const objs = listPartGroupObjects(sceneRoot);
  return objs.map((object, childIndex) => ({
    key: partGroupKey(fileIndex, childIndex),
    label: labelForPartGroup(object, childIndex),
    object,
  }));
}

export type AssemblyManifest = {
  schemaVersion?: number;
  composedDocument?: boolean;
  legacyIfaceAssembly?: boolean;
  sourceFile?: string;
  /** Assembly async glTF used `grouping:true` (instance transforms); see onshape-pull-part.mjs. */
  assemblyGltfGrouping?: boolean;
  /**
   * Optional visibility buckets for composed assemblies whose node names do not use `Document - Part` style
   * (e.g. Onshape `occurrence of …`). First matching rule wins per object; see {@link collectManifestPartGroups}.
   * Matching uses {@link normalizeNodeNameForPartMatching} so Three.js `_` sanitization still lines up with rules.
   */
  partVisibilityBuckets?: PartVisibilityBucketRule[];
  notes?: string;
  /** Present when pull script applied scripts/gltf-web-optimize.mjs. */
  glbWebOptimize?: {
    applied?: boolean;
    inputBytes?: number;
    outputBytes?: number;
    simplifyRatio?: number;
    simplifyError?: number;
    simplifyLockBorder?: boolean;
    meshoptLevel?: string;
    extensionsUsed?: string[];
  };
};
