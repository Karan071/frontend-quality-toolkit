import { composite, contrastRatio, cssEscape, parseColor, toHex } from '@ftk/audit-core';
import type { RGBA } from '@ftk/audit-core';
import type { PageMeta, Visitor, WalkContext } from '@ftk/audit-core';
import { STYLE_GROUPS, elementLabel } from './index';
import type { ElementInfo, Sides, StyleEntry } from './index';

/** Elements injected by the toolkit itself; never analysed or captured. */
export const TOOLKIT_ID_PREFIX = '__ftk';

export function isToolkitNode(el: Element): boolean {
  return !!el.id && el.id.startsWith(TOOLKIT_ID_PREFIX);
}

// ───────────────────────────── Shadow DOM helpers ─────────────────────────────

/** Separates the host selector from the selector inside its open shadow root. */
export const SHADOW_SEP = ' >>> ';

type SelectorRoot = Document | ShadowRoot;

export function rootOf(el: Element): SelectorRoot {
  return el.getRootNode() as SelectorRoot;
}

/** Parent element, crossing a shadow boundary up to the host. */
export function parentOf(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

/** Every element under `root`, descending into open shadow roots (host first, then its shadow tree). */
export function* elementsIn(root: ParentNode): Generator<Element> {
  for (const el of Array.from(root.querySelectorAll('*'))) {
    yield el;
    if (el.shadowRoot) yield* elementsIn(el.shadowRoot);
  }
}

// ───────────────────────────── Selectors ─────────────────────────────

const selectorCache = new WeakMap<Element, string>();

function looksGenerated(cls: string): boolean {
  // CSS-in-JS / hashed class names (css-1a2b3c, sc-bdVaJa, jsx-123456) are unstable across builds.
  if (/^(css|sc|jsx|emotion|styled)-[A-Za-z0-9]{4,}$/.test(cls)) return true;
  return cls.length > 28 || (cls.match(/\d/g)?.length ?? 0) > 3;
}

function segment(el: Element, root: SelectorRoot): string {
  const tag = el.localName;
  if (el.id) {
    const sel = `#${cssEscape(el.id)}`;
    try {
      if (root.querySelectorAll(sel).length === 1) return sel;
    } catch {
      /* fall through */
    }
  }
  const classes = Array.from(el.classList)
    .filter((c) => !c.startsWith(TOOLKIT_ID_PREFIX) && !looksGenerated(c))
    .slice(0, 2);
  let seg = tag + classes.map((c) => `.${cssEscape(c)}`).join('');
  const parent = el.parentNode as ParentNode | null;
  if (parent) {
    const same = Array.from(parent.children).filter((s) => s.matches(seg));
    if (same.length > 1) seg += `:nth-of-type(${indexOfType(el)})`;
  }
  return seg;
}

function indexOfType(el: Element): number {
  let i = 1;
  for (let s = el.previousElementSibling; s; s = s.previousElementSibling) {
    if (s.localName === el.localName) i++;
  }
  return i;
}

/** Shortest selector that is unique inside `root` (a document or one shadow root). */
function selectorWithin(el: Element, root: SelectorRoot): string {
  const stop = root instanceof Document ? root.documentElement : null;
  const parts: string[] = [];
  for (let cur: Element | null = el; cur && cur !== stop; cur = cur.parentElement) {
    const seg = segment(cur, root);
    parts.unshift(seg);
    const candidate = parts.join(' > ');
    try {
      if (root.querySelectorAll(candidate).length === 1) return candidate;
    } catch {
      /* invalid selector, keep climbing */
    }
    if (seg.startsWith('#')) return candidate;
  }
  return parts.join(' > ');
}

/**
 * Shortest selector that resolves to exactly this element. Elements inside open shadow roots
 * get `host >>> inner` selectors, which `queryAllSafe` knows how to resolve.
 */
export function uniqueSelector(el: Element): string {
  const hit = selectorCache.get(el);
  if (hit) return hit;
  const root = rootOf(el);
  let result: string;
  if (root instanceof ShadowRoot) {
    result = `${uniqueSelector(root.host)}${SHADOW_SEP}${selectorWithin(el, root)}`;
  } else if (el === root.documentElement) result = 'html';
  else if (el === root.body) result = 'body';
  else result = selectorWithin(el, root);
  selectorCache.set(el, result);
  return result;
}

/** querySelectorAll that understands `host >>> inner` shadow-piercing selectors. */
export function queryAllSafe(selector: string, limit = 50): Element[] {
  try {
    const parts = selector.split(SHADOW_SEP).map((p) => p.trim());
    let roots: ParentNode[] = [document];
    for (let i = 0; i < parts.length; i++) {
      const matches = roots.flatMap((r) => Array.from(r.querySelectorAll(parts[i])));
      if (i === parts.length - 1) return matches.slice(0, limit);
      roots = matches.map((m) => m.shadowRoot).filter((r): r is ShadowRoot => !!r);
    }
    return [];
  } catch {
    return [];
  }
}

// ───────────────────────────── Colour helpers ─────────────────────────────

let normalizer: CanvasRenderingContext2D | null | undefined;

/** Resolves any CSS colour (oklch, lab, color()...) to an rgb string via canvas. */
export function normalizeColor(value: string): string {
  if (!value || value.startsWith('rgb') || value.startsWith('#') || value === 'transparent') return value;
  if (normalizer === undefined) {
    normalizer = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  }
  if (!normalizer) return value;
  normalizer.clearRect(0, 0, 1, 1);
  normalizer.fillStyle = '#000';
  normalizer.fillStyle = value;
  normalizer.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = normalizer.getImageData(0, 0, 1, 1).data;
  return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
}

export interface ResolvedBackground {
  color: string | null;
  uncertain: boolean;
}

/**
 * Composites ancestor backgrounds to find the colour behind an element's
 * text. Gradients and images make the answer uncertain.
 */
export function resolveBackground(el: Element): ResolvedBackground {
  const layers: ReturnType<typeof parseColor>[] = [];
  let uncertain = false;
  for (let cur: Element | null = el; cur; cur = parentOf(cur)) {
    const cs = getComputedStyle(cur);
    const bg = parseColor(normalizeColor(cs.backgroundColor));
    if (bg && bg.a > 0) layers.push(bg);
    if (cs.backgroundImage && cs.backgroundImage !== 'none') {
      uncertain = true;
      break;
    }
    if (bg && bg.a >= 1) break;
  }
  let acc = { r: 255, g: 255, b: 255, a: 1 };
  for (const layer of layers.reverse()) acc = composite(layer!, acc);
  return { color: toHex({ ...acc, a: 1 }), uncertain };
}

export interface BackgroundResult {
  /** Opaque colour behind the element, composited from ancestors over white. */
  rgba: RGBA;
  /** An ancestor paints an image/gradient, so the real colour is unknown. */
  uncertain: boolean;
  /** Product of the element's and its ancestors' opacity. */
  opacity: number;
}

/** Memoised resolver — O(n) over the whole document instead of O(n·depth). */
export function makeBackgroundResolver(): (el: Element) => BackgroundResult {
  const cache = new WeakMap<Element, BackgroundResult>();
  const resolve = (el: Element): BackgroundResult => {
    const hit = cache.get(el);
    if (hit) return hit;
    const parent = parentOf(el);
    const base: BackgroundResult = parent
      ? resolve(parent)
      : { rgba: { r: 255, g: 255, b: 255, a: 1 }, uncertain: false, opacity: 1 };
    const cs = getComputedStyle(el);
    const bg = parseColor(normalizeColor(cs.backgroundColor));
    const result: BackgroundResult = {
      rgba: bg && bg.a > 0 ? composite(bg, base.rgba) : base.rgba,
      uncertain: base.uncertain || (!!cs.backgroundImage && cs.backgroundImage !== 'none'),
      opacity: base.opacity * (Number.isNaN(parseFloat(cs.opacity)) ? 1 : parseFloat(cs.opacity)),
    };
    cache.set(el, result);
    return result;
  };
  return resolve;
}

export function elementContrast(el: Element, cs = getComputedStyle(el)) {
  const fgRaw = parseColor(normalizeColor(cs.color));
  if (!fgRaw) return null;
  const { color, uncertain } = resolveBackground(el);
  const bg = parseColor(color);
  if (!bg) return null;
  let opacity = 1;
  for (let cur: Element | null = el; cur; cur = parentOf(cur)) {
    opacity *= parseFloat(getComputedStyle(cur).opacity || '1');
  }
  const fg = composite({ ...fgRaw, a: fgRaw.a * opacity }, bg);
  return { ratio: contrastRatio({ ...fg, a: 1 }, bg), fg: toHex({ ...fg, a: 1 }), bg: color, uncertain };
}

// ───────────────────────────── Accessible name / role ─────────────────────────────

const IMPLICIT_ROLES: Record<string, string> = {
  a: 'link', button: 'button', nav: 'navigation', main: 'main', header: 'banner', footer: 'contentinfo',
  aside: 'complementary', form: 'form', h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading',
  h5: 'heading', h6: 'heading', img: 'img', ul: 'list', ol: 'list', li: 'listitem', table: 'table',
  select: 'combobox', textarea: 'textbox', dialog: 'dialog', section: 'region', article: 'article',
};

export function implicitRole(el: Element): string | null {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit.split(/\s+/)[0];
  const tag = el.localName;
  if (tag === 'a') return el.hasAttribute('href') ? 'link' : null;
  if (tag === 'input') {
    const t = (el as HTMLInputElement).type;
    if (['button', 'submit', 'reset', 'image'].includes(t)) return 'button';
    if (t === 'checkbox') return 'checkbox';
    if (t === 'radio') return 'radio';
    if (t === 'range') return 'slider';
    if (t === 'hidden') return null;
    return 'textbox';
  }
  return IMPLICIT_ROLES[tag] ?? null;
}

function textOf(el: Element, depth = 0): string {
  if (depth > 6) return '';
  let out = '';
  el.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) out += n.textContent ?? '';
    else if (n.nodeType === Node.ELEMENT_NODE) {
      const child = n as Element;
      if (child.getAttribute('aria-hidden') === 'true') return;
      const label = child.getAttribute('aria-label');
      if (label) out += ` ${label} `;
      else if (child.localName === 'img') out += ` ${child.getAttribute('alt') ?? ''} `;
      else if (child.localName === 'svg') out += ` ${child.querySelector('title')?.textContent ?? ''} `;
      else {
        const inner = textOf(child, depth + 1);
        // Name-from-content falls back to a descendant's title attribute (e.g. <a><div title="upvote"></div></a>).
        out += inner || ` ${child.getAttribute('title') ?? ''} `;
      }
    }
  });
  return out.replace(/\s+/g, ' ').trim();
}

/** Simplified accessible-name computation (aria-labelledby, aria-label, native labels, content). */
export function accessibleName(el: Element): string {
  const labelledby = el.getAttribute('aria-labelledby');
  if (labelledby) {
    const joined = labelledby
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id))
      .filter((n): n is HTMLElement => !!n)
      .map((n) => textOf(n))
      .join(' ')
      .trim();
    if (joined) return joined;
  }
  const aria = el.getAttribute('aria-label')?.trim();
  if (aria) return aria;

  const tag = el.localName;
  if (tag === 'img') return (el.getAttribute('alt') ?? '').trim();
  if (tag === 'input' || tag === 'select' || tag === 'textarea') {
    const input = el as HTMLInputElement;
    if (['button', 'submit', 'reset'].includes(input.type)) return (input.value || input.type).trim();
    if (input.type === 'image') return (input.alt || '').trim();
    const labels = input.labels ? Array.from(input.labels).map((l) => textOf(l)).join(' ').trim() : '';
    if (labels) return labels;
    return (input.title || '').trim();
  }
  const own = textOf(el);
  if (own) return own;
  return (el.getAttribute('title') ?? '').trim();
}

// ───────────────────────────── Element description (inspector) ─────────────────────────────

const px = (v: string) => parseFloat(v) || 0;

export function boxModel(cs: CSSStyleDeclaration, rect: DOMRect) {
  const sides = (prefix: string, suffix = ''): Sides => ({
    top: px(cs.getPropertyValue(`${prefix}-top${suffix}`)),
    right: px(cs.getPropertyValue(`${prefix}-right${suffix}`)),
    bottom: px(cs.getPropertyValue(`${prefix}-bottom${suffix}`)),
    left: px(cs.getPropertyValue(`${prefix}-left${suffix}`)),
  });
  const margin = sides('margin');
  const padding = sides('padding');
  const border = sides('border', '-width');
  return {
    margin,
    border,
    padding,
    content: {
      width: Math.max(0, rect.width - border.left - border.right - padding.left - padding.right),
      height: Math.max(0, rect.height - border.top - border.bottom - padding.top - padding.bottom),
    },
  };
}

function isInFixedContext(el: Element): boolean {
  for (let cur: Element | null = el; cur; cur = parentOf(cur)) {
    const pos = getComputedStyle(cur).position;
    if (pos === 'fixed' || pos === 'sticky') return true;
  }
  return false;
}

export function describeElement(el: Element, all = false): ElementInfo {
  const cs = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  const classes = Array.from(el.classList).filter((c) => !c.startsWith(TOOLKIT_ID_PREFIX));

  const styles = all
    ? [
        {
          group: 'All computed',
          entries: Array.from(cs).map((prop) => ({ prop, value: cs.getPropertyValue(prop) })),
        },
      ]
    : STYLE_GROUPS.map(({ group, props }) => ({
        group,
        entries: props.map((prop) => ({ prop, value: cs.getPropertyValue(prop) })).filter((e) => e.value !== ''),
      }));

  const path: ElementInfo['path'] = [];
  for (let cur: Element | null = el; cur; cur = parentOf(cur)) {
    path.unshift({
      selector: uniqueSelector(cur),
      label: elementLabel(cur.localName, cur.id || null, Array.from(cur.classList).slice(0, 2)),
    });
  }

  const hasDirectText = Array.from(el.childNodes).some(
    (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim().length > 0,
  );
  const contrast = hasDirectText ? elementContrast(el, cs) : null;

  return {
    selector: uniqueSelector(el),
    tag: el.localName,
    id: el.id || null,
    classes,
    text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    box: boxModel(cs, rect),
    styles,
    attributes: Array.from(el.attributes)
      .filter((a) => a.name !== 'style' || a.value.length < 300)
      .map((a) => ({ prop: a.name, value: a.value.slice(0, 200) })),
    a11y: { role: implicitRole(el), name: accessibleName(el).slice(0, 120) },
    path,
    childCount: el.children.length,
    hasParent: !!parentOf(el) && el !== document.documentElement,
    hasPrev: !!el.previousElementSibling,
    hasNext: !!el.nextElementSibling,
    contrast: contrast
      ? { ...contrast, fontSize: px(cs.fontSize) }
      : null,
    inFixedContext: isInFixedContext(el),
  };
}

export function relativeElement(el: Element, rel: 'parent' | 'child' | 'next' | 'prev'): Element | null {
  switch (rel) {
    case 'parent':
      return parentOf(el) && el !== document.documentElement ? parentOf(el) : null;
    case 'child':
      return Array.from(el.children).find((c) => !isToolkitNode(c)) ?? null;
    case 'next':
      return el.nextElementSibling;
    case 'prev':
      return el.previousElementSibling;
  }
}

// ───────────────────────────── Page meta & walk ─────────────────────────────

export function collectMeta(): PageMeta {
  const doc = document;
  let maxDepth = 0;
  let count = 0;
  const all = doc.getElementsByTagName('*');
  count = all.length;
  // Depth sample: cheap and good enough — measuring every node is O(n·depth).
  const step = Math.max(1, Math.floor(all.length / 800));
  for (let i = 0; i < all.length; i += step) {
    let d = 0;
    for (let p: Element | null = all[i]; p; p = p.parentElement) d++;
    if (d > maxDepth) maxDepth = d;
  }
  return {
    url: location.href,
    title: doc.title,
    lang: doc.documentElement.getAttribute('lang'),
    viewportMeta: doc.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? null,
    description: doc.querySelector('meta[name="description"]')?.getAttribute('content') ?? null,
    hasFavicon: !!doc.querySelector('link[rel~="icon"]'),
    hasDoctype: !!doc.doctype,
    charset: doc.characterSet,
    elementCount: count - doc.querySelectorAll(`[id^="${TOOLKIT_ID_PREFIX}"]`).length,
    maxDepth,
  };
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'HEAD', 'TITLE', 'NOSCRIPT', 'TEMPLATE', 'BASE']);

/**
 * Visits every rendered element once and hands each visitor a shared, lazily
 * evaluated context — a single getComputedStyle / getBoundingClientRect pass
 * serves every analyzer.
 */
export function walkDocument(visitors: Visitor<unknown>[], limit = 25000): { visited: number; truncated: boolean } {
  // Descends into open shadow roots so web-component content is audited too.
  const all = document.body ? [document.body, ...elementsIn(document.body)] : [];
  let visited = 0;
  for (const el of all) {
    if (visited >= limit) return { visited, truncated: true };
    if (SKIP_TAGS.has(el.tagName) || isToolkitNode(el)) continue;
    if (el.closest(`[id^="${TOOLKIT_ID_PREFIX}"]`)) continue;
    visited++;
    let style: CSSStyleDeclaration | null = null;
    let rect: DOMRect | null = null;
    let selector: string | null = null;
    const ctx: WalkContext = {
      el,
      get style() {
        return (style ??= getComputedStyle(el));
      },
      rect: () => (rect ??= el.getBoundingClientRect()),
      selector: () => (selector ??= uniqueSelector(el)),
      visible: () => {
        const s = ctx.style;
        if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
        const r = ctx.rect();
        return r.width > 0 && r.height > 0;
      },
    };
    for (const v of visitors) v.visit(ctx);
  }
  return { visited, truncated: false };
}
