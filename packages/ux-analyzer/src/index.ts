import { makeFinding, plural } from '@ftk/audit-core';
import type { ButtonSample, ControlSample, CssData, Finding, PageMeta, SpacingData, UxData } from '@ftk/audit-core';

export interface SpacingSummary {
  total: number;
  onGrid: number;
  gridShare: number;
  distinct: { px: number; count: number }[];
  base: 4 | 8;
}

/** How much of the spacing falls on a 4px grid (the usual design-system base). */
export function summarizeSpacing(data: SpacingData): SpacingSummary {
  const total = data.values.reduce((n, v) => n + v.count, 0);
  const onGrid = data.values.filter((v) => v.px % 4 === 0).reduce((n, v) => n + v.count, 0);
  const onEight = data.values.filter((v) => v.px % 8 === 0).reduce((n, v) => n + v.count, 0);
  return {
    total,
    onGrid,
    gridShare: total ? onGrid / total : 1,
    distinct: [...data.values].sort((a, b) => a.px - b.px),
    base: onEight / (total || 1) >= 0.75 ? 8 : 4,
  };
}

export function buttonSignature(b: ButtonSample): string {
  const r = (n: number) => Math.round(n / 2) * 2;
  return [b.bg, b.color, r(b.radius), r(b.padX), r(b.padY), Math.round(b.fontSize), b.fontWeight, b.hasBorder].join('|');
}

export interface ButtonVariant {
  signature: string;
  sample: ButtonSample;
  count: number;
}

export function buttonVariants(buttons: ButtonSample[]): ButtonVariant[] {
  const map = new Map<string, ButtonVariant>();
  for (const b of buttons) {
    const sig = buttonSignature(b);
    const hit = map.get(sig);
    if (hit) hit.count++;
    else map.set(sig, { signature: sig, sample: b, count: 1 });
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

const GENERIC_LINK = /^(click here|here|read more|more|learn more|link|this|click|details|info)$/i;

export interface UxInput {
  ux: UxData;
  spacing: SpacingData;
  controls: ControlSample[];
  meta: Pick<PageMeta, 'description' | 'hasFavicon' | 'hasDoctype'>;
  css: Pick<CssData, 'tokens' | 'inaccessibleSheets'>;
  distinctColors?: number;
}

export function analyzeUx({ ux, spacing, controls, meta, css, distinctColors = 0 }: UxInput): Finding[] {
  const out: Finding[] = [];

  if (!meta.hasDoctype) {
    out.push(makeFinding({
      ruleId: 'ux.no-doctype', category: 'uxui', severity: 'warning',
      title: 'Missing <!DOCTYPE html>', message: 'Without a doctype the browser renders in quirks mode, which changes box sizing and layout.', key: 'doctype',
    }));
  }

  const sp = summarizeSpacing(spacing);
  if (sp.total >= 30 && sp.gridShare < 0.7) {
    out.push(makeFinding({
      ruleId: 'ux.off-grid-spacing', category: 'uxui', severity: sp.gridShare < 0.5 ? 'warning' : 'info',
      title: `${Math.round(sp.gridShare * 100)}% of spacing is on a 4 px grid`,
      message: `${sp.total - sp.onGrid} of ${sp.total} padding/gap values are off-grid, which makes rhythm feel uneven.`,
      evidence: { onGridPercent: Math.round(sp.gridShare * 100), distinct: sp.distinct.length },
      key: 'off-grid',
    }));
  }
  const frequent = sp.distinct.filter((v) => v.count >= 2);
  if (frequent.length > 20) {
    out.push(makeFinding({
      ruleId: 'ux.too-many-spacing-values', category: 'uxui', severity: 'info',
      title: `${frequent.length} distinct spacing values`,
      message: 'A spacing scale (4, 8, 12, 16, 24, 32…) keeps layouts consistent and easier to tune.',
      evidence: { distinct: frequent.length }, key: 'spacing-values',
    }));
  }

  const radii = spacing.radii.filter((r) => r.px > 0 && r.px < 999 && r.count >= 2);
  if (radii.length > 5) {
    out.push(makeFinding({
      ruleId: 'ux.radius-inconsistency', category: 'uxui', severity: 'warning',
      title: `${radii.length} different corner radii`,
      message: `Radii in use: ${radii.map((r) => `${r.px}px`).join(', ')}. Pick 2–3 steps (e.g. 4, 8, 16).`,
      evidence: { radii: radii.length }, key: 'radii',
    }));
  }

  const variants = buttonVariants(ux.buttons);
  if (variants.length > 4) {
    out.push(makeFinding({
      ruleId: 'ux.button-inconsistency', category: 'uxui', severity: 'warning',
      title: `${variants.length} distinct button styles`,
      message: `${ux.buttons.length} buttons use ${variants.length} different combinations of colour, radius, padding and type. Most systems need primary, secondary and ghost.`,
      selectors: variants.slice(0, 8).map((v) => v.sample.selector),
      evidence: { variants: variants.length, buttons: ux.buttons.length }, key: 'buttons',
    }));
  }

  const generic = ux.links.filter((l) => GENERIC_LINK.test(l.text.trim()));
  if (generic.length) {
    out.push(makeFinding({
      ruleId: 'ux.generic-link-text', category: 'uxui', severity: 'warning',
      title: `${plural(generic.length, 'link')} with generic text`,
      message: `"${generic[0].text}" says nothing out of context — screen-reader users often navigate by a list of links.`,
      selectors: generic.slice(0, 20).map((l) => l.selector), count: generic.length, key: 'generic-links',
    }));
  }
  if (ux.hashLinkCount >= 3) {
    out.push(makeFinding({
      ruleId: 'ux.dead-links', category: 'uxui', severity: 'info',
      title: `${plural(ux.hashLinkCount, 'link')} go nowhere`,
      message: 'href="#" and javascript: links jump to the top or do nothing. Use a <button> for actions.',
      evidence: { count: ux.hashLinkCount }, key: 'dead-links',
    }));
  }

  const noSubmit = ux.forms.filter((f) => f.inputCount > 0 && !f.hasSubmit);
  if (noSubmit.length) {
    out.push(makeFinding({
      ruleId: 'ux.form-no-submit', category: 'uxui', severity: 'info',
      title: `${plural(noSubmit.length, 'form')} without a submit button`,
      message: 'Users expect a visible submit action; implicit submit on Enter is not discoverable.',
      selectors: noSubmit.map((f) => f.selector).slice(0, 15), key: 'form-submit',
    }));
  }

  const missingAuto = controls.filter((c) => c.kind === 'input' && ['email', 'tel', 'password'].includes(c.inputType ?? '') && !c.autocomplete);
  if (missingAuto.length) {
    out.push(makeFinding({
      ruleId: 'ux.autocomplete-missing', category: 'uxui', severity: 'info',
      title: `${plural(missingAuto.length, 'field')} without autocomplete`,
      message: 'autocomplete lets browsers and password managers fill email, phone and password fields (also WCAG 1.3.5).',
      selectors: missingAuto.slice(0, 15).map((c) => c.selector), count: missingAuto.length, key: 'autocomplete',
    }));
  }

  if (!meta.description) {
    out.push(makeFinding({
      ruleId: 'ux.no-meta-description', category: 'uxui', severity: 'info',
      title: 'No meta description', message: 'Search results and link previews fall back to arbitrary page text.', key: 'meta-desc',
    }));
  }
  if (!meta.hasFavicon) {
    out.push(makeFinding({
      ruleId: 'ux.no-favicon', category: 'uxui', severity: 'info',
      title: 'No favicon declared', message: 'Tabs and bookmarks show a generic icon; browsers also request /favicon.ico on every visit.', key: 'favicon',
    }));
  }
  if (css.tokens.length === 0 && css.inaccessibleSheets === 0 && distinctColors > 12) {
    out.push(makeFinding({
      ruleId: 'ux.no-design-tokens', category: 'uxui', severity: 'info',
      title: 'No CSS custom properties defined',
      message: `${distinctColors} distinct colours but no :root variables. Tokens make a design system enforceable.`, key: 'tokens',
    }));
  }
  return out;
}
