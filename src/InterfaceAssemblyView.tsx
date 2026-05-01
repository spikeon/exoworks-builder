import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import {
  Suspense,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type React from 'react';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder as MeshoptDecoderFactory } from 'three-stdlib';
import {
  Box3,
  Group,
  MOUSE,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import type { OrbitControls as OrbitControlsHandle } from 'three-stdlib';
import {
  collectPartGroupsForSceneRoot,
  is2020NodeName,
  type AssemblyManifest,
} from './assemblyPartGroups';
import {
  assembleModelsByInterfaces,
  injectIfaceNodesFromSidecar,
  type MateConnectorsSidecar,
} from './interfaceFrames';
import { encodeModelUrlForFetch } from './modelUrl';

function visibleInAncestors(o: Object3D): boolean {
  let x: Object3D | null = o;
  while (x) {
    if (!x.visible) return false;
    x = x.parent;
  }
  return true;
}

function expandBoxByVisibleMeshes(box: Box3, root: Object3D) {
  root.traverse((o) => {
    if (!visibleInAncestors(o)) return;
    if (o.type === 'Mesh' || o.type === 'SkinnedMesh') {
      box.expandByObject(o, true);
    } else if (o.type === 'InstancedMesh') {
      box.expandByObject(o, false);
    }
  });
}

/**
 * Three-quarter “CAD isometric”: above and to the side, not top-down on the XZ plane.
 * Azimuth orbits from +Z toward +X; elevation is angle above horizontal (Y-up world).
 */
function isoViewDirection(): Vector3 {
  const azDeg = 44;
  const elDeg = 28;
  const az = (azDeg * Math.PI) / 180;
  const el = (elDeg * Math.PI) / 180;
  return new Vector3(
    Math.cos(el) * Math.sin(az),
    Math.sin(el),
    Math.cos(el) * Math.cos(az)
  ).normalize();
}

const ISO_DIRECTION = isoViewDirection();

const HALF_TURN = Math.PI / 2;
const ZOOM_STEP = 1.2;

/**
 * Onshape glTF needs a fixed tilt so the body **front** faces the default camera.
 * Baseline export framing used +270° about X; a **90° step** from that (not a full 180° flip to +90°)
 * lands at **180°** about X.
 */
const MODEL_PRESENTATION_QUATERNION = new Quaternion().setFromAxisAngle(
  new Vector3(1, 0, 0),
  2 * HALF_TURN
);

/** Match previous default framing: ~two “zoom-in” steps from neutral fit. */
const INITIAL_ZOOM_MULT = ZOOM_STEP ** 2;

/**
 * Frame the assembly from the CAD isometric diagonal; sync OrbitControls target & limits.
 * Re-runs when the model’s bounding sphere changes (new asset / visibility).
 */
function FitOrbitCamera({
  boundingRadius,
  controlsRef,
  fitKey,
}: {
  boundingRadius: number;
  controlsRef: React.RefObject<OrbitControlsHandle | null>;
  /** New key → full isometric reset; same key + new radius → keep orbit, adjust distance. */
  fitKey: string;
}) {
  const { camera, size } = useThree((s) => ({ camera: s.camera, size: s.size }));
  const lastFitKeyRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    const apply = () => {
      if (!(camera instanceof PerspectiveCamera) || boundingRadius <= 0) return;
      const controls = controlsRef.current;
      const vFovRad = (camera.fov * Math.PI) / 180;
      const aspect = Math.max(camera.aspect, 0.01);
      const portrait = aspect < 1;
      const padding = portrait ? 1.06 : 1.12;
      const hFovRad = 2 * Math.atan(Math.tan(vFovRad / 2) * aspect);
      const distV = (boundingRadius * padding) / Math.tan(vFovRad / 2);
      const distH = (boundingRadius * padding) / Math.tan(hFovRad / 2);
      const baseDist = portrait ? distV : Math.max(distV, distH);
      const dist = baseDist / INITIAL_ZOOM_MULT;

      const fullReset = lastFitKeyRef.current !== fitKey;
      lastFitKeyRef.current = fitKey;

      if (fullReset || !controls) {
        camera.position.set(
          ISO_DIRECTION.x * dist,
          ISO_DIRECTION.y * dist,
          ISO_DIRECTION.z * dist
        );
        camera.up.set(0, 1, 0);
        camera.lookAt(0, 0, 0);
        if (controls) {
          controls.target.set(0, 0, 0);
        }
      } else {
        const t = controls.target;
        const offset = camera.position.clone().sub(t);
        const len = offset.length();
        if (len > 1e-8) {
          offset.multiplyScalar(dist / len);
          camera.position.copy(t).add(offset);
        } else {
          camera.position.set(
            ISO_DIRECTION.x * dist,
            ISO_DIRECTION.y * dist,
            ISO_DIRECTION.z * dist
          );
          camera.lookAt(t);
        }
        camera.up.set(0, 1, 0);
      }

      camera.near = Math.max(dist * 1e-4, 0.001);
      camera.far = Math.max(dist * 50, 100);
      camera.updateProjectionMatrix();
      if (controls) {
        controls.minDistance = Math.max(dist * 0.02, 1e-4);
        controls.maxDistance = Math.max(dist * 80, 1);
        controls.update();
      }
    };
    apply();
    queueMicrotask(apply);
  }, [camera, boundingRadius, fitKey, size.width, size.height]);

  return null;
}

export type PartCatalogFile = {
  fileIndex: number;
  fileLabel: string;
  groups: { key: string; label: string }[];
};

export type AssemblyModelInput = {
  url: string;
  label?: string;
  mateSidecar?: MateConnectorsSidecar | null;
  assemblyManifest?: AssemblyManifest | null;
  /**
   * Multi-file `iface_*` alignment (inject sidecar frames + snap roots). Default false:
   * composed document uses Onshape transforms; toggle visibility by part group (scene children).
   */
  legacyIfaceAssembly?: boolean;
};

export type InterfaceAssemblyViewProps = {
  models: AssemblyModelInput[];
  /** Part groups (`f0-n:encodedName`, …). Omitted keys default to visible. */
  partVisibility?: Record<string, boolean>;
  onPartCatalogChange?: (files: PartCatalogFile[]) => void;
  className?: string;
  /** Override the container style (e.g. explicit width/height when embedding). */
  style?: React.CSSProperties;
};

/** Stable fallback — `partVisibility ?? {}` would be a new object every render and retrigger fit/recenter. */
const EMPTY_PART_VISIBILITY: Record<string, boolean> = Object.freeze({});

/**
 * Procedural 2020 extrusion replacement is disabled — only hide matching nodes (and strip any
 * stale replacement meshes from older runs).
 */
function hide2020ExtrusionNodes(roots: Group[]): void {
  for (const root of roots) {
    const stale: Object3D[] = [];
    root.traverse((o) => {
      if (o.userData.is2020Replacement) stale.push(o);
    });
    stale.forEach((o) => o.parent?.remove(o));

    root.traverse((node) => {
      if (is2020NodeName(node.name)) node.visible = false;
    });
  }
}

function useLegacyIfaceAssembly(models: AssemblyModelInput[]): boolean {
  return useMemo(
    () =>
      models.some(
        (m) =>
          m.legacyIfaceAssembly === true ||
          m.assemblyManifest?.legacyIfaceAssembly === true
      ),
    [models]
  );
}

function AssemblyContent({
  models,
  partVisibility = {},
  onPartCatalogChange,
  controlsRef,
}: {
  models: AssemblyModelInput[];
  partVisibility: Record<string, boolean>;
  onPartCatalogChange?: (files: PartCatalogFile[]) => void;
  controlsRef: React.RefObject<OrbitControlsHandle | null>;
}) {
  /**
   * Parent often passes a new `models` array each render; `useLoader` keys must stay stable
   * or suspend-react treats every frame as a cache miss → endless fetch() (see Network tab).
   */
  const modelUrlKey = models.map((m) => m.url).join('\u0001');
  const encodedUrls = useMemo(
    () => models.map((m) => encodeModelUrlForFetch(m.url)),
    [modelUrlKey]
  );

  const meshoptExtension = useCallback((loader: GLTFLoader) => {
    const meshoptDecoder =
      typeof MeshoptDecoderFactory === 'function'
        ? MeshoptDecoderFactory()
        : MeshoptDecoderFactory;
    loader.setMeshoptDecoder(meshoptDecoder);
  }, []);

  const gltfs = useLoader(GLTFLoader, encodedUrls, meshoptExtension);
  const outerRef = useRef<Group>(null);
  const recenterRef = useRef<Group>(null);
  const { scene } = useThree();
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const onCatalogRef = useRef(onPartCatalogChange);
  onCatalogRef.current = onPartCatalogChange;

  const legacyIface = useLegacyIfaceAssembly(models);
  const catalogSig = useRef('');
  const [boundingRadius, setBoundingRadius] = useState(0);
  /** R3F can reset `Object3D.visible` after our layout effect; re-apply each frame (cheap). */
  const flatPartVisibilityTargetsRef = useRef<{ key: string; objects: Object3D[] }[]>(
    []
  );
  const partVisibilityRef = useRef(partVisibility);
  partVisibilityRef.current = partVisibility;

  const fileLabels = useMemo(
    () =>
      models.map(
        (m, i) => m.label?.trim() || `Model ${i + 1}`
      ),
    [modelUrlKey]
  );

  const roots = useMemo(
    () =>
      gltfs.map((gltf, i) => {
        const root = gltf.scene.clone(true) as Group;
        root.traverse((o) => {
          o.frustumCulled = false;
        });
        if (legacyIface) {
          injectIfaceNodesFromSidecar(root, models[i]?.mateSidecar);
        }
        return root;
      }),
    [gltfs, models, legacyIface]
  );

  useLayoutEffect(() => {
    const outer = outerRef.current;
    if (!outer) {
      flatPartVisibilityTargetsRef.current = [];
      return;
    }

    if (legacyIface) {
      assembleModelsByInterfaces(roots, sceneRef.current as Scene);
    }

    hide2020ExtrusionNodes(roots);

    const flat: { key: string; objects: Object3D[] }[] = [];
    const summary: PartCatalogFile[] = [];
    for (let fi = 0; fi < roots.length; fi++) {
      const groups = collectPartGroupsForSceneRoot(
        roots[fi]!,
        fi,
        models[fi]?.assemblyManifest
      );
      for (const g of groups) {
        flat.push({ key: g.key, objects: g.objects });
        const vis = partVisibility[g.key] !== false;
        for (const obj of g.objects) {
          obj.visible = vis;
        }
      }
      summary.push({
        fileIndex: fi,
        fileLabel: fileLabels[fi] ?? `Model ${fi + 1}`,
        groups: groups.map(({ key, label }) => ({ key, label })),
      });
    }
    flatPartVisibilityTargetsRef.current = flat;
    const sig = JSON.stringify(summary);
    if (sig !== catalogSig.current) {
      catalogSig.current = sig;
      onCatalogRef.current?.(summary);
    }

    const box = new Box3();
    for (const r of roots) {
      expandBoxByVisibleMeshes(box, r);
    }
    if (box.isEmpty()) {
      for (const r of roots) {
        box.expandByObject(r);
      }
    }
    const center = new Vector3();
    const size = new Vector3();
    box.getCenter(center);
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z, 1e-6);
    const scale = 1.8 / maxDim;
    outer.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
    outer.scale.setScalar(scale);
  }, [roots, legacyIface, partVisibility, fileLabels, models]);

  useFrame(() => {
    const pv = partVisibilityRef.current;
    for (const { key, objects } of flatPartVisibilityTargetsRef.current) {
      const vis = pv[key] !== false;
      for (const obj of objects) {
        obj.visible = vis;
      }
    }
  });

  /**
   * Snap the world-axis-aligned bounding box center to the origin after rotation or fit changes.
   * Fit uses mesh world boxes that can disagree slightly with rigid R·T·S math; recentring removes
   * drift so the assembly stays framed on lookAt(0,0,0).
   */
  useLayoutEffect(() => {
    const g = recenterRef.current;
    if (!g) return;
    g.position.set(0, 0, 0);
    g.updateMatrixWorld(true);
    const wbox = new Box3().setFromObject(g);
    if (wbox.isEmpty()) {
      setBoundingRadius(0.5);
      return;
    }
    const wc = new Vector3();
    const wsize = new Vector3();
    wbox.getCenter(wc);
    wbox.getSize(wsize);
    g.position.set(-wc.x, -wc.y, -wc.z);
    /** Oriented world AABB; camera distance uses this sphere radius. */
    const R =
      0.5 *
      Math.sqrt(
        wsize.x * wsize.x + wsize.y * wsize.y + wsize.z * wsize.z
      );
    setBoundingRadius(R > 1e-8 ? R : 0.5);
  }, [roots, legacyIface, partVisibility, fileLabels, models]);

  /**
   * Rotation is handled by OrbitControls (camera). Here: recenter mesh only when geometry/visibility changes.
   */
  return (
    <>
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minPolarAngle={0.08}
        maxPolarAngle={Math.PI - 0.08}
        zoomSpeed={1.1}
        rotateSpeed={0.65}
        panSpeed={0.65}
        screenSpacePanning
        target={[0, 0, 0]}
        mouseButtons={{
          LEFT: MOUSE.PAN,
          RIGHT: MOUSE.ROTATE,
          MIDDLE: MOUSE.DOLLY,
        }}
      />
      <FitOrbitCamera
        boundingRadius={boundingRadius}
        controlsRef={controlsRef}
        fitKey={modelUrlKey}
      />
      <group ref={recenterRef}>
        <group quaternion={MODEL_PRESENTATION_QUATERNION}>
          <group ref={outerRef}>
            {roots.map((r, i) => (
              <primitive key={i} object={r} />
            ))}
          </group>
        </group>
      </group>
    </>
  );
}

/**
 * Loads glTF scenes. **Composed document (default):** direct scene children group by the text **before**
 * the first ` - ` (with `_` expanded from GLTFLoader names). Optional `partVisibilityBuckets` in the
 * manifest overrides with substring rules. No `iface_*` snapping unless legacy.
 */
const controlBtn: CSSProperties = {
  width: 32,
  height: 32,
  padding: 0,
  fontSize: 15,
  lineHeight: 1,
  border: '1px solid #3a3a48',
  borderRadius: 6,
  background: '#1c1c24',
  color: '#e4e4ec',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

export function InterfaceAssemblyView({
  models,
  partVisibility,
  onPartCatalogChange,
  className,
  style,
}: InterfaceAssemblyViewProps) {
  const controlsRef = useRef<OrbitControlsHandle | null>(null);

  const rotateWorldY = useCallback((sign: number) => {
    const c = controlsRef.current;
    if (!c) return;
    c.setAzimuthalAngle(c.getAzimuthalAngle() + sign * HALF_TURN);
    c.update();
  }, []);

  const rotateWorldX = useCallback((sign: number) => {
    const c = controlsRef.current;
    if (!c) return;
    const lo = c.minPolarAngle + 0.02;
    const hi = c.maxPolarAngle - 0.02;
    const next = Math.min(
      Math.max(c.getPolarAngle() + sign * HALF_TURN, lo),
      hi
    );
    c.setPolarAngle(next);
    c.update();
  }, []);

  const zoomIn = useCallback(() => {
    const c = controlsRef.current;
    if (!c) return;
    c.dollyIn();
    c.update();
  }, []);
  const zoomOut = useCallback(() => {
    const c = controlsRef.current;
    if (!c) return;
    c.dollyOut();
    c.update();
  }, []);

  const hasModels = models.length > 0;
  const resolvedPartVisibility = partVisibility ?? EMPTY_PART_VISIBILITY;

  return (
    <div
      className={className}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        touchAction: 'none',
        overflow: 'hidden',
        ...style,
      }}
    >
      <Canvas
        style={{ width: '100%', height: '100%', display: 'block' }}
        camera={{ position: [1, 1, 1], fov: 45 }}
        gl={{ alpha: false }}
      >
        <color attach="background" args={['#0e0e12']} />
        <hemisphereLight args={['#8a8a9a', '#1a1a22', 0.65]} />
        <ambientLight intensity={0.45} />
        <directionalLight position={[4, 6, 3]} intensity={1.15} castShadow={false} />
        <directionalLight position={[-3, 2, -2]} intensity={0.35} />
        {hasModels && (
          <Suspense fallback={null}>
            <AssemblyContent
              models={models}
              partVisibility={resolvedPartVisibility}
              onPartCatalogChange={onPartCatalogChange}
              controlsRef={controlsRef}
            />
          </Suspense>
        )}
      </Canvas>
      {hasModels && (
        <div
          style={{
            position: 'absolute',
            right: 8,
            bottom: 8,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
            userSelect: 'none',
            pointerEvents: 'auto',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 32px)',
              gridTemplateRows: 'repeat(3, 32px)',
              gap: 4,
              alignItems: 'center',
              justifyItems: 'center',
            }}
          >
            <span />
            <button
              type="button"
              aria-label="Rotate up 90 degrees"
              style={{ ...controlBtn, gridColumn: 2, gridRow: 1 }}
              onClick={() => rotateWorldX(-1)}
            >
              ↑
            </button>
            <span />
            <button
              type="button"
              aria-label="Rotate left 90 degrees"
              style={{ ...controlBtn, gridColumn: 1, gridRow: 2 }}
              onClick={() => rotateWorldY(-1)}
            >
              ←
            </button>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: '#4a4a58',
                gridColumn: 2,
                gridRow: 2,
              }}
            />
            <button
              type="button"
              aria-label="Rotate right 90 degrees"
              style={{ ...controlBtn, gridColumn: 3, gridRow: 2 }}
              onClick={() => rotateWorldY(1)}
            >
              →
            </button>
            <span />
            <button
              type="button"
              aria-label="Rotate down 90 degrees"
              style={{ ...controlBtn, gridColumn: 2, gridRow: 3 }}
              onClick={() => rotateWorldX(1)}
            >
              ↓
            </button>
            <span />
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              aria-label="Zoom out"
              style={controlBtn}
              onClick={zoomOut}
            >
              −
            </button>
            <button
              type="button"
              aria-label="Zoom in"
              style={controlBtn}
              onClick={zoomIn}
            >
              +
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
