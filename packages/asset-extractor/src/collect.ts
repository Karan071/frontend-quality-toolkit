import { collectResources } from '@ftk/bundle-analyzer/collect';
import { isThirdParty } from '@ftk/bundle-analyzer';
import { collectFontFaces } from '@ftk/css-analyzer/collect';
import { walkDocument } from '@ftk/dom-analyzer/collect';
import type { Visitor } from '@ftk/audit-core';
import { ASSET_TYPES, assetFileName, classifyUrl, cssUrls, mergeAssets, parseSrcset } from './index';
import type { AssetSample, AssetType } from './index';

const MAX_ASSETS = 2500;
const MAX_DATA_URIS = 150;
const MAX_DATA_URI_LENGTH = 3_000_000;
const MAX_SVGS = 150;
const MAX_SVG_BYTES = 300_000;
const LAZY_SRC = ['data-src', 'data-lazy-src', 'data-original', 'data-lazy'];
const LAZY_SRCSET = ['data-srcset', 'data-lazy-srcset'];
const MIN_SVG_SIZE = 8;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/** `<link>`, `<meta>` and `<script src>` — they live in <head>, which the body walk does not visit. */
function headReferences(add: (raw: string | null | undefined, hint: AssetType | null, extra: { source: string }) => void) {
  for (const el of Array.from(document.querySelectorAll('script[src], link, meta'))) {
    switch (el.localName) {
      case 'script':
        add(el.getAttribute('src'), 'js', { source: 'script' });
        break;
      case 'link': {
        const rel = (el.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
        const href = el.getAttribute('href');
        if (rel.some((r) => ['icon', 'apple-touch-icon', 'apple-touch-icon-precomposed', 'mask-icon', 'fluid-icon'].includes(r))) add(href, 'icon', { source: 'link-icon' });
        else if (rel.includes('stylesheet')) add(href, 'css', { source: 'link' });
        else if (rel.includes('manifest')) add(href, 'document', { source: 'manifest' });
        else if (rel.includes('preload') || rel.includes('modulepreload')) {
          const as = el.getAttribute('as');
          const hint: AssetType | null = as === 'style' ? 'css' : as === 'script' ? 'js' : as === 'font' ? 'font' : as === 'image' ? 'image' : as === 'video' || as === 'audio' ? 'media' : null;
          if (hint) add(href, hint, { source: 'preload' });
        }
        break;
      }
      case 'meta': {
        const key = (el.getAttribute('property') ?? el.getAttribute('name') ?? '').toLowerCase();
        if (/^(og:image(:url|:secure_url)?|twitter:image(:src)?|msapplication-tileimage|thumbnail)$/.test(key)) add(el.getAttribute('content'), 'image', { source: 'meta' });
        break;
      }
    }
  }
}

/**
 * Finds every file the page uses: elements and their srcset/lazy-load attributes, CSS background /
 * mask images, @font-face files, icons and social images, inline SVG markup, and — for anything
 * injected by script — the network entries the browser recorded.
 */
export function collectAssets(): { assets: AssetSample[]; truncated: boolean } {
  const found = new Map<string, AssetSample>();
  let truncated = false;
  let dataUris = 0;
  let svgs = 0;
  let seq = 0;

  const put = (url: string, type: AssetType, extra: Partial<AssetSample> & { source: string }) => {
    if (found.size >= MAX_ASSETS) {
      truncated = true;
      return;
    }
    const { source, ...rest } = extra;
    const existing = found.get(url);
    let host = '';
    if (!url.startsWith('data:')) {
      try {
        host = new URL(url).host;
      } catch {
        return;
      }
    }
    const sample: AssetSample = {
      id: '',
      url,
      type,
      sources: [source],
      name: assetFileName(url, type, rest.contentType, ++seq),
      thirdParty: host ? isThirdParty(host, location.host) : false,
      host,
      ...rest,
    };
    found.set(url, existing ? mergeAssets(existing, sample) : sample);
  };

  /** Normalises a reference and records it. `hint` is the role the page gives it (img, icon, font…). */
  const add = (raw: string | null | undefined, hint: AssetType | null, extra: Partial<AssetSample> & { source: string }) => {
    const value = raw?.trim();
    if (!value) return;
    let url = value;
    if (url.startsWith('data:')) {
      if (url.length > MAX_DATA_URI_LENGTH || dataUris >= MAX_DATA_URIS) return;
      dataUris++;
    } else {
      if (/^(blob:|javascript:|about:|mailto:|tel:|#)/i.test(url)) return;
      try {
        url = new URL(url, document.baseURI).href;
      } catch {
        return;
      }
      if (!/^(https?|file):/.test(url)) return;
    }
    const detected = classifyUrl(url);
    // The role on the page wins, except that a .ico/.icns file is always an icon.
    const type = detected === 'icon' ? 'icon' : (hint ?? detected);
    put(url, type, extra);
  };

  const visitor: Visitor<void> = {
    visit(ctx) {
      const { el } = ctx;
      const tag = el.localName;
      const sel = () => ctx.selector();

      switch (tag) {
        case 'img': {
          const img = el as HTMLImageElement;
          add(img.currentSrc || img.src, 'image', {
            source: 'img', width: img.naturalWidth || undefined, height: img.naturalHeight || undefined, selector: sel(), alt: img.getAttribute('alt'),
          });
          for (const c of parseSrcset(img.getAttribute('srcset') ?? '')) add(c.url, 'image', { source: 'srcset', descriptor: c.descriptor, selector: sel() });
          for (const a of LAZY_SRC) add(img.getAttribute(a), 'image', { source: 'lazy', selector: sel() });
          for (const a of LAZY_SRCSET) for (const c of parseSrcset(img.getAttribute(a) ?? '')) add(c.url, 'image', { source: 'lazy', descriptor: c.descriptor, selector: sel() });
          break;
        }
        case 'source': {
          const inMedia = !!el.closest('video, audio');
          add(el.getAttribute('src'), inMedia ? 'media' : 'image', { source: inMedia ? 'media' : 'picture', selector: sel() });
          for (const c of parseSrcset(el.getAttribute('srcset') ?? '')) add(c.url, 'image', { source: 'picture', descriptor: c.descriptor, selector: sel() });
          break;
        }
        case 'video':
          add(el.getAttribute('poster'), 'image', { source: 'poster', selector: sel() });
          add((el as HTMLVideoElement).currentSrc || el.getAttribute('src'), 'media', { source: 'video', selector: sel() });
          break;
        case 'audio':
          add((el as HTMLAudioElement).currentSrc || el.getAttribute('src'), 'media', { source: 'audio', selector: sel() });
          break;
        case 'track':
          add(el.getAttribute('src'), 'document', { source: 'track', selector: sel() });
          break;
        case 'input':
          if ((el as HTMLInputElement).type === 'image') add(el.getAttribute('src'), 'image', { source: 'input', selector: sel() });
          break;
        case 'object':
          add(el.getAttribute('data'), null, { source: 'object', selector: sel() });
          break;
        case 'embed':
          add(el.getAttribute('src'), null, { source: 'embed', selector: sel() });
          break;
        case 'a': {
          const href = el.getAttribute('href');
          let absolute = '';
          try {
            absolute = href ? new URL(href, document.baseURI).href : '';
          } catch { /* malformed href */ }
          // Only links to files (PDFs, archives, media…), not to ordinary pages.
          if (absolute && classifyUrl(absolute) !== 'other') add(absolute, null, { source: 'link-to', selector: sel() });
          break;
        }
        case 'svg':
          if (!(el as SVGElement).ownerSVGElement && svgs < MAX_SVGS) {
            const r = ctx.rect();
            if (r.width >= MIN_SVG_SIZE && r.height >= MIN_SVG_SIZE) {
              const markup = new XMLSerializer().serializeToString(el);
              if (markup.length <= MAX_SVG_BYTES) {
                svgs++;
                const label = el.getAttribute('aria-label') ?? el.querySelector('title')?.textContent ?? el.id ?? '';
                const stem = slug(label) || `inline-svg-${svgs}`;
                const url = `inline-svg:${svgs}`;
                found.set(url, {
                  id: '', url, type: 'svg', sources: ['inline-svg'], name: `${stem}.svg`, svg: markup, bytes: new TextEncoder().encode(markup).length,
                  width: Math.round(r.width), height: Math.round(r.height), selector: sel(), thirdParty: false, host: '',
                });
              }
            }
          }
          break;
      }

      // CSS images: backgrounds (incl. multiple layers), masks, list bullets, border images.
      const s = ctx.style;
      for (const value of [s.backgroundImage, s.getPropertyValue('mask-image'), s.getPropertyValue('-webkit-mask-image'), s.listStyleImage, s.borderImageSource]) {
        if (value && value !== 'none' && value.includes('url(')) for (const u of cssUrls(value)) add(u, 'image', { source: 'css-bg', selector: sel() });
      }
    },
    result: () => undefined,
  };

  const { truncated: walkTruncated } = walkDocument([visitor as Visitor<unknown>]);
  if (walkTruncated) truncated = true;

  headReferences(add);
  for (const f of collectFontFaces()) add(f.url, 'font', { source: 'font-face' });

  // Anything the page loaded (script-injected images, fonts pulled in by CSS, lazy media…).
  for (const r of collectResources()) {
    const hint: AssetType | null = r.type === 'image' ? 'image' : r.type === 'font' ? 'font' : r.type === 'css' ? 'css' : r.type === 'script' ? 'js' : r.type === 'media' ? 'media' : null;
    if (!hint) continue;
    add(r.url, hint, { source: 'network', bytes: r.sizeKnown ? r.encodedSize || r.transferSize || r.decodedSize || undefined : undefined });
  }

  const order = (t: AssetType) => ASSET_TYPES.indexOf(t);
  const assets = [...found.values()]
    .filter((a) => !a.url.startsWith('chrome-extension:'))
    .sort((a, b) => order(a.type) - order(b.type) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
    .map((a, i) => ({ ...a, id: `a${i}` }));
  return { assets, truncated };
}
