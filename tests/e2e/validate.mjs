// Data-validity audit: are the values the toolkit collects real or bogus?
//
//   node tests/e2e/validate.mjs                 # ground-truth fixtures only
//   node tests/e2e/validate.mjs --live          # + real websites (needs network)
//   node tests/e2e/validate.mjs --live https://example.org   # custom sites
//
// Three kinds of evidence:
//  1. Ground truth   – fixtures whose correct values are known by construction.
//  2. Oracle         – an independent re-measurement (plain DOM APIs, pixel sampling, curl) of the same page.
//  3. Invariants     – impossible values (NaN, negatives, bad hex, selectors that match nothing).
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { launch, ROOT, sleep } from './harness.mjs';

const args = process.argv.slice(2);
const LIVE = args.includes('--live');
const customSites = args.filter((a) => /^https?:/.test(a));
const OUT = join(ROOT, 'tests/e2e/out');
mkdirSync(OUT, { recursive: true });

// ── bundle the pure pipeline (probes → snapshot → findings) so Node can run it on raw collector output ──
const bundlePath = join(OUT, 'pipeline.bundle.mjs');
await build({ entryPoints: [join(ROOT, 'extension/shared/audit.ts')], bundle: true, format: 'esm', platform: 'node', outfile: bundlePath, logLevel: 'error' });
const pipeline = await import(`file://${bundlePath}?${Date.now()}`);
const { ALL_KINDS } = JSON.parse('{"ALL_KINDS":["meta","images","resources","css","overflow","a11y","styles","vitals"]}');

// ── result bookkeeping ──
const results = [];
let group = '';
const section = (name) => { group = name; console.log(`\n${name}`); };
function check(name, ok, detail = '', severity = 'fail') {
  results.push({ group, name, ok, detail: String(detail), severity });
  const mark = ok ? '  ✓' : severity === 'warn' ? '  ⚠' : '  ✗';
  console.log(`${mark} ${name}${detail !== '' ? ` — ${detail}` : ''}`);
}
const near = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) <= tol;

// ── independent WCAG maths (deliberately NOT imported from the toolkit) ──
const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/;

// ── fixtures ──
function png(w, h) {
  const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const body = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(body)); return Buffer.concat([l, body, c]); };
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = (x * 255 / w) | 0; raw[o + 1] = (y * 255 / h) | 0; raw[o + 2] = (x * y) & 255; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - Buffer.byteLength(s)));
const BIG = png(1600, 1000), SMALL = png(20, 20), LCPIMG = png(400, 250), XOPNG = png(64, 64);
const TRUTH_JS = pad('/* truth.js */ window.__truthJs = 1;', 12345);        // exactly 12345 bytes
const XO_JS = pad('/* xo.js */ window.__xoJs = 1;', 4321);                   // exactly 4321 bytes
const TRUTH_CSS = pad(`:root{--brand:#3b5bdb;--gap:16px}.c{padding:4px 8px;font:16px/1.5 Arial,sans-serif}
@media (min-width:768px){.c{padding:8px}}
@media (min-width:768px){.c{margin:0}}
@media (max-width:480px){.c{margin:1px}}
@media (min-width:1024px){.c{margin:2px}}`, 2000);
const XO_CSS = ':root{--xo-token:#ff6600}@media (min-width:1280px){.c{margin:3px}}';
const fx = (n) => readFileSync(join(ROOT, 'tests/fixtures', n), 'utf8');

const send = (res, type, body, extra = {}) => { res.writeHead(200, { 'content-type': type, 'content-length': Buffer.byteLength(body), ...extra }); res.end(body); };
const xoServer = http.createServer((req, res) => {
  if (req.url === '/xo.js') return send(res, 'text/javascript', XO_JS);
  if (req.url === '/xo.css') return send(res, 'text/css', XO_CSS);
  if (req.url === '/xo.png') return send(res, 'image/png', XOPNG);
  res.writeHead(404); res.end();
}).listen(0, '127.0.0.1');
await new Promise((r) => xoServer.once('listening', r));
const XO = `http://localhost:${xoServer.address().port}`;   // different hostname → genuinely cross-origin and third-party
const TTFB_DELAY = 300;
const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/big.png') return send(res, 'image/png', BIG);
  if (u === '/small.png') return send(res, 'image/png', SMALL);
  if (u === '/lcpimg.png') return send(res, 'image/png', LCPIMG);
  if (u === '/truth.js') return send(res, 'text/javascript', TRUTH_JS);
  if (u === '/truth.css') return send(res, 'text/css', TRUTH_CSS);
  if (u === '/blank') return send(res, 'text/html', '<!doctype html><title>boot</title>');
  if (u === '/truth') return send(res, 'text/html', fx('truth.html').replace(/__XO__/g, XO));
  if (u === '/vitals') return setTimeout(() => send(res, 'text/html', fx('vitals.html')), TTFB_DELAY);
  res.writeHead(404); res.end('nope');
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

// ── browser plumbing ──
const { browser, extId, sw } = await launch();
const ORACLE_PRELOAD = () => {
  // Independent Web Vitals observers, registered before any page script runs.
  const o = (window.__oracle = { cls: 0, shifts: [], lcp: null, fcp: null, longTasks: [] });
  const watch = (type, fn) => { try { new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true }); } catch { /* unsupported */ } };
  watch('layout-shift', (e) => { if (!e.hadRecentInput) { o.cls += e.value; o.shifts.push(e.value); } });
  watch('largest-contentful-paint', (e) => { o.lcp = { value: e.renderTime || e.loadTime || e.startTime, size: e.size, id: e.element?.id ?? null }; });
  watch('paint', (e) => { if (e.name === 'first-contentful-paint') o.fcp = e.startTime; });
  watch('longtask', (e) => o.longTasks.push({ start: e.startTime, duration: e.duration }));
};

async function openPage(url, { width = 600, height = 800, dpr = 1 } = {}) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(ORACLE_PRELOAD);
  await page.setViewport({ width, height, deviceScaleFactor: dpr });
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.bringToFront();
  return page;
}

// One extension page acts as the "panel": it can reach content scripts and the service worker like the real UI does.
const bootPage = await browser.newPage();
await bootPage.goto(`${ORIGIN}/blank`, { waitUntil: 'load' });
const bootTab = await sw.evaluate(async (u) => (await chrome.tabs.query({ url: u + '*' }))[0].id, `${ORIGIN}/blank`);
const cdp = await browser.target().createCDPSession();
const { targetId } = await cdp.send('Target.createTarget', { url: `chrome-extension://${extId}/sidepanel.html?tab=${bootTab}`, newWindow: true, width: 420, height: 800 });
const panel = await (await browser.waitForTarget((t) => t._targetId === targetId)).asPage();
await panel.waitForSelector('.app');

const tabIdOf = (page) => sw.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id ?? null, page.url());
const callPage = (tabId, type, payload = {}) => panel.evaluate(async (t, ty, p) => {
  const r = await chrome.tabs.sendMessage(t, { type: ty, payload: p });
  if (!r?.ok) throw new Error(r?.error ?? 'no response');
  return r.data;
}, tabId, type, payload);
const callBg = (type, payload) => panel.evaluate(async (ty, p) => {
  const r = await chrome.runtime.sendMessage({ type: ty, payload: p });
  if (!r?.ok) throw new Error(r?.error ?? 'no response');
  return r.data;
}, type, payload);

/** Mirrors runAudit() in the panel: collect → probe sizes → fetch cross-origin CSS → analyse. */
async function runAudit(page) {
  const tabId = await tabIdOf(page);
  const raw = await callPage(tabId, 'page:collect', { kinds: ALL_KINDS });
  let snapshot = raw;
  const wanted = pipeline.urlsToProbe(snapshot);
  const probes = wanted.length ? await callBg('bg:probe', { urls: wanted, pageUrl: page.url() }) : {};
  snapshot = pipeline.applyProbes(snapshot, probes);
  const sheets = pipeline.externalSheetUrls(snapshot);
  const css = sheets.length ? await callBg('bg:fetch-css', { urls: sheets, pageUrl: page.url() }) : {};
  snapshot = pipeline.applyExternalCss(snapshot, css);
  const audit = pipeline.buildAudit(snapshot, !!raw.truncated);
  return { raw, snapshot, audit, probes, css, tabId };
}

// ── generic invariants ──
function walkNumbers(value, path, visit) {
  if (typeof value === 'number') visit(path, value);
  else if (Array.isArray(value)) value.forEach((v, i) => walkNumbers(v, `${path}[${i}]`, visit));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walkNumbers(v, `${path}.${k}`, visit);
}
const NON_NEGATIVE_SKIP = /\.(top|right|x|y|scrollX|scrollY|start|time|left|bottom)$|\.rect\./;

function invariants(snap, label) {
  const bad = [];
  walkNumbers(snap, 'snapshot', (p, n) => { if (!Number.isFinite(n)) bad.push(`${p}=${n}`); else if (n < 0 && !/resources\[\d+\]\.duration/.test(p) && !NON_NEGATIVE_SKIP.test(p) && !/shifts|longTasks/.test(p)) bad.push(`${p}=${n}`); });
  check(`${label}: no NaN / Infinity / unexpected negative numbers`, bad.length === 0, bad.slice(0, 6).join(', '));

  const hexes = [
    ...snap.colors.map((c) => ['colors', c.value]),
    ...snap.a11y.text.flatMap((t) => [['text.fg', t.fg], ...(t.bg ? [['text.bg', t.bg]] : [])]),
    ...snap.ux.buttons.flatMap((b) => [['btn.bg', b.bg], ['btn.color', b.color]]),
  ].filter(([, v]) => !HEX.test(v));
  check(`${label}: every colour is a valid hex`, hexes.length === 0, hexes.slice(0, 4).map((h) => h.join('=')).join(', '));

  const v = snap.viewport;
  check(`${label}: viewport sane (width/height > 0, dpr 0.5–5, scrollWidth ≥ clientWidth)`, v.width > 0 && v.height > 0 && v.dpr >= 0.5 && v.dpr <= 5 && v.scrollWidth >= v.clientWidth, JSON.stringify(v));
  check(`${label}: headings levels 1–6`, snap.a11y.headings.every((h) => h.level >= 1 && h.level <= 6), snap.a11y.headings.filter((h) => h.level < 1 || h.level > 6).map((h) => h.level).join(','));
  check(`${label}: font sizes / weights plausible`, snap.typography.sizes.every((s) => s.px >= 1 && s.px <= 400) && snap.typography.weights.every((w) => w.weight >= 100 && w.weight <= 1000), '');
  const blocks = snap.typography.blocks.filter((b) => !(b.lineHeightRatio > 0.5 && b.lineHeightRatio < 5 && b.charsPerLine > 0));
  check(`${label}: paragraph blocks have sane line-height ratio and measure`, blocks.length === 0, blocks.slice(0, 3).map((b) => `${b.selector} lh=${b.lineHeightRatio} cpl=${b.charsPerLine}`).join(' | '));
  const neg = snap.resources.filter((r) => r.duration < 0);
  check(`${label}: no resource has a negative duration`, neg.length === 0, `${neg.length} of ${snap.resources.length}: ` + neg.slice(0, 3).map((r) => `${r.url.slice(0, 60)} dur=${r.duration.toFixed(1)} start=${r.startTime.toFixed(0)} type=${r.type}`).join(' | '));
  const res = snap.resources.filter((r) => r.sizeKnown && (r.encodedSize > r.decodedSize * 1.05 + 64 && r.decodedSize > 0 ? r.encodedSize > 0 : false));
  check(`${label}: resource encoded size never exceeds decoded (beyond tiny overhead)`, res.length === 0, res.slice(0, 3).map((r) => `${r.url.slice(-40)} enc=${r.encodedSize} dec=${r.decodedSize}`).join(' | '), 'warn');
  const t = snap.vitals;
  const ordered = [t.ttfb, t.fcp, t.domContentLoaded, t.load].filter((x) => x != null);
  check(`${label}: vitals are finite and ≥ 0 (ttfb ${t.ttfb?.toFixed?.(0)}, fcp ${t.fcp?.toFixed?.(0)}, load ${t.load?.toFixed?.(0)})`, ordered.every((x) => Number.isFinite(x) && x >= 0) && t.cls >= 0 && t.tbt >= 0, '');
  check(`${label}: TTFB ≤ FCP and TTFB ≤ DCL ≤ load`, (t.ttfb == null || t.fcp == null || t.ttfb <= t.fcp + 1) && (t.domContentLoaded == null || t.load == null || t.domContentLoaded <= t.load + 1) && (t.ttfb == null || t.domContentLoaded == null || t.ttfb <= t.domContentLoaded), `ttfb=${t.ttfb?.toFixed?.(0)} fcp=${t.fcp?.toFixed?.(0)} dcl=${t.domContentLoaded?.toFixed?.(0)} load=${t.load?.toFixed?.(0)}`);
  if (t.lcp) check(`${label}: LCP ≥ FCP and size > 0`, (t.fcp == null || t.lcp.value >= t.fcp - 1) && t.lcp.size > 0, `lcp=${t.lcp.value.toFixed(0)} fcp=${t.fcp?.toFixed?.(0)} size=${t.lcp.size}`);
  const bp = snap.css.breakpoints.filter((b) => !(b.px > 0 && b.px < 10000 && b.uses >= 1));
  check(`${label}: breakpoints are positive px with ≥ 1 use`, bp.length === 0, JSON.stringify(bp.slice(0, 3)));
  const findings = snap.__findings ?? [];
  void findings;
}

/** Every selector the toolkit reports must resolve to an element — otherwise "click to highlight" is a lie. */
async function selectorChecks(page, snap, label) {
  const selectors = new Set([
    ...snap.images.map((i) => i.selector),
    ...snap.a11y.text.map((t) => t.selector),
    ...snap.a11y.controls.map((c) => c.selector),
    ...snap.a11y.targets.map((t) => t.selector),
    ...snap.a11y.headings.map((h) => h.selector),
    ...snap.overflow.culprits.map((c) => c.selector),
    ...snap.ux.buttons.map((b) => b.selector),
    ...snap.ux.links.slice(0, 80).map((l) => l.selector),
    ...snap.scripts.map((s) => s.selector),
    ...snap.a11y.ariaIssues.filter((a) => a.kind !== 'duplicate-id').map((a) => a.selector),
  ]);
  const counts = await page.evaluate((sels) => {
    const SEP = ' >>> ';
    const resolve = (selector) => {
      try {
        const parts = selector.split(SEP).map((p) => p.trim());
        let roots = [document];
        for (let i = 0; i < parts.length; i++) {
          const m = roots.flatMap((r) => [...r.querySelectorAll(parts[i])]);
          if (i === parts.length - 1) return m.length;
          roots = m.map((x) => x.shadowRoot).filter(Boolean);
        }
      } catch { return -1; }
      return 0;
    };
    return sels.map((s) => [s, resolve(s)]);
  }, [...selectors]);
  const missing = counts.filter(([, n]) => n <= 0);
  const ambiguous = counts.filter(([, n]) => n > 1);
  check(`${label}: every reported selector resolves (${counts.length} checked)`, missing.length === 0, missing.slice(0, 4).map(([s, n]) => `${s.slice(0, 60)}→${n}`).join(' | '));
  check(`${label}: selectors are unique (single element)`, ambiguous.length === 0, `${ambiguous.length} ambiguous` + (ambiguous.length ? `: ${ambiguous.slice(0, 3).map(([s, n]) => `${s.slice(0, 50)}→${n}`).join(' | ')}` : ''), 'warn');
}

/** Independent re-measurement of the page, using different APIs than the collectors. */
const oracleDom = () => {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'HEAD', 'TITLE', 'NOSCRIPT', 'TEMPLATE', 'BASE']);
  const light = [...document.getElementsByTagName('*')].filter((e) => !(e.id || '').startsWith('__ftk'));
  const all = [];
  const walk = (root) => root.querySelectorAll('*').forEach((el) => { if ((el.id || '').startsWith('__ftk')) return; all.push(el); if (el.shadowRoot) walk(el.shadowRoot); });
  walk(document);
  const depthOf = (el) => { let d = 0; for (let n = el; n; n = n.parentElement || (n.getRootNode() instanceof ShadowRoot ? n.getRootNode().host : null)) d++; return d; };
  let maxDepthExact = 0; for (const el of light) maxDepthExact = Math.max(maxDepthExact, depthOf(el));
  return {
    lightCount: light.length,
    shadowAwareCount: all.filter((e) => !(e.id || '').startsWith('__ftk')).length,
    maxDepthExact,
    innerWidth, innerHeight, dpr: devicePixelRatio,
    docClientWidth: document.documentElement.clientWidth,
    docScrollWidth: document.documentElement.scrollWidth,
    images: [...document.images].map((i) => ({ src: i.currentSrc || i.src, nw: i.naturalWidth, nh: i.naturalHeight, w: i.getBoundingClientRect().width, h: i.getBoundingClientRect().height, complete: i.complete, disp: getComputedStyle(i).display, alt: i.getAttribute('alt') })),
    headings: [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading]')].filter((h) => { const s = getComputedStyle(h); const r = h.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0' && r.width > 0 && r.height > 0; }).map((h) => /^H[1-6]$/.test(h.tagName) ? +h.tagName[1] : +(h.getAttribute('aria-level') ?? 2)),
    hashLinks: [...document.querySelectorAll('a[href]')].filter((a) => { const h = a.getAttribute('href'); const r = a.getBoundingClientRect(); const s = getComputedStyle(a); return (h === '#' || /^javascript:/i.test(h)) && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0' && r.width > 0 && r.height > 0; }).length,
    scripts: [...document.scripts].filter((s) => !s.id.startsWith('__ftk')).length,
    resources: performance.getEntriesByType('resource').filter((e) => !/^(data|blob|chrome-extension):/.test(e.name)).map((e) => ({ url: e.name, init: e.initiatorType, enc: e.encodedBodySize, dec: e.decodedBodySize, xfer: e.transferSize, rb: e.renderBlockingStatus })),
    nav: (() => { const n = performance.getEntriesByType('navigation')[0]; return n ? { ttfb: n.responseStart, dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd } : null; })(),
    viewportMeta: document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? null,
    vitals: window.__oracle ?? null,
    text: [...all].filter((e) => !SKIP.has(e.tagName)).length,
  };
};

// ════════════════════════════════ 1. GROUND TRUTH: fixture with known values ════════════════════════════════
section('Ground truth · truth fixture (viewport 600×800, dpr 1)');
const truthPage = await openPage(`${ORIGIN}/truth`);
await sleep(800);
const T = await runAudit(truthPage);
const S = T.snapshot;
writeFileSync(join(OUT, 'truth-snapshot.json'), JSON.stringify(S, null, 1));
const textBy = (needle) => S.a11y.text.find((t) => t.text.includes(needle));

// -- viewport
check('viewport width/height/dpr match the page', S.viewport.width === 600 && S.viewport.height === 800 && S.viewport.dpr === 1, JSON.stringify(S.viewport));
check('overflow: horizontal scroll detected, scrollWidth = 900px element + 8px body margin', S.overflow.hasHorizontalScroll && S.overflow.scrollWidth === 908, `scrollWidth=${S.overflow.scrollWidth} clientWidth=${S.overflow.clientWidth}`);
check('overflow: culprit is #wide at width 900', S.overflow.culprits.some((c) => c.selector === '#wide' && c.width === 900 && c.fixedWidth), JSON.stringify(S.overflow.culprits.map((c) => [c.selector, c.width, c.right])));

// -- contrast: expected fg/bg known by construction
const EXPECT = [
  ['black on white', '#000000', '#ffffff'],
  ['767676 on white', '#767676', '#ffffff'],
  ['777777 on white', '#777777', '#ffffff'],
  ['white on navy', '#ffffff', '#223366'],
  ['half black text', '#808080', '#ffffff'],        // rgba(0,0,0,.5) over white = 127.5 → 128 or 127
  ['opacity parent', '#808080', '#ffffff'],         // opacity .5 black over white
  ['hsl red', '#cc0000', '#ffffff'],
  ['translucent bg over white', '#ffffff', '#808080'],
  ['tiny3 on green', '#ffffff', '#00bb66'],
];
for (const [needle, fg, bg] of EXPECT) {
  const t = textBy(needle);
  if (!t) { check(`contrast sample "${needle}" present`, false, 'missing'); continue; }
  const dFg = Math.max(...hexRgb(t.fg).map((v, i) => Math.abs(v - hexRgb(fg)[i])));
  const dBg = Math.max(...hexRgb(t.bg).map((v, i) => Math.abs(v - hexRgb(bg)[i])));
  check(`"${needle}": fg ${t.fg} (want ${fg}), bg ${t.bg} (want ${bg}), ratio ${ratio(hexRgb(t.fg), hexRgb(t.bg)).toFixed(2)}`, dFg <= 1 && dBg <= 1 && !t.bgUncertain);
}
check('gradient background is flagged uncertain (not given a bogus bg)', textBy('gradient')?.bgUncertain === true, JSON.stringify(textBy('gradient')));
// Colour-space conversion: oklch / color-mix / lab / lch must equal what the browser actually paints.
async function pixelTruth(page, id, hideText) {
  // Real rendered pixels: screenshot the element with its text hidden and take the dominant colour.
  const clip = await page.evaluate((i, hide) => {
    const el = document.getElementById(i); el.scrollIntoView({ block: 'center' });
    if (hide) { const s = document.createElement('style'); s.id = '__hide'; s.textContent = `#${i}, #${i} *{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important}`; document.head.appendChild(s); }
    const r = el.getBoundingClientRect(); return { x: r.x + scrollX + 2, y: r.y + scrollY + 2, width: Math.max(4, Math.min(r.width, 300) - 4), height: Math.max(4, r.height - 4) };
  }, id, hideText);
  const buf = await page.screenshot({ clip, encoding: 'base64' });
  await page.evaluate(() => document.getElementById('__hide')?.remove());
  return page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height); const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data; const m = new Map();
    for (let i = 0; i < d.length; i += 4) { const k = `${d[i]},${d[i + 1]},${d[i + 2]}`; m.set(k, (m.get(k) ?? 0) + 1); }
    const [top] = [...m].sort((a, b) => b[1] - a[1]); return top[0].split(',').map(Number);
  }, buf);
}
// Positive controls: the pixel method must see a navy and a mid-grey box, or its agreement on white proves nothing.
for (const [id, want] of [['t4', [34, 51, 102]], ['t10', [128, 128, 128]], ['t13', [0, 187, 102]]]) {
  const got = await pixelTruth(truthPage, id, true);
  check(`pixel-sampling control #${id}: sees rgb(${want}) on screen`, Math.max(...got.map((v, i) => Math.abs(v - want[i]))) <= 2, `got rgb(${got})`);
}
for (const [id, needle] of [['t8', 'oklch'], ['t9', 'color-mix'], ['t12', 'lab on lch'], ['t7', 'hsl red']]) {
  const t = textBy(needle); if (!t) { check(`${needle}: sample present`, false); continue; }
  // fg truth: render the same text at huge size so the glyph core is solid; compare to the reported fg.
  const px = await truthPage.evaluate(async (i) => {
    const el = document.getElementById(i); const bg = getComputedStyle(el).backgroundColor;
    const c = document.createElement('canvas'); c.width = c.height = 1; const g = c.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, 1, 1); const b = [...g.getImageData(0, 0, 1, 1).data].slice(0, 3);
    g.fillStyle = '#000'; g.fillStyle = getComputedStyle(el).color; g.fillRect(0, 0, 1, 1);
    return { fg: [...g.getImageData(0, 0, 1, 1).data].slice(0, 3), bg: b };
  }, id);
  const rf = hexRgb(t.fg), d = Math.max(...rf.map((v, i) => Math.abs(v - px.fg[i])));
  check(`${needle}: reported fg ${t.fg} equals the browser's own rasterisation rgb(${px.fg})`, d <= 1, `Δ=${d}`);
  const bgPix = await pixelTruth(truthPage, id, true);
  const rb = hexRgb(t.bg), db = Math.max(...rb.map((v, i) => Math.abs(v - bgPix[i])));
  check(`${needle}: reported bg ${t.bg} equals the pixels on screen rgb(${bgPix})`, db <= 2 || t.bgUncertain, `Δ=${db}`);
}
// Findings: the worst-contrast finding must quote the true minimum among certain samples
const contrastF = T.audit.findings.find((f) => f.ruleId === 'a11y.contrast');
const certain = S.a11y.text.filter((t) => !t.bgUncertain).map((t) => ({ t, r: ratio(hexRgb(t.fg), hexRgb(t.bg)), need: t.fontSize >= 24 || (t.fontSize >= 18.66 && t.fontWeight >= 700) ? 3 : 4.5 })).filter((x) => x.r < x.need).sort((a, b) => a.r - b.r);
check('contrast finding quotes the true worst ratio', !!contrastF && near(contrastF.evidence.worstRatio, Number(certain[0].r.toFixed(2)), 0.011), `finding=${contrastF?.evidence?.worstRatio} independent=${certain[0]?.r.toFixed(2)}`);
check('contrast finding counts failing elements correctly', !!contrastF && contrastF.count === certain.reduce((n, x) => n + x.t.count, 0), `finding=${contrastF?.count} independent=${certain.reduce((n, x) => n + x.t.count, 0)}`);
check('767676 passes AA, 777777 fails AA (the 4.5 boundary)', !certain.some((x) => x.t.text.includes('767676')) && certain.some((x) => x.t.text.includes('777777')), certain.map((x) => `${x.t.text.slice(0, 12)}=${x.r.toFixed(2)}`).join(', '));
check('shadow-DOM text is audited with correct colour', S.a11y.text.some((t) => t.text.includes('shadow text') && t.fg === '#777777' && t.selector.includes('>>>')), '');

// -- images: natural/rendered dimensions and bytes
const img = (id) => S.images.find((i) => i.selector === `#${id}`);
const big = img('big');
check('#big natural 1600×1000, rendered 300×187.5', big?.naturalWidth === 1600 && big?.naturalHeight === 1000 && near(big.renderedWidth, 300, 0.5) && near(big.renderedHeight, 187.5, 0.5), JSON.stringify(big && [big.naturalWidth, big.naturalHeight, big.renderedWidth, big.renderedHeight]));
check(`#big bytes = ${BIG.length} (exact PNG size)`, big?.bytes === BIG.length, `got ${big?.bytes}`);
check(`#xo (cross-origin, hidden from Resource Timing) bytes via probe = ${XOPNG.length}`, img('xo')?.bytes === XOPNG.length, `got ${img('xo')?.bytes}; probe=${JSON.stringify(T.probes[`${XO}/xo.png`])}`);
check('#small bytes exact', img('small')?.bytes === SMALL.length, `got ${img('small')?.bytes} want ${SMALL.length}`);
check('#gone (404) reported complete with naturalWidth 0 → "broken" finding', img('gone')?.complete === true && img('gone')?.naturalWidth === 0 && T.audit.findings.some((f) => f.ruleId === 'img.broken' && f.selectors?.includes('#gone')), JSON.stringify(img('gone') && [img('gone').complete, img('gone').naturalWidth]));
check('#dec (alt="") is decorative; #nodim is not', img('dec')?.decorative === true && img('nodim')?.decorative === false, '');
check('#nodim flagged for missing width/height; #big/#small/#xo are not', (() => { const f = T.audit.findings.find((x) => x.ruleId === 'img.no-dimensions'); return !!f && f.selectors.includes('#nodim') && !f.selectors.includes('#small') && !f.selectors.includes('#xo'); })(), '');
const oversized = T.audit.findings.find((f) => f.ruleId === 'img.oversized');
check('oversized finding: #big (1600×1000 shown at 300×187) flagged, wastedBytes ≈ bytes×(1−1/ratio)', (() => { if (!oversized) return false; const ratioReal = (1600 * 1000) / (300 * 187.5); const want = Math.round(BIG.length * (1 - 1 / ratioReal)); return oversized.selectors.includes('#big') && near(oversized.evidence.wastedBytes, want, want * 0.01); })(), `evidence=${JSON.stringify(oversized?.evidence)}`);
check('background-image captured with rendered size 120×60', S.images.some((i) => i.kind === 'bg' && near(i.renderedWidth, 120, 0.5) && near(i.renderedHeight, 60, 0.5)), '');

// -- resources and scripts
const res = (u) => S.resources.find((r) => r.url === u);
const tj = res(`${ORIGIN}/truth.js`);
check(`truth.js encodedBodySize = 12345`, tj?.encodedSize === 12345 && tj?.decodedSize === 12345, JSON.stringify(tj && [tj.encodedSize, tj.decodedSize, tj.transferSize]));
check('truth.js transferSize ≥ body size and < body + 2 KB header overhead', !!tj && tj.transferSize >= 12345 && tj.transferSize < 12345 + 2048, `transfer=${tj?.transferSize}`);
const xj = res(`${XO}/xo.js`);
check('xo.js is cross-origin: sizeKnown=false, thirdParty=true, probe.size = 4321', !!xj && xj.sizeKnown === false && xj.thirdParty === true && xj.probe?.size === 4321, JSON.stringify(xj && [xj.sizeKnown, xj.thirdParty, xj.probe]));
check('same-origin truth.js is not third party', tj?.thirdParty === false, '');
check('resource types classified (script/css/image)', tj?.type === 'script' && res(`${ORIGIN}/truth.css`)?.type === 'css' && res(`${ORIGIN}/big.png`)?.type === 'image', [tj?.type, res(`${ORIGIN}/truth.css`)?.type, res(`${ORIGIN}/big.png`)?.type].join(','));
const inline = S.scripts.find((s) => !s.src);
const inlineText = await truthPage.evaluate(() => [...document.scripts].find((s) => !s.src && s.textContent.includes('inline')).textContent);
check(`inline script size is in BYTES (${Buffer.byteLength(inlineText)} UTF-8 bytes, ${inlineText.length} chars)`, inline?.inlineBytes === Buffer.byteLength(inlineText), `reported ${inline?.inlineBytes} → ${inline?.inlineBytes === inlineText.length ? 'counts UTF-16 chars, not bytes' : ''}`, 'warn');
check('script attributes: defer detected, external src recorded', S.scripts.filter((s) => s.defer).length === 2 && S.scripts.some((s) => s.src === `${ORIGIN}/truth.js`), '');

// -- css
const sheet = S.css.stylesheets.find((s) => s.href === `${ORIGIN}/truth.css`);
check('stylesheet rule count: 1 :root + .c + 4 @media (+ their inner rules)', !!sheet && sheet.ruleCount >= 5, `ruleCount=${sheet?.ruleCount}`);
const bps = Object.fromEntries(S.css.breakpoints.map((b) => [`${b.kind}:${b.px}`, b.uses]));
check('breakpoints exact: min768×2, max480×1, min1024×1', bps['min:768'] === 2 && bps['max:480'] === 1 && bps['min:1024'] === 1, JSON.stringify(bps));
check('cross-origin CSS text fetched & parsed: min1280 breakpoint from xo.css', bps['min:1280'] === 1 && S.css.stylesheets.find((s) => s.href === `${XO}/xo.css`)?.parsed === true, `min:1280=${bps['min:1280']}`);
check('design tokens read from same- and cross-origin CSS', ['--brand', '--gap', '--xo-token'].every((n) => S.css.tokens.some((t) => t.name === n)), S.css.tokens.map((t) => t.name).join(','));
check('token --brand has the value #3b5bdb', S.css.tokens.find((t) => t.name === '--brand')?.value.toLowerCase() === '#3b5bdb', S.css.tokens.find((t) => t.name === '--brand')?.value);

// -- a11y
check('headings: visible levels [1,2,4] only (hidden h3 excluded)', JSON.stringify(S.a11y.headings.map((h) => h.level)) === '[1,2,4]', JSON.stringify(S.a11y.headings.map((h) => h.level)));
check('heading-skip finding mentions the h2→h4 jump', T.audit.findings.some((f) => /h4|skip/i.test(f.title + f.message) && f.category === 'accessibility'), '');
const t30 = S.a11y.targets.find((t) => t.selector === '#tap30');
check('target sizes: #tap30 reported as 30×30, #tap48 not flagged', t30?.width === 30 && t30?.height === 30 && !S.a11y.targets.some((t) => t.selector === '#tap48'), JSON.stringify(S.a11y.targets.filter((t) => /tap/.test(t.selector))));
const issue = (k) => S.a11y.ariaIssues.filter((i) => i.kind === k);
check('duplicate id "dup" ×2 found', issue('duplicate-id').some((i) => i.detail === 'id="dup" ×2'), JSON.stringify(issue('duplicate-id')));
check('broken aria-labelledby, positive tabindex, invalid role each found once', issue('broken-reference').length === 1 && issue('positive-tabindex').length === 1 && issue('invalid-role').length === 1, `${issue('broken-reference').length}/${issue('positive-tabindex').length}/${issue('invalid-role').length}`);
const email = S.a11y.controls.find((c) => c.selector === '#email'), named = S.a11y.controls.find((c) => c.selector === '#named');
check('controls: #email placeholder-only; #named has accessible name "Named"', email?.placeholderOnly === true && named?.name === 'Named' && named?.placeholderOnly === false, JSON.stringify([email?.name, email?.placeholderOnly, named?.name]));
check('zoomDisabled false for width=device-width, initial-scale=1', S.a11y.zoomDisabled === false, '');
check('landmarks counted: none present', S.a11y.landmarks.main === 0 && S.a11y.landmarks.nav === 0, JSON.stringify(S.a11y.landmarks));

// -- typography / ux / spacing
const para = S.typography.blocks.find((b) => b.selector === '#para');
check('paragraph #para: line-height ratio 1.5, width 300', para?.lineHeightRatio === 1.5 && para?.width === 300, JSON.stringify(para));
const shortLine = 300 / (14 * 0.5);
check(`paragraph measure estimate ≈ ${shortLine.toFixed(1)} chars/line (0.5em avg glyph heuristic)`, near(para?.charsPerLine, shortLine, 0.1), `reported ${para?.charsPerLine}`);
const realCpl = await truthPage.evaluate(() => { const p = document.getElementById('para'); const r = document.createRange(); r.selectNodeContents(p.firstChild); const rects = [...r.getClientRects()]; const lines = new Set(rects.map((x) => Math.round(x.top))).size; return p.textContent.length / lines; });
check(`measure heuristic vs real wrapped line length (${realCpl.toFixed(1)} chars/line actual)`, Math.abs(para?.charsPerLine - realCpl) / realCpl < 0.25, `heuristic ${para?.charsPerLine?.toFixed(1)} vs actual ${realCpl.toFixed(1)} (${(100 * Math.abs(para?.charsPerLine - realCpl) / realCpl).toFixed(0)}% off)`, 'warn');
check('small text: #small11 at 11px reported', S.typography.smallText.some((s) => s.selector === '#small11' && s.fontSize === 11), JSON.stringify(S.typography.smallText));
check('font weights/families: Arial seen', S.typography.families.some((f) => /arial/i.test(f.family)), JSON.stringify(S.typography.families.slice(0, 3)));
check('links: 3 found, 2 are "#"/javascript: dead links', S.ux.links.length >= 3 && S.ux.hashLinkCount === 2, `links=${S.ux.links.length} hash=${S.ux.hashLinkCount}`);
check('form: 1 form with 2 inputs and no submit', S.ux.forms.length === 1 && S.ux.forms[0].inputCount === 2 && !S.ux.forms[0].hasSubmit, JSON.stringify(S.ux.forms));
check('spacing: padding 8 and 16, margin-top 24, radius 6 recorded', [8, 16, 24].every((v) => S.spacing.values.some((s) => s.px === v)) && S.spacing.radii.some((r) => r.px === 6), '');
check('colour usage: #eeeeee background, #767676 text counted', S.colors.some((c) => c.role === 'background' && c.value === '#eeeeee') && S.colors.some((c) => c.role === 'text' && c.value === '#767676'), '');

// -- meta / DOM counts
const O = await truthPage.evaluate(oracleDom);
check(`meta.elementCount = ${O.lightCount} (document.getElementsByTagName count)`, S.meta.elementCount === O.lightCount, `got ${S.meta.elementCount}`);
check(`elementCount includes shadow-DOM elements (${O.shadowAwareCount} actual)`, S.meta.elementCount === O.shadowAwareCount, `reported ${S.meta.elementCount}, actual incl. shadow ${O.shadowAwareCount}`, 'warn');
check('meta.maxDepth equals exact depth', S.meta.maxDepth === O.maxDepthExact, `reported ${S.meta.maxDepth}, exact ${O.maxDepthExact}`);
check('meta basics: title, lang, doctype, charset, viewportMeta', S.meta.title === 'Truth fixture' && S.meta.lang === 'en' && S.meta.hasDoctype && S.meta.charset === 'UTF-8' && S.meta.viewportMeta === 'width=device-width, initial-scale=1', JSON.stringify(S.meta));
check('meta.hasFavicon false (no <link rel=icon>)', S.meta.hasFavicon === false, '');
invariants(S, 'truth');
await selectorChecks(truthPage, S, 'truth');

// ════════════════════════════════ 2. GROUND TRUTH: Web Vitals ════════════════════════════════
section('Ground truth · Web Vitals (server TTFB delay 300 ms, banner shift, 220 ms long task, 320 ms click handler)');
{
  const page = await openPage(`${ORIGIN}/vitals`);
  await sleep(1800);                                   // let the shift (t≈400ms) and long task (t≈1100ms) happen
  await page.click('#btn');                            // trusted click → INP candidate
  await sleep(900);
  const V = await runAudit(page);
  const v = V.snapshot.vitals;
  const o = await page.evaluate(oracleDom);
  writeFileSync(join(OUT, 'vitals-snapshot.json'), JSON.stringify(V.snapshot.vitals, null, 1));
  // The banner pushes #a (600×200), #lcp (400×250) and #btn (200×60) down by 100 px, all inside the 600×800 viewport.
  // Union of before/after boxes = 600×300 + 400×250 + 200×60 = 292 000 px² → impact 292000/480000 = 0.6083;
  // distance = 100/max(600,800) = 0.125; layout-shift score = 0.0760.
  check('CLS = 0.0760 (impact 0.6083 × distance 0.125, derived by hand)', near(v.cls, 0.6083333 * 0.125, 0.002), `reported ${v.cls.toFixed(4)}; independent observer ${o.vitals.cls.toFixed(4)}`);
  check('CLS equals an independent PerformanceObserver', near(v.cls, o.vitals.cls, 0.002), `${v.cls.toFixed(4)} vs ${o.vitals.cls.toFixed(4)}`);
  check('layout-shift source names the shifted element', v.shifts.some((s) => s.selectors.some((x) => /#a$|^#a|div#a|slot|banner/.test(x))), JSON.stringify(v.shifts.map((s) => s.selectors)));
  check(`TTFB ≈ ${TTFB_DELAY} ms server delay (and equals navigation timing)`, v.ttfb >= TTFB_DELAY - 10 && v.ttfb < TTFB_DELAY + 250 && near(v.ttfb, o.nav.ttfb, 1), `reported ${v.ttfb?.toFixed(0)}, nav timing ${o.nav.ttfb.toFixed(0)}`);
  check('load / DOMContentLoaded match navigation timing', near(v.load, o.nav.load, 2) && near(v.domContentLoaded, o.nav.dcl, 2), `load ${v.load?.toFixed(0)} vs ${o.nav.load.toFixed(0)}, dcl ${v.domContentLoaded?.toFixed(0)} vs ${o.nav.dcl.toFixed(0)}`);
  check('FCP equals independent observer', near(v.fcp, o.vitals.fcp, 1), `${v.fcp?.toFixed(0)} vs ${o.vitals.fcp?.toFixed(0)}`);
  check('LCP equals independent observer (value and element)', !!v.lcp && !!o.vitals.lcp && near(v.lcp.value, o.vitals.lcp.value, 1) && v.lcp.size === o.vitals.lcp.size, `${v.lcp?.value.toFixed(0)} (${v.lcp?.selector}, size ${v.lcp?.size}) vs ${o.vitals.lcp?.value.toFixed(0)} (#${o.vitals.lcp?.id}, size ${o.vitals.lcp?.size})`);
  check('LCP element is the 400×250 image (#lcp) and TTFB < LCP', v.lcp?.selector === '#lcp' && v.lcp.size === 400 * 250 && v.lcp.value > v.ttfb, `selector=${v.lcp?.selector} size=${v.lcp?.size}`);
  const long = v.longTasks.filter((t) => t.duration >= 200);
  check('long task of ~220 ms captured', long.length >= 1 && long.some((t) => t.duration >= 215 && t.duration < 300), JSON.stringify(v.longTasks.map((t) => Math.round(t.duration))));
  const expectedTbt = o.vitals.longTasks.filter((t) => o.vitals.fcp == null || t.start >= o.vitals.fcp).reduce((s, t) => s + Math.max(0, t.duration - 50), 0);
  check('TBT = Σ(long task − 50 ms) after FCP, equals independent sum', near(v.tbt, expectedTbt, 1) && v.tbt >= 165, `reported ${v.tbt.toFixed(0)}, independent ${expectedTbt.toFixed(0)} (≥ 170 expected from the 220 ms task)`);
  check('INP ≈ 320 ms click handler (+ presentation delay) on #btn', !!v.inp && v.inp.value >= 316 && v.inp.value < 500 && /btn/.test(v.inp.selector ?? ''), JSON.stringify(v.inp));
  const perf = V.audit.findings.filter((f) => f.category === 'performance');
  const f = (id) => perf.find((x) => x.ruleId === id);
  check('INP finding is "poor" territory? (>200 = needs-improvement)', perf.some((x) => /inp/i.test(x.ruleId) && x.evidence.value === v.inp.value), perf.map((x) => `${x.ruleId}:${x.severity}`).join(', '));
  void f;
  invariants(V.snapshot, 'vitals');
  await page.close();
}

// ════════════════════════════════ 3. Probe accuracy: bytes the extension fetches vs curl ════════════════════════════════
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
/** Bytes a browser would actually download (compressed), or NaN if the server refused curl. */
const rawBytes = (url) => {
  try {
    const out = execFileSync('curl', ['-s', '-m', '20', '-L', '-A', UA, '-H', 'accept-encoding: gzip, deflate, br', '-H', 'accept: */*', '-o', '/dev/null', '-w', '%{http_code} %{size_download}', url], { encoding: 'utf8' }).trim().split(' ');
    return out[0] === '200' ? Number(out[1]) : NaN;
  } catch { return NaN; }
};

// ════════════════════════════════ 3b. First/third-party classification ════════════════════════════════
section('Ground truth · first- vs third-party classification (eTLD+1)');
{
  const bundle = join(OUT, 'bundle-analyzer.bundle.mjs');
  await build({ entryPoints: [join(ROOT, 'packages/bundle-analyzer/src/index.ts')], bundle: true, format: 'esm', platform: 'node', outfile: bundle, logLevel: 'error' });
  const { isThirdParty } = await import(`file://${bundle}?${Date.now()}`);
  // [resource host, page host, expected third-party]
  const cases = [
    ['cdn.example.com', 'www.example.com', false], ['static.example.co.uk', 'www.example.co.uk', false], ['other.co.uk', 'example.co.uk', true],
    ['cdn.other.com', 'www.example.com', true], ['127.0.0.1:3001', '127.0.0.1:3000', false], ['10.0.0.1', '192.168.0.1', true], ['localhost:1', 'localhost:2', false],
    ['a.example.com.au', 'b.example.com.au', false], ['evil.com.au', 'example.com.au', true],
    ['a.co.id', 'b.co.id', true], ['shop.example.co.id', 'www.example.co.id', false], ['x.or.jp', 'y.or.jp', true], ['x.ac.jp', 'y.ac.jp', true],
    ['alice.github.io', 'bob.github.io', true], ['one.vercel.app', 'two.vercel.app', true], ['a.herokuapp.com', 'b.herokuapp.com', true],
  ];
  const wrong = cases.filter(([r, p, want]) => isThirdParty(r, p) !== want);
  check(`classification correct for ${cases.length - wrong.length}/${cases.length} host pairs`, wrong.length === 0, wrong.map(([r, p, want]) => `${r} vs ${p}: said ${want ? 'first' : 'third'}-party`).join(' | '), 'warn');
}

// ════════════════════════════════ 4. LIVE SITES: oracle + invariants ════════════════════════════════
if (LIVE) {
  const sites = customSites.length ? customSites : ['https://example.com', 'https://news.ycombinator.com', 'https://en.wikipedia.org/wiki/Web_performance', 'https://github.com', 'https://www.bbc.com/news', 'https://stripe.com'];
  for (const url of sites) {
    section(`Live · ${url} (1280×800)`);
    let page;
    try {
      page = await openPage(url, { width: 1280, height: 800, dpr: 2 });
      await sleep(4000);
      const A = await runAudit(page);
      const s = A.snapshot;
      const host = new URL(url).hostname.replace(/\W+/g, '_');
      writeFileSync(join(OUT, `live-${host}.json`), JSON.stringify({ meta: s.meta, findings: A.audit.findings.map((f) => ({ ruleId: f.ruleId, severity: f.severity, title: f.title, message: f.message, count: f.count, evidence: f.evidence })) }, null, 1));
      const O = await page.evaluate(oracleDom);
      console.log(`  (${s.meta.elementCount} elements, ${s.images.length} images, ${s.resources.length} resources, ${s.a11y.text.length} text samples, ${A.audit.findings.length} findings${A.raw.truncated ? ', TRUNCATED' : ''})`);
      invariants(s, 'live');
      await selectorChecks(page, s, 'live');

      // viewport / meta
      check('viewport matches window (1280×800 @2×)', s.viewport.width === O.innerWidth && s.viewport.height === O.innerHeight && s.viewport.dpr === O.dpr, JSON.stringify([s.viewport.width, s.viewport.height, s.viewport.dpr, O.innerWidth, O.innerHeight, O.dpr]));
      check('elementCount equals getElementsByTagName count', Math.abs(s.meta.elementCount - O.lightCount) <= 5, `${s.meta.elementCount} vs ${O.lightCount} (page may have mutated)`);
      if (O.shadowAwareCount !== O.lightCount) check(`elementCount excludes shadow-DOM (${O.shadowAwareCount - O.lightCount} hidden elements)`, false, `reported ${s.meta.elementCount}, with shadow ${O.shadowAwareCount}`, 'warn');
      check('maxDepth equals exact depth (collector samples ≤ 800 elements)', s.meta.maxDepth === O.maxDepthExact, `reported ${s.meta.maxDepth}, exact ${O.maxDepthExact}`, 'warn');
      check('scroll width agrees with the page', s.overflow.scrollWidth === O.docScrollWidth && s.overflow.clientWidth === O.docClientWidth, `${s.overflow.scrollWidth}/${s.overflow.clientWidth} vs ${O.docScrollWidth}/${O.docClientWidth}`);

      // headings & links
      check('visible heading levels match an independent query', JSON.stringify(s.a11y.headings.map((h) => h.level)) === JSON.stringify(O.headings), `${s.a11y.headings.length} vs ${O.headings.length}`);
      check('dead-link count ("#" / javascript:) matches', s.ux.hashLinkCount === O.hashLinks, `${s.ux.hashLinkCount} vs ${O.hashLinks}`);
      check('script count matches document.scripts', s.scripts.length === O.scripts, `${s.scripts.length} vs ${O.scripts}`);

      // images: every sampled <img> must match document.images measured before or after the audit
      const O2 = await page.evaluate(oracleDom);
      const imgMismatch = [];
      const close = (m, i) => m.nw === i.naturalWidth && m.nh === i.naturalHeight && Math.abs(m.w - i.renderedWidth) <= 2 && Math.abs(m.h - i.renderedHeight) <= 2;
      for (const i of s.images.filter((x) => x.kind === 'img')) {
        const cands = [...O.images, ...O2.images].filter((o) => o.src === i.src || o.src.startsWith(i.src.slice(0, 80)));
        if (!cands.length) imgMismatch.push(`${i.selector.slice(-50)}: not in document.images`);
        else if (!cands.some((m) => close(m, i))) imgMismatch.push(`${i.selector.slice(-50)}: collector ${i.naturalWidth}×${i.naturalHeight}@${i.renderedWidth.toFixed(0)}×${i.renderedHeight.toFixed(0)}; page ${cands.slice(0, 2).map((m) => `${m.nw}×${m.nh}@${m.w.toFixed(0)}×${m.h.toFixed(0)}`).join(' / ')}`);
      }
      check(`image natural/rendered sizes match document.images (${s.images.filter((x) => x.kind === 'img').length} imgs)`, imgMismatch.length === 0, imgMismatch.slice(0, 3).join(' | '));

      // image findings must be literally true
      const reports = pipeline.analyzeImages ? [] : [];
      void reports;
      const imgFindings = A.audit.findings.filter((f) => f.category === 'images');
      for (const f of imgFindings) {
        if (f.ruleId === 'img.oversized') {
          const wrong = f.selectors.map((sel) => s.images.find((i) => i.selector === sel)).filter((i) => i && i.naturalWidth * i.naturalHeight < 2.25 * i.renderedWidth * i.renderedHeight * Math.min(Math.max(s.viewport.dpr, 1), 3) ** 2);
          check(`img.oversized: every listed image really has ≥ 2.25× the pixels needed (dpr-aware)`, wrong.length === 0, wrong.slice(0, 2).map((i) => i.selector).join(','));
        }
        if (f.ruleId === 'img.no-dimensions') {
          const wrong = f.selectors.map((sel) => s.images.find((i) => i.selector === sel)).filter((i) => i && i.hasWidthAttr && i.hasHeightAttr);
          check('img.no-dimensions: none of the listed images has both width and height attrs', wrong.length === 0, wrong.map((i) => i.selector).join(','));
        }
      }

      // byte sizes: compare with what curl actually downloads (compressed, like a browser)
      const byUrl = new Map(s.resources.map((r) => [r.url, r]));
      const candidates = [...new Set([...s.images.filter((i) => /^https?:/.test(i.src)).map((i) => i.src), ...s.resources.filter((r) => ['script', 'css', 'image', 'font'].includes(r.type)).map((r) => r.url)])];
      const groups = { timing: [], probe: [] };
      for (const u of candidates) {
        const r = byUrl.get(u);
        const image = s.images.find((i) => i.src === u);
        const reported = r ? (r.sizeKnown ? r.encodedSize || r.transferSize || r.decodedSize : r.probe?.size) : image?.bytes;
        if (!reported) continue;
        const g = r && r.sizeKnown ? groups.timing : groups.probe;
        if (g.length < 12) g.push({ u, reported });
      }
      for (const [name, list] of Object.entries(groups)) {
        if (!list.length) continue;
        const bad = [];
        for (const { u, reported } of list) {
          const wire = rawBytes(u);
          if (Number.isFinite(wire) && wire > 0 && Math.abs(wire - reported) / wire > 0.05 && Math.abs(wire - reported) > 150) bad.push(`${u.slice(-46)}: reported ${reported}, on the wire ${wire} (${(reported / wire).toFixed(1)}×)`);
        }
        check(`byte sizes from ${name === 'timing' ? 'Resource Timing' : 'the size probe (cross-origin)'} match the wire (${list.length - bad.length}/${list.length})`, bad.length === 0, bad.slice(0, 3).join(' | '));
      }

      // resources vs an independent Resource Timing read
      const bogusTransfer = s.resources.filter((r) => r.sizeKnown && r.transferSize > 0 && r.encodedSize > 0 && r.transferSize < r.encodedSize * 0.5);
      check('resource transferSize never far below encodedSize', bogusTransfer.length === 0, bogusTransfer.slice(0, 2).map((r) => r.url.slice(-40)).join(','), 'warn');
      const unknown = s.resources.filter((r) => !r.sizeKnown && ['script', 'css', 'image', 'font'].includes(r.type));
      const unprobed = unknown.filter((r) => r.probe?.size == null);
      check(`cross-origin resources get a probed size (${unknown.length - unprobed.length}/${unknown.length})`, unknown.length === 0 || (unknown.length - unprobed.length) / unknown.length >= 0.6, `${unprobed.length} with unknown size`, 'warn');
      const typeMismatch = s.resources.filter((r) => { const o = O.resources.find((x) => x.url === r.url); return o && ((o.init === 'script' && r.type !== 'script') || (o.init === 'img' && r.type !== 'image')); });
      check('resource type matches initiatorType for script/img', typeMismatch.length === 0, typeMismatch.slice(0, 2).map((r) => `${r.type}:${r.url.slice(-30)}`).join(','));

      // vitals vs independent observers + nav timing
      if (O.vitals && O.nav) {
        const v = s.vitals;
        check('TTFB/load match navigation timing', near(v.ttfb, O.nav.ttfb, 1) && near(v.load, O.nav.load, 2), `ttfb ${v.ttfb?.toFixed(0)}/${O.nav.ttfb.toFixed(0)} load ${v.load?.toFixed(0)}/${O.nav.load.toFixed(0)}`);
        check('FCP matches independent observer', (v.fcp == null && O.vitals.fcp == null) || near(v.fcp, O.vitals.fcp, 1), `${v.fcp?.toFixed(0)} vs ${O.vitals.fcp?.toFixed(0)}`);
        check('LCP matches independent observer', (v.lcp == null && O.vitals.lcp == null) || near(v.lcp?.value, O.vitals.lcp?.value, 1), `${v.lcp?.value?.toFixed(0)} vs ${O.vitals.lcp?.value?.toFixed(0)}`);
        check('CLS matches an independent sum of shifts (session windows ≤ total)', v.cls <= O.vitals.cls + 0.001 && (O.vitals.cls === 0 || v.cls > 0), `reported ${v.cls.toFixed(4)}, total of all shifts ${O.vitals.cls.toFixed(4)}`);
      }

      // contrast: recompute every sample + validate bg/fg against real pixels
      const wrongRatio = A.audit.findings.filter((f) => f.ruleId === 'a11y.contrast' && f.evidence.foreground && f.evidence.background).filter((f) => Math.abs(ratio(hexRgb(f.evidence.foreground), hexRgb(f.evidence.background)) - f.evidence.worstRatio) > 0.011);
      check('a11y.contrast quotes the ratio of the fg/bg it names', wrongRatio.length === 0, wrongRatio.map((f) => `${f.evidence.worstRatio}`).join(','));
      const picks = s.a11y.text.filter((t) => !t.bgUncertain).sort((a, b) => b.count - a.count).slice(0, 12);
      let bgOk = 0, bgTested = 0; const bgBad = [];
      for (const t of picks) {
        try {
          const px = await pixelOf(page, t.selector, true);
          if (!px) continue;
          bgTested++;
          const d = Math.max(...hexRgb(t.bg).map((v, i) => Math.abs(v - px[i])));
          if (d <= 6) bgOk++; else bgBad.push(`${t.selector.slice(0, 40)} reported ${t.bg} vs pixels rgb(${px})`);
        } catch { /* element scrolled/removed */ }
      }
      check(`text background colours match real screen pixels (${bgOk}/${bgTested})`, bgTested === 0 || bgOk / bgTested >= 0.85, bgBad.slice(0, 3).join(' | '), bgOk / Math.max(1, bgTested) >= 0.6 ? 'warn' : 'fail');
      await page.evaluate(() => scrollTo(0, 0));
    } catch (e) {
      check(`site ${url} audited`, false, e.message);
    } finally {
      await page?.close().catch(() => undefined);
    }
  }
}

/** Dominant on-screen colour of an element's box with its text hidden. */
async function pixelOf(page, selector, hideText) {
  const clip = await page.evaluate((sel, hide) => {
    const parts = sel.split(' >>> '); let roots = [document], el = null;
    for (let i = 0; i < parts.length; i++) { const m = roots.flatMap((r) => [...r.querySelectorAll(parts[i])]); el = m[0]; roots = m.map((x) => x.shadowRoot).filter(Boolean); }
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > innerHeight) return null;
    // If another element sits on top of the box centre, the screenshot would measure the wrong thing.
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    const covered = top && !(top === el || el.contains(top) || top.contains(el));
    if (covered) return null;
    if (hide) { const st = document.createElement('style'); st.id = '__hide'; st.textContent = '*{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important}'; document.head.appendChild(st); }
    return { x: Math.max(0, r.x + scrollX + 1), y: Math.max(0, r.y + scrollY + 1), width: Math.max(2, Math.min(r.width - 2, innerWidth - r.x - 2, 400)), height: Math.max(2, Math.min(r.height - 2, innerHeight - r.y - 2, 200)) };
  }, selector, hideText);
  if (!clip) return null;
  const buf = await page.screenshot({ clip, encoding: 'base64' });
  await page.evaluate(() => document.getElementById('__hide')?.remove());
  return page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height); const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data; const m = new Map();
    for (let i = 0; i < d.length; i += 4) { const k = `${d[i]},${d[i + 1]},${d[i + 2]}`; m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
  }, buf);
}

// ── summary ──
await browser.close();
xoServer.close(); server.close();
const fails = results.filter((r) => !r.ok && r.severity === 'fail');
const warns = results.filter((r) => !r.ok && r.severity === 'warn');
writeFileSync(join(OUT, 'validate-report.json'), JSON.stringify(results, null, 1));
console.log(`\n${results.length} checks · ${results.filter((r) => r.ok).length} passed · ${fails.length} FAILED · ${warns.length} warnings`);
for (const r of fails) console.log(`  ✗ [${r.group.split('·')[0].trim()}] ${r.name} — ${r.detail}`);
for (const r of warns) console.log(`  ⚠ [${r.group.split('·')[0].trim()}] ${r.name} — ${r.detail}`);
process.exit(fails.length ? 1 : 0);
