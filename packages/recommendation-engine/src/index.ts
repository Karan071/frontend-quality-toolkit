import { CATEGORY_LABEL, SEVERITY_ORDER, formatMs, redactUrl } from '@ftk/audit-core';
import type { Category, EnrichedFinding, Finding, Severity, VitalsSnapshot } from '@ftk/audit-core';
import { RULES } from './rules';

export { RULES } from './rules';

const SEVERITY_WEIGHT: Record<Severity, number> = { error: 3, warning: 2, info: 1 };

const FALLBACK = {
  why: 'This pattern is commonly associated with a degraded experience.',
  how: ['Review the highlighted elements and the evidence above.'],
  impact: 3,
};

/** Priority = rule impact × severity weight, nudged by how widespread the issue is. */
export function priorityOf(finding: Finding): number {
  const impact = (RULES[finding.ruleId] ?? FALLBACK).impact;
  const spread = Math.min(Math.log2((finding.count ?? 1) + 1), 4) / 4; // 0–1
  return Math.round((impact * SEVERITY_WEIGHT[finding.severity] + spread * 3) * 10) / 10;
}

export function enrich(findings: Finding[]): EnrichedFinding[] {
  return findings
    .map((f) => {
      const doc = RULES[f.ruleId] ?? FALLBACK;
      return { ...f, recommendation: { why: doc.why, how: doc.how, priority: priorityOf(f) } };
    })
    .sort((a, b) => b.recommendation.priority - a.recommendation.priority);
}

export interface Recommendation {
  ruleId: string;
  category: Category;
  title: string;
  severity: Severity;
  occurrences: number;
  priority: number;
  how: string[];
  findingIds: string[];
}

/** Top recommendations, deduplicated by rule so five failing images read as one action. */
export function topRecommendations(findings: EnrichedFinding[], limit = 5): Recommendation[] {
  const byRule = new Map<string, Recommendation>();
  for (const f of findings) {
    const hit = byRule.get(f.ruleId);
    if (hit) {
      hit.occurrences++;
      hit.findingIds.push(f.id);
      hit.priority = Math.max(hit.priority, f.recommendation.priority);
      if (SEVERITY_ORDER[f.severity] < SEVERITY_ORDER[hit.severity]) hit.severity = f.severity;
    } else {
      byRule.set(f.ruleId, {
        ruleId: f.ruleId,
        category: f.category,
        title: f.title,
        severity: f.severity,
        occurrences: 1,
        priority: f.recommendation.priority,
        how: f.recommendation.how,
        findingIds: [f.id],
      });
    }
  }
  return [...byRule.values()].sort((a, b) => b.priority - a.priority).slice(0, limit);
}

export interface CategorySummary {
  category: Category;
  errors: number;
  warnings: number;
  infos: number;
  total: number;
}

export function summarizeByCategory(findings: Finding[], categories: Category[]): CategorySummary[] {
  return categories.map((category) => {
    const list = findings.filter((f) => f.category === category);
    return {
      category,
      errors: list.filter((f) => f.severity === 'error').length,
      warnings: list.filter((f) => f.severity === 'warning').length,
      infos: list.filter((f) => f.severity === 'info').length,
      total: list.length,
    };
  });
}

// ───────────────────────────── export ─────────────────────────────

export interface AuditReport {
  url: string;
  title: string;
  takenAt: number;
  viewport: { width: number; height: number };
  vitals?: VitalsSnapshot | null;
  findings: EnrichedFinding[];
}

/**
 * Page-derived text ends up in a report people paste into trackers and chats. Keep it on one line,
 * neutralise HTML and cap its length so a hostile title cannot add headings, links or instructions.
 */
function plain(text: string | undefined, max = 300): string {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  return (flat.length > max ? `${flat.slice(0, max)}…` : flat).replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function toMarkdown(report: AuditReport): string {
  const lines: string[] = [];
  lines.push(`# Frontend audit — ${plain(report.title) || plain(redactUrl(report.url))}`, '');
  lines.push(`- **URL:** ${plain(redactUrl(report.url))}`);
  lines.push(`- **When:** ${new Date(report.takenAt).toISOString()}`);
  lines.push(`- **Viewport:** ${report.viewport.width} × ${report.viewport.height}`);
  lines.push(`- **Findings:** ${report.findings.length}`, '');

  const v = report.vitals;
  if (v) {
    lines.push('## Core Web Vitals', '');
    lines.push('| Metric | Value |', '| --- | --- |');
    lines.push(`| LCP | ${formatMs(v.lcp?.value)} |`);
    lines.push(`| CLS | ${v.cls.toFixed(3)} |`);
    lines.push(`| INP | ${v.inp ? formatMs(v.inp.value) : 'not measured'} |`);
    lines.push(`| FCP | ${formatMs(v.fcp)} |`);
    lines.push(`| TTFB | ${formatMs(v.ttfb)} |`, '');
  }

  for (const category of Object.keys(CATEGORY_LABEL) as Category[]) {
    const list = report.findings.filter((f) => f.category === category);
    if (!list.length) continue;
    lines.push(`## ${CATEGORY_LABEL[category]} (${list.length})`, '');
    for (const f of list) {
      lines.push(`### [${f.severity.toUpperCase()}] ${plain(f.title)}`, '', plain(f.message, 1000), '');
      if (f.selectors?.length) lines.push(`Elements: ${f.selectors.slice(0, 5).map((s) => `\`${plain(s, 200).replace(/`/g, '')}\``).join(', ')}${f.count && f.count > 5 ? ` (+${f.count - 5} more)` : ''}`, '');
      if (f.url) lines.push(`Resource: ${plain(f.url, 500)}`, '');
      lines.push(`**Why it matters:** ${f.recommendation.why}`, '', '**How to fix:**');
      f.recommendation.how.forEach((h) => lines.push(`- ${h}`));
      if (f.fix) lines.push('', '```css', f.fix.css.replace(/```/g, '` ` `'), '```');
      lines.push('');
    }
  }
  return lines.join('\n');
}
