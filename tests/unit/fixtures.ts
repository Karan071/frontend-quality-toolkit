import type { ImageSample, PageSnapshot, ResourceSample, VitalsSnapshot } from '@ftk/audit-core';

export const emptyVitals = (over: Partial<VitalsSnapshot> = {}): VitalsSnapshot => ({
  lcp: null, cls: 0, shifts: [], inp: null, fcp: null, ttfb: null, domContentLoaded: null, load: null,
  longTasks: [], tbt: 0, navigationType: 'navigate', partial: false, ...over,
});

export const image = (over: Partial<ImageSample> = {}): ImageSample => ({
  selector: 'img.a', kind: 'img', src: 'https://example.com/a.jpg', naturalWidth: 800, naturalHeight: 600,
  renderedWidth: 400, renderedHeight: 300, hasAltAttr: true, alt: 'A thing', loading: null, fetchPriority: null,
  srcset: null, sizes: null, inPicture: false, hasWidthAttr: true, hasHeightAttr: true, hasAspectRatio: false,
  top: 0, aboveFold: true, complete: true, decorative: false, ...over,
});

export const resource = (over: Partial<ResourceSample> = {}): ResourceSample => ({
  url: 'https://example.com/app.js', type: 'script', host: 'example.com', thirdParty: false,
  transferSize: 50_000, encodedSize: 49_000, decodedSize: 160_000, duration: 120, startTime: 10, protocol: 'h2',
  renderBlocking: false, sizeKnown: true, ...over,
});

export const snapshot = (over: Partial<PageSnapshot> = {}): PageSnapshot => ({
  takenAt: 1_700_000_000_000,
  meta: { url: 'https://example.com/', title: 'Example', lang: 'en', viewportMeta: 'width=device-width, initial-scale=1', description: 'd', hasFavicon: true, hasDoctype: true, charset: 'UTF-8', elementCount: 300, maxDepth: 12 },
  viewport: { width: 1440, height: 900, dpr: 2, clientWidth: 1440, scrollWidth: 1440, scrollHeight: 3000, scrollX: 0, scrollY: 0 },
  images: [], resources: [], scripts: [],
  css: { stylesheets: [], breakpoints: [], tokens: [], inaccessibleSheets: 0 },
  overflow: { hasHorizontalScroll: false, scrollWidth: 1440, clientWidth: 1440, culprits: [], culpritCount: 0 },
  a11y: { controls: [], headings: [], landmarks: { main: 1, nav: 1, header: 1, footer: 1 }, targets: [], ariaIssues: [], focusRules: [], clickableNotFocusable: [], zoomDisabled: false, text: [] },
  typography: { families: [], sizes: [], weights: [], blocks: [], smallText: [] },
  colors: [], spacing: { values: [], radii: [] },
  ux: { buttons: [], links: [], hashLinkCount: 0, forms: [] },
  vitals: emptyVitals(),
  ...over,
});
