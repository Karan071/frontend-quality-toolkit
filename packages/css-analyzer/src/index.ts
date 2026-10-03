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
