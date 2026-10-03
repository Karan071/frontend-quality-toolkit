import { useMemo, useState } from 'react';
import { formatBytes, formatMs } from '@ftk/audit-core';
import type { ResourceSample } from '@ftk/audit-core';
import { resourceBytes, summarizeBundles } from '@ftk/bundle-analyzer';
import { FindingList } from '../components/FindingList';
import { Badge, Bar, Card } from '../components/ui';
import { useAuditView } from '../components/hooks';

const name = (url: string) => {
  try {
    const u = new URL(url);
    return u.pathname.split('/').filter(Boolean).pop() || u.host;
  } catch {
    return url;
  }
};

function Stat({ label, bytes, count, note }: { label: string; bytes: number; count: number; note?: string }) {
  return (
    <div className="metric">
      <span className="metric-name">{label}</span>
      <span className="metric-value">{formatBytes(bytes)}</span>
      <span className="muted small">
        {count} request{count === 1 ? '' : 's'}
        {note ? ` · ${note}` : ''}
      </span>
    </div>
  );
}

function ResourceRow({ r, max }: { r: ResourceSample; max: number }) {
  const bytes = resourceBytes(r);
  const tone = bytes != null && bytes > (r.type === 'script' ? 300 : 150) * 1024 ? 'error' : bytes != null && bytes > (r.type === 'script' ? 150 : 50) * 1024 ? 'warn' : undefined;
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 3 }}>
      <div className="row between">
        <span className="ellipsis" style={{ fontWeight: 600 }} title={r.url}>
          {name(r.url)}
        </span>
        <span className="mono">{bytes != null ? formatBytes(bytes) : '—'}</span>
      </div>
      <Bar value={bytes ?? 0} max={max} tone={tone} />
      <div className="row wrap small muted" style={{ gap: 4 }}>
        <Badge>{r.type}</Badge>
        {r.thirdParty && <Badge tone="info">3rd party</Badge>}
        {r.renderBlocking && <Badge tone="warning">blocking</Badge>}
        <span>{r.host}</span>
        <span>· {formatMs(r.duration)}</span>
        {r.decodedSize > 0 && bytes != null && r.decodedSize > bytes * 1.2 && <span>· {formatBytes(r.decodedSize)} raw</span>}
      </div>
    </div>
  );
}

export function Bundles() {
  const { audit, by } = useAuditView();
  const [filter, setFilter] = useState<'all' | 'script' | 'css' | 'third'>('all');
  const summary = useMemo(() => (audit ? summarizeBundles(audit.snapshot.resources) : null), [audit]);

  const rows = useMemo(() => {
    if (!audit) return [];
    return audit.snapshot.resources
      .filter((r) => (filter === 'all' ? ['script', 'css'].includes(r.type) : filter === 'third' ? r.thirdParty : r.type === filter))
      .sort((a, b) => (resourceBytes(b) ?? -1) - (resourceBytes(a) ?? -1));
  }, [audit, filter]);

  const max = Math.max(1, ...rows.map((r) => resourceBytes(r) ?? 0));

  return (
    <>
      {summary && (
        <div className="grid">
          <Stat label="JavaScript" bytes={summary.script.bytes} count={summary.script.count} note={summary.script.thirdPartyBytes ? `${formatBytes(summary.script.thirdPartyBytes)} 3rd party` : undefined} />
          <Stat label="CSS" bytes={summary.css.bytes} count={summary.css.count} />
          <Stat label="Images" bytes={summary.image.bytes} count={summary.image.count} />
          <Stat label="Fonts" bytes={summary.font.bytes} count={summary.font.count} />
        </div>
      )}

      <FindingList findings={by('bundles')} hasAudit={!!audit} emptyTitle="Bundles look lean" emptyHint="No oversized, blocking or uncompressed scripts and stylesheets detected." />

      {summary && summary.thirdParty.length > 0 && (
        <Card title={`Third parties (${summary.thirdParty.length})`}>
          <div className="list">
            {summary.thirdParty.slice(0, 10).map((h) => (
              <div key={h.host} className="list-item">
                <span className="grow ellipsis" title={h.host}>{h.host}</span>
                <Badge>{h.category}</Badge>
                <span className="mono small">{h.bytes ? formatBytes(h.bytes) : `${h.requests} req`}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {audit && (
        <Card
          title="Scripts & stylesheets"
          actions={
            <select aria-label="Filter resources" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} style={{ width: 'auto' }}>
              <option value="all">JS + CSS</option>
              <option value="script">JavaScript</option>
              <option value="css">CSS</option>
              <option value="third">Third-party</option>
            </select>
          }
        >
          <div className="list">
            {rows.slice(0, 60).map((r) => (
              <ResourceRow key={r.url} r={r} max={max} />
            ))}
            {rows.length === 0 && <div className="list-item muted">No matching resources.</div>}
          </div>
          <p className="muted small">
            Sizes are transferred (compressed) bytes. Cross-origin resources that hide their size are measured with a background HEAD request; “—” means the server did not say.
          </p>
        </Card>
      )}
    </>
  );
}
