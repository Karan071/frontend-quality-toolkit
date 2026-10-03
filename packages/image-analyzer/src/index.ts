import { formatBytes, makeFinding, plural } from '@ftk/audit-core';
import type { Finding, ImageSample, ResourceSample, Severity, ViewportInfo, VitalsSnapshot } from '@ftk/audit-core';

export type ImageFlag =
  | 'broken'
  | 'oversized'
  | 'undersized'
  | 'no-dimensions'
  | 'no-lazy'
  | 'lazy-above-fold'
  | 'legacy-format'
  | 'large-file'
  | 'no-srcset'
  | 'srcset-no-sizes';

export type ImageFormat = 'jpeg' | 'png' | 'gif' | 'webp' | 'avif' | 'svg' | 'unknown';

export const FLAG_LABEL: Record<ImageFlag, string> = {
  broken: 'Broken',
  oversized: 'Oversized',
  undersized: 'Upscaled',
  'no-dimensions': 'No width/height',
  'no-lazy': 'Not lazy',
  'lazy-above-fold': 'Lazy above fold',
  'legacy-format': 'Legacy format',
  'large-file': 'Large file',
  'no-srcset': 'No srcset',
  'srcset-no-sizes': 'srcset without sizes',
};

export function imageFormat(img: Pick<ImageSample, 'src' | 'contentType'>): ImageFormat {
  const type = img.contentType?.toLowerCase() ?? '';
  if (type.includes('jpeg') || type.includes('jpg')) return 'jpeg';
  if (type.includes('png')) return 'png';
  if (type.includes('gif')) return 'gif';
  if (type.includes('webp')) return 'webp';
  if (type.includes('avif')) return 'avif';
  if (type.includes('svg')) return 'svg';
  const src = img.src.toLowerCase();
  if (src.startsWith('data:image/')) return imageFormat({ src: '', contentType: src.slice(5, src.indexOf(';')) });
  const path = src.split(/[?#]/)[0];
  const ext = /\.(jpe?g|png|gif|webp|avif|svg)$/.exec(path)?.[1];
  if (!ext) return 'unknown';
  return (ext === 'jpg' ? 'jpeg' : ext) as ImageFormat;
}

/** Fills `bytes`/`contentType` from Resource Timing, falling back to the size probe. */
export function attachImageSizes(images: ImageSample[], resources: ResourceSample[]): ImageSample[] {
  const byUrl = new Map(resources.map((r) => [r.url, r]));
  return images.map((img) => {
    if (img.bytes != null) return img;
    const r = byUrl.get(img.src);
    if (!r) return img;
    const bytes = r.sizeKnown ? r.encodedSize || r.transferSize || r.decodedSize : r.probe?.size;
    return { ...img, bytes: bytes || undefined, contentType: r.probe?.contentType ?? img.contentType };
  });
}

export interface ImageContext {
  viewport: Pick<ViewportInfo, 'width' | 'height' | 'dpr'>;
  /** Selectors named as sources of layout shifts. */
  shiftSelectors: Set<string>;
}

export interface ImageReport {
  image: ImageSample;
  format: ImageFormat;
  flags: ImageFlag[];
  /** Bytes that could be saved by serving the right size. */
  wastedBytes: number;
  /** natural pixels ÷ pixels actually needed. */
  oversizeRatio: number | null;
}

const KB = 1024;

export function evaluateImage(img: ImageSample, ctx: ImageContext): ImageReport {
  const format = imageFormat(img);
  const flags: ImageFlag[] = [];
  const isRaster = format !== 'svg';
  const dpr = Math.max(1, Math.min(ctx.viewport.dpr || 1, 3));
  const needW = img.renderedWidth * dpr;
  const needH = img.renderedHeight * dpr;
  let oversizeRatio: number | null = null;
  let wasted = 0;

  if (img.kind === 'img' && img.complete && img.naturalWidth === 0 && !img.src.startsWith('data:') && format !== 'svg') {
    flags.push('broken');
  }

  if (img.kind === 'img' && isRaster && img.naturalWidth > 0 && needW > 0 && needH > 0) {
    oversizeRatio = (img.naturalWidth * img.naturalHeight) / (needW * needH);
    if (oversizeRatio >= 2.25 && img.naturalWidth >= 200) {
      flags.push('oversized');
      if (img.bytes) wasted = Math.round(img.bytes * (1 - 1 / oversizeRatio));
    }
    if (img.naturalWidth < img.renderedWidth * 0.9 && img.renderedWidth >= 100) flags.push('undersized');
  }

  if (img.kind === 'img' && !img.decorative && img.renderedWidth > 1 && !(img.hasWidthAttr && img.hasHeightAttr) && !img.hasAspectRatio) {
    flags.push('no-dimensions');
  }

  if (img.kind === 'img') {
    if (img.loading === 'lazy' && img.aboveFold) flags.push('lazy-above-fold');
    if (img.loading !== 'lazy' && !img.aboveFold && img.top > ctx.viewport.height * 1.5) flags.push('no-lazy');
  }

  if (isRaster && (format === 'jpeg' || format === 'png' || format === 'gif')) {
    const sizeable = img.bytes != null ? img.bytes >= 50 * KB : img.renderedWidth * img.renderedHeight >= 300 * 300;
    if (sizeable) flags.push('legacy-format');
  }

  if (img.bytes != null && img.bytes >= 200 * KB) flags.push('large-file');

  if (img.kind === 'img' && isRaster) {
    const hasWidthSrcset = !!img.srcset && /\s\d+w\b/.test(img.srcset);
    if (!img.srcset && !img.inPicture && img.renderedWidth >= 300 && img.naturalWidth >= img.renderedWidth * 1.5) {
      flags.push('no-srcset');
    }
    if (hasWidthSrcset && !img.sizes && img.renderedWidth < ctx.viewport.width * 0.9) flags.push('srcset-no-sizes');
  }
  return { image: img, format, flags, wastedBytes: wasted, oversizeRatio };
}

export interface ImageAnalysisInput {
  images: ImageSample[];
  viewport: Pick<ViewportInfo, 'width' | 'height' | 'dpr'>;
  vitals?: Pick<VitalsSnapshot, 'shifts'>;
}

export function reportImages(input: ImageAnalysisInput): ImageReport[] {
  const shiftSelectors = new Set((input.vitals?.shifts ?? []).flatMap((s) => s.selectors));
  const ctx: ImageContext = { viewport: input.viewport, shiftSelectors };
  return input.images.map((i) => evaluateImage(i, ctx));
}

interface Group {
  flag: ImageFlag;
  ruleId: string;
  title: (n: number) => string;
  severity: (reports: ImageReport[], ctx: ImageContext) => Severity;
  message: (reports: ImageReport[], ctx: ImageContext) => string;
  fix?: (reports: ImageReport[]) => Finding['fix'];
}

const sumWasted = (rs: ImageReport[]) => rs.reduce((s, r) => s + r.wastedBytes, 0);
const totalBytes = (rs: ImageReport[]) => rs.reduce((s, r) => s + (r.image.bytes ?? 0), 0);

const GROUPS: Group[] = [
  {
    flag: 'broken',
    ruleId: 'img.broken',
    title: (n) => `${plural(n, 'broken image')}`,
    severity: () => 'error',
    message: () => 'These images failed to load (404, blocked, or invalid data).',
  },
  {
    flag: 'oversized',
    ruleId: 'img.oversized',
    title: (n) => `${plural(n, 'image')} larger than displayed`,
    severity: (rs) => (sumWasted(rs) >= 200 * KB ? 'error' : 'warning'),
    message: (rs) => {
      const w = sumWasted(rs);
      const worst = [...rs].sort((a, b) => (b.oversizeRatio ?? 0) - (a.oversizeRatio ?? 0))[0];
      return `${worst.image.naturalWidth}×${worst.image.naturalHeight}px image is shown at ${Math.round(worst.image.renderedWidth)}×${Math.round(worst.image.renderedHeight)}px${
        w > 0 ? `; roughly ${formatBytes(w)} could be saved across these images` : ''
      }.`;
    },
  },
  {
    flag: 'large-file',
    ruleId: 'img.large-file',
    title: (n) => `${plural(n, 'image')} over 200 KB`,
    severity: (rs) => (rs.some((r) => (r.image.bytes ?? 0) >= 500 * KB) ? 'error' : 'warning'),
    message: (rs) => `Together they weigh ${formatBytes(totalBytes(rs))}.`,
  },
  {
    flag: 'legacy-format',
    ruleId: 'img.legacy-format',
    title: (n) => `${plural(n, 'image')} could use WebP or AVIF`,
    severity: () => 'warning',
    message: (rs) => `JPEG/PNG/GIF assets (${formatBytes(totalBytes(rs))} known) usually compress 25–50% smaller as WebP or AVIF.`,
  },
  {
    flag: 'no-dimensions',
    ruleId: 'img.no-dimensions',
    title: (n) => `${plural(n, 'image')} without width/height`,
    severity: (rs, ctx) => (rs.some((r) => ctx.shiftSelectors.has(r.image.selector)) ? 'error' : 'warning'),
    message: (rs, ctx) => {
      const shifting = rs.filter((r) => ctx.shiftSelectors.has(r.image.selector)).length;
      return shifting
        ? `The browser cannot reserve space before these load; ${shifting} of them caused measured layout shifts.`
        : 'The browser cannot reserve space before these load, so they can shift the layout.';
    },
    fix: (rs) => {
      const usable = rs.filter((r) => r.image.naturalWidth > 0 && r.image.naturalHeight > 0).slice(0, 25);
      if (!usable.length) return undefined;
      return {
        label: 'Reserve space with aspect-ratio',
        css: usable
          .map((r) => `${r.image.selector} { aspect-ratio: ${r.image.naturalWidth} / ${r.image.naturalHeight}; height: auto; }`)
          .join('\n'),
      };
    },
  },
  {
    flag: 'lazy-above-fold',
    ruleId: 'img.lazy-above-fold',
    title: (n) => `${plural(n, 'visible image')} marked lazy`,
    severity: () => 'warning',
    message: () => 'Images in the first viewport should load eagerly; lazy-loading delays them and hurts LCP.',
  },
  {
    flag: 'no-lazy',
    ruleId: 'img.no-lazy',
    title: (n) => `${plural(n, 'offscreen image')} not lazy-loaded`,
    severity: (rs) => (totalBytes(rs) >= 100 * KB ? 'warning' : 'info'),
    message: (rs) => `These sit well below the fold${totalBytes(rs) ? ` (${formatBytes(totalBytes(rs))} known)` : ''} but are fetched immediately.`,
  },
  {
    flag: 'no-srcset',
    ruleId: 'img.no-srcset',
    title: (n) => `${plural(n, 'image')} without responsive srcset`,
    severity: () => 'info',
    message: () => 'Large images with no srcset send the same file to every screen size.',
  },
  {
    flag: 'srcset-no-sizes',
    ruleId: 'img.srcset-no-sizes',
    title: (n) => `${plural(n, 'image')} with srcset but no sizes`,
    severity: () => 'warning',
    message: () => 'Without sizes the browser assumes the image is 100vw wide and may pick an oversized candidate.',
  },
  {
    flag: 'undersized',
    ruleId: 'img.undersized',
    title: (n) => `${plural(n, 'image')} upscaled`,
    severity: () => 'info',
    message: () => 'The intrinsic resolution is lower than the rendered size, so they may look soft.',
  },
];

export function analyzeImages(input: ImageAnalysisInput): Finding[] {
  const reports = reportImages(input);
  const shiftSelectors = new Set((input.vitals?.shifts ?? []).flatMap((s) => s.selectors));
  const ctx: ImageContext = { viewport: input.viewport, shiftSelectors };
  const out: Finding[] = [];

  for (const g of GROUPS) {
    const hits = reports.filter((r) => r.flags.includes(g.flag));
    if (!hits.length) continue;
    const sorted =
      g.flag === 'oversized'
        ? [...hits].sort((a, b) => b.wastedBytes - a.wastedBytes || (b.oversizeRatio ?? 0) - (a.oversizeRatio ?? 0))
        : hits;
    out.push(
      makeFinding({
        ruleId: g.ruleId,
        category: 'images',
        severity: g.severity(sorted, ctx),
        title: g.title(hits.length),
        message: g.message(sorted, ctx),
        selectors: sorted.slice(0, 20).map((r) => r.image.selector),
        count: hits.length,
        evidence: {
          images: hits.length,
          wastedBytes: g.flag === 'oversized' ? sumWasted(hits) : null,
          totalBytes: totalBytes(hits) || null,
        },
        fix: g.fix?.(sorted),
        key: g.ruleId,
      }),
    );
  }
  return out;
}
