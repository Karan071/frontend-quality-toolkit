import { useMemo, useState } from 'react';
import { formatBytes } from '@ftk/audit-core';
import { FLAG_LABEL, reportImages } from '@ftk/image-analyzer';
import type { ImageFlag, ImageReport } from '@ftk/image-analyzer';
import { highlightSelectors } from '../actions';
import { FindingList } from '../components/FindingList';
import { Badge, Card, Empty } from '../components/ui';
import { useAuditView } from '../components/hooks';

type Sort = 'issues' | 'bytes' | 'waste';

const TONE: Partial<Record<ImageFlag, 'error' | 'warning' | 'info'>> = {
  broken: 'error',
  oversized: 'warning',
  'large-file': 'warning',
  'legacy-format': 'warning',
  'no-dimensions': 'warning',
  'lazy-above-fold': 'warning',
  'srcset-no-sizes': 'warning',
  'no-lazy': 'info',
  'no-srcset': 'info',
  undersized: 'info',
};

const fileName = (src: string) => {
  if (src.startsWith('data:')) return 'inline data URI';
  try {
    const u = new URL(src);
    return decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? u.host);
  } catch {
    return src;
  }
};

function ImageRow({ report }: { report: ImageReport }) {
  const { image: img, flags, format } = report;
  return (
    <button type="button" className="list-item" style={{ alignItems: 'flex-start' }} onClick={() => highlightSelectors([img.selector], 'info')}>
      <span className="grow" style={{ minWidth: 0 }}>
        <span className="ellipsis" style={{ display: 'block', fontWeight: 600 }} title={img.src}>
          {fileName(img.src)}
        </span>
        <span className="muted small">
          {img.kind === 'bg' ? 'background' : `${img.naturalWidth}×${img.naturalHeight}`} → {Math.round(img.renderedWidth)}×{Math.round(img.renderedHeight)}
          {' · '}
          {img.bytes != null ? formatBytes(img.bytes) : 'size unknown'}
          {' · '}
          {format}
        </span>
        {flags.length > 0 && (
          <span className="row wrap" style={{ marginTop: 3, gap: 4 }}>
            {flags.map((f) => (
              <Badge key={f} tone={TONE[f]}>
                {FLAG_LABEL[f]}
              </Badge>
            ))}
          </span>
        )}
      </span>
    </button>
  );
}

export function Images() {
  const { audit, by } = useAuditView();
  const [sort, setSort] = useState<Sort>('issues');
  const [onlyIssues, setOnlyIssues] = useState(false);

  const reports = useMemo(
    () => (audit ? reportImages({ images: audit.snapshot.images, viewport: audit.snapshot.viewport, vitals: audit.snapshot.vitals }) : []),
    [audit],
  );

  const sorted = useMemo(() => {
    const list = onlyIssues ? reports.filter((r) => r.flags.length) : reports;
    const key = (r: ImageReport) => (sort === 'bytes' ? (r.image.bytes ?? 0) : sort === 'waste' ? r.wastedBytes : r.flags.length);
    return [...list].sort((a, b) => key(b) - key(a));
  }, [reports, sort, onlyIssues]);

  const known = reports.filter((r) => r.image.bytes != null);
  const total = known.reduce((n, r) => n + (r.image.bytes ?? 0), 0);
  const wasted = reports.reduce((n, r) => n + r.wastedBytes, 0);

  return (
    <>
      {audit && reports.length > 0 && (
        <div className="grid">
          <div className="metric">
            <span className="metric-name">Images</span>
            <span className="metric-value">{reports.length}</span>
          </div>
          <div className="metric">
            <span className="metric-name">Known weight</span>
            <span className="metric-value">{formatBytes(total)}</span>
            <span className="muted small">{known.length} of {reports.length} sized</span>
          </div>
          <div className="metric">
            <span className="metric-name">Potential savings</span>
            <span className="metric-value">{wasted ? formatBytes(wasted) : '—'}</span>
            <span className="muted small">from resizing</span>
          </div>
        </div>
      )}

      <FindingList findings={by('images')} hasAudit={!!audit} emptyTitle="Images look good" emptyHint="No oversized, heavy or layout-shifting images detected." />

      {audit && reports.length === 0 && (
        <Empty title="No images found">
          <span>This page has no &lt;img&gt; elements or CSS background images in the rendered DOM.</span>
        </Empty>
      )}

      {reports.length > 0 && (
        <Card
          title={`All images (${sorted.length})`}
          actions={
            <span className="row">
              <label className="row small">
                <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> Issues only
              </label>
              <select aria-label="Sort images" value={sort} onChange={(e) => setSort(e.target.value as Sort)} style={{ width: 'auto' }}>
                <option value="issues">Most issues</option>
                <option value="bytes">Largest file</option>
                <option value="waste">Most waste</option>
              </select>
            </span>
          }
        >
          <div className="list">
            {sorted.slice(0, 100).map((r, i) => (
              <ImageRow key={`${r.image.selector}-${i}`} report={r} />
            ))}
          </div>
          {sorted.length > 100 && <p className="muted small">Showing the first 100.</p>}
          <p className="muted small">File sizes come from Resource Timing, or a background HEAD request for cross-origin images. Clicking a row highlights it on the page.</p>
        </Card>
      )}
    </>
  );
}
