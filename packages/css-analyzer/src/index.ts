import type { Breakpoint, DesignToken } from '@ftk/audit-core';
import { parseColor } from '@ftk/audit-core';

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
  if (parseColor(v) || /^(hsl|hsla|oklch|oklab|lab|lch|color)\(/i.test(v)) return 'color';
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

/**
 * Lightweight text parse for stylesheets the page cannot read through the CSSOM (cross-origin
 * without CORS). It finds breakpoints, :root custom properties and outline-removing :focus rules;
 * it does not resolve @import or nested at-rules beyond what a flat rule scan sees.
 */
export function parseCssText(css: string): ParsedCss {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const mediaTexts = [...text.matchAll(/@media\s+([^{]+)\{/g)].map((m) => m[1].trim());
  const tokens = new Map<string, DesignToken>();
  const focusRules: string[] = [];
  let ruleCount = 0;

  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    const body = m[2];
    if (!selector || selector.startsWith('@')) continue;
    ruleCount++;
    if (/(^|,)\s*(:root|html|:host)\s*(,|$)/.test(selector)) {
      for (const d of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)) {
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
