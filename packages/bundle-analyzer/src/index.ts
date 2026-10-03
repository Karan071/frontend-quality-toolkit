import { formatBytes, formatMs, makeFinding, plural } from '@ftk/audit-core';
import type { Finding, ResourceSample, ScriptSample, StylesheetSample } from '@ftk/audit-core';

const KB = 1024;

// ───────────────────────────── helpers ─────────────────────────────

const TWO_PART_TLDS = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.in', 'co.jp', 'co.kr',
  'com.br', 'com.mx', 'com.ar', 'co.za', 'com.sg', 'com.hk', 'com.tr', 'com.cn',
]);

/** Approximate eTLD+1 (good enough to tell first-party from third-party). */
export function registrableDomain(host: string): string {
  const h = host.replace(/:\d+$/, '').toLowerCase();
  if (/^[\d.]+$/.test(h) || h.includes(':') || h === 'localhost') return h;
  const parts = h.split('.');
  if (parts.length <= 2) return h;
  const last2 = parts.slice(-2).join('.');
  return TWO_PART_TLDS.has(last2) ? parts.slice(-3).join('.') : last2;
}

export function isThirdParty(resourceHost: string, pageHost: string): boolean {
  return registrableDomain(resourceHost) !== registrableDomain(pageHost);
}

export type ThirdPartyCategory =
  | 'analytics'
  | 'advertising'
  | 'social'
  | 'fonts'
  | 'cdn'
  | 'support'
  | 'payments'
  | 'video'
  | 'other';

const CATEGORY_PATTERNS: [ThirdPartyCategory, RegExp][] = [
  ['analytics', /google-analytics|googletagmanager|segment\.(com|io)|mixpanel|hotjar|clarity\.ms|plausible|amplitude|heap(analytics)?\.|fullstory|newrelic|nr-data|sentry|datadog|mouseflow|matomo/],
  ['advertising', /doubleclick|googlesyndication|googleadservices|adservice|criteo|taboola|outbrain|adnxs|amazon-adsystem|pubmatic|rubiconproject/],
  ['social', /facebook|fbcdn|twitter|twimg|linkedin|licdn|tiktok|instagram|pinterest|snapchat/],
  ['fonts', /fonts\.(googleapis|gstatic)|typekit|use\.fontawesome|fontawesome|fonts\.net/],
  ['cdn', /cdnjs|jsdelivr|unpkg|cloudflare|cloudfront|fastly|akamai|bootstrapcdn|jquery\.com/],
  ['support', /intercom|zendesk|drift|crisp\.chat|hubspot|livechat|tawk|freshdesk/],
  ['payments', /stripe|paypal|braintree|adyen|klarna/],
  ['video', /youtube|ytimg|vimeo|wistia|jwplayer/],
];

export function categorizeHost(host: string): ThirdPartyCategory {
  const h = host.toLowerCase();
  return CATEGORY_PATTERNS.find(([, re]) => re.test(h))?.[0] ?? 'other';
}

/** Bytes over the wire when known, otherwise the probed Content-Length. */
export function resourceBytes(r: ResourceSample): number | null {
  if (r.sizeKnown) return r.encodedSize || r.transferSize || r.decodedSize || null;
  return r.probe?.size ?? null;
}

export function resourceTypeOf(url: string, initiator: string): ResourceSample['type'] {
  const path = url.split(/[?#]/)[0].toLowerCase();
  if (/\.(m?js|cjs)$/.test(path) || initiator === 'script') return 'script';
  if (/\.css$/.test(path)) return 'css';
  if (/\.(woff2?|ttf|otf|eot)$/.test(path)) return 'font';
  if (/\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)$/.test(path) || initiator === 'img' || initiator === 'image') return 'image';
  if (/\.(mp4|webm|ogg|mp3|wav|m4a)$/.test(path) || initiator === 'video' || initiator === 'audio') return 'media';
  if (initiator === 'fetch' || initiator === 'xmlhttprequest' || initiator === 'beacon') return 'fetch';
  if (initiator === 'link') return 'css';
  return 'other';
}

// ───────────────────────────── summary ─────────────────────────────

export interface TypeSummary {
  count: number;
  bytes: number;
  thirdPartyBytes: number;
  unknownCount: number;
}

export interface BundleSummary {
  script: TypeSummary;
  css: TypeSummary;
  image: TypeSummary;
  font: TypeSummary;
  other: TypeSummary;
  totalBytes: number;
  thirdParty: { host: string; category: ThirdPartyCategory; requests: number; bytes: number }[];
  largest: ResourceSample[];
}

export function summarizeBundles(resources: ResourceSample[]): BundleSummary {
  const empty = (): TypeSummary => ({ count: 0, bytes: 0, thirdPartyBytes: 0, unknownCount: 0 });
  const sums = { script: empty(), css: empty(), image: empty(), font: empty(), other: empty() };
  const hosts = new Map<string, { host: string; category: ThirdPartyCategory; requests: number; bytes: number }>();
  let total = 0;

  for (const r of resources) {
    const bucket = r.type in sums ? sums[r.type as keyof typeof sums] : sums.other;
    const bytes = resourceBytes(r);
    bucket.count++;
    if (bytes == null) bucket.unknownCount++;
    else {
      bucket.bytes += bytes;
      total += bytes;
      if (r.thirdParty) bucket.thirdPartyBytes += bytes;
    }
    if (r.thirdParty) {
      const h = hosts.get(r.host) ?? { host: r.host, category: categorizeHost(r.host), requests: 0, bytes: 0 };
      h.requests++;
      h.bytes += bytes ?? 0;
      hosts.set(r.host, h);
    }
  }
  const largest = resources
    .filter((r) => (r.type === 'script' || r.type === 'css') && resourceBytes(r) != null)
    .sort((a, b) => (resourceBytes(b) ?? 0) - (resourceBytes(a) ?? 0))
    .slice(0, 10);
  return {
    ...sums,
    totalBytes: total,
    thirdParty: [...hosts.values()].sort((a, b) => b.bytes - a.bytes || b.requests - a.requests),
    largest,
  };
}

// ───────────────────────────── rules ─────────────────────────────

export interface BundleInput {
  resources: ResourceSample[];
  scripts: ScriptSample[];
  stylesheets: StylesheetSample[];
}

const fileName = (url: string) => {
  try {
    const u = new URL(url);
    return u.pathname.split('/').filter(Boolean).pop() || u.host;
  } catch {
    return url;
  }
};

export function analyzeBundles({ resources, scripts, stylesheets }: BundleInput): Finding[] {
  const out: Finding[] = [];
  const js = resources.filter((r) => r.type === 'script');
  const css = resources.filter((r) => r.type === 'css');

  const large = (list: ResourceSample[], warn: number, err: number, label: string, ruleId: string) => {
    const hits = list
      .map((r) => ({ r, bytes: resourceBytes(r) ?? 0 }))
      .filter((x) => x.bytes >= warn)
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 6);
    for (const { r, bytes } of hits) {
      out.push(
        makeFinding({
          ruleId,
          category: 'bundles',
          severity: bytes >= err ? 'error' : 'warning',
          title: `Large ${label}: ${fileName(r.url)} (${formatBytes(bytes)})`,
          message: `${r.thirdParty ? 'Third-party ' : ''}${label} transfers ${formatBytes(bytes)}${
            r.decodedSize > bytes * 1.2 ? ` (${formatBytes(r.decodedSize)} uncompressed)` : ''
          } and took ${formatMs(r.duration)}.`,
          url: r.url,
          evidence: { bytes, decoded: r.decodedSize || null, duration: Math.round(r.duration), thirdParty: r.thirdParty },
        }),
      );
    }
  };
  large(js, 150 * KB, 300 * KB, 'JavaScript bundle', 'bundle.large-js');
  large(css, 50 * KB, 150 * KB, 'stylesheet', 'bundle.large-css');

  const totalJs = js.reduce((s, r) => s + (resourceBytes(r) ?? 0), 0);
  if (totalJs >= 500 * KB) {
    out.push(
      makeFinding({
        ruleId: 'bundle.total-js',
        category: 'bundles',
        severity: totalJs >= 1024 * KB ? 'error' : 'warning',
        title: `${formatBytes(totalJs)} of JavaScript`,
        message: `${plural(js.length, 'script')} transfer ${formatBytes(totalJs)} in total; parsing and executing it competes with rendering.`,
        evidence: { bytes: totalJs, requests: js.length },
        key: 'total-js',
      }),
    );
  }
  const totalCss = css.reduce((s, r) => s + (resourceBytes(r) ?? 0), 0);
  if (totalCss >= 200 * KB) {
    out.push(
      makeFinding({
        ruleId: 'bundle.total-css',
        category: 'bundles',
        severity: 'warning',
        title: `${formatBytes(totalCss)} of CSS`,
        message: `${plural(css.length, 'stylesheet')} transfer ${formatBytes(totalCss)}; every rule must be parsed before first paint.`,
        evidence: { bytes: totalCss, requests: css.length },
        key: 'total-css',
      }),
    );
  }

  // Render-blocking: DOM-derived (head, no async/defer/module / no media), merged with Resource Timing.
  const blockingScripts = scripts.filter((s) => s.src && s.inHead && !s.async && !s.defer && !s.module);
  const blockingCss = stylesheets.filter((s) => s.href && s.inHead && (!s.media || s.media === 'all'));
  const timingBlocking = resources.filter((r) => r.renderBlocking && (r.type === 'script' || r.type === 'css'));
  if (blockingScripts.length) {
    out.push(
      makeFinding({
        ruleId: 'bundle.render-blocking-js',
        category: 'bundles',
        severity: blockingScripts.length >= 3 ? 'error' : 'warning',
        title: `${plural(blockingScripts.length, 'render-blocking script')}`,
        message: 'Scripts in <head> without async or defer stop the parser until they download and run.',
        selectors: blockingScripts.map((s) => s.selector).slice(0, 15),
        evidence: { count: blockingScripts.length },
        key: 'blocking-js',
      }),
    );
  }
  if (blockingCss.length >= 3 || (blockingCss.length && timingBlocking.some((r) => r.type === 'css' && r.duration > 500))) {
    out.push(
      makeFinding({
        ruleId: 'bundle.render-blocking-css',
        category: 'bundles',
        severity: 'warning',
        title: `${plural(blockingCss.length, 'render-blocking stylesheet')}`,
        message: 'Each stylesheet in <head> must download before first paint. Inline critical CSS or split by media.',
        evidence: { count: blockingCss.length },
        key: 'blocking-css',
      }),
    );
  }

  const unCompressed = resources.filter(
    (r) => (r.type === 'script' || r.type === 'css') && r.sizeKnown && r.decodedSize > 2 * KB && r.encodedSize >= r.decodedSize * 0.97 && !r.thirdParty,
  );
  if (unCompressed.length) {
    out.push(
      makeFinding({
        ruleId: 'bundle.uncompressed',
        category: 'bundles',
        severity: 'warning',
        title: `${plural(unCompressed.length, 'text resource')} appear uncompressed`,
        message: `Transfer size equals decoded size for ${unCompressed.slice(0, 3).map((r) => fileName(r.url)).join(', ')}. Enable gzip or Brotli.`,
        evidence: { bytes: unCompressed.reduce((s, r) => s + r.decodedSize, 0) },
        url: unCompressed[0].url,
        key: 'uncompressed',
      }),
    );
  }

  const third = resources.filter((r) => r.thirdParty && r.type === 'script');
  const thirdBytes = third.reduce((s, r) => s + (resourceBytes(r) ?? 0), 0);
  if (third.length >= 10 || thirdBytes >= 150 * KB) {
    const hosts = new Map<string, number>();
    third.forEach((r) => hosts.set(r.host, (hosts.get(r.host) ?? 0) + (resourceBytes(r) ?? 0)));
    const top = [...hosts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([h]) => h);
    out.push(
      makeFinding({
        ruleId: 'bundle.third-party',
        category: 'bundles',
        severity: thirdBytes >= 300 * KB ? 'error' : 'warning',
        title: `${plural(third.length, 'third-party script')} (${formatBytes(thirdBytes)})`,
        message: `Largest third-party hosts: ${top.join(', ')}. Third-party code is outside your control and runs on the main thread.`,
        evidence: { requests: third.length, bytes: thirdBytes, hosts: hosts.size },
        key: 'third-party',
      }),
    );
  }

  if (js.length > 30) {
    out.push(
      makeFinding({
        ruleId: 'bundle.many-scripts',
        category: 'bundles',
        severity: 'warning',
        title: `${js.length} script requests`,
        message: 'Lots of small scripts add request overhead and delay hydration. Consider bundling or lazy-loading.',
        evidence: { requests: js.length },
        key: 'many-scripts',
      }),
    );
  }

  const inline = [
    ...scripts.filter((s) => !s.src && s.inlineBytes >= 50 * KB).map((s) => ({ kind: 'script', bytes: s.inlineBytes, sel: s.selector })),
    ...stylesheets.filter((s) => !s.href && s.inlineBytes >= 50 * KB).map((s) => ({ kind: 'style', bytes: s.inlineBytes, sel: 'style' })),
  ];
  if (inline.length) {
    out.push(
      makeFinding({
        ruleId: 'bundle.inline-large',
        category: 'bundles',
        severity: 'warning',
        title: `${plural(inline.length, 'large inline block')}`,
        message: `Inline ${inline.map((i) => `${i.kind} (${formatBytes(i.bytes)})`).join(', ')} cannot be cached separately and bloats the HTML.`,
        selectors: inline.filter((i) => i.sel !== 'style').map((i) => i.sel),
        key: 'inline-large',
      }),
    );
  }

  const seen = new Map<string, number>();
  scripts.forEach((s) => s.src && seen.set(s.src, (seen.get(s.src) ?? 0) + 1));
  const dupes = [...seen.entries()].filter(([, n]) => n > 1);
  if (dupes.length) {
    out.push(
      makeFinding({
        ruleId: 'bundle.duplicate-script',
        category: 'bundles',
        severity: 'warning',
        title: `${plural(dupes.length, 'script')} included more than once`,
        message: `${fileName(dupes[0][0])} is loaded ${dupes[0][1]} times.`,
        url: dupes[0][0],
        key: 'dupes',
      }),
    );
  }
  return out;
}
