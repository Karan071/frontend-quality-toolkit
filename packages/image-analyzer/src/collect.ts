import type { ImageSample, Visitor } from '@ftk/audit-core';

const MAX_IMAGES = 300;
const MAX_BG = 40;
const URL_RE = /url\((['"]?)(.*?)\1\)/;

function dataUrlBytes(src: string): number {
  const comma = src.indexOf(',');
  if (comma < 0) return 0;
  const body = src.slice(comma + 1);
  return src.slice(0, comma).includes(';base64') ? Math.floor((body.length * 3) / 4) : body.length;
}

function absoluteUrl(raw: string): string {
  try {
    return new URL(raw, location.href).href;
  } catch {
    return raw;
  }
}

/** Collects <img> elements and CSS background images during the shared walk. */
export function imagesVisitor(): Visitor<ImageSample[]> {
  const images: ImageSample[] = [];
  let bgCount = 0;
  const scrollY = window.scrollY;
  const vh = window.innerHeight;

  return {
    visit(ctx) {
      const { el } = ctx;
      if (el.localName === 'img') {
        if (images.length >= MAX_IMAGES) return;
        const img = el as HTMLImageElement;
        const style = ctx.style;
        if (style.display === 'none') return;
        const rect = ctx.rect();
        const src = img.currentSrc || img.src;
        if (!src) return;
        // 1×1 tracking pixels and other degenerate boxes.
        if (rect.width <= 1 && rect.height <= 1 && img.naturalWidth <= 1) return;
        const alt = img.getAttribute('alt');
        const role = img.getAttribute('role');
        const isData = src.startsWith('data:');
        images.push({
          selector: ctx.selector(),
          kind: 'img',
          src: isData ? src.slice(0, 80) : src,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          renderedWidth: rect.width,
          renderedHeight: rect.height,
          hasAltAttr: alt !== null,
          alt,
          loading: img.getAttribute('loading'),
          fetchPriority: img.getAttribute('fetchpriority'),
          srcset: img.getAttribute('srcset'),
          sizes: img.getAttribute('sizes'),
          inPicture: img.parentElement?.localName === 'picture',
          hasWidthAttr: img.hasAttribute('width'),
          hasHeightAttr: img.hasAttribute('height'),
          hasAspectRatio: style.aspectRatio !== 'auto',
          top: rect.top + scrollY,
          aboveFold: rect.top + scrollY < vh && rect.bottom + scrollY > 0,
          complete: img.complete,
          decorative: alt === '' || role === 'presentation' || role === 'none',
          bytes: isData ? dataUrlBytes(src) : undefined,
        });
        return;
      }

      if (bgCount >= MAX_BG) return;
      const bg = ctx.style.backgroundImage;
      if (!bg || bg === 'none' || !bg.includes('url(')) return;
      if (!ctx.visible()) return;
      const m = URL_RE.exec(bg);
      if (!m || !m[2]) return;
      const rect = ctx.rect();
      bgCount++;
      images.push({
        selector: ctx.selector(),
        kind: 'bg',
        src: m[2].startsWith('data:') ? m[2].slice(0, 80) : absoluteUrl(m[2]),
        naturalWidth: 0,
        naturalHeight: 0,
        renderedWidth: rect.width,
        renderedHeight: rect.height,
        hasAltAttr: false,
        alt: null,
        loading: null,
        fetchPriority: null,
        srcset: null,
        sizes: null,
        inPicture: false,
        hasWidthAttr: false,
        hasHeightAttr: false,
        hasAspectRatio: false,
        top: rect.top + scrollY,
        aboveFold: rect.top + scrollY < vh,
        complete: true,
        decorative: true,
        bytes: m[2].startsWith('data:') ? dataUrlBytes(m[2]) : undefined,
      });
    },
    result: () => images,
  };
}
