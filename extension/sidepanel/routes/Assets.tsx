import { useMemo, useState } from 'react';
import { formatBytes, isSafeFetchUrl } from '@ftk/audit-core';
import { ASSET_LABEL, ASSET_TYPES, countByType, totalBytes } from '@ftk/asset-extractor';
import type { AssetSample, AssetType } from '@ftk/asset-extractor';
import { cancelAssetDownload, downloadAsset, downloadAssetsZip, highlightSelectors, scanAssets, toast } from '../actions';
import { svgDataUrl } from '../assets';
import { Badge, Banner, Button, Card, Empty, Icon } from '../components/ui';
import type { IconName } from '../components/ui';
import { useApp } from '../state';

const TYPE_ICON: Record<AssetType, IconName> = {
  image: 'image', svg: 'image', icon: 'image', font: 'type', css: 'file', js: 'code', media: 'film', document: 'file', other: 'file',
};

const PAGE_SIZE = 150;

function Thumb({ a }: { a: AssetSample }) {
  const { tab } = useApp();
  // Thumbnails load from this extension's origin, so URLs the page points at the user's local
  // network (127.0.0.1, 192.168.x.x…) are not requested.
  const src = a.svg ? svgDataUrl(a.svg) : a.url.startsWith('data:') || isSafeFetchUrl(a.url, tab.url) ? a.url : null;
  const visual = (a.type === 'image' || a.type === 'icon' || a.type === 'svg') && src;
  return (
    <span className="asset-thumb" aria-hidden="true">
      {visual ? <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : <Icon name={TYPE_ICON[a.type]} />}
    </span>
  );
}

function AssetRow({ a, checked, onToggle }: { a: AssetSample; checked: boolean; onToggle: () => void }) {
  const size = a.bytes ? formatBytes(a.bytes) : a.bytes === 0 ? '' : '…';
  const dims = a.width && a.height ? `${a.width}×${a.height}` : '';
  return (
    <div className={`asset ${checked ? 'selected' : ''}`}>
      <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Select ${a.name}`} />
      <Thumb a={a} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="ellipsis asset-name" title={a.url.startsWith('data:') ? '(data URI)' : a.url}>
          {a.name}
        </div>
        <div className="muted small ellipsis">
          {[ASSET_LABEL[a.type], dims, a.descriptor, size, a.sources.slice(0, 2).join(' + '), a.host].filter(Boolean).join(' · ')}
        </div>
      </div>
      {a.thirdParty && <Badge tone="info">3rd</Badge>}
      <span className="row" style={{ gap: 2 }}>
        <Button small variant="ghost" icon="download" aria-label={`Download ${a.name}`} title="Download" onClick={() => downloadAsset(a)} />
        {/^https?:/.test(a.url) && (
          <Button small variant="ghost" icon="open" aria-label={`Open ${a.name} in a new tab`} title="Open in a new tab" onClick={() => chrome.tabs.create({ url: a.url, active: false })} />
        )}
        <Button
          small
          variant="ghost"
          icon="copy"
          aria-label={`Copy URL of ${a.name}`}
          title="Copy URL"
          disabled={a.url.startsWith('data:') || a.url.startsWith('inline-svg:')}
          onClick={async () => {
            await navigator.clipboard.writeText(a.url);
            toast('URL copied', 'success');
          }}
        />
        {a.selector && <Button small variant="ghost" icon="eye" aria-label={`Highlight ${a.name} on the page`} title="Highlight on the page" onClick={() => highlightSelectors([a.selector!], 'info')} />}
      </span>
    </div>
  );
}

export function Assets() {
  const app = useApp();
  const { assets, assetsScanning, assetProgress, tab } = app;
  const [filter, setFilter] = useState<AssetType | 'all'>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(PAGE_SIZE);
  const ready = tab.status === 'ready';

  const items = useMemo(() => assets?.items ?? [], [assets]);
  const counts = useMemo(() => countByType(items), [items]);
  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () => items.filter((a) => (filter === 'all' || a.type === filter) && (!q || a.name.toLowerCase().includes(q) || a.url.toLowerCase().includes(q) || a.host.toLowerCase().includes(q))),
    [items, filter, q],
  );
  const picked = items.filter((a) => selected.has(a.id));
  const allVisibleSelected = visible.length > 0 && visible.every((a) => selected.has(a.id));
  const toggleVisible = () =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (allVisibleSelected) visible.forEach((a) => next.delete(a.id));
      else visible.forEach((a) => next.add(a.id));
      return next;
    });
  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <>
      <div className="row between wrap">
        <span className="section-title">Page assets</span>
        <Button variant="primary" icon={assets ? 'refresh' : 'search'} busy={assetsScanning} disabled={!ready} onClick={scanAssets}>
          {assets ? 'Rescan' : 'Scan assets'}
        </Button>
      </div>

      {!assets && !assetsScanning && (
        <Empty title="Find every file this page uses" icon="archive">
          <span>Images (including every srcset size and lazy-loaded one), inline SVG, icons, fonts, stylesheets, scripts, video/audio and linked documents. Download any of them, or everything as a ZIP organised by type.</span>
        </Empty>
      )}
      {assets?.truncated && <Banner tone="warn">Very large page: the list was capped at 2,500 assets.</Banner>}

      {assets && (
        <>
          <div className="chips" role="group" aria-label="Asset type">
            <button type="button" className="chip-btn" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
              All<span className="chip-n">{items.length}</span>
            </button>
            {ASSET_TYPES.filter((t) => counts[t] > 0).map((t) => (
              <button key={t} type="button" className="chip-btn" aria-pressed={filter === t} onClick={() => setFilter(t)}>
                {ASSET_LABEL[t]}
                <span className="chip-n">{counts[t]}</span>
              </button>
            ))}
          </div>

          <input type="search" className="search" placeholder="Filter by name, URL or host…" aria-label="Filter assets" value={query} onChange={(e) => { setQuery(e.target.value); setShown(PAGE_SIZE); }} />

          <Card>
            <div className="row between wrap">
              <label className="row small">
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} /> Select all {visible.length}
              </label>
              <span className="muted small">
                {picked.length ? `${picked.length} selected${totalBytes(picked) ? ` · ${formatBytes(totalBytes(picked))}` : ''}` : `${items.length} assets · ${formatBytes(totalBytes(items))} known`}
              </span>
            </div>
            <div className="row wrap">
              <Button small variant="primary" icon="download" disabled={!picked.length || !!assetProgress} onClick={() => downloadAssetsZip(picked, 'selected')}>
                Download selected ({picked.length})
              </Button>
              <Button small icon="archive" disabled={!items.length || !!assetProgress} onClick={() => downloadAssetsZip(items, 'all')}>
                Download all as ZIP ({items.length})
              </Button>
              {visible.length !== items.length && visible.length > 0 && (
                <Button small variant="ghost" disabled={!!assetProgress} onClick={() => downloadAssetsZip(visible, 'filtered')}>
                  Download these {visible.length}
                </Button>
              )}
            </div>
            {assetProgress && (
              <div className="stack" style={{ gap: 6 }} role="status">
                <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={assetProgress.total} aria-valuenow={assetProgress.done} aria-label="Downloading assets">
                  <span style={{ width: `${(assetProgress.done / Math.max(1, assetProgress.total)) * 100}%` }} />
                </div>
                <div className="row between small muted">
                  <span>
                    Downloading {assetProgress.done}/{assetProgress.total} · {formatBytes(assetProgress.bytes)}
                    {assetProgress.failed ? ` · ${assetProgress.failed} failed` : ''}
                  </span>
                  <Button small variant="ghost" onClick={cancelAssetDownload}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </Card>

          {visible.length === 0 ? (
            <Empty title="No assets match" icon="search">
              <span>Try another type or clear the filter.</span>
            </Empty>
          ) : (
            <div className="list asset-list">
              {visible.slice(0, shown).map((a) => (
                <AssetRow key={a.id} a={a} checked={selected.has(a.id)} onToggle={() => toggle(a.id)} />
              ))}
            </div>
          )}
          {visible.length > shown && (
            <Button onClick={() => setShown((n) => n + PAGE_SIZE)}>
              Show {Math.min(PAGE_SIZE, visible.length - shown)} more ({visible.length - shown} hidden)
            </Button>
          )}
          <p className="muted small">
            Files are downloaded by your browser directly from the site (without cookies), so login-protected files may fail and are listed in the ZIP's <code>_failed.txt</code>. Thumbnails load from the site itself. Only download assets you have the right to use.
          </p>
        </>
      )}
    </>
  );
}
