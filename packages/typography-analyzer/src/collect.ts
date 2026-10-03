import type { TypographyData, Visitor } from '@ftk/audit-core';
import { primaryFamily } from './index';

const MAX_BLOCKS = 60;
const MAX_SMALL = 60;

/**
 * Samples font families, sizes and weights from elements with direct text, and
 * paragraph-like blocks for line-height and line-length checks.
 */
export function typographyVisitor(): Visitor<TypographyData> {
  const families = new Map<string, number>();
  const sizes = new Map<number, number>();
  const weights = new Map<number, number>();
  const blocks: TypographyData['blocks'] = [];
  const smallText: TypographyData['smallText'] = [];
  const bump = <K,>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1);

  return {
    visit(ctx) {
      const { el } = ctx;
      let text = '';
      for (const n of el.childNodes) if (n.nodeType === Node.TEXT_NODE) text += n.textContent ?? '';
      text = text.trim();
      if (!text || !ctx.visible()) return;

      const s = ctx.style;
      const fontSize = parseFloat(s.fontSize);
      if (!fontSize) return;
      bump(families, primaryFamily(s.fontFamily));
      // Whole pixels: rem/em arithmetic yields 14.1, 14.2, 14.8… which are not distinct design choices.
      bump(sizes, Math.round(fontSize));
      bump(weights, parseInt(s.fontWeight, 10) || 400);

      if (fontSize < 12 && smallText.length < MAX_SMALL) smallText.push({ selector: ctx.selector(), fontSize });

      // Paragraph-like: enough text to wrap across lines.
      if (text.length >= 80 && blocks.length < MAX_BLOCKS && s.display !== 'inline') {
        const lineHeight = s.lineHeight === 'normal' ? 1.2 : parseFloat(s.lineHeight) / fontSize;
        const width = ctx.rect().width - (parseFloat(s.paddingLeft) || 0) - (parseFloat(s.paddingRight) || 0);
        // Average glyph ≈ 0.5em for proportional fonts.
        blocks.push({
          selector: ctx.selector(),
          fontSize,
          lineHeightRatio: Number.isFinite(lineHeight) ? Number(lineHeight.toFixed(2)) : 0,
          charsPerLine: Math.min(width / (fontSize * 0.5), text.length),
          width: Math.round(width),
        });
      }
    },
    result: () => ({
      families: [...families].map(([family, count]) => ({ family, count })),
      sizes: [...sizes].map(([px, count]) => ({ px, count })),
      weights: [...weights].map(([weight, count]) => ({ weight, count })),
      blocks,
      smallText,
    }),
  };
}
