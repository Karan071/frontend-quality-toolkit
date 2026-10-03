import { useState } from 'react';
import type { ReactNode } from 'react';
import type { Sides } from '@ftk/dom-analyzer';
import { elementLabel } from '@ftk/dom-analyzer';
import { applyCustomCss, clearSelection, navigateSelection, revertFix, selectSelector, takeScreenshot, togglePick } from '../actions';
import { Badge, Button, Card, Empty, Segmented, Swatch } from '../components/ui';
import { useApp } from '../state';

type View = 'box' | 'styles' | 'rules' | 'a11y';

const n = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

function Layer({ label, sides, cls, children }: { label: string; sides: Sides; cls: string; children: ReactNode }) {
  return (
    <div className={`bm ${cls}`}>
      <span className="tag">{label}</span>
      <div className="c">{n(sides.top)}</div>
      <div className="mid">
        <span>{n(sides.left)}</span>
        {children}
        <span>{n(sides.right)}</span>
      </div>
      <div className="c">{n(sides.bottom)}</div>
    </div>
  );
}

function BoxModel() {
  const { selection } = useApp();
  if (!selection) return null;
  const { box, rect } = selection.info;
  return (
    <div className="stack">
      <div className="boxmodel" role="img" aria-label={`Box model: ${Math.round(rect.width)} by ${Math.round(rect.height)} pixels`}>
        <Layer label="margin" sides={box.margin} cls="bm-margin">
          <Layer label="border" sides={box.border} cls="bm-border">
            <Layer label="padding" sides={box.padding} cls="bm-padding">
              <div className="bm-content bm">
                {n(box.content.width)} × {n(box.content.height)}
              </div>
            </Layer>
          </Layer>
        </Layer>
      </div>
      <p className="muted small" style={{ textAlign: 'center' }}>
        Border box {n(rect.width)} × {n(rect.height)} px
      </p>
    </div>
  );
}

function Styles() {
  const { selection } = useApp();
  const [filter, setFilter] = useState('');
  if (!selection) return null;
  const q = filter.trim().toLowerCase();
  return (
    <div className="stack">
      <div className="row">
        <input
          type="text"
          className="grow"
          placeholder="Filter properties"
          aria-label="Filter computed styles"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <Button small aria-pressed={selection.allStyles} onClick={() => selectSelector(selection.selector, { all: !selection.allStyles })}>
          {selection.allStyles ? 'Curated' : 'All'}
        </Button>
      </div>
      {selection.info.styles.map((g) => {
        const entries = g.entries.filter((e) => !q || e.prop.includes(q) || e.value.toLowerCase().includes(q));
        if (!entries.length) return null;
        return (
          <div key={g.group}>
            <div className="label" style={{ marginBottom: 3 }}>{g.group}</div>
            <dl className="kv">
              {entries.map((e) => (
                <div key={e.prop} style={{ display: 'contents' }}>
                  <dt>{e.prop}</dt>
                  <dd>{e.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })}
    </div>
  );
}

function Rules() {
  const { selection } = useApp();
  if (!selection) return null;
  return (
    <div className="stack">
      {selection.rules.length === 0 && <p className="muted">No readable rules match this element.</p>}
      {selection.rules.map((r, i) => (
        <div key={i} className="card" style={{ padding: 8 }}>
          <div className="row between">
            <code style={{ fontWeight: 700, wordBreak: 'break-all' }}>{r.selector}</code>
            <span className="muted small">{r.source}</span>
          </div>
          {r.media && <span className="muted small">@media {r.media}</span>}
          <dl className="kv">
            {r.declarations.map((d) => (
              <div key={d.prop} style={{ display: 'contents' }}>
                <dt>{d.prop}</dt>
                <dd>{d.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
      {selection.inaccessibleSheets > 0 && (
        <p className="muted small">
          {selection.inaccessibleSheets} cross-origin stylesheet(s) could not be read; their rules are not listed. Computed styles are still exact.
        </p>
      )}
    </div>
  );
}

function A11yView() {
  const { selection } = useApp();
  if (!selection) return null;
  const { a11y, contrast, attributes } = selection.info;
  const ratio = contrast?.ratio;
  // Large text (≥ 24px) needs 3:1; weight is not captured, so bold 18.66px+ text is judged strictly.
  const required = contrast && contrast.fontSize >= 24 ? 3 : 4.5;
  return (
    <div className="stack">
      <dl className="kv">
        <dt>role</dt>
        <dd>{a11y.role ?? '—'}</dd>
        <dt>name</dt>
        <dd>{a11y.name || '—'}</dd>
      </dl>
      {contrast && ratio != null && (
        <div className="row wrap">
          <Swatch color={contrast.fg} />
          <span className="mono">on</span>
          <Swatch color={contrast.bg ?? '#fff'} />
          <Badge tone={ratio >= required! ? 'ok' : 'error'}>{ratio.toFixed(2)}:1</Badge>
          <span className="muted small">{contrast.uncertain ? 'background is an image/gradient — estimate' : `needs ${required}:1`}</span>
        </div>
      )}
      <div className="label">Attributes</div>
      <dl className="kv">
        {attributes.map((a) => (
          <div key={a.prop} style={{ display: 'contents' }}>
            <dt>{a.prop}</dt>
            <dd>{a.value || '""'}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function TempCss() {
  const { selection, fixes } = useApp();
  const [css, setCss] = useState('');
  const [important, setImportant] = useState(true);
  if (!selection) return null;
  const id = `custom:${selection.selector}`;
  const applied = fixes[id];
  return (
    <Card title="Try CSS (temporary)">
      <div className="field">
        <label htmlFor="temp-css">Declarations for this element</label>
        <textarea id="temp-css" value={css} placeholder={'max-width: 100%;\npadding: 8px;'} onChange={(e) => setCss(e.target.value)} />
      </div>
      <label className="row small">
        <input type="checkbox" checked={important} onChange={(e) => setImportant(e.target.checked)} /> Add !important
      </label>
      <div className="row">
        <Button small variant="primary" disabled={!css.trim()} onClick={() => applyCustomCss(selection.selector, css, important)}>
          Apply
        </Button>
        {applied && (
          <Button small onClick={() => revertFix(id)}>
            Revert
          </Button>
        )}
      </div>
      <p className="muted small">Lives only in this tab. Closing the panel or reloading removes it.</p>
    </Card>
  );
}

export function Inspect() {
  const app = useApp();
  const { selection, picking, tab } = app;
  const [view, setView] = useState<View>('box');
  const info = selection?.info;

  return (
    <>
      <div className="row">
        <Button variant={picking ? 'primary' : 'default'} icon="pick" aria-pressed={picking} disabled={tab.status !== 'ready'} onClick={togglePick}>
          {picking ? 'Click an element… (Esc to cancel)' : 'Pick element'}
        </Button>
        {selection && (
          <Button variant="ghost" small onClick={clearSelection}>
            Clear
          </Button>
        )}
      </div>

      {!selection && (
        <Empty title="No element selected">
          <span>Choose “Pick element”, then click anything on the page to see its box model, computed styles, matching CSS rules and accessibility info.</span>
        </Empty>
      )}

      {selection && info && (
        <>
          <Card>
            <div className="row between">
              <strong className="mono ellipsis" title={selection.selector}>
                {elementLabel(info.tag, info.id, info.classes)}
              </strong>
              <Badge>
                {Math.round(info.rect.width)} × {Math.round(info.rect.height)}
              </Badge>
            </div>
            {info.text && <p className="muted small ellipsis">“{info.text}”</p>}
            <nav className="crumbs" aria-label="Element path">
              {info.path.slice(-5).map((p, i, arr) => (
                <span key={p.selector}>
                  {i > 0 && <span className="sep"> › </span>}
                  <button type="button" aria-current={i === arr.length - 1} onClick={() => selectSelector(p.selector, { reveal: true })}>
                    {p.label}
                  </button>
                </span>
              ))}
            </nav>
            <div className="row wrap">
              <Button small disabled={!info.hasParent} onClick={() => navigateSelection('parent')} aria-label="Select parent">
                ↑ Parent
              </Button>
              <Button small disabled={info.childCount === 0} onClick={() => navigateSelection('child')} aria-label="Select first child">
                ↓ Child
              </Button>
              <Button small disabled={!info.hasPrev} onClick={() => navigateSelection('prev')} aria-label="Select previous sibling">
                ← Prev
              </Button>
              <Button small disabled={!info.hasNext} onClick={() => navigateSelection('next')} aria-label="Select next sibling">
                Next →
              </Button>
              <Button small icon="camera" onClick={() => takeScreenshot({ type: 'element' })}>
                Screenshot
              </Button>
            </div>
            {info.inFixedContext && <p className="muted small">This element is fixed or sticky; full-page captures place it where the page would show it at the top or bottom.</p>}
          </Card>

          <Segmented
            label="Inspector view"
            value={view}
            onChange={setView}
            options={[
              { value: 'box', label: 'Box' },
              { value: 'styles', label: 'Styles' },
              { value: 'rules', label: 'Rules' },
              { value: 'a11y', label: 'A11y' },
            ]}
          />
          {view === 'box' && <BoxModel />}
          {view === 'styles' && <Styles />}
          {view === 'rules' && <Rules />}
          {view === 'a11y' && <A11yView />}
          <TempCss />
        </>
      )}
    </>
  );
}
