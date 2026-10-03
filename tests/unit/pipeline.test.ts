import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { enrich, RULES, toMarkdown, topRecommendations } from '@ftk/recommendation-engine';
import { makeFinding } from '@ftk/audit-core';
import { analyzeSnapshot, applyProbes, buildAudit, compareAudits, urlsToProbe } from '../../extension/shared/audit';
import { image, resource, snapshot } from './fixtures';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('recommendation-engine', () => {
  it('has guidance for every rule id any analyzer can emit', () => {
    const emitted = new Set<string>();
    for (const file of walk('packages')) {
      if (file.includes('recommendation-engine')) continue;
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/ruleId:\s*'([a-z0-9]+\.[a-z0-9-]+)'/gi)) emitted.add(m[1]);
    }
    // perf.<vital> rules are built from a template literal.
    for (const v of ['lcp', 'cls', 'inp', 'fcp', 'ttfb', 'tbt']) emitted.add(`perf.${v}`);
    const missing = [...emitted].filter((id) => !RULES[id]);
    expect(missing).toEqual([]);
    expect(emitted.size).toBeGreaterThan(50);
  });

  it('every documented rule has a reason and at least one action', () => {
    for (const [id, doc] of Object.entries(RULES)) {
      expect(doc.why.length, id).toBeGreaterThan(10);
      expect(doc.how.length, id).toBeGreaterThan(0);
      expect(doc.impact, id).toBeGreaterThanOrEqual(1);
      expect(doc.impact, id).toBeLessThanOrEqual(10);
    }
  });

  it('ranks errors above warnings and widespread issues higher', () => {
    const mk = (ruleId: string, severity: 'error' | 'warning' | 'info', count = 1) =>
      makeFinding({ ruleId, category: 'uxui', severity, title: ruleId, message: 'm', key: ruleId + severity, count });
    const out = enrich([mk('ux.no-favicon', 'info'), mk('a11y.contrast', 'error', 30), mk('a11y.contrast', 'warning', 1)]);
    expect(out[0].severity).toBe('error');
    expect(out[out.length - 1].ruleId).toBe('ux.no-favicon');
    const recs = topRecommendations(out, 5);
    expect(recs.filter((r) => r.ruleId === 'a11y.contrast')).toHaveLength(1);
    expect(recs[0].occurrences).toBe(2);
  });

  it('exports Markdown with evidence, fixes and recommendations', () => {
    const audit = buildAudit(snapshot({ meta: { ...snapshot().meta, lang: null } }));
    const md = toMarkdown({ url: audit.url, title: audit.title, takenAt: audit.takenAt, viewport: { width: 1440, height: 900 }, findings: audit.findings });
    expect(md).toContain('# Frontend audit');
    expect(md).toContain('Page language not declared');
    expect(md).toContain('**How to fix:**');
  });
});

describe('audit pipeline', () => {
  it('a clean page produces no findings', () => {
    expect(analyzeSnapshot(snapshot())).toEqual([]);
  });

  it('collects URLs worth probing and merges results back', () => {
    const snap = snapshot({
      resources: [
        resource({ url: 'https://cdn.x.com/a.js', sizeKnown: false, encodedSize: 0, transferSize: 0, decodedSize: 0 }),
        resource({ url: 'https://e.com/known.js' }),
        resource({ url: 'https://x.com/api', type: 'fetch', sizeKnown: false }),
      ],
      images: [image({ src: 'https://img.x.com/hero.jpg' }), image({ src: 'data:image/png;base64,AA', bytes: 10 })],
    });
    expect(urlsToProbe(snap).sort()).toEqual(['https://cdn.x.com/a.js', 'https://img.x.com/hero.jpg']);
    const merged = applyProbes(snap, { 'https://cdn.x.com/a.js': { size: 500_000 }, 'https://img.x.com/hero.jpg': { size: 900_000, contentType: 'image/jpeg' } });
    expect(merged.resources[0].probe?.size).toBe(500_000);
    expect(merged.images[0].bytes).toBe(900_000);
    const audit = buildAudit(merged);
    expect(audit.findings.map((f) => f.ruleId)).toEqual(expect.arrayContaining(['bundle.large-js', 'img.large-file']));
  });

  it('de-duplicates by id and sorts most important first', () => {
    const audit = buildAudit(snapshot({
      meta: { ...snapshot().meta, lang: null, description: null },
      images: [image({ hasAltAttr: false, alt: null })],
    }));
    const priorities = audit.findings.map((f) => f.recommendation.priority);
    expect([...priorities].sort((a, b) => b - a)).toEqual(priorities);
    expect(new Set(audit.findings.map((f) => f.id)).size).toBe(audit.findings.length);
  });

  it('compares before and after audits', () => {
    const before = buildAudit(snapshot({ images: [image({ hasAltAttr: false, alt: null }), image({ selector: 'img.b', hasAltAttr: false, alt: null })] }));
    const after = buildAudit(snapshot());
    const diff = compareAudits(before, after);
    expect(diff.before).toBeGreaterThan(diff.after);
    expect(diff.byCategory.find((c) => c.category === 'accessibility')).toMatchObject({ before: 1, after: 0 });
    expect(diff.byRule[0].ruleId).toBe('a11y.img-alt-missing');
  });
});
