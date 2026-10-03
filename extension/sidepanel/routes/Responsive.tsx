import { useState } from 'react';
import { enrich } from '@ftk/recommendation-engine';
import { DEVICE_PRESETS } from '@ftk/responsive-analyzer';
import type { DevicePreset } from '@ftk/responsive-analyzer';
import { applyEmulation, resetEmulation, takeScreenshot, testAllViewports, testViewport } from '../actions';
import { FindingList } from '../components/FindingList';
import { Badge, Banner, Button, Card, Icon } from '../components/ui';
import { useAuditView } from '../components/hooks';

type Target = { label: string; width: number; height: number; mobile: boolean };

function PresetRow({ preset }: { preset: DevicePreset }) {
  const { app } = useAuditView();
  const { emulation, viewportTests, testing, shotBusy, tab } = app;
  const result = viewportTests.find((r) => r.label === preset.label && r.width === preset.width);
  const active = emulation.active && emulation.width === preset.width && emulation.height === preset.height;
  const disabled = tab.status !== 'ready' || !!testing;

  return (
    <div className="list-item" style={{ flexWrap: 'wrap' }}>
      <div className="grow">
        <div className="row">
          <strong>{preset.label}</strong>
          {active && <Badge tone="accent">Active</Badge>}
          {result && (result.hasHorizontalScroll ? <Badge tone="error">Overflow</Badge> : <Badge tone="ok">Fits</Badge>)}
        </div>
        <span className="muted small">
          {preset.width} × {preset.height}
        </span>
      </div>
      <div className="row">
        <Button small busy={testing === preset.label} disabled={disabled} onClick={() => testViewport(preset)}>
          Test
        </Button>
        <Button
          small
          icon="camera"
          disabled={disabled || !!shotBusy}
          aria-label={`Screenshot at ${preset.label} ${preset.width} by ${preset.height}`}
          onClick={async () => {
            if (!active) await applyEmulation(preset);
            await takeScreenshot({ type: 'viewport', label: preset.label });
          }}
        >
          Screenshot
        </Button>
      </div>
    </div>
  );
}

function Custom() {
  const { app } = useAuditView();
  const [w, setW] = useState('390');
  const [h, setH] = useState('844');
  const [mobile, setMobile] = useState(true);
  const width = Math.round(Number(w));
  const height = Math.round(Number(h));
  const valid = width >= 200 && width <= 4000 && height >= 200 && height <= 4000;
  const target: Target = { label: 'Custom', width, height, mobile };

  return (
    <Card title="Custom size">
      <div className="row">
        <div className="field grow">
          <label htmlFor="cw">Width</label>
          <input id="cw" type="number" min={200} max={4000} value={w} onChange={(e) => setW(e.target.value)} />
        </div>
        <div className="field grow">
          <label htmlFor="ch">Height</label>
          <input id="ch" type="number" min={200} max={4000} value={h} onChange={(e) => setH(e.target.value)} />
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
      {!valid && <span className="small" style={{ color: 'var(--error)' }}>Use 200–4000 px.</span>}
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
  const { emulation, viewportTests, testing } = app;
  const breakpoints = audit?.snapshot.css.breakpoints ?? [];
  const failing = viewportTests.filter((r) => r.hasHorizontalScroll);

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
          {emulation.mobile ? ' (mobile)' : ''}. Chrome shows a “debugging this browser” bar while this is on.
        </Banner>
      ) : (
        <p className="muted small">The page viewport follows the side panel width. Use a preset to test an exact size independent of the panel.</p>
      )}

      <div className="row between">
        <span className="section-title">Devices</span>
        <Button small variant="primary" busy={!!testing} disabled={app.tab.status !== 'ready'} onClick={testAllViewports}>
          Test all
        </Button>
      </div>
      <div className="list">
        {DEVICE_PRESETS.map((p) => (
          <PresetRow key={p.id} preset={p} />
        ))}
      </div>

      <Custom />

      {viewportTests.length > 0 && (
        <Card title="Test results">
          <div className="list">
            {viewportTests.map((r) => (
              <div key={`${r.label}-${r.width}`} className="list-item" style={{ flexWrap: 'wrap' }}>
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
          {failing.length === 0 && <p className="small" style={{ color: 'var(--ok)' }}>No horizontal overflow at any tested size.</p>}
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
                disabled={app.tab.status !== 'ready'}
                onClick={() => applyEmulation({ label: `${b.px}px`, width: Math.max(200, b.px), height: 900, mobile: b.px <= 768 })}
              >
                <Icon name="eye" /> {b.kind} {b.px}
              </button>
            ))}
          </div>
          <p className="muted small">Discovered from readable stylesheets (min/max-width media queries). Click one to resize the viewport to it.</p>
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
