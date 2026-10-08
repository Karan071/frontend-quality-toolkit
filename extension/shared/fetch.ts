/**
 * Bounded reading of fetch responses. Servers can stream endless or heavily compressed bodies
 * (fetch inflates them transparently), so size is counted on the decoded stream, not the headers.
 */

export class TooLargeError extends Error {
  constructor(limit: number) {
    super(`Larger than the ${Math.round(limit / 1024 / 1024)} MB limit`);
    this.name = 'TooLargeError';
  }
}

/**
 * Reads at most `limit` bytes. When the body is longer, throws TooLargeError, or, with
 * `truncate`, returns what fit and cancels the rest of the transfer.
 */
export async function readCapped(res: Response, limit: number, opts: { truncate?: boolean } = {}): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length'));
  if (!opts.truncate && Number.isFinite(declared) && declared > limit) {
    await res.body?.cancel().catch(() => undefined);
    throw new TooLargeError(limit);
  }
  if (!res.body) return new Uint8Array(await res.arrayBuffer());

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.byteLength > limit) {
      await reader.cancel().catch(() => undefined);
      if (!opts.truncate) throw new TooLargeError(limit);
      chunks.push(value.subarray(0, limit - total));
      total = limit;
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Text of a response, cut off after `limit` bytes. */
export async function readTextCapped(res: Response, limit: number): Promise<string> {
  return new TextDecoder().decode(await readCapped(res, limit, { truncate: true }));
}

/** Per-file ceiling for asset downloads. */
export const MAX_ASSET_BYTES = 50 * 1024 * 1024;
/** Stylesheet text read for auditing; larger sheets are truncated. */
export const MAX_CSS_BYTES = 800_000;
