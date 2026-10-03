/** Everything about turning "what a page references" into downloadable, well-named files. */

export type AssetType = 'image' | 'icon' | 'svg' | 'font' | 'css' | 'js' | 'media' | 'document' | 'other';

export const ASSET_TYPES: AssetType[] = ['image', 'svg', 'icon', 'font', 'css', 'js', 'media', 'document', 'other'];

export const ASSET_LABEL: Record<AssetType, string> = {
  image: 'Images',
  svg: 'Inline SVG',
  icon: 'Icons',
  font: 'Fonts',
  css: 'CSS',
  js: 'JavaScript',
  media: 'Video & audio',
  document: 'Documents',
  other: 'Other',
};

/** Folder each type goes into inside the ZIP. */
export const ASSET_FOLDER: Record<AssetType, string> = {
  image: 'images',
  svg: 'svg',
  icon: 'icons',
  font: 'fonts',
  css: 'css',
  js: 'js',
  media: 'media',
  document: 'documents',
  other: 'other',
};

export interface AssetSample {
  id: string;
  /** Absolute URL, a data: URI, or `inline-svg:N` for markup that lives in the page. */
  url: string;
  type: AssetType;
  /** Where the page references it: img, srcset, css-bg, link, script, font-face, meta, a, video, network… */
  sources: string[];
  /** Suggested file name (unique within the ZIP only after planZipPaths). */
  name: string;
  width?: number;
  height?: number;
  /** srcset descriptor such as "2x" or "800w". */
  descriptor?: string;
  selector?: string;
  alt?: string | null;
  bytes?: number;
  contentType?: string;
  /** Serialized markup for inline SVGs. */
  svg?: string;
  thirdParty: boolean;
  host: string;
}

// ───────────────────────────── classification ─────────────────────────────

const EXT_TYPE: [RegExp, AssetType][] = [
  [/\.(png|jpe?g|gif|webp|avif|bmp|tiff?|svg)$/i, 'image'],
  [/\.(ico|icns)$/i, 'icon'],
  [/\.(woff2?|ttf|otf|eot)$/i, 'font'],
  [/\.css$/i, 'css'],
  [/\.(m?js|cjs)$/i, 'js'],
  [/\.(mp4|webm|ogv|ogg|mov|m4v|mp3|wav|m4a|aac|flac|opus)$/i, 'media'],
  [/\.(pdf|zip|gz|tar|7z|rar|docx?|xlsx?|pptx?|csv|txt|json|vtt|srt|webmanifest|xml)$/i, 'document'],
];

export function pathOf(url: string): string {
  if (url.startsWith('data:') || url.startsWith('inline-svg:')) return '';
  try {
    return decodeURIComponent(new URL(url).pathname);
  } catch {
    return url.split(/[?#]/)[0];
  }
}

/** Type from the file extension alone; `other` when nothing matches. */
export function classifyUrl(url: string): AssetType {
  if (url.startsWith('data:')) return typeFromMime(/^data:([^;,]+)/.exec(url)?.[1] ?? '');
  const path = pathOf(url);
  return EXT_TYPE.find(([re]) => re.test(path))?.[1] ?? 'other';
}

export function typeFromMime(mime: string): AssetType {
  const m = mime.toLowerCase();
  if (m === 'image/x-icon' || m === 'image/vnd.microsoft.icon') return 'icon';
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('font/') || /(woff|opentype|truetype)/.test(m)) return 'font';
  if (m === 'text/css') return 'css';
  if (/(javascript|ecmascript)/.test(m)) return 'js';
  if (m.startsWith('video/') || m.startsWith('audio/')) return 'media';
  if (m === 'application/pdf' || m === 'application/zip' || m === 'application/json' || m === 'text/csv') return 'document';
  return 'other';
}

const MIME_EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif',
  'image/svg+xml': 'svg', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'image/bmp': 'bmp',
  'font/woff2': 'woff2', 'font/woff': 'woff', 'font/ttf': 'ttf', 'font/otf': 'otf', 'application/font-woff': 'woff',
  'text/css': 'css', 'text/javascript': 'js', 'application/javascript': 'js',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav',
  'application/pdf': 'pdf', 'application/zip': 'zip', 'application/json': 'json', 'text/csv': 'csv', 'text/plain': 'txt',
};

export function extFromMime(mime: string | undefined): string | null {
  if (!mime) return null;
  return MIME_EXT[mime.split(';')[0].trim().toLowerCase()] ?? null;
}

const DEFAULT_EXT: Record<AssetType, string> = { image: 'png', svg: 'svg', icon: 'ico', font: 'woff2', css: 'css', js: 'js', media: 'mp4', document: 'bin', other: 'bin' };

/** Safe file name for a URL: decoded last path segment, sanitized, with an extension guaranteed. */
export function assetFileName(url: string, type: AssetType, contentType?: string, index = 1): string {
  if (url.startsWith('data:')) {
    const mime = /^data:([^;,]+)/.exec(url)?.[1];
    return `inline-${type === 'other' ? 'file' : type}-${index}.${extFromMime(mime) ?? DEFAULT_EXT[type]}`;
  }
  if (url.startsWith('inline-svg:')) return `inline-svg-${index}.svg`;
  const segment = pathOf(url).split('/').filter(Boolean).pop() ?? '';
  let base = segment.replace(/[^\w.@()\- ]+/g, '_').replace(/^\.+/, '').slice(0, 100);
  let fromHost = false;
  if (!base) {
    fromHost = true;
    let host = 'asset';
    try {
      host = new URL(url).hostname.replace(/[^\w.-]+/g, '_');
    } catch { /* keep default */ }
    base = host;
  }
  // A host name like "x.com" only looks like it has an extension.
  if (fromHost || !/\.[A-Za-z0-9]{1,6}$/.test(base)) base += `.${extFromMime(contentType) ?? DEFAULT_EXT[type]}`;
  return base;
}

// ───────────────────────────── parsing ─────────────────────────────

export interface SrcsetCandidate {
  url: string;
  descriptor?: string;
}

/**
 * Parses an img/source srcset following the HTML spec: a URL is a run of non-whitespace, so a comma
 * inside it (`/w_400,h_300/a.jpg`) belongs to the URL; only a trailing comma ends a candidate.
 */
export function parseSrcset(srcset: string): SrcsetCandidate[] {
  const out: SrcsetCandidate[] = [];
  const n = srcset.length;
  let i = 0;
  while (i < n) {
    while (i < n && /[\s,]/.test(srcset[i])) i++;
    if (i >= n) break;
    let start = i;
    while (i < n && !/\s/.test(srcset[i])) i++;
    let url = srcset.slice(start, i);
    let descriptor: string | undefined;
    if (/,+$/.test(url)) {
      url = url.replace(/,+$/, ''); // "a.jpg," — no descriptor, candidate ended
    } else {
      start = i;
      while (i < n && srcset[i] !== ',') i++;
      descriptor = srcset.slice(start, i).trim().split(/\s+/)[0] || undefined;
    }
    if (url && !url.startsWith('data:')) out.push({ url, descriptor });
  }
  return out;
}

/** `url(...)` references in a CSS value, quotes stripped. */
export function cssUrls(value: string): string[] {
  const out: string[] = [];
  for (const m of value.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s][^)]*?))\s*\)/g)) {
    const u = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (u && !u.startsWith('#')) out.push(u);
  }
  return out;
}

/** Font files declared by @font-face rules in raw stylesheet text. */
export function parseFontFaceUrls(css: string, baseUrl: string): { url: string; family?: string }[] {
  const out: { url: string; family?: string }[] = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const rule of text.matchAll(/@font-face\s*\{([^}]*)\}/gi)) {
    const body = rule[1];
    const family = /font-family\s*:\s*["']?([^;"']+)/i.exec(body)?.[1]?.trim();
    const src = /src\s*:\s*([^;]+)/i.exec(body)?.[1] ?? '';
    for (const u of cssUrls(src)) {
      try {
        out.push({ url: new URL(u, baseUrl).href, family });
      } catch { /* unresolvable */ }
    }
  }
  return out;
}

// ───────────────────────────── planning ─────────────────────────────

/**
 * Assigns each asset a unique path inside the ZIP (`folder/name`, with `-2`, `-3`… before the
 * extension when names collide, e.g. two different `logo.png` files from different hosts).
 */
export function planZipPaths(assets: Pick<AssetSample, 'id' | 'type' | 'name'>[]): Map<string, string> {
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const a of assets) {
    const folder = ASSET_FOLDER[a.type];
    const dot = a.name.lastIndexOf('.');
    const stem = dot > 0 ? a.name.slice(0, dot) : a.name;
    const ext = dot > 0 ? a.name.slice(dot) : '';
    let path = `${folder}/${a.name}`;
    for (let n = 2; used.has(path.toLowerCase()); n++) path = `${folder}/${stem}-${n}${ext}`;
    used.add(path.toLowerCase());
    out.set(a.id, path);
  }
  return out;
}

export function countByType(assets: Pick<AssetSample, 'type'>[]): Record<AssetType, number> {
  const out = Object.fromEntries(ASSET_TYPES.map((t) => [t, 0])) as Record<AssetType, number>;
  assets.forEach((a) => out[a.type]++);
  return out;
}

export function totalBytes(assets: Pick<AssetSample, 'bytes'>[]): number {
  return assets.reduce((n, a) => n + (a.bytes ?? 0), 0);
}

/** Merges two samples of the same URL, keeping the richest metadata and the union of sources. */
export function mergeAssets(a: AssetSample, b: AssetSample): AssetSample {
  return {
    ...a,
    sources: [...new Set([...a.sources, ...b.sources])],
    width: a.width ?? b.width,
    height: a.height ?? b.height,
    descriptor: a.descriptor ?? b.descriptor,
    selector: a.selector ?? b.selector,
    alt: a.alt ?? b.alt,
    bytes: a.bytes ?? b.bytes,
    contentType: a.contentType ?? b.contentType,
    // A real type beats "other" (e.g. network entry classified before the DOM reference).
    type: a.type === 'other' ? b.type : a.type,
  };
}
