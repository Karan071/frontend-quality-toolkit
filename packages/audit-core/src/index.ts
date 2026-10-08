export * from './types';
export * from './color';
export * from './url-safety';

import type { Category, EvidenceValue, Finding, Severity, TempFix } from './types';

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function plural(n: number, one: string, many = one + 's'): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Small deterministic string hash, enough for stable finding ids. */
export function hash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export interface FindingInput {
  ruleId: string;
  category: Category;
  severity: Severity;
  title: string;
  message: string;
  selectors?: string[];
  count?: number;
  url?: string;
  evidence?: Record<string, EvidenceValue>;
  fix?: TempFix;
  /** Disambiguates findings of the same rule; defaults to first selector/url. */
  key?: string;
}

export function makeFinding(input: FindingInput): Finding {
  const { key, ...rest } = input;
  const discriminator = key ?? input.selectors?.[0] ?? input.url ?? '';
  return {
    ...rest,
    id: `${input.ruleId}:${hash(discriminator)}`,
    count: input.count ?? input.selectors?.length,
  };
}

export const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function sortFindings<T extends Finding>(findings: T[]): T[] {
  return [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/** Caps a list while remembering how many were dropped. */
export function sample<T>(items: T[], max: number): T[] {
  return items.length > max ? items.slice(0, max) : items;
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export type Rating = 'good' | 'needs-improvement' | 'poor';

export function rate(value: number, good: number, poor: number): Rating {
  if (value <= good) return 'good';
  if (value <= poor) return 'needs-improvement';
  return 'poor';
}

// Built from a string so the bundled output stays ASCII-only: Chrome refuses content scripts
// containing the U+FFFF noncharacter that a literal /[\u00A0-\uFFFF]/ gets minified into.
const CSS_UNSAFE = new RegExp('[^a-zA-Z0-9_\\u00A0-\\uFFFF-]', 'g');

/** Escapes an identifier for use in a CSS selector without needing `CSS.escape`. */
export function cssEscape(value: string): string {
  return value.replace(CSS_UNSAFE, (c) => `\\${c}`).replace(/^(\d)/, '\\3$1 ');
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}
