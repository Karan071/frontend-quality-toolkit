import type { EnrichedFinding } from '@ftk/audit-core';
import { plural } from '@ftk/audit-core';
import { FindingCard } from './FindingCard';
import { Banner, Empty } from './ui';

export function severityCounts(findings: { severity: string }[]) {
  return {
    error: findings.filter((f) => f.severity === 'error').length,
    warning: findings.filter((f) => f.severity === 'warning').length,
    info: findings.filter((f) => f.severity === 'info').length,
  };
}

export function SeveritySummary({ findings }: { findings: { severity: string }[] }) {
  const c = severityCounts(findings);
  return (
    <span className="muted small">
      {plural(c.error, 'error')} · {plural(c.warning, 'warning')} · {c.info} info
    </span>
  );
}

/** Findings list with a one-line summary; renders an "all clear" state when empty. */
export function FindingList({
  findings,
  hasAudit,
  emptyTitle = 'No issues found',
  emptyHint,
}: {
  findings: EnrichedFinding[];
  hasAudit: boolean;
  emptyTitle?: string;
  emptyHint?: string;
}) {
  if (!hasAudit) {
    return (
      <Banner>
        <span>Run the audit from Overview to see findings here.</span>
      </Banner>
    );
  }
  if (!findings.length) {
    return (
      <Empty title={emptyTitle}>
        <span>{emptyHint ?? 'Nothing to report in this area.'}</span>
      </Empty>
    );
  }
  return (
    <div className="stack">
      <div className="row between">
        <span className="section-title">Findings ({findings.length})</span>
        <SeveritySummary findings={findings} />
      </div>
      {findings.map((f) => (
        <FindingCard key={f.id} finding={f} />
      ))}
    </div>
  );
}
