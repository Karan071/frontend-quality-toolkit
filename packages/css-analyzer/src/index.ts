import type { Breakpoint, DesignToken } from '@ftk/audit-core';
import { isPlainColorValue, parseColor } from '@ftk/audit-core';

const MEDIA_WIDTH = /\(\s*(min|max)-width\s*:\s*([\d.]+)\s*(px|em|rem)\s*\)/g;
// Range syntax: (width >= 768px), (width <= 600px), (width < 600px), (width > 768px)
const MEDIA_RANGE = /\(\s*width\s*(>=|<=|>|<)\s*([\d.]+)\s*(px|em|rem)\s*\)/g;

const toPx = (n: number, unit: string) => (unit === 'px' ? n : n * 16);

/** Extracts distinct width breakpoints from raw media-query strings. */
export function parseBreakpoints(mediaTexts: string[]): Breakpoint[] {
  const found = new Map<string, Breakpoint>();
  const add = (px: number, kind: 'min' | 'max') => {
    const rounded = Math.round(px);
    const key = `${kind}:${rounded}`;
    const bp = found.get(key);
    if (bp) bp.uses++;
    else found.set(key, { px: rounded, kind, uses: 1 });
  };
  for (const text of mediaTexts) {
    for (const m of text.matchAll(MEDIA_WIDTH)) add(toPx(parseFloat(m[2]), m[3]), m[1] as 'min' | 'max');
    for (const m of text.matchAll(MEDIA_RANGE)) {
      add(toPx(parseFloat(m[2]), m[3]), m[1].startsWith('>') ? 'min' : 'max');
    }
  }
  return [...found.values()].sort((a, b) => a.px - b.px || (a.kind === 'min' ? -1 : 1));
}

export function classifyToken(value: string): DesignToken['kind'] {
  const v = value.trim();
  // isPlainColorValue rejects `hsl(...) url(http://…)`, which would otherwise make the panel fetch it.
  if (isPlainColorValue(v) && (parseColor(v) || /^(hsl|hsla|oklch|oklab|lab|lch|color)\(/i.test(v))) return 'color';
  if (/^-?[\d.]+(px|rem|em|%|vw|vh|ch)?$/.test(v) && v !== '0') return 'size';
  if (/serif|sans-serif|monospace|system-ui|["']/.test(v)) return 'font';
  return 'other';
}

/** Short, human label for where a rule came from. */
export function sourceLabel(href: string | null): string {
  if (!href) return '<style>';
  try {
    const u = new URL(href);
    const file = u.pathname.split('/').filter(Boolean).pop() ?? u.host;
    return file;
  } catch {
    return href;
  }
}

export interface ParsedCss {
  mediaTexts: string[];
  tokens: DesignToken[];
  focusRules: string[];
  ruleCount: number;
}

/** Removes /* … *\/ comments in one linear pass; an unterminated comment runs to the end, as in browsers. */
function stripComments(css: string): string {
  let out = '';
  let pos = 0;
  for (;;) {
    const open = css.indexOf('/*', pos);
    if (open < 0) return out + css.slice(pos);
    out += css.slice(pos, open);
    const close = css.indexOf('*/', open + 2);
    if (close < 0) return out;
    pos = close + 2;
  }
}

/** Selector/body pairs of every innermost `selector { body }` block, found in a single linear pass. */
function* flatRules(text: string): Generator<[selector: string, body: string]> {
  let start = 0; // first char after the previous brace
  let openAt = -1; // index of a `{` with no brace seen since
  let selector = '';
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 123 /* { */) {
      selector = text.slice(start, i);
      openAt = i;
      start = i + 1;
    } else if (c === 125 /* } */) {
      if (openAt >= 0 && openAt === start - 1 && selector) yield [selector, text.slice(openAt + 1, i)];
      openAt = -1;
      start = i + 1;
    }
  }
}

/** Media query texts of every `@media … {`, without regex backtracking over attacker-sized input. */
function mediaQueries(text: string): string[] {
  const out: string[] = [];
  let pos = 0;
  let brace = -2; // cached index of the next `{` at or after `pos`
  for (;;) {
    const at = text.indexOf('@media', pos);
    if (at < 0) break;
    const afterKeyword = at + 6;
    if (brace !== -1 && brace < afterKeyword) brace = text.indexOf('{', afterKeyword);
    if (brace < 0) break;
    const query = text.slice(afterKeyword, brace);
    if (query.length >= 2 && /^\s/.test(query)) {
      out.push(query.trim());
      pos = brace + 1;
    } else {
      pos = afterKeyword;
    }
  }
  return out;
}

/**
 * Lightweight text parse for stylesheets the page cannot read through the CSSOM (cross-origin
 * without CORS). It finds breakpoints, :root custom properties and outline-removing :focus rules;
 * it does not resolve @import or nested at-rules beyond what a flat rule scan sees.
 * The input is fully attacker-controlled, so every step here runs in linear time.
 */
export function parseCssText(css: string): ParsedCss {
  const text = stripComments(css);
  const mediaTexts = mediaQueries(text);
  const tokens = new Map<string, DesignToken>();
  const focusRules: string[] = [];
  let ruleCount = 0;

  for (const [rawSelector, body] of flatRules(text)) {
    const selector = rawSelector.trim();
    if (!selector || selector.startsWith('@')) continue;
    ruleCount++;
    if (/(^|,)\s*(:root|html|:host)\s*(,|$)/.test(selector)) {
      for (const declaration of body.split(';')) {
        const d = /^\s*(--[\w-]+)\s*:\s*(.+)$/s.exec(declaration);
        if (!d) continue;
        const value = d[2].trim();
        if (value && !tokens.has(d[1])) tokens.set(d[1], { name: d[1], value, kind: classifyToken(value) });
      }
    }
    if (/:focus(-visible)?\b/.test(selector)) {
      const removes = /outline(-style|-width)?\s*:\s*(none|0(px)?)\b/.test(body);
      const alternative = /(box-shadow|border(-color)?|background(-color)?|text-decoration)\s*:/.test(body);
      if (removes && !alternative) focusRules.push(selector.replace(/\s+/g, ' '));
    }
  }
  return { mediaTexts, tokens: [...tokens.values()], focusRules: focusRules.slice(0, 20), ruleCount };
}
