import { formatMs, makeFinding, rate } from '@ftk/audit-core';
import type { Finding, ImageSample, PageMeta, Rating, VitalsSnapshot } from '@ftk/audit-core';

export interface Threshold {
  good: number;
  poor: number;
}

/** web.dev thresholds (75th percentile guidance). */
export const THRESHOLDS = {
  lcp: { good: 2500, poor: 4000 },
  cls: { good: 0.1, poor: 0.25 },
  inp: { good: 200, poor: 500 },
  fcp: { good: 1800, poor: 3000 },
  ttfb: { good: 800, poor: 1800 },
  tbt: { good: 200, poor: 600 },
} satisfies Record<string, Threshold>;

export type VitalName = keyof typeof THRESHOLDS;

export function rateVital(name: VitalName, value: number | null | undefined): Rating | null {
  if (value == null) return null;
  const t = THRESHOLDS[name];
  return rate(value, t.good, t.poor);
}

export function formatVital(name: VitalName, value: number | null | undefined): string {
  if (value == null) return '—';
  return name === 'cls' ? value.toFixed(3) : formatMs(value);
}

const severityFor = (r: Rating | null) => (r === 'poor' ? 'error' : 'warning') as 'error' | 'warning';

export interface PerformanceInput {
  vitals: VitalsSnapshot;
  meta: Pick<PageMeta, 'elementCount' | 'maxDepth'>;
  images: ImageSample[];
}

export function analyzePerformance({ vitals, meta, images }: PerformanceInput): Finding[] {
  const out: Finding[] = [];
  const push = (
    name: VitalName,
    value: number | null,
    title: string,
    message: string,
    extra: Partial<Parameters<typeof makeFinding>[0]> = {},
  ) => {
    const r = rateVital(name, value);
    if (value == null || r === null || r === 'good') return;
    out.push(
      makeFinding({
        ruleId: `perf.${name}`,
        category: 'performance',
        severity: severityFor(r),
        title,
        message,
        evidence: { value, good: THRESHOLDS[name].good, poor: THRESHOLDS[name].poor },
        key: name,
        ...extra,
      }),
    );
  };

  if (vitals.lcp) {
    const l = vitals.lcp;
    push('lcp', l.value, `Slow Largest Contentful Paint (${formatMs(l.value)})`,
      `LCP element${l.selector ? ` ${l.selector}` : ''} painted at ${formatMs(l.value)}; the goal is under ${formatMs(THRESHOLDS.lcp.good)}.`,
      { selectors: l.selector ? [l.selector] : undefined, url: l.url ?? undefined });

    if (l.tag === 'img' && l.selector) {
      const img = images.find((i) => i.selector === l.selector);
      if (img?.loading === 'lazy') {
        out.push(
          makeFinding({
            ruleId: 'perf.lcp-lazy',
            category: 'performance',
            severity: 'error',
            title: 'LCP image is lazy-loaded',
            message: 'The largest above-the-fold image has loading="lazy", which delays its request until layout.',
            selectors: [l.selector],
          }),
        );
      } else if (img && img.fetchPriority !== 'high' && vitals.lcp.value > THRESHOLDS.lcp.good) {
        out.push(
          makeFinding({
            ruleId: 'perf.lcp-priority',
            category: 'performance',
            severity: 'info',
            title: 'LCP image has no fetchpriority="high"',
            message: 'Hinting the hero image as high priority lets the browser fetch it ahead of lower-value requests.',
            selectors: [l.selector],
          }),
        );
      }
    }
  }

  push('cls', vitals.cls, `Layout shifts (CLS ${vitals.cls.toFixed(3)})`,
    `Cumulative layout shift is ${vitals.cls.toFixed(3)}; the goal is under ${THRESHOLDS.cls.good}.`,
    {
      selectors: [...new Set([...vitals.shifts].sort((a, b) => b.value - a.value).flatMap((s) => s.selectors))].slice(0, 12),
    });

  if (vitals.inp) {
    push('inp', vitals.inp.value, `Slow interaction (INP ${formatMs(vitals.inp.value)})`,
      `Slowest interaction was a ${vitals.inp.type}${vitals.inp.selector ? ` on ${vitals.inp.selector}` : ''} taking ${formatMs(vitals.inp.value)}.`,
      { selectors: vitals.inp.selector ? [vitals.inp.selector] : undefined });
  }
  push('fcp', vitals.fcp, `Slow First Contentful Paint (${formatMs(vitals.fcp)})`,
    `First content appeared after ${formatMs(vitals.fcp)}.`);
  push('ttfb', vitals.ttfb, `Slow server response (TTFB ${formatMs(vitals.ttfb)})`,
    `The first byte arrived after ${formatMs(vitals.ttfb)}, delaying everything else.`);
  if (vitals.tbt > 0) {
    push('tbt', vitals.tbt, `High Total Blocking Time (${formatMs(vitals.tbt)})`,
      `${vitals.longTasks.length} long task(s) blocked the main thread for ${formatMs(vitals.tbt)} beyond the 50 ms budget.`);
  }

  if (meta.elementCount > 1500) {
    out.push(
      makeFinding({
        ruleId: 'perf.dom-size',
        category: 'performance',
        severity: meta.elementCount > 3000 ? 'error' : 'warning',
        title: `Large DOM (${meta.elementCount.toLocaleString()} elements)`,
        message: `Big DOMs slow style calculation, layout and memory use. Depth reaches ${meta.maxDepth}.`,
        evidence: { elements: meta.elementCount, depth: meta.maxDepth },
        key: 'dom-size',
      }),
    );
  } else if (meta.maxDepth > 32) {
    out.push(
      makeFinding({
        ruleId: 'perf.dom-depth',
        category: 'performance',
        severity: 'warning',
        title: `Deeply nested DOM (depth ${meta.maxDepth})`,
        message: 'Deep trees make style recalculation and layout more expensive.',
        evidence: { depth: meta.maxDepth },
        key: 'dom-depth',
      }),
    );
  }
  return out;
}
