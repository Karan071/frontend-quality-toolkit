import { MAX_CAPTURE_HEIGHT, buildMeta, fitScale, planTiles, screenshotName } from './index';
import type {
  CaptureRequest,
  ElementTarget,
  PrepareInfo,
  Rect,
  ScreenshotRecord,
  ShotMeta,
} from './index';

/** Calls into the page (the content script). */
export interface PageDriver {
  prepare(opts: { mode: CaptureRequest['type']; keepHighlight: boolean }): Promise<PrepareInfo>;
  /** Pre-scrolls the page to trigger lazy content. Returns refreshed document size. */
  warmUp(): Promise<{ width: number; height: number }>;
  scroll(opts: { x: number; y: number; hide: 'none' | 'bottom' | 'top' | 'all' }): Promise<{ x: number; y: number }>;
  element(selector: string): Promise<ElementTarget | null>;
  restore(): Promise<void>;
}

export interface EngineDeps {
  driver: PageDriver;
  /** Grabs the currently visible viewport pixels. */
  grab(): Promise<ImageBitmap>;
  progress?(done: number, total: number): void;
}

export type CaptureOutput = Omit<ScreenshotRecord, 'id' | 'createdAt'>;

async function encode(canvas: OffscreenCanvas, format: CaptureRequest['format'], quality: number): Promise<Blob> {
  return canvas.convertToBlob(
    format === 'jpeg' ? { type: 'image/jpeg', quality: Math.min(1, Math.max(0.1, quality)) } : { type: 'image/png' },
  );
}

function newCanvas(width: number, height: number, format: CaptureRequest['format']) {
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
  const ctx = canvas.getContext('2d')!;
  if (format === 'jpeg') {
    // JPEG has no alpha: transparent areas would turn black.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  return { canvas, ctx };
}

/**
 * Captures a viewport, full page or element.
 *
 * Full-page and large-element captures scroll the document tile by tile. Fixed
 * and sticky elements are handled by the page driver (sticky → in-flow; fixed →
 * shown only in the first/last tile) so they are never duplicated in the output.
 */
export async function capture(req: CaptureRequest, { driver, grab, progress }: EngineDeps): Promise<CaptureOutput> {
  const warnings: string[] = [];
  const info = await driver.prepare({ mode: req.type, keepHighlight: !!req.keepHighlight });
  warnings.push(...info.warnings);
  try {
    let width: number;
    let height: number;
    let blob: Blob;
    let scaledDown = false;
    let truncated = false;

    if (req.type === 'viewport') {
      const frame = await grab();
      width = frame.width;
      height = frame.height;
      const { canvas, ctx } = newCanvas(width, height, req.format);
      ctx.drawImage(frame, 0, 0);
      frame.close();
      blob = await encode(canvas, req.format, req.quality);
      return finish(blob, width, height, req, info, warnings, false, false);
    }

    let region: Rect;
    if (req.type === 'element') {
      if (!req.selector) throw new Error('No element selected.');
      const target = await driver.element(req.selector);
      if (!target) throw new Error('The selected element is no longer on the page.');
      if (target.rect.width < 1 || target.rect.height < 1) throw new Error('The selected element has no visible size.');
      if (target.fits) {
        // Single frame, no fixed-element juggling: also works for fixed/sticky targets.
        const frame = await grab();
        const scale = frame.width / info.viewport.width;
        const sx = Math.max(0, Math.round(target.rect.x * scale));
        const sy = Math.max(0, Math.round(target.rect.y * scale));
        const sw = Math.min(frame.width - sx, Math.round(target.rect.width * scale));
        const sh = Math.min(frame.height - sy, Math.round(target.rect.height * scale));
        const { canvas, ctx } = newCanvas(sw, sh, req.format);
        ctx.drawImage(frame, sx, sy, sw, sh, 0, 0, sw, sh);
        frame.close();
        blob = await encode(canvas, req.format, req.quality);
        return finish(blob, sw, sh, req, info, warnings, false, false);
      }
      region = target.docRect;
    } else {
      const doc = await driver.warmUp();
      info.doc = doc;
      region = { x: 0, y: 0, width: doc.width, height: doc.height };
    }

    if (region.height > MAX_CAPTURE_HEIGHT) {
      region = { ...region, height: MAX_CAPTURE_HEIGHT };
      truncated = true;
      warnings.push(`Page is very tall; capture stopped at ${MAX_CAPTURE_HEIGHT.toLocaleString()} px.`);
    }

    const tiles = planTiles(region, info.viewport, info.doc, info.bottomFixedHeight);
    const requestedScale = info.viewport.dpr || 1;
    const scale = fitScale(region.width, region.height, requestedScale);
    if (scale < requestedScale - 0.001) {
      scaledDown = true;
      warnings.push('Image exceeds browser canvas limits and was scaled down.');
    }
    width = Math.round(region.width * scale);
    height = Math.round(region.height * scale);
    const { canvas, ctx } = newCanvas(width, height, req.format);

    let done = 0;
    for (const tile of tiles) {
      const actual = await driver.scroll({ x: tile.scrollX, y: tile.scrollY, hide: tile.hide });
      const frame = await grab();
      // Frame pixels per CSS px (equals dpr, or the emulated scale under device emulation).
      const k = frame.width / info.viewport.width;
      const srcX = (tile.draw.x - actual.x) * k;
      const srcY = (tile.draw.y - actual.y) * k;
      const srcW = Math.min(tile.draw.width * k, frame.width - srcX);
      const srcH = Math.min(tile.draw.height * k, frame.height - srcY);
      if (srcW > 0 && srcH > 0) {
        ctx.drawImage(
          frame,
          Math.max(0, srcX), Math.max(0, srcY), srcW, srcH,
          (tile.draw.x - region.x) * scale, (tile.draw.y - region.y) * scale,
          (srcW / k) * scale, (srcH / k) * scale,
        );
      }
      frame.close();
      progress?.(++done, tiles.length);
    }
    blob = await encode(canvas, req.format, req.quality);
    return finish(blob, width, height, req, info, warnings, scaledDown, truncated);
  } finally {
    await driver.restore().catch(() => undefined);
  }
}

function finish(
  blob: Blob,
  width: number,
  height: number,
  req: CaptureRequest,
  info: PrepareInfo,
  warnings: string[],
  scaledDown: boolean,
  truncated: boolean,
): CaptureOutput {
  const meta: ShotMeta = buildMeta(info, req);
  // The name reports CSS pixels for viewport/full page so it matches the page, not the device.
  const cssW = req.type === 'fullpage' ? info.doc.width : info.viewport.width;
  const cssH = req.type === 'fullpage' ? Math.min(info.doc.height, MAX_CAPTURE_HEIGHT) : info.viewport.height;
  return {
    name: screenshotName({ url: info.url, type: req.type, format: req.format, width: cssW, height: cssH, selector: req.selector }),
    type: req.type,
    format: req.format,
    width,
    height,
    bytes: blob.size,
    meta,
    blob,
    scaledDown,
    truncated,
    warnings,
  };
}
