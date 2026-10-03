import { useState } from 'react';
import type { ShotType } from '@ftk/screenshot-engine';
import { removeAllShots, removeShot, saveSettings, takeScreenshot } from '../actions';
import { Compare, Thumb } from '../components/Compare';
import { ShotActions } from '../components/ScreenshotBar';
import { Badge, Banner, Button, Card, Empty, Icon, Segmented } from '../components/ui';
import { useApp } from '../state';

export function Screenshots() {
  const app = useApp();
  const { settings, selection, shotBusy, screenshots, tab, emulation } = app;
  const [type, setType] = useState<ShotType>('viewport');
  // Compare selection: first pick is "before", second is "after".
  const [picked, setPicked] = useState<string[]>([]);

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p.slice(-1), id]));
  const before = screenshots.find((s) => s.id === picked[0]);
  const after = screenshots.find((s) => s.id === picked[1]);
  const ready = tab.status === 'ready' && !shotBusy;

  return (
    <>
      <Card title="Capture">
        <Segmented
          label="Screenshot type"
          value={type}
          onChange={setType}
          options={[
            { value: 'viewport', label: 'Viewport' },
            { value: 'fullpage', label: 'Full page' },
            { value: 'element', label: 'Element' },
          ]}
        />
        {type === 'element' && (
          <p className="small muted">
            {selection ? (
              <>
                Selected: <code>{selection.selector}</code> ({Math.round(selection.info.rect.width)} × {Math.round(selection.info.rect.height)})
              </>
            ) : (
              'Pick an element in Inspect first.'
            )}
          </p>
        )}
        {type === 'viewport' && (
          <p className="small muted">
            {emulation.active ? `Emulated viewport ${emulation.width} × ${emulation.height}.` : 'Captures what is visible now — the viewport is narrower than the window while this panel is open. Use Responsive for exact sizes.'}
          </p>
        )}
        {type === 'fullpage' && <p className="small muted">Scrolls the page to load lazy content, then stitches tiles. Fixed and sticky elements appear once.</p>}

        <div className="row">
          <div className="field grow">
            <label htmlFor="fmt">Format</label>
            <select id="fmt" value={settings.format} onChange={(e) => saveSettings({ format: e.target.value as 'png' | 'jpeg' })}>
              <option value="png">PNG</option>
              <option value="jpeg">JPEG</option>
            </select>
          </div>
          {settings.format === 'jpeg' && (
            <div className="field grow">
              <label htmlFor="q">Quality: {settings.quality}%</label>
              <input id="q" type="range" min={10} max={100} step={5} value={settings.quality} onChange={(e) => saveSettings({ quality: Number(e.target.value) })} />
            </div>
          )}
        </div>
        <Button
          variant="primary"
          icon="camera"
          busy={!!shotBusy}
          disabled={!ready || (type === 'element' && !selection)}
          onClick={() => takeScreenshot({ type })}
        >
          Capture
        </Button>
        <p className="muted small">Screenshots stay on this device (IndexedDB). Nothing is uploaded.</p>
      </Card>

      <div className="row between">
        <span className="section-title">Saved ({screenshots.length})</span>
        {screenshots.length > 0 && (
          <Button small variant="ghost" className="danger" onClick={removeAllShots}>
            Clear all
          </Button>
        )}
      </div>

      {screenshots.length === 0 && (
        <Empty title="No screenshots yet">
          <span>Capture the viewport, the full page, or a selected element. Select two to compare before and after a fix.</span>
        </Empty>
      )}

      <div className="stack">
        {screenshots.map((s) => {
          const idx = picked.indexOf(s.id);
          return (
            <div key={s.id} className={`shot ${idx >= 0 ? 'selected' : ''}`}>
              <Thumb shot={s} className="shot-thumb" />
              <div className="grow stack" style={{ gap: 4 }}>
                <div className="row between">
                  <strong className="ellipsis" title={s.name}>{s.name}</strong>
                </div>
                <div className="row wrap small muted" style={{ gap: 4 }}>
                  <Badge>{s.type}</Badge>
                  <span>{s.width} × {s.height}</span>
                  <span>· {s.meta.deviceMode}</span>
                  <span>· {(s.bytes / 1024).toFixed(0)} KB</span>
                  <span>· {new Date(s.createdAt).toLocaleTimeString()}</span>
                </div>
                {s.meta.label && <span className="small muted ellipsis">{s.meta.label}</span>}
                <div className="row wrap">
                  <ShotActions shot={s} />
                  <label className="row small">
                    <input type="checkbox" checked={idx >= 0} onChange={() => toggle(s.id)} aria-label={`Select ${s.name} for comparison`} />
                    {idx === 0 ? 'Before' : idx === 1 ? 'After' : 'Compare'}
                  </label>
                  <Button small variant="ghost" aria-label={`Delete ${s.name}`} onClick={() => removeShot(s.id)}>
                    <Icon name="trash" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {picked.length === 1 && <Banner>Select one more screenshot to compare. The first one chosen is “Before”.</Banner>}
      {before && after && (
        <Card
          title="Compare"
          actions={
            <Button small variant="ghost" onClick={() => setPicked([picked[1], picked[0]])}>
              Swap
            </Button>
          }
        >
          <Compare before={before} after={after} />
        </Card>
      )}
    </>
  );
}
