import { makeFinding, plural } from '@ftk/audit-core';
import type { Finding, TypographyData } from '@ftk/audit-core';

/** Primary family from a CSS font-family stack. */
export function primaryFamily(stack: string): string {
  return (stack.split(',')[0] ?? '').trim().replace(/^["']|["']$/g, '');
}

const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'system-ui', 'cursive', 'fantasy', 'ui-sans-serif', 'ui-serif', 'ui-monospace', '-apple-system', 'blinkmacsystemfont']);

export interface TypographySummary {
  families: { family: string; count: number }[];
  /** Distinct sizes, ascending. */
  sizes: { px: number; count: number }[];
  weights: { weight: number; count: number }[];
  /** Ratio between successive distinct sizes — a consistent scale sits around 1.125–1.5. */
  scaleRatios: number[];
}

export function summarizeTypography(data: TypographyData): TypographySummary {
  const sizes = [...data.sizes].sort((a, b) => a.px - b.px);
  const ratios: number[] = [];
  for (let i = 1; i < sizes.length; i++) ratios.push(Number((sizes[i].px / sizes[i - 1].px).toFixed(2)));
  return {
    families: [...data.families].sort((a, b) => b.count - a.count),
    sizes,
    weights: [...data.weights].sort((a, b) => a.weight - b.weight),
    scaleRatios: ratios,
  };
}

export function analyzeTypography(data: TypographyData): Finding[] {
  const out: Finding[] = [];
  const families = data.families.filter((f) => !GENERIC.has(f.family.toLowerCase()));
  // Ignore long-tail families used by < 2% of text (icon fonts, one-off widgets).
  const total = families.reduce((n, f) => n + f.count, 0) || 1;
  const meaningful = families.filter((f) => f.count / total >= 0.02);

  if (meaningful.length > 3) {
    out.push(
      makeFinding({
        ruleId: 'ux.too-many-fonts',
        category: 'uxui',
        severity: 'warning',
        title: `${meaningful.length} font families`,
        message: `${meaningful.slice(0, 5).map((f) => f.family).join(', ')}. Most designs need one or two (body + display/mono).`,
        evidence: { families: meaningful.length },
        key: 'fonts',
      }),
    );
  }

  const sizes = data.sizes.filter((s) => s.count >= 2);
  if (sizes.length > 10) {
    out.push(
      makeFinding({
        ruleId: 'ux.too-many-sizes',
        category: 'uxui',
        severity: 'warning',
        title: `${sizes.length} distinct font sizes`,
        message: `Sizes: ${sizes.map((s) => `${+s.px.toFixed(1)}`).join(', ')} px. A type scale of 6–8 steps keeps hierarchy clear.`,
        evidence: { sizes: sizes.length },
        key: 'sizes',
      }),
    );
  }

  if (data.smallText.length) {
    const worst = [...data.smallText].sort((a, b) => a.fontSize - b.fontSize)[0];
    out.push(
      makeFinding({
        ruleId: 'ux.small-text',
        category: 'uxui',
        severity: data.smallText.length > 10 ? 'warning' : 'info',
        title: `${plural(data.smallText.length, 'text element')} under 12 px`,
        message: `Smallest is ${+worst.fontSize.toFixed(1)} px. Small text is hard to read, especially on mobile.`,
        selectors: data.smallText.slice(0, 20).map((s) => s.selector),
        count: data.smallText.length,
        fix: {
          label: 'Raise to 12 px',
          css: data.smallText.slice(0, 20).map((s) => `${s.selector} { font-size: 12px !important; }`).join('\n'),
        },
        key: 'small-text',
      }),
    );
  }

  const tight = data.blocks.filter((b) => b.fontSize >= 14 && b.lineHeightRatio > 0 && b.lineHeightRatio < 1.3);
  if (tight.length) {
    out.push(
      makeFinding({
        ruleId: 'ux.line-height-tight',
        category: 'uxui',
        severity: 'warning',
        title: `${plural(tight.length, 'paragraph')} with tight line-height`,
        message: `Line-height ${tight[0].lineHeightRatio.toFixed(2)}× is under the 1.4–1.6 comfortable range for body text (WCAG 1.4.12 suggests ≥ 1.5).`,
        selectors: tight.slice(0, 20).map((b) => b.selector),
        count: tight.length,
        fix: { label: 'Set line-height: 1.5', css: tight.slice(0, 20).map((b) => `${b.selector} { line-height: 1.5 !important; }`).join('\n') },
        key: 'line-height',
      }),
    );
  }

  const long = data.blocks.filter((b) => b.charsPerLine > 90);
  if (long.length) {
    const worst = [...long].sort((a, b) => b.charsPerLine - a.charsPerLine)[0];
    out.push(
      makeFinding({
        ruleId: 'ux.line-length',
        category: 'uxui',
        severity: 'warning',
        title: `${plural(long.length, 'text block')} with very long lines`,
        message: `Up to ~${Math.round(worst.charsPerLine)} characters per line; 45–80 reads best.`,
        selectors: long.slice(0, 20).map((b) => b.selector),
        count: long.length,
        fix: { label: 'Cap measure at 70ch', css: long.slice(0, 20).map((b) => `${b.selector} { max-width: 70ch !important; }`).join('\n') },
        key: 'line-length',
      }),
    );
  }
  return out;
}
