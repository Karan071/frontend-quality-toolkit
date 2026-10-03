import { useEffect, useMemo, useRef, useState } from 'react';
import { CATEGORY_LABELS, DEVICE_PRESETS, aspectLabel, orientPreset, physicalSize } from '@ftk/responsive-analyzer';
import type { DeviceCategory, DevicePreset } from '@ftk/responsive-analyzer';
import { Icon } from '../sidepanel/components/icons';
import { applyNetworkRules, clearNetworkRules, userAgentFor } from './network';

type Filter = DeviceCategory | 'apple';
type Zoom = 'fit' | number;

const CATEGORIES = Object.keys(CATEGORY_LABELS) as DeviceCategory[];
const ZOOM_STEPS = [0.1, 0.15, 0.2, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2];
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 2;
const CANVAS_PAD = 28;
const STORAGE_KEY = 'ftk:simulator';

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const pct = (n: number) => `${Math.round(n * 100)}%`;

// ───────────────────────────── persistence ─────────────────────────────

type Saved = { device?: string; landscape?: boolean; zoom?: Zoom; framed?: boolean };

function loadSaved(): Saved {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Saved;
  } catch {
    return {};
  }
}

function save(next: Saved) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
}

// ───────────────────────────── geometry ─────────────────────────────

/** How the physical device is drawn around the viewport, all in CSS px before zooming. */
function frameMetrics(p: DevicePreset, framed: boolean) {
  const cat = p.category;
  const longest = Math.max(p.width, p.height);
  const bezel = !framed ? 0 : cat === 'phone' ? 14 : cat === 'tablet' ? 22 : clamp(Math.round(longest * 0.012), 10, 36);
  const bodyRadius = !framed ? 0 : cat === 'phone' ? 50 : cat === 'tablet' ? 32 : cat === 'laptop' ? 18 : 12;
  const screenRadius = !framed ? 0 : cat === 'phone' ? 36 : cat === 'tablet' ? 14 : 4;
  const stand = !framed ? 0 : cat === 'laptop' ? 20 : cat === 'desktop' || cat === 'ultrawide' || cat === 'tv' ? clamp(Math.round(p.height * 0.1), 40, 220) : 0;
  const padX = framed && cat === 'laptop' ? Math.round(p.width * 0.04) : 0;
  const bodyW = p.width + bezel * 2;
  const bodyH = p.height + bezel * 2;
  return { bezel, bodyRadius, screenRadius, stand, padX, bodyW, bodyH, totalW: bodyW + padX * 2, totalH: bodyH + stand };
}

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

// ───────────────────────────── url helpers ─────────────────────────────

function normalizeUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    const u = new URL(/^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

const searchText = (p: DevicePreset) =>
  `${p.label} ${p.brand ?? ''} ${p.note ?? ''} ${p.inches ?? ''}″ ${p.width}x${p.height} ${p.width} ${p.height} ${CATEGORY_LABELS[p.category]}`.toLowerCase();

// ───────────────────────────── device picker ─────────────────────────────

function DevicePicker({ activeId, landscape, onPick }: { activeId: string; landscape: boolean; onPick: (id: string) => void }) {
  const [filter, setFilter] = useState<Filter>(() => DEVICE_PRESETS.find((p) => p.id === activeId)?.category ?? 'phone');
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const inFilter = (p: DevicePreset, f: Filter) => (f === 'apple' ? p.brand === 'Apple' : p.category === f);
  const list = DEVICE_PRESETS.filter((p) => (q ? searchText(p).includes(q) : inFilter(p, filter)));

  return (
    <>
      <input
        type="search"
        className="search"
        placeholder="Search devices: iPhone, iPad, 49, TV, 1920…"
        aria-label="Search devices"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {!q && (
        <div className="chips" role="group" aria-label="Device category">
          {[...CATEGORIES, 'apple' as const].map((c) => (
            <button key={c} type="button" className="chip-btn" aria-pressed={filter === c} onClick={() => setFilter(c)}>
              {c === 'apple' ? 'Apple' : CATEGORY_LABELS[c]}
              <span className="chip-n">{DEVICE_PRESETS.filter((p) => inFilter(p, c)).length}</span>
            </button>
          ))}
        </div>
      )}
      <div className="list device-grid">
        {list.map((p) => {
          const shown = orientPreset(p, landscape);
          return (
            <button key={p.id} type="button" className="list-item device-card" aria-pressed={p.id === activeId} onClick={() => onPick(p.id)}>
              <div className="grow">
                <strong className="device-name">{p.label}</strong>
                <div className="small device-size">
                  {shown.width} × {shown.height}
                  {p.dpr > 1 ? ` @${p.dpr}×` : ''}
                </div>
                <div className="muted small device-meta">{[p.inches ? `${p.inches}″` : '', p.note ?? ''].filter(Boolean).join(' · ') || aspectLabel(p.width, p.height)}</div>
              </div>
            </button>
          );
        })}
        {list.length === 0 && <div className="list-item muted device-empty">No device matches “{query}”.</div>}
      </div>
    </>
  );
}

// ───────────────────────────── simulator ─────────────────────────────

export function Simulator() {
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const saved = useMemo(loadSaved, []);
  const initialUrl = normalizeUrl(params.get('url') ?? '') ?? '';

  const [address, setAddress] = useState(initialUrl);
  const [url, setUrl] = useState(initialUrl);
  const [deviceId, setDeviceId] = useState(() => {
    const wanted = params.get('device') ?? saved.device;
    return DEVICE_PRESETS.some((p) => p.id === wanted) ? (wanted as string) : 'iphone-15';
  });
  const [landscape, setLandscape] = useState(params.has('device') ? params.get('landscape') === '1' : !!saved.landscape);
  const [zoom, setZoom] = useState<Zoom>(saved.zoom ?? 'fit');
  const [framed, setFramed] = useState(saved.framed ?? true);
  const [side, setSide] = useState(() => innerWidth >= 900);
  const [net, setNet] = useState<{ ready: boolean; error?: string }>({ ready: false });
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [canvasRef, canvasSize] = useElementSize<HTMLDivElement>();

  const base = DEVICE_PRESETS.find((p) => p.id === deviceId) ?? DEVICE_PRESETS[0];
  const device = useMemo(() => orientPreset(base, landscape), [base, landscape]);
  const m = frameMetrics(device, framed);
  const phys = physicalSize(device);

  const availW = Math.max(120, canvasSize.width - CANVAS_PAD * 2);
  const availH = Math.max(120, canvasSize.height - CANVAS_PAD * 2);
  const fitScale = clamp(Math.min(availW / m.totalW, availH / m.totalH, 1), MIN_ZOOM, 1);
  const scale = zoom === 'fit' ? fitScale : clamp(zoom, MIN_ZOOM, MAX_ZOOM);

  useEffect(() => save({ device: deviceId, landscape, zoom, framed }), [deviceId, landscape, zoom, framed]);
  useEffect(() => {
    document.title = `${device.label} · Device Emulator`;
  }, [device.label]);

  // Header and User-Agent rules. The iframe only mounts once they are in place, and reloads when the UA changes.
  const ua = userAgentFor(device);
  const appliedUa = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void applyNetworkRules(device).then((r) => {
      if (!live) return;
      setNet({ ready: true, error: r.ok ? undefined : r.error });
      if (appliedUa.current !== undefined && appliedUa.current !== ua) setReloadKey((k) => k + 1);
      appliedUa.current = ua;
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ua]);
  useEffect(() => {
    const cleanup = () => void clearNetworkRules();
    addEventListener('pagehide', cleanup);
    return () => removeEventListener('pagehide', cleanup);
  }, []);

  // Ctrl/Cmd + wheel (and trackpad pinch) zooms the preview instead of the whole page.
  const current = useRef(scale);
  current.current = scale;
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom(clamp(current.current * (e.deltaY < 0 ? 1.08 : 1 / 1.08), MIN_ZOOM, MAX_ZOOM));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [canvasRef]);

  const close = async () => {
    try {
      const me = await chrome.tabs.getCurrent();
      if (me?.openerTabId != null) await chrome.tabs.update(me.openerTabId, { active: true }).catch(() => undefined);
      if (me?.id != null) await chrome.tabs.remove(me.id);
      else window.close();
    } catch {
      window.close();
    }
  };

  const stepZoom = (dir: 1 | -1) => {
    const next = dir > 0 ? ZOOM_STEPS.find((s) => s > scale + 0.005) : [...ZOOM_STEPS].reverse().find((s) => s < scale - 0.005);
    setZoom(next ?? (dir > 0 ? MAX_ZOOM : MIN_ZOOM));
  };

  const go = () => {
    const next = normalizeUrl(address);
    if (!next) return;
    setAddress(next);
    if (next === url) setReloadKey((k) => k + 1);
    else setUrl(next);
    setLoading(true);
  };

  useEffect(() => {
    if (url) setLoading(true);
  }, [url, reloadKey]);

  const zoomValue = zoom === 'fit' ? 'fit' : ZOOM_STEPS.includes(zoom) ? String(zoom) : 'custom';

  return (
    <div className="sim">
      <form
        className="sim-top"
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
      >
        <button type="button" className="btn small iconbtn" aria-label={side ? 'Hide device list' : 'Show device list'} aria-pressed={side} title="Device list" onClick={() => setSide((s) => !s)}>
          <Icon name="phone" />
        </button>
        <span className="sim-brand">Device Emulator</span>
        <input type="text" className="sim-address" aria-label="Page address" placeholder="https://example.com" value={address} onChange={(e) => setAddress(e.target.value)} spellCheck={false} />
        <button type="submit" className="btn small primary" disabled={!normalizeUrl(address)}>
          Go
        </button>
        <button type="button" className="btn small iconbtn" aria-label="Reload" title="Reload" disabled={!url} onClick={() => setReloadKey((k) => k + 1)}>
          <Icon name="refresh" />
        </button>
        {url && (
          <a className="btn small iconbtn" href={url} target="_blank" rel="noreferrer" aria-label="Open page in a normal tab" title="Open page in a normal tab">
            <Icon name="open" />
          </a>
        )}
        <button type="button" className="btn small sim-close" aria-label="Close the emulator" title="Close the emulator and go back to the page" onClick={() => void close()}>
          <Icon name="close" /> Close
        </button>
      </form>

      {side && (
        <aside className="sim-side" aria-label="Devices">
          <DevicePicker
            activeId={deviceId}
            landscape={landscape}
            onPick={(id) => {
              setDeviceId(id);
              if (innerWidth < 760) setSide(false);
            }}
          />
        </aside>
      )}

      <main className="sim-main">
        <div className="sim-toolbar">
          <div className="sim-info">
            <strong>{device.label}</strong>
            <span className="muted small">
              {device.width} × {device.height}
              {device.dpr > 1 ? ` @${device.dpr}×` : ''} · {phys.width} × {phys.height} px · {aspectLabel(device.width, device.height)}
              {device.inches ? ` · ${device.inches}″` : ''}
            </span>
          </div>
          <div className="sim-controls">
            <button type="button" className="btn small" disabled={!base.mobile} aria-pressed={landscape && base.mobile} title={base.mobile ? 'Rotate the device' : 'Desktops and TVs do not rotate'} onClick={() => setLandscape((v) => !v)}>
              <Icon name="rotate" /> Rotate
            </button>
            <button type="button" className="btn small" aria-pressed={framed} title="Draw the device frame" onClick={() => setFramed((v) => !v)}>
              <Icon name="monitor" /> Frame
            </button>
            <span className="sim-zoom" role="group" aria-label="Zoom">
              <button type="button" className="btn small iconbtn" aria-label="Zoom out" title="Zoom out (Ctrl + scroll)" disabled={scale <= MIN_ZOOM + 0.005} onClick={() => stepZoom(-1)}>
                −
              </button>
              <select
                aria-label="Zoom level"
                value={zoomValue}
                onChange={(e) => setZoom(e.target.value === 'fit' ? 'fit' : Number(e.target.value))}
              >
                <option value="fit">Fit · {pct(fitScale)}</option>
                {zoomValue === 'custom' && <option value="custom">{pct(scale)}</option>}
                {ZOOM_STEPS.map((s) => (
                  <option key={s} value={s}>
                    {pct(s)}
                  </option>
                ))}
              </select>
              <button type="button" className="btn small iconbtn" aria-label="Zoom in" title="Zoom in (Ctrl + scroll)" disabled={scale >= MAX_ZOOM - 0.005} onClick={() => stepZoom(1)}>
                +
              </button>
              <button type="button" className="btn small" aria-pressed={zoom === 'fit'} title="Zoom out until the whole device fits" onClick={() => setZoom('fit')}>
                Fit
              </button>
              <button type="button" className="btn small" aria-pressed={zoom === 1} title="Actual size" onClick={() => setZoom(1)}>
                100%
              </button>
            </span>
          </div>
        </div>

        <div className="sim-canvas" ref={canvasRef}>
          {!url ? (
            <div className="sim-empty">
              <strong>Enter a page address</strong>
              <span className="muted">Type a URL above, or open the simulator from the Responsive tab to preview the current page.</span>
            </div>
          ) : (
            <div className="sim-sizer" style={{ width: m.totalW * scale, height: m.totalH * scale }}>
              <div className={`sim-device ${device.category}`} style={{ width: m.totalW, height: m.totalH, transform: `scale(${scale})` }}>
                <div className="sim-body" style={{ left: m.padX, width: m.bodyW, height: m.bodyH, padding: m.bezel, borderRadius: m.bodyRadius }}>
                  <div className="sim-screen" style={{ width: device.width, height: device.height, borderRadius: m.screenRadius }}>
                    {net.ready && (
                      <iframe
                        key={reloadKey}
                        title={`${device.label} preview of ${url}`}
                        src={url}
                        width={device.width}
                        height={device.height}
                        // No allow-top-navigation: framed pages cannot navigate this simulator away.
                        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock"
                        allow="fullscreen; clipboard-read; clipboard-write"
                        onLoad={() => setLoading(false)}
                      />
                    )}
                  </div>
                </div>
                {m.stand > 0 && (
                  <div
                    className="sim-stand"
                    style={device.category === 'laptop' ? { top: m.bodyH, left: 0, width: m.totalW, height: m.stand } : { top: m.bodyH, left: m.padX, width: m.bodyW, height: m.stand }}
                    aria-hidden="true"
                  >
                    {device.category === 'laptop' ? (
                      <span className="sim-base" />
                    ) : (
                      <>
                        <span className="sim-neck" />
                        <span className="sim-foot" />
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="sim-status small muted" role="status">
          {loading && <span className="sim-loading">Loading…</span>}
          {net.error && <span className="sim-warn">Could not adjust request headers ({net.error}); some sites may refuse to load in the frame.</span>}
          {!net.error && ua && <span title={ua}>Sending a {device.brand === 'Apple' ? 'Safari on iOS' : 'Chrome on Android'} user agent.</span>}
          <span>
            Page blank or logged out? The site may block embedding or need cookies a frame cannot send. The side-panel <em>Test</em> button works on any page.
          </span>
        </div>
      </main>
    </div>
  );
}
