import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { ASSET_FOLDER, extFromMime, planZipPaths } from './index';
import type { AssetSample } from './index';

export interface FetchedAsset {
  bytes: Uint8Array;
  contentType?: string;
}

export interface ZipProgress {
  done: number;
  total: number;
  failed: number;
  /** Bytes added so far. */
  bytes: number;
  current?: string;
}

export interface ZipResult {
  blob: Blob;
  added: number;
  failed: { asset: AssetSample; error: string }[];
  bytes: number;
  cancelled: boolean;
}

const TEXT_TYPES = new Set(['css', 'js', 'svg', 'document', 'other']);
const ENC = new TextEncoder();

/**
 * Downloads the assets (a few at a time) and writes them into a ZIP, one folder per type, plus an
 * `assets.json` index. Individual failures never abort the archive: they are listed in
 * `_failed.txt` and returned. Text types are deflated; already-compressed media is stored.
 */
export async function buildZip(
  assets: AssetSample[],
  fetchBytes: (a: AssetSample) => Promise<FetchedAsset>,
  opts: { onProgress?: (p: ZipProgress) => void; concurrency?: number; signal?: { cancelled: boolean }; source?: { url: string; title: string } } = {},
): Promise<ZipResult> {
  const paths = planZipPaths(assets);
  const chunks: Uint8Array[] = [];
  let resolveEnded: () => void = () => undefined;
  let rejectEnded: (e: unknown) => void = () => undefined;
  const ended = new Promise<void>((res, rej) => {
    resolveEnded = res;
    rejectEnded = rej;
  });
  const zip = new Zip((err, chunk, final) => {
    if (err) return rejectEnded(err);
    chunks.push(chunk);
    if (final) resolveEnded();
  });

  const failed: ZipResult['failed'] = [];
  const index: Record<string, unknown>[] = [];
  let done = 0;
  let bytes = 0;
  let added = 0;
  let next = 0;
  const report = (current?: string) => opts.onProgress?.({ done, total: assets.length, failed: failed.length, bytes, current });

  const addFile = (path: string, data: Uint8Array, text: boolean) => {
    const file = text ? new ZipDeflate(path, { level: 6 }) : new ZipPassThrough(path);
    zip.add(file);
    file.push(data, true);
  };

  async function worker() {
    while (next < assets.length && !opts.signal?.cancelled) {
      const a = assets[next++];
      const path = paths.get(a.id)!;
      report(a.name);
      try {
        const got = await fetchBytes(a);
        // A path with no usable extension (server sent a generic name) can be improved from the MIME type.
        let finalPath = path;
        const ext = extFromMime(got.contentType);
        if (ext && !/\.[A-Za-z0-9]{1,6}$/.test(path)) finalPath = `${path}.${ext}`;
        addFile(finalPath, got.bytes, TEXT_TYPES.has(a.type));
        bytes += got.bytes.byteLength;
        added++;
        index.push({ path: finalPath, url: a.url.startsWith('data:') ? '(data URI)' : a.url, type: a.type, bytes: got.bytes.byteLength, sources: a.sources, width: a.width, height: a.height, selector: a.selector });
      } catch (e) {
        failed.push({ asset: a, error: e instanceof Error ? e.message : String(e) });
      }
      done++;
      report();
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 5, assets.length)) }, worker));

  addFile(
    'assets.json',
    ENC.encode(JSON.stringify({ source: opts.source ?? null, createdAt: new Date().toISOString(), count: added, folders: Object.values(ASSET_FOLDER), assets: index }, null, 2)),
    true,
  );
  if (failed.length) {
    addFile('_failed.txt', ENC.encode(failed.map((f) => `${f.asset.url}\t${f.error}`).join('\n') + '\n'), true);
  }
  zip.end();
  await ended;
  return { blob: new Blob(chunks as BlobPart[], { type: 'application/zip' }), added, failed, bytes, cancelled: !!opts.signal?.cancelled };
}
