import { describe, expect, it } from 'vitest';
import type { A11yData, TextSample } from '@ftk/audit-core';
import { analyzeAccessibility, evaluateContrast, isLargeText } from '@ftk/accessibility-analyzer';
import { analyzeBundles, categorizeHost, isThirdParty, registrableDomain, resourceBytes, summarizeBundles } from '@ftk/bundle-analyzer';
import { analyzeColors, analyzePalette, classifyHarmony } from '@ftk/color-analyzer';
import { parseBreakpoints, classifyToken } from '@ftk/css-analyzer';
import { analyzeImages, attachImageSizes, evaluateImage, imageFormat } from '@ftk/image-analyzer';
import { analyzePerformance, rateVital } from '@ftk/performance-analyzer';
import { analyzeResponsive, deviceModeFor } from '@ftk/responsive-analyzer';
import { analyzeTypography } from '@ftk/typography-analyzer';
import { analyzeUx, buttonVariants, summarizeSpacing } from '@ftk/ux-analyzer';
import { emptyVitals, image, resource, snapshot } from './fixtures';

const ids = (fs: { ruleId: string }[]) => fs.map((f) => f.ruleId);
const vp = { width: 1440, height: 900, dpr: 2 };
const ctx = { viewport: vp, shiftSelectors: new Set<string>() };

describe('image-analyzer', () => {
  it('flags an image far larger than its rendered size and estimates waste', () => {
    const r = evaluateImage(image({ naturalWidth: 3000, naturalHeight: 2000, renderedWidth: 300, renderedHeight: 200, bytes: 1_000_000 }), ctx);
    expect(r.flags).toContain('oversized');
    expect(r.flags).toContain('large-file');
    expect(r.wastedBytes).toBeGreaterThan(800_000);
  });

  it('accounts for device pixel ratio (2× art is fine)', () => {
    const r = evaluateImage(image({ naturalWidth: 800, naturalHeight: 600, renderedWidth: 400, renderedHeight: 300 }), ctx);
    expect(r.flags).not.toContain('oversized');
  });

  it('flags missing dimensions only when no aspect-ratio either', () => {
    expect(evaluateImage(image({ hasWidthAttr: false, hasHeightAttr: false }), ctx).flags).toContain('no-dimensions');
    expect(evaluateImage(image({ hasWidthAttr: false, hasHeightAttr: false, hasAspectRatio: true }), ctx).flags).not.toContain('no-dimensions');
  });

  it('handles lazy-loading above and below the fold', () => {
    expect(evaluateImage(image({ loading: 'lazy', aboveFold: true }), ctx).flags).toContain('lazy-above-fold');
    expect(evaluateImage(image({ aboveFold: false, top: 4000 }), ctx).flags).toContain('no-lazy');
    expect(evaluateImage(image({ aboveFold: false, top: 4000, loading: 'lazy' }), ctx).flags).not.toContain('no-lazy');
  });

  it('suggests modern formats for heavy JPEG/PNG but not SVG/WebP', () => {
    expect(evaluateImage(image({ bytes: 120_000 }), ctx).flags).toContain('legacy-format');
    expect(evaluateImage(image({ src: 'https://e.com/a.webp', bytes: 120_000 }), ctx).flags).not.toContain('legacy-format');
    expect(evaluateImage(image({ src: 'https://e.com/a.svg', bytes: 120_000, naturalWidth: 10, naturalHeight: 10 }), ctx).flags).toEqual([]);
  });

  it('detects srcset without sizes and broken images', () => {
    const r = evaluateImage(image({ srcset: 'a.jpg 400w, b.jpg 800w', sizes: null, renderedWidth: 300, renderedHeight: 200 }), ctx);
    expect(r.flags).toContain('srcset-no-sizes');
    expect(evaluateImage(image({ complete: true, naturalWidth: 0, naturalHeight: 0 }), ctx).flags).toContain('broken');
  });

  it('groups findings per rule, escalates when CLS names the image, and offers an aspect-ratio fix', () => {
    const imgs = [image({ selector: '#hero', hasWidthAttr: false, hasHeightAttr: false, naturalWidth: 1600, naturalHeight: 900 })];
    const calm = analyzeImages({ images: imgs, viewport: vp });
    expect(calm.find((f) => f.ruleId === 'img.no-dimensions')?.severity).toBe('warning');
    const shifted = analyzeImages({ images: imgs, viewport: vp, vitals: { shifts: [{ value: 0.2, time: 1, selectors: ['#hero'] }] } });
    const f = shifted.find((x) => x.ruleId === 'img.no-dimensions')!;
    expect(f.severity).toBe('error');
    expect(f.fix?.css).toContain('aspect-ratio: 1600 / 900');
  });

  it('infers formats and attaches probed sizes', () => {
    expect(imageFormat({ src: 'https://x.com/a.JPG?v=1' })).toBe('jpeg');
    expect(imageFormat({ src: 'https://x.com/img', contentType: 'image/avif' })).toBe('avif');
    const res = resource({ url: 'https://cdn.x.com/a.jpg', type: 'image', sizeKnown: false, transferSize: 0, encodedSize: 0, decodedSize: 0, probe: { size: 345_678, contentType: 'image/jpeg' } });
    const [img] = attachImageSizes([image({ src: 'https://cdn.x.com/a.jpg' })], [res]);
    expect(img.bytes).toBe(345_678);
  });
});

describe('bundle-analyzer', () => {
  it('derives registrable domains and third-party status', () => {
    expect(registrableDomain('cdn.shop.example.co.uk')).toBe('example.co.uk');
    expect(registrableDomain('www.example.com')).toBe('example.com');
    expect(isThirdParty('static.example.com', 'www.example.com')).toBe(false);
    expect(isThirdParty('googletagmanager.com', 'www.example.com')).toBe(true);
    expect(categorizeHost('www.google-analytics.com')).toBe('analytics');
    expect(categorizeHost('fonts.gstatic.com')).toBe('fonts');
  });

  it('prefers Resource Timing sizes and falls back to probes', () => {
    expect(resourceBytes(resource({ encodedSize: 10, transferSize: 20 }))).toBe(10);
    expect(resourceBytes(resource({ sizeKnown: false, encodedSize: 0, transferSize: 0, decodedSize: 0, probe: { size: 99 } }))).toBe(99);
    expect(resourceBytes(resource({ sizeKnown: false, encodedSize: 0, transferSize: 0, decodedSize: 0 }))).toBeNull();
  });

  it('flags large bundles with severity by size', () => {
    const f = analyzeBundles({
      resources: [resource({ url: 'https://e.com/big.js', encodedSize: 400_000 }), resource({ url: 'https://e.com/mid.js', encodedSize: 200_000 })],
      scripts: [], stylesheets: [],
    }).filter((x) => x.ruleId === 'bundle.large-js');
    expect(f.map((x) => x.severity)).toEqual(['error', 'warning']);
  });

  it('detects render-blocking scripts, uncompressed text and duplicate includes', () => {
    const findings = analyzeBundles({
      resources: [resource({ url: 'https://e.com/raw.js', encodedSize: 100_000, decodedSize: 100_000 })],
      scripts: [
        { src: 'https://e.com/a.js', inlineBytes: 0, async: false, defer: false, module: false, inHead: true, selector: 'script:nth-of-type(1)' },
        { src: 'https://e.com/a.js', inlineBytes: 0, async: false, defer: true, module: false, inHead: true, selector: 'script:nth-of-type(2)' },
      ],
      stylesheets: [],
    });
    expect(ids(findings)).toEqual(expect.arrayContaining(['bundle.render-blocking-js', 'bundle.uncompressed', 'bundle.duplicate-script']));
    expect(findings.find((f) => f.ruleId === 'bundle.render-blocking-js')?.count).toBe(1);
  });

  it('summarises weight by type with third-party split', () => {
    const s = summarizeBundles([
      resource({ encodedSize: 1000 }),
      resource({ url: 'https://t.com/x.js', host: 't.com', thirdParty: true, encodedSize: 3000 }),
      resource({ url: 'https://e.com/s.css', type: 'css', encodedSize: 500 }),
    ]);
    expect(s.script).toMatchObject({ count: 2, bytes: 4000, thirdPartyBytes: 3000 });
    expect(s.css.bytes).toBe(500);
    expect(s.thirdParty[0].host).toBe('t.com');
  });
});

const text = (over: Partial<TextSample> = {}): TextSample => ({
  selector: 'p', text: 'Hello', fg: '#999999', bg: '#ffffff', bgUncertain: false, fontSize: 16, fontWeight: 400, count: 1, extraSelectors: [], ...over,
});
const a11y = (over: Partial<A11yData> = {}) => snapshot().a11y && { ...snapshot().a11y, ...over };

describe('accessibility-analyzer', () => {
  const run = (over: Partial<A11yData> = {}, extra: Partial<Parameters<typeof analyzeAccessibility>[0]> = {}) =>
    analyzeAccessibility({ a11y: a11y(over), images: [], meta: { lang: 'en', title: 'T' }, viewport: { width: 1440 }, ...extra });

  it('knows what large text is', () => {
    expect(isLargeText(24, 400)).toBe(true);
    expect(isLargeText(19, 700)).toBe(true);
    expect(isLargeText(19, 400)).toBe(false);
  });

  it('fails #999 on white at normal size, passes at large size, and offers a fix', () => {
    expect(evaluateContrast(text())?.passes).toBe(false);
    expect(evaluateContrast(text({ fg: '#888888' }))?.passes).toBe(false);
    expect(evaluateContrast(text({ fg: '#888888', fontSize: 26 }))?.passes).toBe(true);
    const f = run({ text: [text()] }).find((x) => x.ruleId === 'a11y.contrast')!;
    expect(f.severity).toBe('error');
    expect(f.fix?.css).toMatch(/p \{ color: #[0-9a-f]{6} !important; \}/);
  });

  it('reports unverifiable contrast over images as info, not an error', () => {
    const f = run({ text: [text({ bgUncertain: true })] });
    expect(ids(f)).toContain('a11y.contrast-unknown');
    expect(ids(f)).not.toContain('a11y.contrast');
  });

  it('finds missing alt, empty names, unlabeled fields, lang, title and zoom lock', () => {
    const f = run(
      {
        zoomDisabled: true,
        controls: [
          { selector: 'input', tag: 'input', kind: 'input', inputType: 'text', name: '', placeholderOnly: true, autocomplete: null },
          { selector: 'button.x', tag: 'button', kind: 'button', inputType: null, name: '', placeholderOnly: false, autocomplete: null },
          { selector: 'a.y', tag: 'a', kind: 'link', inputType: null, name: '', placeholderOnly: false, autocomplete: null },
        ],
      },
      { images: [image({ hasAltAttr: false, alt: null })], meta: { lang: null, title: '' } },
    );
    expect(ids(f)).toEqual(expect.arrayContaining([
      'a11y.img-alt-missing', 'a11y.label-missing', 'a11y.button-name', 'a11y.link-name', 'a11y.lang-missing', 'a11y.title-missing', 'a11y.zoom-disabled',
    ]));
    expect(f.find((x) => x.ruleId === 'a11y.label-missing')?.message).toMatch(/placeholder/i);
  });

  it('does not flag decorative images (alt="")', () => {
    const f = run({}, { images: [image({ hasAltAttr: true, alt: '', decorative: true })] });
    expect(ids(f)).not.toContain('a11y.img-alt-missing');
  });

  it('checks heading structure', () => {
    const h = (level: number, i: number) => ({ level, text: `H${i}`, selector: `h${level}:nth(${i})` });
    expect(ids(run({ headings: [h(2, 1), h(4, 2)] }))).toEqual(expect.arrayContaining(['a11y.no-h1', 'a11y.heading-order']));
    expect(ids(run({ headings: [h(1, 1), h(2, 2), h(3, 3)] }))).not.toContain('a11y.heading-order');
    expect(ids(run({ headings: [h(1, 1), h(1, 2)] }))).toContain('a11y.multiple-h1');
  });

  it('grades target size by WCAG minimum and by viewport', () => {
    const t = (w: number, h: number, sel: string) => ({ selector: sel, width: w, height: h, kind: 'link', display: 'inline' });
    const f = run({ targets: [t(16, 16, 'a.tiny'), t(30, 30, 'a.small')] }, { viewport: { width: 390 } });
    expect(f.find((x) => x.ruleId === 'a11y.target-size-minimum')?.severity).toBe('error');
    expect(f.find((x) => x.ruleId === 'a11y.target-size-comfortable')?.severity).toBe('warning');
    const desktop = run({ targets: [t(30, 30, 'a.small')] });
    expect(desktop.find((x) => x.ruleId === 'a11y.target-size-comfortable')?.severity).toBe('info');
  });

  it('reports ARIA problems', () => {
    const f = run({
      ariaIssues: [
        { kind: 'hidden-focusable', selector: 'div', detail: 'x' },
        { kind: 'invalid-role', selector: 'span', detail: 'role="foo"' },
        { kind: 'duplicate-id', selector: '[id="a"]', detail: 'id="a" ×2' },
      ],
      landmarks: { main: 0, nav: 0, header: 0, footer: 0 },
    });
    expect(ids(f)).toEqual(expect.arrayContaining(['a11y.aria-hidden-focusable', 'a11y.invalid-role', 'a11y.duplicate-id', 'a11y.no-main']));
  });
});

describe('responsive & performance', () => {
  it('requires a sane viewport meta', () => {
    const base = { viewport: { width: 390 }, overflow: snapshot().overflow };
    expect(ids(analyzeResponsive({ ...base, meta: { viewportMeta: null } }))).toContain('resp.no-viewport-meta');
    expect(ids(analyzeResponsive({ ...base, meta: { viewportMeta: 'width=1024' } }))).toContain('resp.viewport-fixed-width');
    expect(analyzeResponsive({ ...base, meta: { viewportMeta: 'width=device-width, initial-scale=1' } })).toEqual([]);
  });

  it('reports horizontal overflow with culprits, harsher on mobile', () => {
    const overflow = { hasHorizontalScroll: true, scrollWidth: 600, clientWidth: 390, culpritCount: 2, culprits: [{ selector: '.wide', tag: 'div', right: 600, width: 600, fixedWidth: true }] };
    const mobile = analyzeResponsive({ meta: { viewportMeta: 'width=device-width' }, viewport: { width: 390 }, overflow });
    const f = mobile.find((x) => x.ruleId === 'resp.horizontal-scroll')!;
    expect(f.severity).toBe('error');
    expect(f.selectors).toEqual(['.wide']);
    expect(f.message).toContain('210px');
    const desktop = analyzeResponsive({ meta: { viewportMeta: 'width=device-width' }, viewport: { width: 1440 }, overflow });
    expect(desktop.find((x) => x.ruleId === 'resp.horizontal-scroll')?.severity).toBe('warning');
    expect(deviceModeFor(390)).toBe('mobile');
    expect(deviceModeFor(768)).toBe('tablet');
    expect(deviceModeFor(1440)).toBe('desktop');
  });

  it('parses breakpoints from media queries, including range syntax and em', () => {
    const bps = parseBreakpoints(['(min-width: 768px)', '(max-width: 767.98px) and (orientation: portrait)', '(width >= 1024px)', '(min-width: 48em)', '(min-width: 768px)']);
    expect(bps.find((b) => b.px === 768 && b.kind === 'min')?.uses).toBe(3); // 768px ×2 + 48em
    expect(bps.map((b) => b.px)).toEqual([768, 768, 1024]);
    expect(classifyToken('#fff')).toBe('color');
    expect(classifyToken('16px')).toBe('size');
    expect(classifyToken('"Inter", sans-serif')).toBe('font');
  });

  it('rates vitals against web.dev thresholds', () => {
    expect(rateVital('lcp', 2400)).toBe('good');
    expect(rateVital('lcp', 3000)).toBe('needs-improvement');
    expect(rateVital('lcp', 4500)).toBe('poor');
    expect(rateVital('cls', 0.26)).toBe('poor');
    expect(rateVital('inp', null)).toBeNull();
  });

  it('only reports non-good vitals, ties CLS to elements, and catches lazy LCP images', () => {
    const none = analyzePerformance({ vitals: emptyVitals({ lcp: { value: 1200, selector: 'img', url: null, size: 1, tag: 'img' }, cls: 0.02 }), meta: { elementCount: 100, maxDepth: 10 }, images: [] });
    expect(none).toEqual([]);

    const vitals = emptyVitals({
      lcp: { value: 5200, selector: '#hero', url: 'https://e.com/hero.jpg', size: 9, tag: 'img' },
      cls: 0.31, shifts: [{ value: 0.3, time: 900, selectors: ['.banner'] }], tbt: 700, longTasks: [{ start: 1, duration: 800 }], ttfb: 2000,
    });
    const f = analyzePerformance({ vitals, meta: { elementCount: 4000, maxDepth: 20 }, images: [image({ selector: '#hero', loading: 'lazy' })] });
    expect(ids(f)).toEqual(expect.arrayContaining(['perf.lcp', 'perf.cls', 'perf.tbt', 'perf.ttfb', 'perf.dom-size', 'perf.lcp-lazy']));
    expect(f.find((x) => x.ruleId === 'perf.cls')?.selectors).toEqual(['.banner']);
    expect(f.find((x) => x.ruleId === 'perf.lcp')?.severity).toBe('error');
    expect(f.find((x) => x.ruleId === 'perf.dom-size')?.severity).toBe('error');
  });
});

describe('colour, typography and UX', () => {
  const use = (value: string, count = 5, role: 'text' | 'background' | 'border' = 'text') => ({ value, role, count });

  it('classifies colour harmony from hue sets', () => {
    expect(classifyHarmony([])).toBe('neutral');
    expect(classifyHarmony([210])).toBe('monochromatic');
    expect(classifyHarmony([200, 230])).toBe('analogous');
    expect(classifyHarmony([200, 20])).toBe('complementary');
    expect(classifyHarmony([0, 120, 240])).toBe('triadic');
    expect(classifyHarmony([0, 90, 180, 270])).toBe('tetradic');
    expect(classifyHarmony([0, 70, 150, 220, 300])).toBe('multi-hue');
  });

  it('builds a palette: merges near colours, separates neutrals, detects the scheme', () => {
    const p = analyzePalette([use('#ffffff', 50, 'background'), use('#111111', 40), use('#0b5fff', 20), use('#0c60ff', 4), use('#ff7a00', 12)]);
    expect(p.distinct).toBe(4); // #0b5fff ≈ #0c60ff
    expect(p.swatches.find((s) => s.hex === '#ffffff')?.neutral).toBe(true);
    expect(p.scheme).toBe('complementary');
  });

  it('flags palette sprawl and near-duplicate colours', () => {
    const many = Array.from({ length: 45 }, (_, i) => use(`#${((i * 5700) % 0xffffff).toString(16).padStart(6, '0')}`));
    expect(ids(analyzeColors(many))).toContain('ux.color-sprawl');
    const dupes = ['#333333', '#343434', '#353535', '#363636'].map((c) => use(c, 3));
    expect(ids(analyzeColors(dupes))).toContain('ux.near-duplicate-colors');
  });

  it('flags typography problems with fixes', () => {
    const f = analyzeTypography({
      families: ['Inter', 'Georgia', 'Roboto Slab', 'Courier Prime', 'Comic Neue'].map((family) => ({ family, count: 10 })),
      sizes: Array.from({ length: 12 }, (_, i) => ({ px: 10 + i * 1.5, count: 4 })),
      weights: [],
      smallText: [{ selector: '.fine', fontSize: 10 }],
      blocks: [
        { selector: 'p.tight', fontSize: 16, lineHeightRatio: 1.1, charsPerLine: 60, width: 500 },
        { selector: 'p.wide', fontSize: 16, lineHeightRatio: 1.6, charsPerLine: 140, width: 1100 },
      ],
    });
    expect(ids(f)).toEqual(expect.arrayContaining(['ux.too-many-fonts', 'ux.too-many-sizes', 'ux.small-text', 'ux.line-height-tight', 'ux.line-length']));
    expect(f.find((x) => x.ruleId === 'ux.line-length')?.fix?.css).toContain('max-width: 70ch');
  });

  it('ignores generic families and long-tail icon fonts', () => {
    const f = analyzeTypography({ families: [{ family: 'Inter', count: 500 }, { family: 'sans-serif', count: 20 }, { family: 'FontAwesome', count: 2 }, { family: 'Icons', count: 1 }, { family: 'Dingbats', count: 1 }], sizes: [], weights: [], smallText: [], blocks: [] });
    expect(ids(f)).not.toContain('ux.too-many-fonts');
  });

  it('measures spacing grid adherence and button variants', () => {
    expect(summarizeSpacing({ values: [{ px: 8, count: 6 }, { px: 16, count: 6 }, { px: 13, count: 8 }], radii: [] }).gridShare).toBeCloseTo(0.6);
    const btn = (bg: string, radius = 6) => ({ selector: 'button', bg, color: '#fff', radius, padX: 16, padY: 8, fontSize: 14, fontWeight: 600, hasBorder: false });
    expect(buttonVariants([btn('#00f'), btn('#00f'), btn('#f00'), btn('#00f', 20)])).toHaveLength(3);
  });

  it('reports basic UX issues', () => {
    const f = analyzeUx({
      ux: {
        buttons: [], links: [{ selector: 'a.more', text: 'Click here', href: '/x' }], hashLinkCount: 4,
        forms: [{ selector: 'form', hasSubmit: false, inputCount: 2 }],
      },
      spacing: { values: [], radii: [3, 4, 6, 8, 10, 12].map((px) => ({ px, count: 3 })) },
      controls: [{ selector: 'input#e', tag: 'input', kind: 'input', inputType: 'email', name: 'Email', placeholderOnly: false, autocomplete: null }],
      meta: { description: null, hasFavicon: false, hasDoctype: false },
      css: { tokens: [], inaccessibleSheets: 0 }, distinctColors: 20,
    });
    expect(ids(f)).toEqual(expect.arrayContaining([
      'ux.no-doctype', 'ux.radius-inconsistency', 'ux.generic-link-text', 'ux.dead-links', 'ux.form-no-submit',
      'ux.autocomplete-missing', 'ux.no-meta-description', 'ux.no-favicon', 'ux.no-design-tokens',
    ]));
  });
});
