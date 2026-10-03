import { formatMs } from '@ftk/audit-core';
import type { VitalsSnapshot } from '@ftk/audit-core';
import { THRESHOLDS, formatVital, rateVital } from '@ftk/performance-analyzer';
import type { VitalName } from '@ftk/performance-analyzer';
import { highlightSelectors, refreshVitals, reloadAndMeasure, takeScreenshot } from '../actions';
import { FindingList } from '../components/FindingList';
import { Badge, Banner, Button, Card, Empty, RatingBadge } from '../components/ui';
import { useAuditView } from '../components/hooks';

const LABELS: Record<VitalName, { name: string; hint: string }> = {
  lcp: { name: 'LCP', hint: 'Largest Contentful Paint' },
  cls: { name: 'CLS', hint: 'Cumulative Layout Shift' },
  inp: { name: 'INP', hint: 'Interaction to Next Paint' },
  fcp: { name: 'FCP', hint: 'First Contentful Paint' },
  ttfb: { name: 'TTFB', hint: 'Time to First Byte' },
  tbt: { name: 'TBT', hint: 'Total Blocking Time' },
};

function valueOf(v: VitalsSnapshot, name: VitalName): number | null {
  switch (name) {
    case 'lcp': return v.lcp?.value ?? null;
    case 'cls': return v.cls;
    case 'inp': return v.inp?.value ?? null;
    case 'fcp': return v.fcp;
    case 'ttfb': return v.ttfb;
    case 'tbt': return v.tbt;
  }
}

function Metric({ vitals, name }: { vitals: VitalsSnapshot; name: VitalName }) {
  const value = valueOf(vitals, name);
  const rating = rateVital(name, value);
  const t = THRESHOLDS[name];
  // Meter: good → 33%, poor → 66%, scale to 1.33× poor.
  const pct = value == null ? null : Math.min(100, (value / (t.poor * 1.5)) * 100);
  return (
    <div className="metric">
      <div className="metric-name">
        <span title={LABELS[name].hint}>{LABELS[name].name}</span>
        <RatingBadge rating={rating} />
      </div>
      <div className={`metric-value ${rating ?? ''}`}>{formatVital(name, value)}</div>
      <div className="meter" role="img" aria-label={`${LABELS[name].name} ${formatVital(name, value)}, ${rating ?? 'not measured'}`}>
        {pct != null && <span className="meter-pin" style={{ left: `${pct}%` }} />}
      </div>
      <span className="muted small">
        good ≤ {name === 'cls' ? t.good : formatMs(t.good)}
      </span>
    </div>
  );
}

function Timeline({ v }: { v: VitalsSnapshot }) {
  const marks = [
    { label: 'TTFB', at: v.ttfb },
    { label: 'FCP', at: v.fcp },
    { label: 'LCP', at: v.lcp?.value ?? null },
    { label: 'DOMContentLoaded', at: v.domContentLoaded },
    { label: 'Load', at: v.load },
  ].filter((m): m is { label: string; at: number } => m.at != null);
  if (!marks.length) return null;
  const max = Math.max(...marks.map((m) => m.at));
  return (
    <Card title="Timeline">
      <div className="stack">
        {marks.map((m) => (
          <div key={m.label}>
            <div className="row between small">
              <span>{m.label}</span>
              <span className="mono">{formatMs(m.at)}</span>
            </div>
            <div className="bar" role="presentation">
              <span style={{ width: `${(m.at / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function Performance() {
  const { app, audit, by } = useAuditView();
  const v = app.vitals;
  const ready = app.tab.status === 'ready';

  return (
    <>
      <div className="row wrap">
        <Button variant="primary" icon="refresh" busy={app.measuring} disabled={!ready} onClick={reloadAndMeasure}>
          Reload &amp; measure
        </Button>
        <Button disabled={!ready} onClick={refreshVitals}>
          Refresh
        </Button>
        <Button icon="camera" disabled={!ready || !!app.shotBusy} onClick={() => takeScreenshot({ type: 'viewport', label: 'Performance test' })}>
          Capture viewport
        </Button>
      </div>

      {!v && <Empty title="No measurements yet"><span>Choose “Reload &amp; measure” to record vitals from a fresh page load.</span></Empty>}

      {v && (
        <>
          {v.partial && (
            <Banner tone="warn">
              The page loaded before the toolkit attached, so early metrics may be missing. Use “Reload &amp; measure” for a complete reading.
            </Banner>
          )}
          <div className="grid">
            {(['lcp', 'cls', 'inp', 'fcp', 'ttfb', 'tbt'] as VitalName[]).map((n) => (
              <Metric key={n} vitals={v} name={n} />
            ))}
          </div>
          {v.inp == null && <p className="muted small">INP needs a real interaction — click or type on the page, then Refresh.</p>}

          <Timeline v={v} />

          {v.lcp?.selector && (
            <Card title="LCP element">
              <div className="row wrap">
                <button type="button" className="sel-chip" onClick={() => highlightSelectors([v.lcp!.selector!], 'info')}>
                  {v.lcp.selector}
                </button>
                <Badge>{Math.round(v.lcp.size).toLocaleString()} px²</Badge>
              </div>
              {v.lcp.url && <code className="ellipsis" title={v.lcp.url}>{v.lcp.url}</code>}
            </Card>
          )}

          {v.shifts.length > 0 && (
            <Card title={`Layout shifts (${v.shifts.length})`}>
              <div className="list">
                {v.shifts.slice(0, 5).map((s, i) => (
                  <button key={i} type="button" className="list-item" disabled={!s.selectors.length} onClick={() => highlightSelectors(s.selectors, 'warning')}>
                    <Badge tone={s.value > 0.1 ? 'error' : 'warning'}>{s.value.toFixed(3)}</Badge>
                    <span className="grow ellipsis mono">{s.selectors[0] ?? 'unknown element'}</span>
                    <span className="muted small">{formatMs(s.time)}</span>
                  </button>
                ))}
              </div>
            </Card>
          )}

          {v.longTasks.length > 0 && (
            <Card title={`Long tasks (${v.longTasks.length})`}>
              <div className="list">
                {[...v.longTasks].sort((a, b) => b.duration - a.duration).slice(0, 5).map((t, i) => (
                  <div key={i} className="list-item">
                    <Badge tone={t.duration > 200 ? 'error' : 'warning'}>{Math.round(t.duration)} ms</Badge>
                    <span className="muted small">at {formatMs(t.start)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      <FindingList findings={by('performance')} hasAudit={!!audit} emptyTitle="Performance looks healthy" emptyHint="All measured vitals are within the recommended thresholds." />
    </>
  );
}
