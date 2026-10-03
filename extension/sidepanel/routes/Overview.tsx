import { CATEGORIES, CATEGORY_LABEL, plural } from '@ftk/audit-core';
import type { Category } from '@ftk/audit-core';
import { formatVital, rateVital } from '@ftk/performance-analyzer';
import { summarizeByCategory, topRecommendations } from '@ftk/recommendation-engine';
import { clearFixes, downloadAudit, exportMarkdown, navigate, revertFix, runAudit, toast } from '../actions';
import { compareAudits } from '../../shared/audit';
import { Badge, Banner, Button, Card, Empty, Icon } from '../components/ui';
import type { IconName } from '../components/ui';
import { CATEGORY_ROUTE, useAuditView } from '../components/hooks';
import { currentBaseline } from '../state';

const CATEGORY_ICON: Record<Category, IconName> = {
  performance: 'gauge',
  responsive: 'phone',
  accessibility: 'person',
  images: 'image',
  bundles: 'package',
  uxui: 'layers',
};

function Tile({ category, summary }: { category: Category; summary?: ReturnType<typeof summarizeByCategory>[number] }) {
  let status = 'Not run';
  let tone = 'none';
  if (summary) {
    if (summary.errors) {
      status = `${plural(summary.errors, 'error')}${summary.warnings ? `, ${summary.warnings} warn` : ''}`;
      tone = 'error';
    } else if (summary.warnings) {
      status = plural(summary.warnings, 'warning');
      tone = 'warning';
    } else {
      status = summary.infos ? plural(summary.infos, 'note') : 'All clear';
      tone = 'ok';
    }
  }
  return (
    <button type="button" className="tile" onClick={() => navigate(CATEGORY_ROUTE[category])}>
      <span className="tile-top">
        <Icon name={CATEGORY_ICON[category]} />
        <Icon name="chevron" />
      </span>
      <span>
        <span className="tile-name" style={{ display: 'block' }}>{CATEGORY_LABEL[category]}</span>
        <span className={`tile-status ${tone}`}>{status}</span>
      </span>
    </button>
  );
}

function Verification() {
  const { app, audit } = useAuditView();
  const baseline = currentBaseline(app);
  const fixes = Object.values(app.fixes);
  if (!fixes.length || !audit) return null;
  const diff = baseline ? compareAudits(baseline, audit) : null;
  const present = new Set(audit.findings.map((f) => f.id));

  return (
    <Card
      title="Fix verification"
      actions={
        <Button small variant="ghost" onClick={clearFixes}>
          Revert all
        </Button>
      }
    >
      {diff && (
        <p>
          Findings <strong>{diff.before}</strong> → <strong>{diff.after}</strong>{' '}
          <Badge tone={diff.after < diff.before ? 'ok' : diff.after > diff.before ? 'error' : undefined}>
            {diff.after - diff.before > 0 ? '+' : ''}
            {diff.after - diff.before}
          </Badge>
        </p>
      )}
      {diff && diff.byCategory.some((c) => c.before !== c.after) && (
        <div className="row wrap small">
          {diff.byCategory
            .filter((c) => c.before !== c.after)
            .map((c) => (
              <span key={c.category} className="muted">
                {CATEGORY_LABEL[c.category]}: {c.before} → {c.after}
              </span>
            ))}
        </div>
      )}
      <div className="list">
        {fixes.map((f) => {
          const resolved = f.findingId ? !present.has(f.findingId) : null;
          return (
            <div className="list-item" key={f.id}>
              <span className="grow ellipsis" title={f.label}>
                {f.label}
              </span>
              {resolved === true && <Badge tone="ok">Resolved</Badge>}
              {resolved === false && <Badge tone="warning">Still present</Badge>}
              {resolved === null && <Badge>Custom</Badge>}
              <Button small variant="ghost" onClick={() => revertFix(f.id)}>
                Revert
              </Button>
            </div>
          );
        })}
      </div>
      <p className="muted small">Temporary fixes exist only in this tab until you reload or close the panel. Capture screenshots before and after, then compare them in Screenshots.</p>
    </Card>
  );
}

export function Overview() {
  const { app, audit } = useAuditView();
  const { tab } = app;

  if (tab.status === 'restricted') {
    return (
      <Empty title="This page can't be inspected" icon="lock">
        <span>Browsers block extensions on internal pages (chrome://, the Web Store, new tab). Open a regular website and the toolkit will attach to it.</span>
      </Empty>
    );
  }

  const summaries = audit ? summarizeByCategory(audit.findings, CATEGORIES) : [];
  const recs = audit ? topRecommendations(audit.findings, 5) : [];
  const totals = {
    error: audit?.findings.filter((f) => f.severity === 'error').length ?? 0,
    warning: audit?.findings.filter((f) => f.severity === 'warning').length ?? 0,
    info: audit?.findings.filter((f) => f.severity === 'info').length ?? 0,
  };
  const v = app.vitals;

  return (
    <>
      {app.auditError && <Banner tone="error">{app.auditError}</Banner>}
      {audit?.truncated && <Banner tone="warn">This page is very large; the audit sampled the first 25,000 elements.</Banner>}

      <section className="card hero" aria-label="Audit summary">
        {audit ? (
          <>
            <div className="row between" style={{ alignItems: 'flex-end' }}>
              <div>
                <div className="hero-number">{audit.findings.length}</div>
                <div className="muted small">findings at {audit.snapshot.viewport.width} × {audit.snapshot.viewport.height}</div>
              </div>
              <Button variant="primary" icon="refresh" busy={app.auditRunning} disabled={tab.status !== 'ready'} onClick={() => runAudit()}>
                Re-run
              </Button>
            </div>
            <div className="sev-bar" role="img" aria-label={`${totals.error} errors, ${totals.warning} warnings, ${totals.info} notes`}>
              {totals.error > 0 && <span className="e" style={{ flex: totals.error }} />}
              {totals.warning > 0 && <span className="w" style={{ flex: totals.warning }} />}
              {totals.info > 0 && <span className="i" style={{ flex: totals.info }} />}
              {audit.findings.length === 0 && <span style={{ flex: 1, background: 'var(--success)' }} />}
            </div>
            <div className="legend">
              <span><i style={{ background: 'var(--destructive)' }} />{totals.error} errors</span>
              <span><i style={{ background: 'var(--warning)' }} />{totals.warning} warnings</span>
              <span><i style={{ background: 'var(--info)' }} />{totals.info} notes</span>
            </div>
          </>
        ) : (
          <>
            <div>
              <h2 className="section-title">Audit this page</h2>
              <p className="muted" style={{ marginTop: 2 }}>One click checks performance, layout, images, bundles, accessibility and design consistency — all inside your browser.</p>
            </div>
            <Button variant="primary" block icon="play" busy={app.auditRunning} disabled={tab.status !== 'ready'} onClick={() => runAudit()}>
              Run full audit
            </Button>
          </>
        )}
      </section>

      <div className="grid">
        {CATEGORIES.map((c) => (
          <Tile key={c} category={c} summary={summaries.find((s) => s.category === c)} />
        ))}
      </div>

      <Verification />

      {v && (v.lcp || v.fcp || v.cls > 0) && (
        <Card title="Web Vitals" actions={<button type="button" className="btn small ghost" onClick={() => navigate('performance')}>Details</button>}>
          <div className="row wrap">
            {(['lcp', 'cls', 'inp'] as const).map((name) => {
              const value = name === 'lcp' ? v.lcp?.value : name === 'cls' ? v.cls : v.inp?.value;
              const rating = rateVital(name, value ?? null);
              return (
                <Badge key={name} tone={rating === 'good' ? 'ok' : rating === 'poor' ? 'error' : rating ? 'warning' : undefined}>
                  {name.toUpperCase()} {formatVital(name, value ?? null)}
                </Badge>
              );
            })}
          </div>
        </Card>
      )}

      {recs.length > 0 && (
        <Card title="Top recommendations">
          <div className="list">
            {recs.map((r) => (
              <button
                key={r.ruleId}
                type="button"
                className="list-item"
                onClick={() => navigate(CATEGORY_ROUTE[r.category], r.findingIds[0])}
              >
                <Badge tone={r.severity}>{r.severity === 'error' ? 'Fix' : r.severity === 'warning' ? 'Improve' : 'Note'}</Badge>
                <span className="grow">
                  <span style={{ display: 'block' }}>{r.title}</span>
                  <span className="muted small">{r.how[0]}</span>
                </span>
                <Icon name="chevron" />
              </button>
            ))}
          </div>
        </Card>
      )}

      {!audit && !app.auditRunning && tab.status === 'ready' && (
        <Card title="How it works">
          <ol className="steps">
            <li><span><strong>Audit</strong> <span className="muted">to find problems with evidence.</span></span></li>
            <li><span><strong>Highlight</strong> <span className="muted">any finding to see it on the page.</span></span></li>
            <li><span><strong>Try a fix</strong> <span className="muted">temporarily, then verify it worked.</span></span></li>
            <li><span><strong>Capture &amp; compare</strong> <span className="muted">before and after screenshots.</span></span></li>
          </ol>
        </Card>
      )}

      {audit && (
        <Card title="Export">
          <div className="row wrap">
            <Button
              small
              icon="copy"
              onClick={async () => {
                await navigator.clipboard.writeText(exportMarkdown() ?? '');
                toast('Markdown report copied', 'success');
              }}
            >
              Copy Markdown
            </Button>
            <Button small icon="download" onClick={() => downloadAudit('md')}>
              .md
            </Button>
            <Button small icon="download" onClick={() => downloadAudit('json')}>
              .json
            </Button>
          </div>
        </Card>
      )}
    </>
  );
}
