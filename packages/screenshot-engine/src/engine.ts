import { MAX_CAPTURE_HEIGHT, MAX_CAPTURE_WIDTH, buildMeta, planParts, planTiles, screenshotName } from './index';
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
  /** Pre-scrolls the page (or inner scroller) to trigger lazy content. Returns the refreshed scrollable size. */
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
 * Full-page and large-element captures scroll tile by tile. Fixed and sticky elements are
 * handled by the page driver (sticky → in-flow; fixed → shown only in the first/last tile)
 * so they are never duplicated. Pages that scroll inside a container are stitched from that
 * container. Output taller than one canvas can hold is split into full-resolution parts
 * rather than being scaled down.
 */
export async function capture(req: CaptureRequest, { driver, grab, progress }: EngineDeps): Promise<CaptureOutput[]> {
  const warnings: string[] = [];
  const info = await driver.prepare({ mode: req.type, keepHighlight: !!req.keepHighlight });
  warnings.push(...info.warnings);
  try {
    if (req.type === 'viewport') {
      const frame = await grab();
      const { canvas, ctx } = newCanvas(frame.width, frame.height, req.format);
      ctx.drawImage(frame, 0, 0);
      const [w, h] = [frame.width, frame.height];
      frame.close();
      return [finish(await encode(canvas, req.format, req.quality), w, h, req, info, warnings)];
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
        return [finish(await encode(canvas, req.format, req.quality), sw, sh, req, info, warnings)];
      }
      region = target.docRect;
    } else {
      const doc = await driver.warmUp();
      if (info.scroller) info.scroller = { ...info.scroller, scrollWidth: doc.width, scrollHeight: doc.height };
      else info.doc = doc;
      region = { x: 0, y: 0, width: doc.width, height: doc.height };
    }

    // Inner scroller: tiles are viewport-sized windows onto the container's content box.
    const sc = req.type === 'fullpage' ? info.scroller : undefined;
    const tileViewport = sc ? { width: sc.rect.width, height: sc.rect.height } : info.viewport;
    const tileDoc = sc ? { width: sc.scrollWidth, height: sc.scrollHeight } : info.doc;
    const offset = sc ? { x: sc.rect.x, y: sc.rect.y } : { x: 0, y: 0 };

    let truncated = false;
    if (region.height > MAX_CAPTURE_HEIGHT) {
      region = { ...region, height: MAX_CAPTURE_HEIGHT };
      truncated = true;
      warnings.push(`Page is very tall; capture stopped at ${MAX_CAPTURE_HEIGHT.toLocaleString()} px.`);
    }

    if (region.width > MAX_CAPTURE_WIDTH) {
      region = { ...region, width: MAX_CAPTURE_WIDTH };
      truncated = true;
      warnings.push(`Page is very wide; capture stopped at ${MAX_CAPTURE_WIDTH.toLocaleString()} px.`);
    }

    const requestedScale = info.viewport.dpr || 1;
    const plan = planParts(region, requestedScale);
    if (plan.scale < requestedScale - 0.001) warnings.push('Page is wider than one browser canvas allows; the image was scaled down.');
    if (plan.parts.length > 1) warnings.push(`Page is taller than one browser canvas allows; saved as ${plan.parts.length} full-resolution parts.`);
    const canvases = plan.parts.map((p) => newCanvas(p.width * plan.scale, p.height * plan.scale, req.format));

    const tiles = planTiles(region, tileViewport, tileDoc, sc ? 0 : info.bottomFixedHeight);
    let done = 0;
    for (const tile of tiles) {
      const actual = await driver.scroll({ x: tile.scrollX, y: tile.scrollY, hide: sc ? 'all' : tile.hide });
      const frame = await grab();
      // Frame pixels per CSS px (equals dpr, or the emulated scale under device emulation).
      const k = frame.width / info.viewport.width;
      plan.parts.forEach((part, i) => {
        // Rows of this tile that belong to this part, in document CSS px.
        const top = Math.max(tile.draw.y, part.y);
        const bottom = Math.min(tile.draw.y + tile.draw.height, part.y + part.height);
        if (bottom <= top) return;
        const srcX = (tile.draw.x - actual.x + offset.x) * k;
        const srcY = (top - actual.y + offset.y) * k;
        const srcW = Math.min(tile.draw.width * k, frame.width - srcX);
        const srcH = Math.min((bottom - top) * k, frame.height - srcY);
        if (srcW <= 0 || srcH <= 0) return;
        canvases[i].ctx.drawImage(
          frame,
          Math.max(0, srcX), Math.max(0, srcY), srcW, srcH,
          (tile.draw.x - region.x) * plan.scale, (top - part.y) * plan.scale,
          (srcW / k) * plan.scale, (srcH / k) * plan.scale,
        );
      });
      frame.close();
      progress?.(++done, tiles.length);
    }

    const out: CaptureOutput[] = [];
    for (let i = 0; i < canvases.length; i++) {
      const { canvas } = canvases[i];
      const blob = await encode(canvas, req.format, req.quality);
      out.push(finish(blob, canvas.width, canvas.height, req, info, warnings, truncated, plan.parts.length > 1 ? { index: i + 1, total: plan.parts.length } : undefined, plan.scale < requestedScale - 0.001));
    }
    return out;
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
  truncated = false,
  part?: { index: number; total: number },
  scaledDown = false,
): CaptureOutput {
  const meta: ShotMeta = buildMeta(info, req);
  // The name reports CSS pixels for viewport/full page so it matches the page, not the device.
  const sc = info.scroller;
  const cssW = req.type === 'fullpage' ? (sc?.scrollWidth ?? info.doc.width) : info.viewport.width;
  const cssH = req.type === 'fullpage' ? Math.min(sc?.scrollHeight ?? info.doc.height, MAX_CAPTURE_HEIGHT) : info.viewport.height;
  return {
    name: screenshotName({ url: info.url, type: req.type, format: req.format, width: cssW, height: cssH, selector: req.selector, part }),
    type: req.type,
    format: req.format,
    width,
    height,
    bytes: blob.size,
    meta: part ? { ...meta, label: [meta.label, `part ${part.index}/${part.total}`].filter(Boolean).join(' · ') } : meta,
    blob,
    scaledDown,
    truncated,
    warnings,
  };
}
