import { makeFinding, plural } from '@ftk/audit-core';
import type { Finding, OverflowData, PageMeta, ViewportInfo, CssData } from '@ftk/audit-core';

export type DeviceMode = 'mobile' | 'tablet' | 'desktop';

export interface DevicePreset {
  id: string;
  label: string;
  width: number;
  height: number;
  mode: DeviceMode;
  mobile: boolean;
}

export const DEVICE_PRESETS: DevicePreset[] = [
  { id: 'mobile-s', label: 'Small mobile', width: 320, height: 640, mode: 'mobile', mobile: true },
  { id: 'mobile', label: 'Mobile', width: 390, height: 844, mode: 'mobile', mobile: true },
  { id: 'tablet', label: 'Tablet', width: 768, height: 1024, mode: 'tablet', mobile: true },
  { id: 'laptop', label: 'Laptop', width: 1280, height: 800, mode: 'desktop', mobile: false },
  { id: 'desktop', label: 'Desktop', width: 1440, height: 900, mode: 'desktop', mobile: false },
];

export function deviceModeFor(width: number): DeviceMode {
  if (width <= 480) return 'mobile';
  if (width <= 1024) return 'tablet';
  return 'desktop';
}

export interface ResponsiveInput {
  meta: Pick<PageMeta, 'viewportMeta'>;
  viewport: Pick<ViewportInfo, 'width'>;
  overflow: OverflowData;
  css?: Pick<CssData, 'breakpoints' | 'stylesheets'>;
}

export function analyzeResponsive(input: ResponsiveInput): Finding[] {
  const out: Finding[] = [];
  const { meta, viewport, overflow } = input;

  if (!meta.viewportMeta) {
    out.push(
      makeFinding({
        ruleId: 'resp.no-viewport-meta',
        category: 'responsive',
        severity: 'error',
        title: 'Missing viewport meta tag',
        message: 'Mobile browsers will lay the page out at ~980px and scale it down.',
        key: 'viewport-meta',
      }),
    );
  } else {
    const content = meta.viewportMeta.toLowerCase().replace(/\s+/g, '');
    const fixed = /(^|,)width=(\d+)/.exec(content);
    if (fixed) {
      out.push(
        makeFinding({
          ruleId: 'resp.viewport-fixed-width',
          category: 'responsive',
          severity: 'warning',
          title: 'Viewport meta uses a fixed width',
          message: `width=${fixed[2]} prevents the layout from adapting to the device width.`,
          evidence: { content: meta.viewportMeta },
          key: 'viewport-fixed',
        }),
      );
    }
  }

  if (overflow.hasHorizontalScroll) {
    const extra = overflow.scrollWidth - overflow.clientWidth;
    const tags = [...new Set(overflow.culprits.map((c) => c.tag))].join(', ');
    out.push(
      makeFinding({
        ruleId: 'resp.horizontal-scroll',
        category: 'responsive',
        severity: viewport.width <= 768 ? 'error' : 'warning',
        title: `Horizontal scroll at ${viewport.width}px`,
        message: `Content is ${extra}px wider than the viewport${
          overflow.culpritCount ? ` — ${plural(overflow.culpritCount, 'element')} extend past the right edge` : ''
        }.`,
        selectors: overflow.culprits.map((c) => c.selector),
        count: overflow.culpritCount || undefined,
        evidence: {
          viewportWidth: viewport.width,
          scrollWidth: overflow.scrollWidth,
          clientWidth: overflow.clientWidth,
          tags,
        },
        key: `h-scroll:${viewport.width}`,
      }),
    );
  }

  if (input.css && input.css.breakpoints.length === 0 && input.css.stylesheets.some((s) => s.accessible)) {
    out.push(
      makeFinding({
        ruleId: 'resp.no-breakpoints',
        category: 'responsive',
        severity: 'info',
        title: 'No width-based media queries found',
        message:
          'The readable stylesheets contain no min-width / max-width @media rules. The layout may rely on fluid sizing alone, or breakpoints live in stylesheets that could not be read.',
        key: 'no-breakpoints',
      }),
    );
  }
  return out;
}

export interface ViewportTestResult {
  label: string;
  width: number;
  height: number;
  hasHorizontalScroll: boolean;
  scrollWidth: number;
  clientWidth: number;
  culpritCount: number;
  findings: Finding[];
}

export function summarizeViewportTest(
  label: string,
  input: ResponsiveInput & { viewport: ViewportInfo },
): ViewportTestResult {
  const findings = analyzeResponsive(input);
  return {
    label,
    width: input.viewport.width,
    height: input.viewport.height,
    hasHorizontalScroll: input.overflow.hasHorizontalScroll,
    scrollWidth: input.overflow.scrollWidth,
    clientWidth: input.overflow.clientWidth,
    culpritCount: input.overflow.culpritCount,
    findings,
  };
}
