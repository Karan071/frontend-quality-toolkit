import type { CssData, DesignToken, StylesheetSample } from '@ftk/audit-core';
import type { MatchedRule } from '@ftk/dom-analyzer';
import { classifyToken, parseBreakpoints, sourceLabel } from './index';

interface RuleVisit {
  rule: CSSRule;
  sheet: CSSStyleSheet;
  media: string | null;
}

/** Depth-first walk over a sheet, descending into @media/@supports/@layer/@import. */
function* walkRules(sheet: CSSStyleSheet, media: string | null = null, depth = 0): Generator<RuleVisit> {
  let rules: CSSRuleList;
  try {
    rules = sheet.cssRules;
  } catch {
    return; // cross-origin stylesheet without CORS
  }
  yield* walkRuleList(rules, sheet, media, depth);
}

function* walkRuleList(list: CSSRuleList, sheet: CSSStyleSheet, media: string | null, depth: number): Generator<RuleVisit> {
  if (depth > 6) return;
  for (const rule of Array.from(list)) {
    if (rule instanceof CSSImportRule) {
      if (rule.styleSheet) yield* walkRules(rule.styleSheet, rule.media.mediaText || media, depth + 1);
      continue;
    }
    if (rule instanceof CSSMediaRule) {
      yield { rule, sheet, media: rule.conditionText };
      yield* walkRuleList(rule.cssRules, sheet, rule.conditionText, depth + 1);
      continue;
    }
    if ('cssRules' in rule && (rule as CSSGroupingRule).cssRules) {
      yield { rule, sheet, media };
      yield* walkRuleList((rule as CSSGroupingRule).cssRules, sheet, media, depth + 1);
      continue;
    }
    yield { rule, sheet, media };
  }
}

function sheetAccessible(sheet: CSSStyleSheet): boolean {
  try {
    void sheet.cssRules;
    return true;
  } catch {
    return false;
  }
}

function countRules(sheet: CSSStyleSheet): number | null {
  if (!sheetAccessible(sheet)) return null;
  let n = 0;
  for (const v of walkRules(sheet)) if (v.rule instanceof CSSStyleRule) n++;
  return n;
}

export function collectCss(): CssData {
  const stylesheets: StylesheetSample[] = [];
  const mediaTexts: string[] = [];
  const tokens = new Map<string, DesignToken>();
  let inaccessible = 0;

  for (const sheet of Array.from(document.styleSheets)) {
    const owner = sheet.ownerNode as Element | null;
    if (owner?.id?.startsWith('__ftk')) continue;
    const accessible = sheetAccessible(sheet);
    if (!accessible) inaccessible++;
    const isInline = owner?.localName === 'style';
    stylesheets.push({
      href: sheet.href,
      inlineBytes: isInline ? (owner?.textContent?.length ?? 0) : 0,
      media: sheet.media.mediaText || null,
      inHead: !!owner?.closest('head'),
      accessible,
      ruleCount: countRules(sheet),
    });
    if (sheet.media.mediaText) mediaTexts.push(sheet.media.mediaText);

    for (const { rule, media } of walkRules(sheet)) {
      if (rule instanceof CSSMediaRule && media) mediaTexts.push(media);
      if (rule instanceof CSSStyleRule && /(^|[\s,])(:root|html|:host)\b/.test(rule.selectorText)) {
        for (const prop of Array.from(rule.style)) {
          if (!prop.startsWith('--') || tokens.size >= 300) continue;
          const value = rule.style.getPropertyValue(prop).trim();
          if (value && !tokens.has(prop)) tokens.set(prop, { name: prop, value, kind: classifyToken(value) });
        }
      }
    }
  }

  return {
    stylesheets,
    breakpoints: parseBreakpoints(mediaTexts),
    tokens: [...tokens.values()],
    inaccessibleSheets: inaccessible,
  };
}

/** Rules whose selector matches `el`, in source order, plus the inline style. */
export function matchedRules(el: Element, limit = 60): { rules: MatchedRule[]; inaccessible: number } {
  const out: MatchedRule[] = [];
  let inaccessible = 0;
  const inline = (el as HTMLElement).style;
  if (inline && inline.length) {
    out.push({
      selector: 'element.style',
      source: 'inline',
      media: null,
      declarations: Array.from(inline).map((prop) => ({ prop, value: inline.getPropertyValue(prop) })),
    });
  }
  for (const sheet of Array.from(document.styleSheets)) {
    if ((sheet.ownerNode as Element | null)?.id?.startsWith('__ftk')) continue;
    if (!sheetAccessible(sheet)) {
      inaccessible++;
      continue;
    }
    for (const { rule, sheet: owner, media } of walkRules(sheet)) {
      if (!(rule instanceof CSSStyleRule)) continue;
      let hit = false;
      try {
        hit = el.matches(rule.selectorText);
      } catch {
        hit = false;
      }
      if (!hit) continue;
      out.push({
        selector: rule.selectorText,
        source: sourceLabel(owner.href),
        media,
        declarations: Array.from(rule.style).map((prop) => ({
          prop,
          value: rule.style.getPropertyValue(prop) + (rule.style.getPropertyPriority(prop) ? ' !important' : ''),
        })),
      });
      if (out.length >= limit) return { rules: out, inaccessible };
    }
  }
  return { rules: out, inaccessible };
}

/**
 * `:focus` rules that strip the outline without offering another visible
 * indicator (box-shadow, border, background, text-decoration).
 */
export function collectFocusOutlineRemovals(): { selector: string; source: string }[] {
  const hits: { selector: string; source: string }[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    if ((sheet.ownerNode as Element | null)?.id?.startsWith('__ftk')) continue;
    for (const { rule, sheet: owner } of walkRules(sheet)) {
      if (!(rule instanceof CSSStyleRule) || !/:focus(-visible)?\b/.test(rule.selectorText)) continue;
      const s = rule.style;
      const removes =
        s.outlineStyle === 'none' || s.outline === 'none' || s.outline === '0' || s.outlineWidth === '0px' || s.outline === '0px';
      if (!removes) continue;
      const hasAlternative =
        !!s.boxShadow || !!s.border || !!s.borderColor || !!s.background || !!s.backgroundColor || !!s.textDecoration;
      if (!hasAlternative) hits.push({ selector: rule.selectorText, source: sourceLabel(owner.href) });
      if (hits.length >= 20) return hits;
    }
  }
  return hits;
}
