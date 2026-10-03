import { CATEGORIES, sortFindings } from '@ftk/audit-core';
import type { Category, EnrichedFinding, Finding, PageSnapshot, ProbeInfo } from '@ftk/audit-core';
import { analyzePerformance } from '@ftk/performance-analyzer';
import { analyzeResponsive } from '@ftk/responsive-analyzer';
import { analyzeAccessibility } from '@ftk/accessibility-analyzer';
import { analyzeImages, attachImageSizes } from '@ftk/image-analyzer';
import { analyzeBundles } from '@ftk/bundle-analyzer';
import { analyzeColors, analyzePalette } from '@ftk/color-analyzer';
import { analyzeTypography } from '@ftk/typography-analyzer';
import { analyzeUx } from '@ftk/ux-analyzer';
import { enrich, summarizeByCategory } from '@ftk/recommendation-engine';
import { parseBreakpoints, parseCssText, sourceLabel } from '@ftk/css-analyzer';

export interface AuditResult {
  url: string;
  title: string;
  takenAt: number;
  snapshot: PageSnapshot;
  findings: EnrichedFinding[];
  truncated: boolean;
}

/** URLs whose size Resource Timing could not report and that are worth probing. */
export function urlsToProbe(snapshot: PageSnapshot): string[] {
  const urls = new Set<string>();
  for (const r of snapshot.resources) {
    if (!r.sizeKnown && ['script', 'css', 'image', 'font'].includes(r.type)) urls.add(r.url);
  }
  const known = new Set(snapshot.resources.filter((r) => r.sizeKnown).map((r) => r.url));
  for (const img of snapshot.images) {
    if (img.bytes == null && /^https?:/.test(img.src) && !known.has(img.src)) urls.add(img.src);
  }
  return [...urls];
}

/** Merges probe results into resources and image samples. */
export function applyProbes(snapshot: PageSnapshot, probes: Record<string, ProbeInfo>): PageSnapshot {
  const resources = snapshot.resources.map((r) => (probes[r.url] ? { ...r, probe: probes[r.url] } : r));
  let images = attachImageSizes(snapshot.images, resources);
  images = images.map((img) => {
    const p = probes[img.src];
    return img.bytes == null && p ? { ...img, bytes: p.size, contentType: p.contentType } : img;
  });
  return { ...snapshot, resources, images };
}

/** Cross-origin stylesheet URLs whose text should be fetched (CSSOM access was denied). */
export function externalSheetUrls(snapshot: PageSnapshot): string[] {
  return snapshot.css.stylesheets.filter((s) => !s.accessible && !s.parsed && s.href && /^https?:/.test(s.href)).map((s) => s.href!);
}

/**
 * Folds the text of cross-origin stylesheets into the snapshot: breakpoints, design tokens and
 * focus-outline removals become visible, and the sheet no longer counts as unreadable.
 */
export function applyExternalCss(snapshot: PageSnapshot, texts: Record<string, string>): PageSnapshot {
  const media: string[] = [];
  const tokens = new Map(snapshot.css.tokens.map((t) => [t.name, t]));
  const focusRules = [...snapshot.a11y.focusRules];
  const stylesheets = snapshot.css.stylesheets.map((sheet) => {
    const text = sheet.href ? texts[sheet.href] : undefined;
    if (sheet.accessible || text === undefined) return sheet;
    const parsed = parseCssText(text);
    media.push(...parsed.mediaTexts);
    parsed.tokens.forEach((t) => !tokens.has(t.name) && tokens.set(t.name, t));
    parsed.focusRules.forEach((selector) => focusRules.push({ selector, source: sourceLabel(sheet.href) }));
    return { ...sheet, parsed: true, ruleCount: parsed.ruleCount };
  });
  if (stylesheets.every((s, i) => s === snapshot.css.stylesheets[i])) return snapshot;

  // Merge breakpoint counts by (kind, px).
  const merged = new Map(snapshot.css.breakpoints.map((b) => [`${b.kind}:${b.px}`, { ...b }]));
  for (const b of parseBreakpoints(media)) {
    const hit = merged.get(`${b.kind}:${b.px}`);
    if (hit) hit.uses += b.uses;
    else merged.set(`${b.kind}:${b.px}`, b);
  }
  return {
    ...snapshot,
    css: {
      ...snapshot.css,
      stylesheets,
      tokens: [...tokens.values()],
      breakpoints: [...merged.values()].sort((a, b) => a.px - b.px),
      inaccessibleSheets: stylesheets.filter((s) => !s.accessible && !s.parsed).length,
    },
    a11y: { ...snapshot.a11y, focusRules: focusRules.slice(0, 20) },
  };
}

export function analyzeSnapshot(s: PageSnapshot): Finding[] {
  const palette = analyzePalette(s.colors);
  return [
    ...analyzePerformance({ vitals: s.vitals, meta: s.meta, images: s.images }),
    ...analyzeResponsive({ meta: s.meta, viewport: s.viewport, overflow: s.overflow, css: s.css }),
    ...analyzeAccessibility({ a11y: s.a11y, images: s.images, meta: s.meta, viewport: s.viewport }),
    ...analyzeImages({ images: s.images, viewport: s.viewport, vitals: s.vitals }),
    ...analyzeBundles({ resources: s.resources, scripts: s.scripts, stylesheets: s.css.stylesheets }),
    ...analyzeColors(s.colors),
    ...analyzeTypography(s.typography),
    ...analyzeUx({ ux: s.ux, spacing: s.spacing, controls: s.a11y.controls, meta: s.meta, css: s.css, distinctColors: palette.distinct }),
  ];
}

export function buildAudit(snapshot: PageSnapshot, truncated = false): AuditResult {
  const unique = new Map<string, Finding>();
  for (const f of analyzeSnapshot(snapshot)) if (!unique.has(f.id)) unique.set(f.id, f);
  return {
    url: snapshot.meta.url,
    title: snapshot.meta.title,
    takenAt: snapshot.takenAt,
    snapshot,
    findings: enrich(sortFindings([...unique.values()])),
    truncated,
  };
}

export interface AuditDiff {
  /** Total findings before/after. */
  before: number;
  after: number;
  byCategory: { category: Category; before: number; after: number }[];
  byRule: { ruleId: string; title: string; before: number; after: number }[];
}

const weight = (f: Finding) => f.count ?? 1;

export function compareAudits(before: AuditResult, after: AuditResult): AuditDiff {
  const cat = (a: AuditResult) => summarizeByCategory(a.findings, CATEGORIES);
  const b = cat(before);
  const a = cat(after);
  const rules = new Map<string, { title: string; before: number; after: number }>();
  for (const f of before.findings) {
    const r = rules.get(f.ruleId) ?? { title: f.title, before: 0, after: 0 };
    r.before += weight(f);
    rules.set(f.ruleId, r);
  }
  for (const f of after.findings) {
    const r = rules.get(f.ruleId) ?? { title: f.title, before: 0, after: 0 };
    r.after += weight(f);
    rules.set(f.ruleId, r);
  }
  return {
    before: before.findings.length,
    after: after.findings.length,
    byCategory: CATEGORIES.map((category, i) => ({ category, before: b[i].total, after: a[i].total })),
    byRule: [...rules.entries()]
      .map(([ruleId, v]) => ({ ruleId, ...v }))
      .filter((r) => r.before !== r.after)
      .sort((x, y) => y.before - y.after - (x.before - x.after)),
  };
}
