import { isSafeFetchUrl } from '@ftk/audit-core';
import { extFromMime } from '@ftk/asset-extractor';
import type { AssetSample } from '@ftk/asset-extractor';
import type { FetchedAsset } from '@ftk/asset-extractor/zip';
import { MAX_ASSET_BYTES, readCapped } from '../shared/fetch';

/**
 * Fetches an asset's bytes. The panel is an extension page with host permissions, so cross-origin
 * files download without CORS. Cookies are not sent, so private (login-protected) files fail and
 * are reported rather than silently skipped.
 */
export async function fetchAssetBytes(a: AssetSample, pageUrl?: string): Promise<FetchedAsset> {
  if (a.svg) return { bytes: new TextEncoder().encode(a.svg), contentType: 'image/svg+xml' };
  if (a.url.startsWith('data:')) {
    const res = await fetch(a.url);
    return { bytes: await readCapped(res, MAX_ASSET_BYTES), contentType: res.headers.get('content-type') ?? undefined };
  }
  // The page picks these URLs, so keep requests out of the user's local network.
  if (!isSafeFetchUrl(a.url, pageUrl)) throw new Error('Blocked: not a public http(s) address');
  const res = await fetch(a.url, { credentials: 'omit', signal: AbortSignal.timeout(45_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!isSafeFetchUrl(res.url || a.url, pageUrl)) throw new Error('Blocked: redirected to a non-public address');
  return { bytes: await readCapped(res, MAX_ASSET_BYTES), contentType: res.headers.get('content-type') ?? undefined };
}

/** Name for a single-file download, fixing a missing extension from the real content type. */
export function downloadName(a: AssetSample, contentType?: string): string {
  if (/\.[A-Za-z0-9]{1,6}$/.test(a.name)) return a.name;
  const ext = extFromMime(contentType);
  return ext ? `${a.name}.${ext}` : a.name;
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
