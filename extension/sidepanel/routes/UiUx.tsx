import { useMemo } from 'react';
import { analyzePalette } from '@ftk/color-analyzer';
import { summarizeTypography } from '@ftk/typography-analyzer';
import { buttonVariants, summarizeSpacing } from '@ftk/ux-analyzer';
import { highlightSelectors, toast } from '../actions';
import { FindingList } from '../components/FindingList';
import { Badge, Bar, Card } from '../components/ui';
import { useAuditView } from '../components/hooks';

function Palette() {
  const { audit } = useAuditView();
  const palette = useMemo(() => (audit ? analyzePalette(audit.snapshot.colors) : null), [audit]);
  if (!palette) return null;
  return (
    <Card title={`Colour palette · ${palette.distinct} distinct`}>
      <div className="row wrap">
        <Badge tone="accent">{palette.scheme.replace('-', ' ')}</Badge>
        <span className="muted small">{palette.description}</span>
      </div>
      <div className="swatch-grid">
        {palette.swatches.slice(0, 24).map((s) => (
          <button
            key={s.hex}
            type="button"
            className="swatch-card"
            title={`${s.hex} — ${s.count} uses (${s.roles.join(', ')}). Click to copy.`}
            onClick={async () => {
              await navigator.clipboard.writeText(s.hex);
              toast(`${s.hex} copied`, 'success');
            }}
            style={{ padding: 0, cursor: 'pointer', textAlign: 'left' }}
          >
            <div className="chip" style={{ background: s.hex }} />
            <div className="meta">
              {s.hex}
              <br />
              <span className="muted">×{s.count}</span>
            </div>
          </button>
        ))}
      </div>
      {palette.dominantHues.length > 0 && (
        <p className="muted small">Dominant hues: {palette.dominantHues.map((h) => `${h}°`).join(', ')} · Colours are grouped by perceptual similarity (ΔE &lt; 5).</p>
      )}
    </Card>
  );
}

function Typography() {
  const { audit } = useAuditView();
  const t = useMemo(() => (audit ? summarizeTypography(audit.snapshot.typography) : null), [audit]);
  if (!t) return null;
  const maxSize = Math.max(1, ...t.sizes.map((s) => s.count));
  return (
    <Card title="Typography">
      <div className="label">Families</div>
      <div className="list">
        {t.families.slice(0, 6).map((f) => (
          <div className="list-item" key={f.family}>
            <span className="grow ellipsis">{f.family || '(default)'}</span>
            <span className="muted small">{f.count} nodes</span>
          </div>
        ))}
      </div>
      <div className="label">Sizes ({t.sizes.length})</div>
      <div className="stack" style={{ gap: 3 }}>
        {t.sizes.slice(0, 14).map((s) => (
          <div key={s.px} className="row">
            <span className="mono small" style={{ width: 48 }}>{s.px}px</span>
            <div className="grow"><Bar value={s.count} max={maxSize} /></div>
            <span className="muted small" style={{ width: 28, textAlign: 'right' }}>{s.count}</span>
          </div>
        ))}
      </div>
      <div className="label">Weights</div>
      <div className="row wrap">
        {t.weights.map((w) => (
          <Badge key={w.weight}>{w.weight} × {w.count}</Badge>
        ))}
      </div>
    </Card>
  );
}

function Spacing() {
  const { audit } = useAuditView();
  const s = useMemo(() => (audit ? summarizeSpacing(audit.snapshot.spacing) : null), [audit]);
  if (!s || !audit) return null;
  const top = [...s.distinct].sort((a, b) => b.count - a.count).slice(0, 12).sort((a, b) => a.px - b.px);
  const max = Math.max(1, ...top.map((v) => v.count));
  const radii = [...audit.snapshot.spacing.radii].sort((a, b) => a.px - b.px);
  return (
    <Card title="Spacing & radii">
      <div className="row between">
        <span>{Math.round(s.gridShare * 100)}% on a {s.base}px grid</span>
        <Badge tone={s.gridShare >= 0.7 ? 'ok' : 'warning'}>{s.distinct.length} values</Badge>
      </div>
      <div className="stack" style={{ gap: 3 }}>
        {top.map((v) => (
          <div key={v.px} className="row">
            <span className="mono small" style={{ width: 44 }}>{v.px}px</span>
            <div className="grow"><Bar value={v.count} max={max} tone={v.px % 4 ? 'warn' : undefined} /></div>
          </div>
        ))}
      </div>
      {radii.length > 0 && (
        <>
          <div className="label">Corner radii</div>
          <div className="row wrap">
            {radii.map((r) => (
              <Badge key={r.px}>{r.px === 9999 ? 'pill' : `${r.px}px`} × {r.count}</Badge>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function Buttons() {
  const { audit } = useAuditView();
  const variants = useMemo(() => (audit ? buttonVariants(audit.snapshot.ux.buttons) : []), [audit]);
  if (!variants.length) return null;
  return (
    <Card title={`Buttons · ${variants.length} style${variants.length === 1 ? '' : 's'}`}>
      <div className="list">
        {variants.slice(0, 8).map((v) => (
          <button key={v.signature} type="button" className="list-item" onClick={() => highlightSelectors([v.sample.selector], 'info')}>
            <span
              className="swatch"
              style={{ width: 28, height: 18, background: v.sample.bg, borderRadius: Math.min(9, v.sample.radius), borderColor: v.sample.color }}
              aria-hidden="true"
            />
            <span className="grow small">
              {v.sample.fontSize}px/{v.sample.fontWeight} · r{Math.round(v.sample.radius)} · pad {Math.round(v.sample.padY)}/{Math.round(v.sample.padX)}
            </span>
            <Badge>×{v.count}</Badge>
          </button>
        ))}
      </div>
    </Card>
  );
}

function Tokens() {
  const { audit } = useAuditView();
  const tokens = audit?.snapshot.css.tokens ?? [];
  if (!audit) return null;
  const groups = (['color', 'size', 'font', 'other'] as const).map((kind) => ({ kind, items: tokens.filter((t) => t.kind === kind) })).filter((g) => g.items.length);
  return (
    <Card title={`Design tokens (${tokens.length})`}>
      {tokens.length === 0 && (
        <p className="muted small">
          No CSS custom properties found on :root{audit.snapshot.css.inaccessibleSheets ? ` (${audit.snapshot.css.inaccessibleSheets} stylesheet(s) were unreadable)` : ''}.
        </p>
      )}
      {groups.map((g) => (
        <div key={g.kind}>
          <div className="label" style={{ marginBottom: 3 }}>{g.kind}</div>
          <dl className="kv">
            {g.items.slice(0, 24).map((t) => (
              <div key={t.name} style={{ display: 'contents' }}>
                <dt>{t.name}</dt>
                <dd>
                  {g.kind === 'color' && <span className="swatch" style={{ background: t.value, marginRight: 5, verticalAlign: 'middle' }} />}
                  {t.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </Card>
  );
}

export function UiUx() {
  const { audit, by } = useAuditView();
  return (
    <>
      <FindingList findings={by('uxui')} hasAudit={!!audit} emptyTitle="Design looks consistent" emptyHint="No palette, typography, spacing or component inconsistencies detected." />
      <Palette />
      <Typography />
      <Spacing />
      <Buttons />
      <Tokens />
    </>
  );
}
