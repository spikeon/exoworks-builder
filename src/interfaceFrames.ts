import {
  Matrix4,
  Object3D,
  Scene,
  Vector3,
  type Group,
} from 'three';

/** Object names must match `iface_<suffix>` (e.g. `iface_neck_top` on both mating parts). */
const IFACE_NAME = /^iface_.+/i;

export type InterfaceNode = {
  object: Object3D;
  /** Full object name, e.g. `iface_neck_top`. */
  ifaceName: string;
};

export function parseInterfaceName(name: string): string | null {
  if (!IFACE_NAME.test(name)) return null;
  return name;
}

/** Collect interface frames: any descendant whose name starts with `iface_`. */
export function collectInterfaceNodes(root: Object3D): InterfaceNode[] {
  const out: InterfaceNode[] = [];
  root.traverse((obj) => {
    const ifaceName = parseInterfaceName(obj.name);
    if (ifaceName) {
      out.push({ object: obj, ifaceName });
    }
  });
  return out;
}

/** Shape of `<name>.mate-connectors.json` from Onshape pull / MCP export. */
export type MateConnectorsSidecar = {
  /** Opt in to multi-file `iface_*` alignment in the viewer (default is composed-document mode). */
  legacyIfaceAssembly?: boolean;
  mateConnectors?: Record<
    string,
    {
      originMeters: number[];
      xAxis: number[];
      yAxis: number[];
      zAxis: number[];
    }
  >;
};

/**
 * Onshape glTF exports usually omit empty mate-connector bodies, so there are no `iface_*`
 * nodes in the scene. This adds Object3D frames from sidecar JSON (Part Studio world, meters)
 * so {@link assembleModelsByInterfaces} can align parts.
 */
export function injectIfaceNodesFromSidecar(
  root: Object3D,
  sidecar: MateConnectorsSidecar | null | undefined
): void {
  if (!sidecar?.mateConnectors) return;

  const existing = new Set(
    collectInterfaceNodes(root).map((n) => n.ifaceName.toLowerCase())
  );

  for (const [ifaceName, data] of Object.entries(sidecar.mateConnectors)) {
    if (!/^iface_/i.test(ifaceName)) continue;
    if (existing.has(ifaceName.toLowerCase())) continue;
    if (
      !data?.originMeters ||
      !data.xAxis ||
      !data.yAxis ||
      !data.zAxis ||
      data.originMeters.length < 3
    ) {
      continue;
    }

    const o = new Object3D();
    o.name = ifaceName;
    const x = new Vector3(data.xAxis[0], data.xAxis[1], data.xAxis[2]);
    const y = new Vector3(data.yAxis[0], data.yAxis[1], data.yAxis[2]);
    const z = new Vector3(data.zAxis[0], data.zAxis[1], data.zAxis[2]);
    const p = new Vector3(
      data.originMeters[0],
      data.originMeters[1],
      data.originMeters[2]
    );
    const m = new Matrix4().makeBasis(x, y, z);
    m.setPosition(p);
    o.matrix.copy(m);
    o.matrixAutoUpdate = false;
    root.add(o);
  }
}

type InterfaceIndex = Map<string, Object3D>;

function indexInterfaces(nodes: InterfaceNode[]): InterfaceIndex {
  const map: InterfaceIndex = new Map();
  for (const n of nodes) {
    map.set(n.ifaceName, n.object);
  }
  return map;
}

/** World matrix of `moving` matches world matrix of `fixed`; only `movingRoot` is adjusted. */
export function alignMovingRootToFixedFrame(
  fixed: Object3D,
  moving: Object3D,
  movingRoot: Object3D,
  rootScene: Scene
): void {
  rootScene.updateMatrixWorld(true);

  const rootWorld = new Matrix4().copy(movingRoot.matrixWorld);
  const movingWorld = new Matrix4().copy(moving.matrixWorld);
  const fixedWorld = new Matrix4().copy(fixed.matrixWorld);

  const movingInRoot = new Matrix4().multiplyMatrices(
    new Matrix4().copy(rootWorld).invert(),
    movingWorld
  );
  const newRootWorld = new Matrix4().multiplyMatrices(
    fixedWorld,
    new Matrix4().copy(movingInRoot).invert()
  );

  const parent = movingRoot.parent;
  if (!parent) {
    movingRoot.matrix.copy(newRootWorld);
    movingRoot.matrixWorld.copy(newRootWorld);
    return;
  }

  parent.updateMatrixWorld(true);
  const parentWorldInv = new Matrix4().copy(parent.matrixWorld).invert();
  const newLocal = new Matrix4().multiplyMatrices(parentWorldInv, newRootWorld);
  movingRoot.matrix.copy(newLocal);
  movingRoot.matrixWorldNeedsUpdate = true;
}

export type PlacedModel = {
  root: Group;
  interfaces: InterfaceIndex;
};

/**
 * Place roots so objects with the same `iface_*` name coincide (e.g. both parts use
 * `iface_neck_top`). First model stays at its current transform; others snap to the assembly.
 */
export function assembleModelsByInterfaces(
  roots: Group[],
  scene: Scene
): void {
  if (roots.length === 0) return;

  const indices = roots.map((r) => indexInterfaces(collectInterfaceNodes(r)));
  const placed = new Set<number>([0]);

  let progress = true;
  while (progress && placed.size < roots.length) {
    progress = false;
    for (let i = 0; i < roots.length; i++) {
      if (placed.has(i)) continue;
      const idxB = indices[i]!;

      for (const j of placed) {
        const idxA = indices[j]!;
        let matched = false;

        for (const [ifaceName, frameB] of idxB) {
          const frameA = idxA.get(ifaceName);
          if (!frameA) continue;

          alignMovingRootToFixedFrame(frameA, frameB, roots[i]!, scene);
          matched = true;
          break;
        }

        if (matched) {
          scene.updateMatrixWorld(true);
          placed.add(i);
          progress = true;
          break;
        }
      }
    }
  }
}
