import { contrastRatio, makeFinding, parseColor, plural, suggestForeground, toHex } from '@ftk/audit-core';
import type { A11yData, Finding, ImageSample, PageMeta, TextSample, ViewportInfo } from '@ftk/audit-core';

export interface A11yInput {
  a11y: A11yData;
  images: ImageSample[];
  meta: Pick<PageMeta, 'lang' | 'title'>;
  viewport: Pick<ViewportInfo, 'width'>;
}

/** WCAG large text: ≥ 24px, or ≥ 18.66px (14pt) and bold. */
export function isLargeText(fontSize: number, weight: number): boolean {
  return fontSize >= 24 || (fontSize >= 18.66 && weight >= 700);
}

export interface ContrastResult {
  sample: TextSample;
  ratio: number;
  required: number;
  passes: boolean;
}

export function evaluateContrast(sample: TextSample): ContrastResult | null {
  const fg = parseColor(sample.fg);
  const bg = parseColor(sample.bg);
  if (!fg || !bg) return null;
  const required = isLargeText(sample.fontSize, sample.fontWeight) ? 3 : 4.5;
  const ratio = contrastRatio({ ...fg, a: 1 }, { ...bg, a: 1 });
  return { sample, ratio, required, passes: ratio >= required };
}

const POOR_ALT = /^(image|img|photo|picture|graphic|icon|banner|logo)?[\s_-]*\d*$|\.(jpe?g|png|gif|webp|svg|avif)$|^(dsc|img|image)[_-]?\d+/i;

const VALID_ROLES = new Set(
  ('alert alertdialog application article banner button cell checkbox columnheader combobox complementary contentinfo definition dialog directory document feed figure form grid gridcell group heading img link list listbox listitem log main marquee math menu menubar menuitem menuitemcheckbox menuitemradio navigation none note option presentation progressbar radio radiogroup region row rowgroup rowheader scrollbar search searchbox separator slider spinbutton status switch tab table tablist tabpanel term textbox timer toolbar tooltip tree treegrid treeitem generic paragraph blockquote caption code deletion emphasis insertion meter strong subscript superscript time doc-abstract doc-acknowledgments doc-afterword doc-appendix doc-backlink doc-biblioentry doc-bibliography doc-biblioref doc-chapter doc-colophon doc-conclusion doc-cover doc-credit doc-credits doc-dedication doc-endnote doc-endnotes doc-epigraph doc-epilogue doc-errata doc-example doc-footnote doc-foreword doc-glossary doc-glossref doc-index doc-introduction doc-noteref doc-notice doc-pagebreak doc-pagelist doc-part doc-preface doc-prologue doc-pullquote doc-qna doc-subtitle doc-tip doc-toc')
    .split(' '),
);

export const isValidRole = (role: string) => VALID_ROLES.has(role.toLowerCase());

const uniq = <T,>(xs: T[]) => [...new Set(xs)];

export function analyzeAccessibility({ a11y, images, meta, viewport }: A11yInput): Finding[] {
  const out: Finding[] = [];
  const mobile = viewport.width <= 768;

  // ── Contrast ──
  const results = a11y.text.map(evaluateContrast).filter((r): r is ContrastResult => !!r);
  const failing = results.filter((r) => !r.passes && !r.sample.bgUncertain).sort((a, b) => a.ratio - b.ratio);
  if (failing.length) {
    const nodes = failing.reduce((n, r) => n + r.sample.count, 0);
    const worst = failing[0];
    const fixes = failing.slice(0, 15).map((r) => {
      const suggested = suggestForeground(parseColor(r.sample.fg)!, parseColor(r.sample.bg)!, r.required);
      return `${r.sample.selector} { color: ${toHex(suggested)} !important; }`;
    });
    out.push(
      makeFinding({
        ruleId: 'a11y.contrast',
        category: 'accessibility',
        severity: 'error',
        title: `${plural(nodes, 'element')} with low text contrast`,
        message: `Worst: ${worst.ratio.toFixed(2)}:1 (${worst.sample.fg} on ${worst.sample.bg}), needs ${worst.required}:1. "${worst.sample.text}"`,
        selectors: uniq(failing.flatMap((r) => [r.sample.selector, ...r.sample.extraSelectors])).slice(0, 25),
        count: nodes,
        evidence: { worstRatio: Number(worst.ratio.toFixed(2)), required: worst.required, foreground: worst.sample.fg, background: worst.sample.bg },
        fix: { label: 'Darken/lighten text to pass AA', css: fixes.join('\n') },
        key: 'contrast',
      }),
    );
  }
  const unknown = a11y.text.filter((t) => t.bgUncertain);
  if (unknown.length) {
    const nodes = unknown.reduce((n, r) => n + r.count, 0);
    out.push(
      makeFinding({
        ruleId: 'a11y.contrast-unknown',
        category: 'accessibility',
        severity: 'info',
        title: `Contrast unverifiable on ${plural(nodes, 'element')}`,
        message: 'Text sits over a background image or gradient. Check these manually.',
        selectors: uniq(unknown.map((t) => t.selector)).slice(0, 20),
        count: nodes,
        key: 'contrast-unknown',
      }),
    );
  }

  // ── Images ──
  const noAlt = images.filter((i) => i.kind === 'img' && !i.hasAltAttr && !i.decorative && i.renderedWidth > 1);
  if (noAlt.length) {
    out.push(
      makeFinding({
        ruleId: 'a11y.img-alt-missing',
        category: 'accessibility',
        severity: 'error',
        title: `${plural(noAlt.length, 'image')} missing alt text`,
        message: 'Screen readers announce the file name instead. Use alt="" for decorative images.',
        selectors: noAlt.slice(0, 25).map((i) => i.selector),
        count: noAlt.length,
        key: 'img-alt',
      }),
    );
  }
  const poorAlt = images.filter((i) => i.kind === 'img' && i.alt && i.alt.trim() && POOR_ALT.test(i.alt.trim()));
  if (poorAlt.length) {
    out.push(
      makeFinding({
        ruleId: 'a11y.img-alt-poor',
        category: 'accessibility',
        severity: 'warning',
        title: `${plural(poorAlt.length, 'image')} with non-descriptive alt`,
        message: `Alt text such as "${poorAlt[0].alt}" does not describe the image.`,
        selectors: poorAlt.slice(0, 20).map((i) => i.selector),
        count: poorAlt.length,
        key: 'img-alt-poor',
      }),
    );
  }

  // ── Names ──
  const unnamedFields = a11y.controls.filter((c) => ['input', 'select', 'textarea'].includes(c.kind) && !c.name);
  if (unnamedFields.length) {
    const usesPlaceholder = unnamedFields.some((c) => c.placeholderOnly);
    out.push(
      makeFinding({
        ruleId: 'a11y.label-missing',
        category: 'accessibility',
        severity: 'error',
        title: `${plural(unnamedFields.length, 'form field')} without a label`,
        message: `${usesPlaceholder ? 'Placeholder text is not a label: it disappears as soon as the user types. ' : ''}Associate a <label>, aria-label or aria-labelledby.`,
        selectors: unnamedFields.slice(0, 25).map((c) => c.selector),
        count: unnamedFields.length,
        key: 'label',
      }),
    );
  }
  const unnamedButtons = a11y.controls.filter((c) => (c.kind === 'button' || c.kind === 'role-button') && !c.name);
  if (unnamedButtons.length) {
    out.push(
      makeFinding({
        ruleId: 'a11y.button-name',
        category: 'accessibility',
        severity: 'error',
        title: `${plural(unnamedButtons.length, 'button')} without an accessible name`,
        message: 'Icon-only buttons need aria-label or visually hidden text.',
        selectors: unnamedButtons.slice(0, 25).map((c) => c.selector),
        count: unnamedButtons.length,
        key: 'button-name',
      }),
    );
  }
  const unnamedLinks = a11y.controls.filter((c) => c.kind === 'link' && !c.name);
  if (unnamedLinks.length) {
    out.push(
      makeFinding({
        ruleId: 'a11y.link-name',
        category: 'accessibility',
        severity: 'error',
        title: `${plural(unnamedLinks.length, 'link')} without an accessible name`,
        message: 'Links with no text, alt or aria-label are announced as just "link".',
        selectors: unnamedLinks.slice(0, 25).map((c) => c.selector),
        count: unnamedLinks.length,
        key: 'link-name',
      }),
    );
  }

  // ── Document ──
  if (!meta.lang) {
    out.push(makeFinding({
      ruleId: 'a11y.lang-missing', category: 'accessibility', severity: 'error',
      title: 'Page language not declared',
      message: 'Add lang="…" to <html> so screen readers pick the right pronunciation.', key: 'lang',
    }));
  }
  if (!meta.title.trim()) {
    out.push(makeFinding({
      ruleId: 'a11y.title-missing', category: 'accessibility', severity: 'error',
      title: 'Page has no <title>', message: 'The title is the first thing a screen reader announces and labels the browser tab.', key: 'title',
    }));
  }
  if (a11y.zoomDisabled) {
    out.push(makeFinding({
      ruleId: 'a11y.zoom-disabled', category: 'accessibility', severity: 'error',
      title: 'Pinch-zoom is disabled',
      message: 'user-scalable=no or a low maximum-scale blocks users who need to enlarge content (WCAG 1.4.4).', key: 'zoom',
    }));
  }
  if (a11y.landmarks.main === 0) {
    out.push(makeFinding({
      ruleId: 'a11y.no-main', category: 'accessibility', severity: 'warning',
      title: 'No <main> landmark', message: 'Landmarks let assistive-technology users jump straight to the primary content.', key: 'main',
    }));
  }

  // ── Headings ──
  const h1s = a11y.headings.filter((h) => h.level === 1);
  if (a11y.headings.length && h1s.length === 0) {
    out.push(makeFinding({
      ruleId: 'a11y.no-h1', category: 'accessibility', severity: 'warning',
      title: 'No <h1> on the page', message: 'Every page should have one top-level heading that names its purpose.', key: 'no-h1',
    }));
  } else if (h1s.length > 1) {
    out.push(makeFinding({
      ruleId: 'a11y.multiple-h1', category: 'accessibility', severity: 'info',
      title: `${h1s.length} <h1> elements`, message: 'Multiple top-level headings can blur the page outline.',
      selectors: h1s.map((h) => h.selector), key: 'multi-h1',
    }));
  }
  const skipped: string[] = [];
  let prev = 0;
  for (const h of a11y.headings) {
    if (prev && h.level > prev + 1) skipped.push(h.selector);
    prev = h.level;
  }
  if (skipped.length) {
    out.push(makeFinding({
      ruleId: 'a11y.heading-order', category: 'accessibility', severity: 'warning',
      title: `${plural(skipped.length, 'heading')} skip levels`,
      message: 'Jumping from e.g. <h2> to <h4> makes the outline harder to navigate.',
      selectors: skipped.slice(0, 20), count: skipped.length, key: 'heading-order',
    }));
  }
  const emptyHeadings = a11y.headings.filter((h) => !h.text.trim());
  if (emptyHeadings.length) {
    out.push(makeFinding({
      ruleId: 'a11y.heading-empty', category: 'accessibility', severity: 'warning',
      title: `${plural(emptyHeadings.length, 'empty heading')}`, message: 'Empty headings are announced with no content.',
      selectors: emptyHeadings.map((h) => h.selector).slice(0, 20), key: 'heading-empty',
    }));
  }

  // ── Touch targets ──
  const tiny = a11y.targets.filter((t) => Math.min(t.width, t.height) < 24);
  const small = a11y.targets.filter((t) => Math.min(t.width, t.height) >= 24 && Math.min(t.width, t.height) < 44);
  const targetFix = (list: typeof tiny) => ({
    label: 'Enlarge to 44 × 44 px',
    css: list
      .slice(0, 20)
      .map((t) => `${t.selector} { min-width: 44px; min-height: 44px;${t.display === 'inline' ? ' display: inline-flex; align-items: center; justify-content: center;' : ''} }`)
      .join('\n'),
  });
  if (tiny.length) {
    out.push(makeFinding({
      ruleId: 'a11y.target-size-minimum', category: 'accessibility', severity: 'error',
      title: `${plural(tiny.length, 'target')} under 24 × 24 px`,
      message: 'WCAG 2.2 (2.5.8, AA) requires pointer targets of at least 24 CSS px.',
      selectors: tiny.slice(0, 25).map((t) => t.selector), count: tiny.length, fix: targetFix(tiny), key: 'target-24',
    }));
  }
  if (small.length) {
    out.push(makeFinding({
      ruleId: 'a11y.target-size-comfortable', category: 'accessibility', severity: mobile ? 'warning' : 'info',
      title: `${plural(small.length, 'target')} under 44 × 44 px`,
      message: `Apple and Google recommend 44–48 px for touch.${mobile ? '' : ' Matters most at mobile widths.'}`,
      selectors: small.slice(0, 25).map((t) => t.selector), count: small.length, fix: targetFix(small), key: 'target-44',
    }));
  }

  // ── Focus & keyboard ──
  if (a11y.focusRules.length) {
    out.push(makeFinding({
      ruleId: 'a11y.focus-outline-removed', category: 'accessibility', severity: 'warning',
      title: `Focus outline removed in ${plural(a11y.focusRules.length, 'rule')}`,
      message: `${a11y.focusRules[0].selector} (${a11y.focusRules[0].source}) removes the outline without a replacement indicator.`,
      fix: { label: 'Restore a visible focus ring', css: ':focus-visible { outline: 2px solid #1a73e8 !important; outline-offset: 2px !important; }' },
      key: 'focus-outline',
    }));
  }
  if (a11y.clickableNotFocusable.length) {
    out.push(makeFinding({
      ruleId: 'a11y.clickable-not-focusable', category: 'accessibility', severity: 'warning',
      title: `${plural(a11y.clickableNotFocusable.length, 'element')} look clickable but are not keyboard-reachable`,
      message: 'Elements styled with cursor:pointer that are not links, buttons or focusable. Use a real <button>/<a> (heuristic).',
      selectors: a11y.clickableNotFocusable.slice(0, 20).map((c) => c.selector), count: a11y.clickableNotFocusable.length,
      key: 'clickable',
    }));
  }

  // ── ARIA ──
  const ariaRules: [AriaKind, string, 'error' | 'warning', (n: number) => string, string][] = [
    ['hidden-focusable', 'a11y.aria-hidden-focusable', 'error', (n) => `${plural(n, 'focusable element')} inside aria-hidden content`, 'Hidden from assistive tech but still reachable by keyboard.'],
    ['invalid-role', 'a11y.invalid-role', 'error', (n) => `${plural(n, 'element')} with an invalid ARIA role`, 'Unknown role values are ignored by assistive technology.'],
    ['broken-reference', 'a11y.aria-broken-reference', 'warning', (n) => `${plural(n, 'ARIA reference')} to a missing id`, 'aria-labelledby / aria-describedby / aria-controls point at ids that do not exist.'],
    ['duplicate-id', 'a11y.duplicate-id', 'warning', (n) => `${plural(n, 'duplicate id')}`, 'Duplicate ids break label associations and ARIA references.'],
    ['positive-tabindex', 'a11y.positive-tabindex', 'warning', (n) => `${plural(n, 'element')} with a positive tabindex`, 'tabindex > 0 creates an unpredictable tab order. Use 0 or -1.'],
  ];
  for (const [kind, ruleId, severity, title, message] of ariaRules) {
    const hits = a11y.ariaIssues.filter((i) => i.kind === kind);
    if (!hits.length) continue;
    out.push(makeFinding({
      ruleId, category: 'accessibility', severity,
      title: title(hits.length), message: `${message} e.g. ${hits[0].detail}`,
      selectors: hits.slice(0, 20).map((h) => h.selector), count: hits.length, key: kind,
    }));
  }
  return out;
}

type AriaKind = A11yData['ariaIssues'][number]['kind'];
