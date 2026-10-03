import { useEffect, useRef, useState } from 'react';
import type { EnrichedFinding } from '@ftk/audit-core';
import { applyFix, clearHighlight, guarded, highlightFinding, navigate, revertFix, screenshotFinding, selectSelector, toast } from '../actions';
import { useApp } from '../state';
import { Badge, Button, Icon, SeverityIcon } from './ui';

function EvidenceList({ evidence }: { evidence: NonNullable<EnrichedFinding['evidence']> }) {
  const entries = Object.entries(evidence).filter(([, v]) => v !== null && v !== '');
  if (!entries.length) return null;
  return (
    <dl className="evidence">
      {entries.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function FindingCard({ finding }: { finding: EnrichedFinding }) {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const highlighted = app.highlightedId === finding.id;
  const applied = app.fixes[finding.id];
  const hasElements = !!finding.selectors?.length;

  useEffect(() => {
    if (app.focusFinding === finding.id) {
      setOpen(true);
      ref.current?.scrollIntoView({ block: 'center' });
    }
  }, [app.focusFinding, finding.id]);

  return (
    <div className={`finding ${finding.severity} ${highlighted ? 'highlighted' : ''}`} ref={ref}>
      <button type="button" className={`finding-head ${finding.severity}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <SeverityIcon severity={finding.severity} />
        <span className="grow">
          <span className="finding-title">{finding.title}</span>
          {!open && <span className="finding-sub">{finding.message}</span>}
        </span>
        {applied && <Badge tone="ok">Fix applied</Badge>}
        <Icon name="chevron" className={`chev ${open ? 'open' : ''}`} />
      </button>

      {open && (
        <div className="finding-body">
          <p>{finding.message}</p>
          {finding.evidence && <EvidenceList evidence={finding.evidence} />}
          {finding.url && <code className="ellipsis" title={finding.url}>{finding.url}</code>}
          {hasElements && (
            <div className="row wrap">
              {finding.selectors!.slice(0, 6).map((s) => (
                <button
                  key={s}
                  type="button"
                  className="sel-chip"
                  title="Select in Inspect"
                  onClick={() => {
                    void guarded(async () => {
                      await selectSelector(s, { reveal: true });
                      navigate('inspect');
                    });
                  }}
                >
                  {s}
                </button>
              ))}
              {(finding.count ?? 0) > 6 && <span className="muted small">+{(finding.count ?? 0) - 6} more</span>}
            </div>
          )}

          <div>
            <div className="label">Why it matters</div>
            <p>{finding.recommendation.why}</p>
          </div>
          <div>
            <div className="label">How to fix</div>
            <ul className="how">
              {finding.recommendation.how.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          </div>
          {finding.fix && (
            <div>
              <div className="label">Temporary fix · {finding.fix.label}</div>
              <pre className="code">{finding.fix.css}</pre>
            </div>
          )}

          <div className="finding-actions">
            {hasElements && (
              <Button small icon="eye" aria-pressed={highlighted} onClick={() => (highlighted ? clearHighlight() : highlightFinding(finding))}>
                {highlighted ? 'Clear highlight' : 'Highlight'}
              </Button>
            )}
            {finding.fix &&
              (applied ? (
                <Button small icon="undo" onClick={() => revertFix(finding.id)}>
                  Revert fix
                </Button>
              ) : (
                <Button small variant="primary" icon="wand" onClick={() => applyFix(finding)}>
                  Try fix
                </Button>
              ))}
            <Button small icon="camera" onClick={() => screenshotFinding(finding)}>
              Screenshot
            </Button>
            {finding.fix && (
              <Button
                small
                icon="copy"
                onClick={async () => {
                  await navigator.clipboard.writeText(finding.fix!.css);
                  toast('CSS copied', 'success');
                }}
              >
                Copy CSS
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
