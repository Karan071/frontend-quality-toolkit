import { evaluateContrast } from '@ftk/accessibility-analyzer';
import { highlightSelectors } from '../actions';
import { FindingList, severityCounts } from '../components/FindingList';
import { Badge, Card, Swatch } from '../components/ui';
import { useAuditView } from '../components/hooks';

export function Accessibility() {
  const { audit, by } = useAuditView();
  const findings = by('accessibility');
  const counts = severityCounts(findings);
  const a11y = audit?.snapshot.a11y;

  const lowest = a11y
    ? a11y.text
        .map(evaluateContrast)
        .filter((r): r is NonNullable<typeof r> => !!r && !r.sample.bgUncertain)
        .sort((x, y) => x.ratio - y.ratio)
        .slice(0, 6)
    : [];

  return (
    <>
      {audit && (
        <div className="grid three">
          <div className="metric">
            <span className="metric-name">Errors</span>
            <span className="metric-value" style={{ color: counts.error ? 'var(--error)' : 'var(--ok)' }}>{counts.error}</span>
          </div>
          <div className="metric">
            <span className="metric-name">Warnings</span>
            <span className="metric-value" style={{ color: counts.warning ? 'var(--warn)' : 'var(--ok)' }}>{counts.warning}</span>
          </div>
          <div className="metric">
            <span className="metric-name">Notes</span>
            <span className="metric-value">{counts.info}</span>
          </div>
        </div>
      )}

      <FindingList findings={findings} hasAudit={!!audit} emptyTitle="No accessibility issues detected" emptyHint="Automated checks cover roughly a third of WCAG; keyboard and screen-reader testing is still needed." />

      {lowest.length > 0 && (
        <Card title="Lowest contrast text">
          <div className="list">
            {lowest.map((r) => (
              <button key={r.sample.selector + r.sample.fg} type="button" className="list-item" onClick={() => highlightSelectors([r.sample.selector, ...r.sample.extraSelectors], r.passes ? 'info' : 'error')}>
                <Swatch color={r.sample.fg} />
                <Swatch color={r.sample.bg ?? '#fff'} />
                <span className="grow ellipsis small" title={r.sample.text}>“{r.sample.text}”</span>
                <Badge tone={r.passes ? 'ok' : 'error'}>{r.ratio.toFixed(2)}:1</Badge>
              </button>
            ))}
          </div>
          <p className="muted small">WCAG AA: 4.5:1 for normal text, 3:1 for large text (24px, or 18.66px bold).</p>
        </Card>
      )}

      {a11y && a11y.headings.length > 0 && (
        <Card title={`Heading outline (${a11y.headings.length})`}>
          <div className="outline-h stack" style={{ gap: 1 }}>
            {a11y.headings.slice(0, 60).map((h, i) => (
              <button key={i} type="button" style={{ paddingLeft: 4 + (h.level - 1) * 12 }} onClick={() => highlightSelectors([h.selector], 'info')}>
                <Badge>h{h.level}</Badge> {h.text || <em className="muted">(empty)</em>}
              </button>
            ))}
          </div>
        </Card>
      )}

      {a11y && (
        <Card title="Landmarks">
          <div className="row wrap">
            {(['main', 'nav', 'header', 'footer'] as const).map((k) => (
              <Badge key={k} tone={k === 'main' && a11y.landmarks.main === 0 ? 'warning' : undefined}>
                {k} × {a11y.landmarks[k]}
              </Badge>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
