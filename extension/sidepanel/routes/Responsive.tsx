import { useState } from 'react';
import { enrich } from '@ftk/recommendation-engine';
import { CATEGORY_LABELS, DEVICE_PRESETS, aspectLabel, describeDevice, orientPreset, physicalSize } from '@ftk/responsive-analyzer';
import type { DeviceCategory, DevicePreset } from '@ftk/responsive-analyzer';
import { applyEmulation, openSimulator, resetEmulation, takeScreenshot, testAllViewports, testCoreViewports, testPresets, testViewport, toast } from '../actions';
import { FindingList } from '../components/FindingList';
import { Badge, Banner, Button, Card, Icon, Segmented } from '../components/ui';
import { useAuditView } from '../components/hooks';

type Target = { label: string; width: number; height: number; mobile: boolean; dpr?: number };

const CATEGORIES = Object.keys(CATEGORY_LABELS) as DeviceCategory[];
type Filter = DeviceCategory | 'apple';

function sizeLines(p: DevicePreset): [string, string] {
  const phys = physicalSize(p);
  const head = `${p.width} × ${p.height}${p.dpr > 1 ? ` @${p.dpr}×` : ''}`;
  const rest = [];
  if (p.dpr !== 1) rest.push(`${phys.width} × ${phys.height} px`);
  rest.push(aspectLabel(p.width, p.height));
  if (p.inches) rest.push(`${p.inches}″`);
  if (p.note) rest.push(p.note);
  return [head, rest.join(' · ')];
}

const searchText = (p: DevicePreset) => `${p.label} ${p.brand ?? ''} ${p.note ?? ''} ${p.inches ?? ''}″ ${p.width}x${p.height} ${p.width} ${p.height} ${CATEGORY_LABELS[p.category]}`.toLowerCase();

function PresetRow({ preset, landscape }: { preset: DevicePreset; landscape: boolean }) {
  const { app } = useAuditView();
  const { emulation, viewportTests, testing, shotBusy, tab } = app;
  const result = viewportTests.find((r) => r.label === preset.label && r.width === preset.width);
  const active = emulation.active && emulation.width === preset.width && emulation.height === preset.height && emulation.label === preset.label;
  const disabled = tab.status !== 'ready' || !!testing;
  const [head, rest] = sizeLines(preset);

  return (
    <div className="list-item device-card">
      <div className="grow">
        <div className="row wrap" style={{ gap: 4 }}>
          <strong className="device-name">{preset.label}</strong>
          {active && <Badge tone="accent">Active</Badge>}
          {result && (result.hasHorizontalScroll ? <Badge tone="error">Overflow</Badge> : <Badge tone="ok">Fits</Badge>)}
        </div>
        <div className="small device-size">{head}</div>
        <div className="muted small device-meta">{rest}</div>
      </div>
      <div className="device-actions">
        <Button small busy={testing === preset.label} disabled={disabled} onClick={() => testViewport(preset)}>
          Test
        </Button>
        <Button
          small
          icon="camera"
          disabled={disabled || !!shotBusy}
          title="Screenshot at this size"
          aria-label={`Screenshot at ${preset.label} ${preset.width} by ${preset.height}`}
          onClick={async () => {
            if (!active) await applyEmulation(preset);
            await takeScreenshot({ type: 'viewport', label: preset.label });
          }}
        />
        <Button
          small
          icon="copy"
          aria-label={`Copy ${preset.label} dimensions`}
          title="Copy size, pixel ratio, physical resolution and a media query"
          onClick={async () => {
            await navigator.clipboard.writeText(describeDevice(preset));
            toast(`${preset.label} dimensions copied`, 'success');
          }}
        />
        <Button
          small
          variant="primary"
          icon="monitor"
          disabled={tab.status !== 'ready'}
          title="Open in the full-screen emulator, centered and zoomed to fit"
          aria-label={`Preview ${preset.label} in the emulator`}
          onClick={() => openSimulator(preset.id, landscape)}
        />
      </div>
    </div>
  );
}

function Custom() {
  const { app } = useAuditView();
  const [w, setW] = useState('390');
  const [h, setH] = useState('844');
  const [dpr, setDpr] = useState('0');
  const [mobile, setMobile] = useState(true);
  const width = Math.round(Number(w));
  const height = Math.round(Number(h));
  const valid = width >= 200 && width <= 10000 && height >= 200 && height <= 10000;
  const target: Target = { label: 'Custom', width, height, mobile, dpr: Number(dpr) };

  return (
    <Card title="Custom size">
      <div className="row wrap">
        <div className="field grow" style={{ minWidth: 90 }}>
          <label htmlFor="cw">Width</label>
          <input id="cw" type="number" min={200} max={10000} value={w} onChange={(e) => setW(e.target.value)} />
        </div>
        <div className="field grow" style={{ minWidth: 90 }}>
          <label htmlFor="ch">Height</label>
          <input id="ch" type="number" min={200} max={10000} value={h} onChange={(e) => setH(e.target.value)} />
        </div>
        <div className="field" style={{ minWidth: 76 }}>
          <label htmlFor="cd">Pixel ratio</label>
          <select id="cd" value={dpr} onChange={(e) => setDpr(e.target.value)}>
            <option value="0">Auto</option>
            <option value="1">1×</option>
            <option value="1.5">1.5×</option>
            <option value="2">2×</option>
            <option value="3">3×</option>
          </select>
        </div>
        <Button
          small
          icon="rotate"
          aria-label="Swap width and height"
          style={{ alignSelf: 'flex-end' }}
          onClick={() => {
            setW(h);
            setH(w);
          }}
        />
      </div>
      <label className="row small">
        <input type="checkbox" checked={mobile} onChange={(e) => setMobile(e.target.checked)} /> Mobile mode (touch, mobile viewport)
      </label>
      {!valid && <span className="small" style={{ color: 'var(--error)' }}>Use 200–10000 px.</span>}
      <div className="row">
        <Button small variant="primary" disabled={!valid || app.tab.status !== 'ready'} onClick={() => applyEmulation(target)}>
          Apply
        </Button>
        <Button small disabled={!valid || !!app.testing} busy={app.testing === 'Custom'} onClick={() => testViewport(target)}>
          Test
        </Button>
      </div>
    </Card>
  );
}

export function Responsive() {
  const { app, audit, by } = useAuditView();
  const { emulation, viewportTests, testing, testProgress } = app;
  const [filter, setFilter] = useState<Filter>('phone');
  const [query, setQuery] = useState('');
  const [landscape, setLandscape] = useState(false);
  const breakpoints = audit?.snapshot.css.breakpoints ?? [];
  const failing = viewportTests.filter((r) => r.hasHorizontalScroll);
  const q = query.trim().toLowerCase();
  const matching = DEVICE_PRESETS.filter((p) => (q ? searchText(p).includes(q) : filter === 'apple' ? p.brand === 'Apple' : p.category === filter));
  const presets = matching.map((p) => orientPreset(p, landscape));
  const countFor = (f: Filter) => DEVICE_PRESETS.filter((p) => (f === 'apple' ? p.brand === 'Apple' : p.category === f)).length;
  const ready = app.tab.status === 'ready';

  const testFindings = enrich(viewportTests.flatMap((t) => t.findings));
  const merged = new Map(by('responsive').map((f) => [f.id, f]));
  testFindings.forEach((f) => merged.set(f.id, merged.get(f.id) ?? f));

  return (
    <>
      {emulation.active ? (
        <Banner
          tone="ok"
          action={
            <Button small onClick={resetEmulation}>
              Reset
            </Button>
          }
        >
          Emulating <strong>{emulation.width} × {emulation.height}</strong>
          {emulation.dpr ? ` @${emulation.dpr}×` : ''}
          {emulation.mobile ? ' (mobile)' : ''}. Chrome shows a “debugging this browser” bar while this is on.
        </Banner>
      ) : (
        <p className="muted small">The page viewport follows the side panel width. Pick a device to test an exact size, from foldables to 49″ monitors and 60″ TVs.</p>
      )}

      <Card title="Device emulator">
        <p className="muted small">
          Opens the page in a full-screen tab: the device sits in the middle of the screen inside a frame, and you can zoom out to see a 49″ monitor or a 60″ TV whole, rotate phones, and switch devices instantly.
        </p>
        <div className="row wrap">
          <Button small variant="primary" icon="monitor" disabled={!ready} onClick={() => openSimulator()}>
            Open emulator
          </Button>
        </div>
      </Card>

      <div className="row between wrap">
        <span className="section-title">Devices</span>
        <span className="row wrap">
          <Button small busy={!!testing && !!testProgress} disabled={!ready || !!testing} onClick={testCoreViewports}>
            Core sizes
          </Button>
          <Button small variant="primary" busy={!!testing && !!testProgress} disabled={!ready || !!testing} onClick={testAllViewports}>
            {testProgress ? `Testing ${testProgress.done + 1}/${testProgress.total}` : `Test all ${DEVICE_PRESETS.length}`}
          </Button>
        </span>
      </div>

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
          {CATEGORIES.map((c) => (
            <button key={c} type="button" className="chip-btn" aria-pressed={filter === c} onClick={() => setFilter(c)}>
              {CATEGORY_LABELS[c]}
              <span className="chip-n">{countFor(c)}</span>
            </button>
          ))}
          <button type="button" className="chip-btn" aria-pressed={filter === 'apple'} onClick={() => setFilter('apple')}>
            Apple
            <span className="chip-n">{countFor('apple')}</span>
          </button>
        </div>
      )}
      <div className="row between wrap">
        <label className="row small">
          <input type="checkbox" checked={landscape} onChange={(e) => setLandscape(e.target.checked)} /> Landscape (phones &amp; tablets)
        </label>
        <Button
          small
          variant="ghost"
          disabled={!ready || !!testing || presets.length === 0}
          onClick={() => testPresets(presets)}
        >
          Test these {presets.length}
        </Button>
      </div>
      <div className="list device-grid">
        {presets.map((p) => (
          <PresetRow key={p.id + p.label} preset={p} landscape={landscape} />
        ))}
        {presets.length === 0 && <div className="list-item muted device-empty">No device matches “{query}”. Use Custom size for any other screen.</div>}
      </div>

      <Custom />

      {viewportTests.length > 0 && (
        <Card title={`Test results (${viewportTests.length})`}>
          <div className="list">
            {viewportTests.map((r) => (
              <div key={`${r.label}-${r.width}-${r.height}`} className="list-item" style={{ flexWrap: 'wrap' }}>
                <span className="grow">
                  <strong>{r.label}</strong> <span className="muted small">{r.width}px</span>
                </span>
                {r.hasHorizontalScroll ? (
                  <Badge tone="error" title={`Scroll width ${r.scrollWidth}px exceeds ${r.clientWidth}px`}>
                    +{r.scrollWidth - r.clientWidth}px overflow · {r.culpritCount} el
                  </Badge>
                ) : (
                  <Badge tone="ok">No overflow</Badge>
                )}
              </div>
            ))}
          </div>
          {failing.length === 0 && !testing && <p className="small" style={{ color: 'var(--ok)' }}>No horizontal overflow at any tested size.</p>}
        </Card>
      )}

      {breakpoints.length > 0 && (
        <Card title={`Breakpoints in CSS (${breakpoints.length})`}>
          <div className="row wrap">
            {breakpoints.map((b) => (
              <button
                key={`${b.kind}${b.px}`}
                type="button"
                className="btn small"
                title={`${b.kind}-width ${b.px}px — used by ${b.uses} media rule(s). Click to emulate this width.`}
                disabled={!ready}
                onClick={() => applyEmulation({ label: `${b.px}px`, width: Math.max(200, b.px), height: 900, mobile: b.px <= 768 })}
              >
                <Icon name="eye" /> {b.kind} {b.px}
              </button>
            ))}
          </div>
          <p className="muted small">Discovered from the page's stylesheets, including cross-origin ones. Click one to resize the viewport to it.</p>
        </Card>
      )}

      <FindingList
        findings={[...merged.values()]}
        hasAudit={!!audit || viewportTests.length > 0}
        emptyTitle="No responsive problems"
        emptyHint="No viewport meta problems or horizontal overflow at the sizes tested."
      />
    </>
  );
}
