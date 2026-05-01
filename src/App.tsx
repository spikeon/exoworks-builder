import { useCallback, useEffect, useMemo, useState } from 'react';
import { InterfaceAssemblyView, type PartCatalogFile } from './InterfaceAssemblyView';
import { loadTestFolderModels, type TestModelEntry } from './loadTestFolderModels';

// ---------------------------------------------------------------------------
// ExoGuitar character creator – complete-assembly config definitions.
// Each entry maps to a GLB pulled via `npm run onshape:pull:all`.
// ---------------------------------------------------------------------------

type GuitarConfig = {
  id: string;
  label: string;
  /** Substring matched against TestModelEntry.label (the filename stem). */
  fileMatch: string;
  emoji: string;
};

const GUITAR_CONFIGS: GuitarConfig[] = [
  // Face Plates
  { id: 'fp-shredder',  label: 'Shredder',              fileMatch: 'Face Plate - Shredder',          emoji: '🎸' },
  { id: 'fp-shredded',  label: 'Shredded Acoustic',     fileMatch: 'Face Plate - Shredded Acoustic', emoji: '🎸' },
  { id: 'fp-acoustic',  label: 'Acoustic',              fileMatch: 'Face Plate - Acoustic',          emoji: '🎵' },
  { id: 'fp-hss',       label: 'HSS',                   fileMatch: 'Face Plate - HSS',               emoji: '🎸' },
  { id: 'fp-sss',       label: 'SSS',                   fileMatch: 'Face Plate - SSS',               emoji: '🎸' },
  // Bridges
  { id: 'br-nova',      label: 'Nova Bridge',           fileMatch: 'Bridge - Nova',                  emoji: '🔩' },
  { id: 'br-archtop',   label: 'Arch Top Bridge',       fileMatch: 'Bridge - Arch Top',              emoji: '🔩' },
  { id: 'br-rocker',    label: 'Rocker Bridge',         fileMatch: 'Bridge - Rocker',                emoji: '🔩' },
  // Necks
  { id: 'nk-plastic',   label: 'Frets — Plastic',       fileMatch: 'Neck - Frets-Plastic',           emoji: '🎶' },
  { id: 'nk-none',      label: 'Fretless',              fileMatch: 'Neck - Frets-None',              emoji: '🎶' },
  { id: 'nk-square',    label: 'Indicators — Square',   fileMatch: 'Neck - Indicators-Square',       emoji: '🎶' },
  { id: 'nk-diamond',   label: 'Indicators — Diamond',  fileMatch: 'Neck - Indicators-Diamond',      emoji: '🎶' },
  { id: 'nk-teardrop',  label: 'Indicators — Teardrop', fileMatch: 'Neck - Indicators-Teardrop',     emoji: '🎶' },
  { id: 'nk-circle',    label: 'Indicators — Circle',   fileMatch: 'Neck - Indicators-Circle',       emoji: '🎶' },
];

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const S = {
  root: {
    margin: 0,
    width: '100%',
    height: '100%',
    minHeight: 0,
    background: '#0a0a0c',
    display: 'flex',
    flexDirection: 'column' as const,
    boxSizing: 'border-box' as const,
    fontFamily: '"Inter", "Segoe UI", system-ui, sans-serif',
    color: '#e4e4ec',
  },
  header: {
    width: '100%',
    padding: '20px 24px 16px',
    boxSizing: 'border-box' as const,
    borderBottom: '1px solid #1e1e2a',
    background: '#0d0d12',
  },
  title: {
    margin: 0,
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: '-0.3px',
    color: '#f0f0fa',
  },
  subtitle: {
    margin: '4px 0 0',
    fontSize: 13,
    color: '#666',
  },
  body: {
    display: 'flex',
    width: '100%',
    flex: 1,
    minHeight: 0,
  },
  sidebar: {
    width: 240,
    flexShrink: 0,
    background: '#0d0d12',
    borderRight: '1px solid #1e1e2a',
    padding: '16px 12px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
    overflowY: 'auto' as const,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: '#555',
    padding: '4px 8px 6px',
  },
  configBtn: (active: boolean) => ({
    width: '100%',
    padding: '10px 12px',
    border: `1px solid ${active ? '#4a9eff' : '#2a2a38'}`,
    borderRadius: 8,
    background: active ? '#0f2545' : '#141420',
    color: active ? '#8ec5ff' : '#a0a0b8',
    cursor: 'pointer',
    textAlign: 'left' as const,
    fontSize: 14,
    fontWeight: active ? 600 : 400,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    transition: 'all 0.15s ease',
  }),
  configCheck: (active: boolean) => ({
    width: 16,
    height: 16,
    flexShrink: 0,
    borderRadius: 4,
    border: `2px solid ${active ? '#4a9eff' : '#3a3a48'}`,
    background: active ? '#1a5080' : 'transparent',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    color: '#8ec5ff',
    fontWeight: 700,
  }),
  divider: {
    height: 1,
    background: '#1e1e2a',
    margin: '4px 0',
  },
  partGroupBtn: (visible: boolean) => ({
    width: '100%',
    padding: '7px 10px',
    border: `1px solid ${visible ? '#2a3a2a' : '#2a2a38'}`,
    borderRadius: 6,
    background: visible ? '#111a11' : '#141420',
    color: visible ? '#6dba6d' : '#555',
    cursor: 'pointer',
    textAlign: 'left' as const,
    fontSize: 12,
    fontWeight: visible ? 500 : 400,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    transition: 'all 0.15s ease',
  }),
  visibilityDot: (visible: boolean) => ({
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: visible ? '#6dba6d' : '#333',
    flexShrink: 0,
  }),
  viewerArea: {
    flex: 1,
    position: 'relative' as const,
    background: '#0a0a0c',
    minWidth: 0,
    minHeight: 0,
  },
  emptyState: {
    maxWidth: 420,
    padding: 32,
    textAlign: 'center' as const,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: 600,
    color: '#555',
    margin: '0 0 12px',
  },
  emptyText: {
    fontSize: 13,
    color: '#444',
    lineHeight: 1.6,
    margin: '0 0 16px',
  },
  code: {
    background: '#1a1a24',
    border: '1px solid #2a2a38',
    borderRadius: 6,
    padding: '10px 14px',
    fontSize: 12,
    color: '#8a8ab8',
    textAlign: 'left' as const,
    fontFamily: 'monospace',
    display: 'block',
    margin: '0 auto',
  },
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

function usePartVisibility(groups: PartCatalogFile[]) {
  const allKeys = useMemo(
    () => groups.flatMap((f) => f.groups.map((g) => g.key)),
    [groups]
  );
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const visibility = useMemo<Record<string, boolean>>(() => {
    const out: Record<string, boolean> = {};
    for (const k of allKeys) {
      out[k] = overrides[k] !== false; // default visible
    }
    return out;
  }, [allKeys, overrides]);

  const toggle = useCallback((key: string) => {
    setOverrides((prev) => ({ ...prev, [key]: prev[key] === false ? true : false }));
  }, []);

  const reset = useCallback(() => setOverrides({}), []);

  return { visibility, toggle, reset };
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export function App() {
  const allModels = useMemo(() => loadTestFolderModels(), []);

  /** One or more configurations shown in the viewer together. */
  const [selectedConfigIds, setSelectedConfigIds] = useState<Set<string>>(() => {
    const id = GUITAR_CONFIGS[0]?.id;
    return id ? new Set([id]) : new Set();
  });

  // Configs that have a matching loaded model
  const availableConfigs = useMemo(
    () =>
      GUITAR_CONFIGS.filter((cfg) =>
        allModels.some((m) =>
          m.label.toLowerCase().includes(cfg.fileMatch.toLowerCase())
        )
      ),
    [allModels]
  );

  const missingConfigs = GUITAR_CONFIGS.filter(
    (cfg) => !availableConfigs.some((a) => a.id === cfg.id)
  );

  const resolveEntry = useCallback(
    (cfg: GuitarConfig): TestModelEntry | null =>
      allModels.find((m) =>
        m.label.toLowerCase().includes(cfg.fileMatch.toLowerCase())
      ) ?? null,
    [allModels]
  );

  const viewerModels = useMemo(() => {
    const out: {
      url: string;
      label?: string;
      mateSidecar: TestModelEntry['mateSidecar'];
      assemblyManifest: TestModelEntry['assemblyManifest'];
      legacyIfaceAssembly: boolean;
    }[] = [];
    for (const id of selectedConfigIds) {
      const cfg = GUITAR_CONFIGS.find((c) => c.id === id);
      if (!cfg) continue;
      const entry = resolveEntry(cfg);
      if (!entry) continue;
      out.push({
        url: entry.url,
        label: entry.label,
        mateSidecar: entry.mateSidecar,
        assemblyManifest: entry.assemblyManifest,
        legacyIfaceAssembly:
          entry.assemblyManifest?.legacyIfaceAssembly === true ||
          entry.mateSidecar?.legacyIfaceAssembly === true,
      });
    }
    return out;
  }, [selectedConfigIds, resolveEntry]);

  // Part group catalog reported by the viewer
  const [catalog, setCatalog] = useState<PartCatalogFile[]>([]);
  const { visibility, toggle, reset } = usePartVisibility(catalog);

  const toggleConfig = useCallback((id: string) => {
    setSelectedConfigIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setCatalog([]);
  }, []);

  const availableIds = useMemo(
    () => new Set(availableConfigs.map((c) => c.id)),
    [availableConfigs]
  );

  useEffect(() => {
    setSelectedConfigIds((prev) => {
      const kept = [...prev].filter((id) => availableIds.has(id));
      if (
        kept.length === prev.size &&
        kept.every((id) => prev.has(id))
      ) {
        return prev;
      }
      return new Set(kept);
    });
  }, [availableIds]);

  // Flatten part groups for UI (keys stay unique per file: f0-n:…, f1-n:…)
  const allGroups = useMemo(
    () => catalog.flatMap((f) => f.groups),
    [catalog]
  );

  return (
    <div style={S.root}>
      {/* Header */}
      <div style={S.header}>
        <h1 style={S.title}>⚙️ ExoGuitar Builder</h1>
        <p style={S.subtitle}>
          Select one or more configurations to preview together (each loads its full assembly GLB)
        </p>
      </div>

      <div style={S.body}>
        {/* Sidebar */}
        <div style={S.sidebar}>
          <div style={S.sectionLabel}>Configurations</div>

          {availableConfigs.length === 0 && (
            <div style={{ color: '#555', fontSize: 12, padding: '4px 8px' }}>
              No models loaded yet — see setup below.
            </div>
          )}

          {availableConfigs.map((cfg) => {
            const on = selectedConfigIds.has(cfg.id);
            return (
              <button
                key={cfg.id}
                type="button"
                style={S.configBtn(on)}
                onClick={() => toggleConfig(cfg.id)}
              >
                <span style={S.configCheck(on)} aria-hidden>
                  {on ? '✓' : ''}
                </span>
                <span style={{ fontSize: 16 }}>{cfg.emoji}</span>
                {cfg.label}
              </button>
            );
          })}

          {missingConfigs.length > 0 && (
            <>
              <div style={S.sectionLabel}>Not yet pulled</div>
              {missingConfigs.map((cfg) => (
                <div
                  key={cfg.id}
                  style={{
                    ...S.configBtn(false),
                    cursor: 'default',
                    opacity: 0.4,
                  }}
                >
                  <span style={{ fontSize: 16 }}>{cfg.emoji}</span>
                  {cfg.label}
                </div>
              ))}
            </>
          )}

          {allGroups.length > 0 && (
            <>
              <div style={S.divider} />
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '4px 8px 4px',
                }}
              >
                <span style={S.sectionLabel}>Parts</span>
                <button
                  type="button"
                  onClick={reset}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#444',
                    cursor: 'pointer',
                    fontSize: 11,
                    padding: '2px 4px',
                  }}
                >
                  Show all
                </button>
              </div>
              {allGroups.map((g) => {
                const vis = visibility[g.key] !== false;
                return (
                  <button
                    key={g.key}
                    type="button"
                    style={S.partGroupBtn(vis)}
                    onClick={() => toggle(g.key)}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {g.label}
                    </span>
                    <div style={S.visibilityDot(vis)} />
                  </button>
                );
              })}
            </>
          )}
        </div>

        {/* 3D Viewer area */}
        <div style={S.viewerArea}>
          {viewerModels.length > 0 ? (
            <InterfaceAssemblyView
              models={viewerModels}
              partVisibility={visibility}
              onPartCatalogChange={setCatalog}
              className="character-creator-viewer"
              style={{ width: '100%', height: '100%' }}
            />
          ) : availableConfigs.length > 0 ? (
            <div
              style={{
                ...S.emptyState,
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%,-50%)',
              }}
            >
              <h2 style={S.emptyTitle}>No configuration selected</h2>
              <p style={S.emptyText}>
                Turn on one or more items under <strong>Configurations</strong> in the sidebar to show
                their assemblies in the viewer.
              </p>
            </div>
          ) : (
            <div style={{ ...S.emptyState, position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }}>
              <h2 style={S.emptyTitle}>No models loaded</h2>
              <p style={S.emptyText}>
                Pull guitar assemblies from OnShape to start exploring. Run these commands
                from the <code>exoworks-builder</code> directory:
              </p>
              <pre style={S.code}>{`# Set your OnShape API keys once:
export ONSHAPE_ACCESS_KEY="your_key"
export ONSHAPE_SECRET_KEY="your_secret"

# Pull all configured assemblies:
npm run onshape:pull:all

# Or pull a single assembly by URL:
npm run onshape:pull -- \\
  "https://cad.onshape.com/documents/..." \\
  --composed \\
  --file="ExoGuitar - Warlock.glb"`}</pre>
              <p style={{ ...S.emptyText, marginTop: 16 }}>
                See <code>onshape-sources.json</code> for the list of configured assemblies.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
