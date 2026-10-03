import { deviceModeFor } from '@ftk/responsive-analyzer';
import type { DeviceMode } from '@ftk/responsive-analyzer';

export type ShotType = 'viewport' | 'fullpage' | 'element';
export type ShotFormat = 'png' | 'jpeg';

export interface CaptureRequest {
  tabId: number;
  type: ShotType;
  format: ShotFormat;
  /** 0–1, JPEG only. */
  quality: number;
  selector?: string;
  /** Keep issue highlights visible (used when attaching a screenshot to a finding). */
  keepHighlight?: boolean;
  label?: string;
}

export interface ShotMeta {
  url: string;
  title: string;
  viewport: { width: number; height: number };
  deviceMode: DeviceMode;
  timestamp: string;
  type: ShotType;
  selector?: string;
  label?: string;
}

export interface ScreenshotRecord {
  id: string;
  name: string;
  type: ShotType;
  format: ShotFormat;
  width: number;
  height: number;
  bytes: number;
  createdAt: number;
  meta: ShotMeta;
  blob: Blob;
  scaledDown: boolean;
  truncated: boolean;
  warnings: string[];
}

export type ScreenshotSummary = Omit<ScreenshotRecord, 'blob'>;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What the page reports after preparing for capture. All sizes in CSS px. */
export interface PrepareInfo {
  viewport: { width: number; height: number; dpr: number };
  doc: { width: number; height: number };
  scroll: { x: number; y: number };
  url: string;
  title: string;
  /** Tallest bottom-anchored fixed element; the last tile re-draws this much of the overlap. */
  bottomFixedHeight: number;
  warnings: string[];
}

export interface ElementTarget {
  /** Viewport-relative rect after scrolling the element into view. */
  rect: Rect;
  /** Document-relative rect. */
  docRect: Rect;
  fits: boolean;
}

// ───────────────────────────── limits ─────────────────────────────

export const MAX_CANVAS_SIDE = 16384;
export const MAX_CANVAS_AREA = 16384 * 16384;
/** Hard cap on captured document height (CSS px). */
export const MAX_CAPTURE_HEIGHT = 40000;

/** Largest scale ≤ `scale` that keeps a w×h CSS-px region inside canvas limits. */
export function fitScale(width: number, height: number, scale: number): number {
  let s = scale;
  s = Math.min(s, MAX_CANVAS_SIDE / Math.max(width, 1), MAX_CANVAS_SIDE / Math.max(height, 1));
  s = Math.min(s, Math.sqrt(MAX_CANVAS_AREA / Math.max(width * height, 1)));
  return Math.max(0.05, s);
}

// ───────────────────────────── tile planning ─────────────────────────────

/** Which position:fixed elements to hide for a tile. */
export type HideMode = 'none' | 'bottom' | 'top' | 'all';

export interface Tile {
  col: number;
  row: number;
  /** Requested scroll offset. The page may clamp it; the engine uses the actual one. */
  scrollX: number;
  scrollY: number;
  hide: HideMode;
  /** Document-space rect of the pixels this tile is responsible for drawing. */
  draw: Rect;
}

function offsets(start: number, end: number, step: number, max: number): number[] {
  const out: number[] = [];
  for (let p = start; ; p += step) {
    const s = Math.min(Math.max(p, 0), max);
    if (out[out.length - 1] !== s) out.push(s);
    if (s + step >= end || p > end + step) break;
  }
  return out;
}

/**
 * Splits `region` (document CSS px) into viewport-sized tiles. Each tile owns
 * only the pixels not already covered by earlier tiles, so a tile captured
 * with different fixed-element visibility never overwrites another's output.
 *
 * Fixed elements are shown in the first row (top-anchored) and last row
 * (bottom-anchored) only, so headers/footers appear once, where they belong.
 */
export function planTiles(
  region: Rect,
  viewport: { width: number; height: number },
  doc: { width: number; height: number },
  bottomFixedHeight = 0,
): Tile[] {
  const maxX = Math.max(0, doc.width - viewport.width);
  const maxY = Math.max(0, doc.height - viewport.height);
  const xs = offsets(region.x, region.x + region.width, viewport.width, maxX);
  const ys = offsets(region.y, region.y + region.height, viewport.height, maxY);
  const regionRight = region.x + region.width;
  const regionBottom = region.y + region.height;
  const tiles: Tile[] = [];

  ys.forEach((sy, row) => {
    const lastRow = row === ys.length - 1;
    let top = row === 0 ? Math.max(region.y, sy) : Math.max(sy, ys[row - 1] + viewport.height);
    if (lastRow && row > 0 && bottomFixedHeight > 0) {
      // Re-draw the strip containing bottom-anchored elements, which were hidden in earlier rows.
      top = Math.max(sy, Math.min(top, sy + viewport.height - bottomFixedHeight));
    }
    const bottom = Math.min(sy + viewport.height, regionBottom);

    xs.forEach((sx, col) => {
      const left = col === 0 ? Math.max(region.x, sx) : Math.max(sx, xs[col - 1] + viewport.width);
      const right = Math.min(sx + viewport.width, regionRight);
      let hide: HideMode;
      if (col > 0) hide = 'all';
      else if (ys.length === 1) hide = 'none';
      else if (row === 0) hide = 'bottom';
      else if (lastRow) hide = 'top';
      else hide = 'all';
      if (right > left && bottom > top) {
        tiles.push({ col, row, scrollX: sx, scrollY: sy, hide, draw: { x: left, y: top, width: right - left, height: bottom - top } });
      }
    });
  });
  return tiles;
}

// ───────────────────────────── naming ─────────────────────────────

export function hostSlug(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'page';
  } catch {
    return 'page';
  }
}

/** `div.hero-card:nth-of-type(2)` → `hero-card`. */
export function selectorSlug(selector: string | undefined): string {
  if (!selector) return 'element';
  const last = selector.split(/\s*>\s*/).pop() ?? selector;
  const base = last.replace(/:[a-z-]+(\([^)]*\))?/gi, '');
  const classes = [...base.matchAll(/\.((?:\\.|[\w-])+)/g)].map((m) => m[1].replace(/\\/g, ''));
  const id = /#((?:\\.|[\w-])+)/.exec(base)?.[1];
  const raw = classes.length ? classes.join('-') : id ?? base.replace(/[^\w-]+/g, '');
  return raw.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40) || 'element';
}

export function screenshotName(opts: {
  url: string;
  type: ShotType;
  format: ShotFormat;
  width: number;
  height: number;
  selector?: string;
}): string {
  const host = hostSlug(opts.url);
  const ext = opts.format === 'jpeg' ? 'jpg' : 'png';
  if (opts.type === 'element') return `${host}-element-${selectorSlug(opts.selector)}.${ext}`;
  return `${host}-${opts.type}-${Math.round(opts.width)}x${Math.round(opts.height)}.${ext}`;
}

export function buildMeta(
  info: Pick<PrepareInfo, 'url' | 'title' | 'viewport'>,
  req: Pick<CaptureRequest, 'type' | 'selector' | 'label'>,
): ShotMeta {
  return {
    url: info.url,
    title: info.title,
    viewport: { width: Math.round(info.viewport.width), height: Math.round(info.viewport.height) },
    deviceMode: deviceModeFor(info.viewport.width),
    timestamp: new Date().toISOString(),
    type: req.type,
    selector: req.selector,
    label: req.label,
  };
}
