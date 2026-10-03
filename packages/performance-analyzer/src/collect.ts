import type { LayoutShift, LcpInfo, VitalsSnapshot } from '@ftk/audit-core';
import { uniqueSelector } from '@ftk/dom-analyzer/collect';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface VitalsCollector {
  snapshot(): VitalsSnapshot;
  stop(): void;
}

const MAX_SHIFTS_KEPT = 30;

/**
 * Starts PerformanceObservers (all `buffered`, so entries that happened before
 * injection are still delivered) and keeps a rolling snapshot of the vitals.
 */
export function startVitals(onChange: () => void): VitalsCollector {
  const observers: PerformanceObserver[] = [];
  let lcp: LcpInfo | null = null;
  let lcpFinal = false;
  let fcp: number | null = null;

  // CLS: session windows — gaps < 1s, max 5s, take the worst window.
  const shifts: LayoutShift[] = [];
  let sessionValue = 0;
  let sessionStart = 0;
  let sessionLast = 0;
  let cls = 0;

  // INP: worst interaction (p98 for pages with 50+ interactions).
  const interactions = new Map<number, { duration: number; selector: string | null; type: string }>();
  let inp: VitalsSnapshot['inp'] = null;

  const longTasks: { start: number; duration: number }[] = [];

  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;

  let timer: number | undefined;
  const notify = () => {
    if (timer !== undefined) return;
    timer = window.setTimeout(() => {
      timer = undefined;
      onChange();
    }, 250);
  };

  const observe = (type: string, cb: (entries: PerformanceEntry[]) => void, extra: object = {}) => {
    try {
      const po = new PerformanceObserver((list) => {
        cb(list.getEntries());
        notify();
      });
      po.observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
      observers.push(po);
    } catch {
      /* entry type unsupported in this browser */
    }
  };

  observe('paint', (entries) => {
    for (const e of entries) if (e.name === 'first-contentful-paint') fcp = e.startTime;
  });

  observe('largest-contentful-paint', (entries) => {
    if (lcpFinal) return;
    const e = entries[entries.length - 1] as any;
    if (!e) return;
    const node: Element | null = e.element ?? null;
    lcp = {
      value: e.renderTime || e.loadTime || e.startTime,
      selector: node && node.isConnected ? uniqueSelector(node) : null,
      url: e.url || null,
      size: e.size ?? 0,
      tag: node ? node.localName : null,
    };
  });
  const finalizeLcp = () => {
    lcpFinal = true;
  };
  for (const type of ['keydown', 'pointerdown', 'scroll'] as const) {
    addEventListener(type, finalizeLcp, { once: true, capture: true, passive: true });
  }

  observe('layout-shift', (entries) => {
    for (const e of entries as any[]) {
      if (e.hadRecentInput) continue;
      if (sessionValue && e.startTime - sessionLast < 1000 && e.startTime - sessionStart < 5000) {
        sessionValue += e.value;
      } else {
        sessionValue = e.value;
        sessionStart = e.startTime;
      }
      sessionLast = e.startTime;
      if (sessionValue > cls) cls = sessionValue;

      const selectors: string[] = [];
      for (const s of (e.sources ?? []) as any[]) {
        if (s.node && (s.node as Node).nodeType === 1 && (s.node as Element).isConnected) {
          selectors.push(uniqueSelector(s.node as Element));
        }
      }
      shifts.push({ value: e.value, time: e.startTime, selectors });
      if (shifts.length > MAX_SHIFTS_KEPT) {
        shifts.sort((a, b) => b.value - a.value);
        shifts.length = MAX_SHIFTS_KEPT;
      }
    }
  });

  observe(
    'event',
    (entries) => {
      for (const e of entries as any[]) {
        if (!e.interactionId) continue;
        const prev = interactions.get(e.interactionId);
        if (!prev || e.duration > prev.duration) {
          interactions.set(e.interactionId, {
            duration: e.duration,
            selector: e.target && e.target.isConnected ? uniqueSelector(e.target as Element) : null,
            type: e.name,
          });
        }
      }
      const sorted = [...interactions.values()].sort((a, b) => b.duration - a.duration);
      const idx = Math.min(sorted.length - 1, Math.floor(sorted.length / 50));
      const pick = sorted[idx];
      inp = pick ? { value: pick.duration, selector: pick.selector, type: pick.type } : null;
    },
    { durationThreshold: 16 },
  );

  observe('longtask', (entries) => {
    for (const e of entries) {
      longTasks.push({ start: e.startTime, duration: e.duration });
      if (longTasks.length > 200) longTasks.shift();
    }
  });

  const onLoad = () => notify();
  addEventListener('load', onLoad);
  document.addEventListener('DOMContentLoaded', onLoad);

  return {
    snapshot() {
      const navNow = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      const n = navNow ?? nav;
      const tbt = longTasks
        .filter((t) => fcp == null || t.start >= fcp)
        .reduce((sum, t) => sum + Math.max(0, t.duration - 50), 0);
      return {
        lcp,
        cls,
        shifts: [...shifts].sort((a, b) => b.value - a.value),
        inp,
        fcp,
        ttfb: n && n.responseStart > 0 ? n.responseStart : null,
        domContentLoaded: n && n.domContentLoadedEventEnd > 0 ? n.domContentLoadedEventEnd : null,
        load: n && n.loadEventEnd > 0 ? n.loadEventEnd : null,
        longTasks: [...longTasks],
        tbt,
        navigationType: n?.type ?? null,
        partial: lcp == null && fcp == null && document.readyState === 'complete',
      };
    },
    stop() {
      observers.forEach((o) => o.disconnect());
      removeEventListener('load', onLoad);
    },
  };
}
