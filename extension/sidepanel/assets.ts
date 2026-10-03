import { extFromMime } from '@ftk/asset-extractor';
import type { AssetSample } from '@ftk/asset-extractor';
import type { FetchedAsset } from '@ftk/asset-extractor/zip';

/**
 * Fetches an asset's bytes. The panel is an extension page with host permissions, so cross-origin
 * files download without CORS. Cookies are not sent, so private (login-protected) files fail and
 * are reported rather than silently skipped.
 */
export async function fetchAssetBytes(a: AssetSample): Promise<FetchedAsset> {
  if (a.svg) return { bytes: new TextEncoder().encode(a.svg), contentType: 'image/svg+xml' };
  const res = await fetch(a.url, { credentials: 'omit', signal: AbortSignal.timeout(45_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get('content-type') ?? undefined };
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
