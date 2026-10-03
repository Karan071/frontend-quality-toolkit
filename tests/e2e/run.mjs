// End-to-end check: loads the built extension into a Chromium browser, drives the real
// side panel (opened as a tab bound to the fixture tab), and verifies behaviour.
import http from 'node:http';
import { deflateSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { strFromU8, unzipSync } from 'fflate';

const ROOT = resolve(import.meta.dirname, '../..');
const OUT = join(ROOT, 'tests/e2e/out');
mkdirSync(OUT, { recursive: true });

const BROWSERS = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const executablePath = BROWSERS.find((p) => existsSync(p));
if (!executablePath) throw new Error('No Chromium-based browser found. Set CHROME_PATH.');

// ── helpers ──
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function bigPng(w, h) {
  const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const body = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(body)); return Buffer.concat([l, body, c]); };
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = (x * 255 / w) | 0; raw[o + 1] = (y * 255 / h) | 0; raw[o + 2] = 128; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PNG = bigPng(1600, 1000);
const fixture = (name) => readFileSync(join(ROOT, 'tests/fixtures', name), 'utf8');
// A second origin serves a stylesheet without CORS headers: the page cannot read it via the CSSOM.
const cssServer = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/css' }); res.end(fixture('external.css')); }).listen(0, '127.0.0.1');
await new Promise((r) => cssServer.once('listening', r));
const CSS_ORIGIN = `http://127.0.0.1:${cssServer.address().port}`;
const SMALL_PNG = bigPng(20, 20);
const server = http.createServer((req, res) => {
  if (req.url === '/favicon.svg') { res.writeHead(200, { 'content-type': 'image/svg+xml' }); return res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#3b5bdb"/></svg>'); }
  if (/^\/lazy\d?\.png$/.test(req.url)) { res.writeHead(200, { 'content-type': 'image/png', 'content-length': SMALL_PNG.length }); return res.end(SMALL_PNG); }
  if (req.url === '/fonts/fx.woff2') { res.writeHead(200, { 'content-type': 'font/woff2' }); return res.end(Buffer.from('wOF2-not-a-real-font')); }
  if (req.url === '/files/report.pdf') { res.writeHead(200, { 'content-type': 'application/pdf' }); return res.end('%PDF-1.4 fixture'); }
  if (req.url === '/big.png') { res.writeHead(200, { 'content-type': 'image/png', 'content-length': PNG.length }); return res.end(PNG); }
  const page = req.url === '/scroller' ? 'scroller.html' : req.url === '/tall' ? 'tall.html' : 'broken.html';
  res.writeHead(200, { 'content-type': 'text/html' }); res.end(fixture(page).replace(/__CSS_ORIGIN__/g, CSS_ORIGIN));
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const URL_ = `http://127.0.0.1:${server.address().port}/`;

const browser = await puppeteer.launch({
  executablePath,
  headless: process.env.HEADED ? false : 'new',
  userDataDir: mkdtempSync(join(tmpdir(), 'ftk-e2e-')),
  args: [`--disable-extensions-except=${join(ROOT, 'dist')}`, `--load-extension=${join(ROOT, 'dist')}`, '--disable-features=DisableLoadExtensionCommandLineSwitch', '--no-first-run', '--no-default-browser-check', '--window-size=1200,900'],
  defaultViewport: null,
  protocolTimeout: 900_000,
  // Puppeteer disables extensions by default.
  ignoreDefaultArgs: ['--disable-extensions'],
});

let exitCode = 0;
try {
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('service-worker.js'), { timeout: 15000 });
  const extId = new URL(swTarget.url()).host;
  console.log(`browser: ${executablePath.split('/').slice(-1)[0]} · extension ${extId}`);

  // Target page in its own window so it stays the active tab there.
  const page = await browser.newPage();
  await page.goto(URL_, { waitUntil: 'load' });
  await page.bringToFront();
  const sw = await swTarget.worker();
  const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({ url: u + '*' }))[0].id, URL_);

  // Panel opens in a separate window sized like the side panel.
  const cdp = await browser.target().createCDPSession();
  const { targetId } = await cdp.send('Target.createTarget', { url: `chrome-extension://${extId}/sidepanel.html?tab=${tabId}`, newWindow: true, width: 400, height: 860 });
  const panelTarget = await browser.waitForTarget((t) => t._targetId === targetId);
  const panel = await panelTarget.asPage();
  const errors = [];
  panel.on('pageerror', (e) => errors.push(e.message));
  panel.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await panel.setViewport({ width: 400, height: 860 });
  await panel.waitForSelector('.app');
  await page.bringToFront();
  const clickText = async (selector, text) => {
    const h = await panel.evaluateHandle((sel, t) => [...document.querySelectorAll(sel)].find((e) => e.textContent.trim().startsWith(t)), selector, text);
    if (!h.asElement()) throw new Error(`No ${selector} starting with "${text}"`);
    await h.asElement().click();
  };
  const waitFor = (fn, arg, timeout = 20000) => panel.waitForFunction(fn, { timeout }, arg);
  const shot = async (name) => panel.screenshot({ path: join(OUT, `${name}.png`) });

  console.log('\nPanel');
  await waitFor(() => document.querySelector('.header-sub .dot.live'));
  check('panel attaches to the fixture tab', (await panel.$eval('.header-sub', (e) => e.textContent)).includes('127.0.0.1'));
  await shot('01-overview-empty');

  console.log('\nAudit');
  await clickText('button', 'Run full audit');
  await waitFor(() => document.querySelector('.hero-number'));
  const titles = await panel.$$eval('.tile-name', (els) => els.length);
  check('overview shows 6 category tiles', titles === 6);
  await shot('02-overview-audit');

  const findingsOf = async (tab) => {
    await clickText('[role=tab]', tab);
    await sleep(200);
    return panel.$$eval('.finding-title', (els) => els.map((e) => e.textContent));
  };
  const a11y = await findingsOf('Accessibility');
  check('flags low contrast', a11y.some((t) => /low text contrast/.test(t)), a11y.join(' | ').slice(0, 120));
  check('flags missing alt text', a11y.some((t) => /missing alt/.test(t)));
  check('flags unlabeled field and unnamed button', a11y.some((t) => /without a label/.test(t)) && a11y.some((t) => /without an accessible name/.test(t)));
  check('flags skipped heading level', a11y.some((t) => /skip levels/.test(t)));
  await shot('03-accessibility');

  console.log('\nShadow DOM & cross-origin CSS');
  await panel.evaluate(() => [...document.querySelectorAll('.finding-head')].find((h) => /without an accessible name/.test(h.textContent))?.click());
  await sleep(150);
  const chips = await panel.$$eval('.sel-chip', (els) => els.map((e) => e.textContent));
  check('audit reaches buttons inside the shadow root (host >>> inner selector)', chips.some((c) => /^#widget >>> /.test(c)), chips.join(' | '));
  // .faint + the orange block + the text inside the shadow root.
  check('contrast check also counts text inside the shadow root', a11y.some((t) => /^3 elements with low text contrast/.test(t)), a11y.join(' | ').slice(0, 140));
  const focusFinding = await panel.$$eval('.finding', (els) => els.find((e) => /Focus outline removed/.test(e.textContent))?.textContent ?? '');
  check('focus-outline removal found in the cross-origin stylesheet', /button\.ext:focus \(external\.css\)/.test(focusFinding), focusFinding.slice(0, 160));

  const images = await findingsOf('Images');
  check('flags oversized + no-dimension image', images.some((t) => /larger than displayed/.test(t)) && images.some((t) => /without width\/height/.test(t)), images.join(' | '));
  const uxui = await findingsOf('UI / UX');
  check('flags generic link text', uxui.some((t) => /generic text/.test(t)));
  await shot('04-uiux');
  await findingsOf('Images');
  await shot('05-images');
  const perf = await findingsOf('Performance');
  await shot('06-performance');
  check('performance tab renders vitals', (await panel.$$('.metric')).length >= 6);

  console.log('\nInspect');
  await clickText('[role=tab]', 'Inspect');
  await clickText('button', 'Pick element');
  await page.hover('#card');
  await page.click('#card');
  await waitFor(() => document.querySelector('.crumbs'));
  const sel = await panel.$eval('.card strong.mono', (e) => e.textContent);
  check('picking selects the element', /card/.test(sel), sel);
  const overlayBox = await page.evaluate(() => !!document.getElementById('__ftk-host'));
  check('overlay host injected in page', overlayBox);
  await shot('07-inspect');
  await clickText('.seg button', 'Styles');
  check('computed styles listed', (await panel.$$('.kv dt')).length > 10);
  // Temp CSS
  await panel.type('#temp-css', 'background: rgb(255, 165, 0);');
  await clickText('button', 'Apply');
  await sleep(300);
  const bg = await page.$eval('#card', (e) => getComputedStyle(e).backgroundColor);
  check('temporary CSS applies to the page', bg === 'rgb(255, 165, 0)', bg);

  await clickText('[role=tab]', 'UI / UX');
  await sleep(200);
  const tokenNames = await panel.$$eval('.kv dt', (els) => els.map((e) => e.textContent));
  check('design tokens are read from the cross-origin stylesheet', tokenNames.includes('--ext-brand'), tokenNames.filter((t) => t.startsWith('--')).join(', '));

  console.log('\nResponsive');
  await clickText('[role=tab]', 'Responsive');
  const bpChips = await panel.$$eval('.card .btn.small', (els) => els.map((e) => e.textContent.trim()));
  check('breakpoints are discovered from the cross-origin stylesheet', bpChips.some((t) => /min 1000/.test(t)) && bpChips.some((t) => /max 480/.test(t)), bpChips.join(' | '));
  const presetCount = Number((await panel.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^Test all \d+/.test(b.textContent.trim()))?.textContent.match(/\d+/)?.[0])) || 0);
  check('device catalogue offers 50+ presets', presetCount >= 50, `${presetCount}`);
  await clickText('button', 'Test all');
  await waitFor((n) => !document.querySelector('[aria-busy="true"]') && document.querySelectorAll('.card .list-item .badge.ok, .card .list-item .badge.error').length >= n, presetCount, 420000);
  const results = await panel.$$eval('.card .list-item', (els) => els.map((e) => e.textContent));
  console.log('   ', results.join(' | ').slice(0, 300));
  check('mobile widths overflow (900px element) and are labelled with the emulated width', results.some((t) => /^Mobile 390px.*overflow/i.test(t)));
  check('desktop has no overflow', results.some((t) => /^Desktop 1440px.*No overflow/.test(t)));
  check('emulation reset after Test all', !(await panel.$('.banner.ok')));
  await shot('08-responsive');

  console.log('\nScreenshots');
  await page.bringToFront();
  const idb = () => panel.evaluate(() => new Promise((resolve) => {
    const open = indexedDB.open('ftk', 1);
    open.onsuccess = () => {
      const all = open.result.transaction('screenshots').objectStore('screenshots').getAll();
      all.onsuccess = async () => {
        const out = [];
        for (const r of all.result) out.push({ id: r.id, name: r.name, type: r.type, width: r.width, height: r.height, format: r.format, scaledDown: r.scaledDown, warnings: r.warnings, createdAt: r.createdAt });
        resolve(out.sort((a, b) => a.createdAt - b.createdAt));
      };
    };
  }));
  /** Runs `action`, then waits until a new screenshot record appears and returns it. */
  const captured = async (action, timeout = 120000) => {
    const before = (await idb()).length;
    await action();
    const t0 = Date.now();
    const seen = new Set();
    while (Date.now() - t0 < timeout) {
      const all = await idb();
      if (all.length > before) return all.at(-1);
      (await panel.$$eval('.toast', (els) => els.map((t) => t.textContent))).forEach((t) => seen.add(t));
      await sleep(300);
    }
    const info = { records: (await idb()).map((r) => `${r.type}:${r.width}x${r.height}`), toasts: [...seen], footer: await panel.evaluate(() => document.querySelector('.footer')?.textContent), buttons: await panel.evaluate(() => [...document.querySelectorAll('.dock button')].map((b) => `${b.textContent}:${b.disabled}`)), header: await panel.evaluate(() => document.querySelector('.header-sub')?.innerHTML) };
    throw new Error(`Timed out waiting for a screenshot: ${JSON.stringify(info)}`);
  };
  const dpr = await page.evaluate(() => devicePixelRatio);
  const layout = await page.evaluate(() => ({ docH: document.documentElement.scrollHeight, docW: document.documentElement.clientWidth, vw: innerWidth, vh: innerHeight, hdr: 56, ftr: 48,
    blocks: [...document.querySelectorAll('.block')].map((b) => { const r = b.getBoundingClientRect(); return { top: r.top + scrollY, h: r.height, id: b.id }; }) }));

  const v = await captured(() => clickText('.footer button', 'Viewport'));
  check('viewport capture saved with expected size', v?.type === 'viewport' && Math.abs(v.width - layout.vw * dpr) <= 2 && Math.abs(v.height - layout.vh * dpr) <= 2, `${v?.width}×${v?.height} (viewport ${layout.vw}×${layout.vh} @${dpr}x)`);
  check('viewport name follows PRD', /^127-0-0-1-viewport-\d+x\d+\.png$/.test(v?.name ?? ''), v?.name);

  const f = await captured(() => clickText('.footer button', 'Full page'), 40000);
  check('full-page capture saved', f?.type === 'fullpage', f?.name);
  check('full-page height matches the document', f && Math.abs(f.height - layout.docH * dpr) <= 2 * dpr, `${f?.width}×${f?.height} vs ${layout.docW}×${layout.docH} @${dpr}x`);

  // Pixel-level checks on the stitched image.
  const probe = await panel.evaluate(async (id, L) => {
    const db = await new Promise((r) => { const o = indexedDB.open('ftk', 1); o.onsuccess = () => r(o.result); });
    const rec = await new Promise((r) => { const g = db.transaction('screenshots').objectStore('screenshots').get(id); g.onsuccess = () => r(g.result); });
    const bmp = await createImageBitmap(rec.blob);
    const k = bmp.width / L.docW;
    const c = new OffscreenCanvas(bmp.width, bmp.height); const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0);
    const px = (x, y) => Array.from(ctx.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data.slice(0, 3));
    const col = L.docW - 40; // right edge column away from content
    const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 14);
    const MAG = [255, 0, 255], CYAN = [0, 255, 255];
    let magentaRows = 0, cyanRows = 0, firstMagentaBelow = null, firstCyanAbove = null;
    for (let y = 0; y < L.docH; y += 4) {
      const p = px(col, y);
      if (near(p, MAG)) { magentaRows++; if (y > L.hdr + 8 && firstMagentaBelow === null) firstMagentaBelow = y; }
      if (near(p, CYAN)) { cyanRows++; if (y < L.docH - L.ftr - 8 && firstCyanAbove === null) firstCyanAbove = y; }
    }
    const blockColors = L.blocks.map((b) => px(200, b.top + b.h / 2));
    return { magentaRows, cyanRows, firstMagentaBelow, firstCyanAbove, blockColors, topPixel: px(col, 10), bottomPixel: px(col, L.docH - 10) };
  }, f.id, layout);
  const expected = { b1: [0xe0, 0x31, 0x31], b2: [0x2f, 0x9e, 0x44], b3: [0x19, 0x71, 0xc2], b4: [0xf0, 0x8c, 0x00], b5: [0x67, 0x41, 0xd9] };
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 16);
  check('stitched tiles are aligned (every block has the right colour at its centre)', layout.blocks.every((b, i) => near(probe.blockColors[i], expected[b.id])), JSON.stringify(probe.blockColors));
  check('fixed header appears once, at the top', near(probe.topPixel, [255, 0, 255]) && probe.firstMagentaBelow === null, `rows=${probe.magentaRows}, stray at ${probe.firstMagentaBelow}`);
  check('fixed footer appears once, at the bottom', near(probe.bottomPixel, [0, 255, 255]) && probe.firstCyanAbove === null, `rows=${probe.cyanRows}, stray at ${probe.firstCyanAbove}`);
  const restored = await page.evaluate(() => ({ scroll: scrollY, attr: document.documentElement.hasAttribute('data-ftk-hide'), style: !!document.getElementById('__ftk-shot-style'), marked: document.querySelectorAll('[data-ftk-pos],[data-ftk-sticky]').length }));
  check('page is restored after capture', restored.scroll === 0 && !restored.attr && !restored.style && restored.marked === 0, JSON.stringify(restored));

  // Element capture (selection from earlier is #card).
  const e = await captured(() => clickText('.footer button', 'Element'));
  check('element capture matches element size', e?.type === 'element' && Math.abs(e.width - 300 * dpr) <= 2 && Math.abs(e.height - 200 * dpr) <= 2, `${e?.name} ${e?.width}×${e?.height}`);

  // JPEG
  await clickText('[role=tab]', 'Screenshots');
  await panel.select('#fmt', 'jpeg');
  await sleep(200);
  const j = await captured(() => clickText('.footer button', 'Viewport'));
  check('JPEG capture works', j.format === 'jpeg' && /\.jpg$/.test(j.name), j.name);

  // Responsive screenshot at mobile size.
  await clickText('[role=tab]', 'Responsive');
  const mobileRow = await panel.evaluateHandle(() => [...document.querySelectorAll('.list-item')].find((r) => r.textContent.includes('390 × 844')));
  const m = await captured(async () => (await mobileRow.asElement().$$('button'))[1].click());
  check('mobile screenshot is the emulated viewport at its device pixel ratio (390×844 @3×)', m && m.width === 390 * 3 && m.height === 844 * 3, `${m?.width}×${m?.height}`);
  check('emulated page really is 390px wide', (await page.evaluate(() => document.documentElement.clientWidth)) === 390);
  await clickText('button', 'Reset');
  await sleep(500);
  check('reset restores the viewport', (await page.evaluate(() => document.documentElement.clientWidth)) > 390);

  // Compare
  await clickText('[role=tab]', 'Screenshots');
  const boxes = await panel.$$('.shot input[type=checkbox]');
  await boxes[0].click();
  await boxes[1].click();
  await clickText('.seg button', 'Difference').catch(() => undefined);
  await panel.waitForSelector('.compare canvas', { timeout: 10000 });
  await sleep(500);
  check('comparison renders a difference view', !!(await panel.$('.compare canvas')) && /pixels changed/.test(await panel.$eval('.card', (e) => e.parentElement.textContent)));
  await shot('09-screenshots');

  console.log('\nPage that scrolls inside a container');
  await page.goto(URL_ + 'scroller', { waitUntil: 'load' });
  await page.bringToFront();
  await waitFor(() => document.querySelector('.header-sub .dot.live'));
  await sleep(1200);
  const sc = await captured(() => clickText('.footer button', 'Full page'));
  check('inner-scroller capture is the container content (5 × 600px), not just the viewport', Math.abs(sc.height - 3000 * dpr) <= 2 * dpr, `${sc.name} ${sc.width}×${sc.height}`);
  const scProbe = await panel.evaluate(async (id) => {
    const db = await new Promise((r) => { const o = indexedDB.open('ftk', 1); o.onsuccess = () => r(o.result); });
    const rec = await new Promise((r) => { const g = db.transaction('screenshots').objectStore('screenshots').get(id); g.onsuccess = () => r(g.result); });
    const bmp = await createImageBitmap(rec.blob); const c = new OffscreenCanvas(bmp.width, bmp.height); const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0);
    const k = bmp.height / 3000; const px = (y) => Array.from(ctx.getImageData(40, Math.round(y * k), 1, 1).data.slice(0, 3));
    return { colors: [300, 900, 1500, 2100, 2700].map(px), top: px(5) };
  }, sc.id);
  const want = [[0xe0, 0x31, 0x31], [0x2f, 0x9e, 0x44], [0x19, 0x71, 0xc2], [0xf0, 0x8c, 0x00], [0x67, 0x41, 0xd9]];
  const near2 = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 16);
  check('inner-scroller tiles are aligned and the fixed top bar is excluded', want.every((w, i) => near2(scProbe.colors[i], w)) && near2(scProbe.top, want[0]), JSON.stringify(scProbe));
  check('inner-scroller scroll position restored', (await page.evaluate(() => document.getElementById('app').scrollTop)) === 0);

  console.log('\nVery tall page (split into full-resolution parts)');
  await page.goto(URL_ + 'tall', { waitUntil: 'load' });
  await page.bringToFront();
  await sleep(1500);
  const beforeTall = (await idb()).length;
  await clickText('.footer button', 'Full page');
  let tallParts = [];
  for (let i = 0; i < 400; i++) { await sleep(400); const all = await idb(); if (all.length >= beforeTall + 2) { await sleep(800); tallParts = (await idb()).slice(beforeTall); break; } }
  check('20,000px page is saved as 2 parts', tallParts.length === 2, tallParts.map((r) => `${r.name} ${r.width}x${r.height}`).join(' | '));
  if (tallParts.length === 2) {
    check('every part fits the canvas limit and nothing was scaled', tallParts.every((r) => r.height <= 16384 && r.width === Math.round(1200 * dpr)) && Math.abs(tallParts[0].height + tallParts[1].height - 20000 * dpr) <= 2 * dpr, tallParts.map((r) => r.height).join(' + '));
    const bandColors = ['#e03131', '#2f9e44', '#1971c2', '#f08c00', '#6741d9', '#0b7285', '#862e9c', '#5c940d', '#c2255c', '#364fc7'];
    const parts = await panel.evaluate(async (ids) => {
      const db = await new Promise((r) => { const o = indexedDB.open('ftk', 1); o.onsuccess = () => r(o.result); });
      const out = [];
      for (const id of ids) {
        const rec = await new Promise((r) => { const g = db.transaction('screenshots').objectStore('screenshots').get(id); g.onsuccess = () => r(g.result); });
        const bmp = await createImageBitmap(rec.blob); const c = new OffscreenCanvas(bmp.width, 1); const ctx = c.getContext('2d', { willReadFrequently: true });
        const rows = [];
        for (let y = 0; y < bmp.height; y += 500) { ctx.drawImage(bmp, 0, y, bmp.width, 1, 0, 0, bmp.width, 1); rows.push([y, Array.from(ctx.getImageData(20, 0, 1, 1).data.slice(0, 3))]); }
        out.push(rows);
      }
      return out;
    }, tallParts.map((r) => r.id));
    const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    // Parts are stored newest-first; part 1 starts at the top of the page.
    const ordered = [...tallParts.keys()].sort((a, b) => /part1of2/.test(tallParts[a].name) ? -1 : 1);
    let ok = true; let offset = 0; const bad = [];
    for (const idx of ordered) {
      for (const [y, color] of parts[idx]) {
        const docY = (offset + y) / dpr; const band = Math.floor(docY / 1000);
        if (docY % 1000 > 20 && docY % 1000 < 980 && !near2(color, hex(bandColors[band % 10]))) { ok = false; bad.push(`${docY}:${color}`); }
      }
      offset += tallParts[idx].height;
    }
    check('colour bands line up across the part boundary', ok, bad.slice(0, 3).join(' '));
  }
  await page.goto(URL_, { waitUntil: 'load' });
  await page.bringToFront();
  await waitFor(() => document.querySelector('.header-sub .dot.live'));
  await sleep(1500);
  await clickText('[role=tab]', 'Overview');
  await clickText('button', 'Re-run').catch(() => clickText('button', 'Run full audit'));
  await sleep(1500);

  console.log('\nFix & verify');
  await clickText('[role=tab]', 'Accessibility');
  await sleep(200);
  await panel.evaluate(() => [...document.querySelectorAll('.finding-head')].find((h) => /low text contrast/.test(h.textContent))?.click());
  await sleep(200);
  await clickText('.finding-actions button', 'Try fix');
  await sleep(2500);
  const after = await panel.$$eval('.finding-title', (els) => els.map((e) => e.textContent));
  const stillFaint = await panel.$$eval('.finding', (els) => els.some((e) => /#aaaaaa/.test(e.textContent)));
  check('applying a fix re-audits and the faint text no longer fails contrast', !stillFaint, 'remaining contrast finding is only the orange card from the Try-CSS step');
  const color = await page.$eval('.faint', (e) => getComputedStyle(e).color);
  check('fix changed the page colour', color !== 'rgb(170, 170, 170)', color);
  await clickText('[role=tab]', 'Overview');
  check('overview shows fix verification', !!(await panel.$$eval('.card-title', (els) => els.some((e) => /Fix verification/.test(e.textContent)))));
  await shot('10-verification');

  console.log('\nUltra-wide monitors and TVs');
  await clickText('[role=tab]', 'Responsive');
  await clickText('.chip-btn', 'Ultrawide');
  const shootPreset = async (label) => {
    const row = await panel.evaluateHandle((l) => [...document.querySelectorAll('.list-item')].find((r) => r.querySelector('strong')?.textContent === l), label);
    if (!row.asElement()) throw new Error(`no preset row ${label}`);
    return captured(async () => (await row.asElement().$$('button'))[1].click());
  };
  const uw = await shootPreset('Super ultrawide 49″');
  check('49″ super-ultrawide screenshot is 5120 × 1440', uw.width === 5120 && uw.height === 1440, `${uw.width}×${uw.height} ${uw.name}`);
  check('page really lays out at 5120px wide', (await page.evaluate(() => document.documentElement.clientWidth)) === 5120);
  const uwNote = await panel.$eval('.banner.ok', (e) => e.textContent);
  check('emulation banner names the size', /5120 × 1440/.test(uwNote), uwNote.slice(0, 60));
  await clickText('.chip-btn', 'TVs');
  const tv = await shootPreset('TV 55″ 4K');
  check('55″ 4K TV: 1920×1080 CSS px rendered at 2× = 3840 × 2160', tv.width === 3840 && tv.height === 2160, `${tv.width}×${tv.height}`);
  check('TV viewport reports 1920 CSS px and 2× pixel ratio', await page.evaluate(() => document.documentElement.clientWidth === 1920 && devicePixelRatio === 2));
  const tv60 = await shootPreset('TV 60″ 4K native');
  check('60″ 4K TV native: 3840 × 2160', tv60.width === 3840 && tv60.height === 2160, `${tv60.width}×${tv60.height}`);
  await clickText('button', 'Reset');
  await sleep(400);

  console.log('\nOfficial devices & device reference');
  await clickText('[role=tab]', 'Responsive');
  await clickText('.chip-btn', 'Apple');
  const appleRows = await panel.$$eval('.list .list-item strong', (els) => els.map((e) => e.textContent));
  check('Apple filter lists iPhones, iPads, MacBooks, iMac and displays', ['iPhone 14', 'iPhone 16 Pro Max', 'iPad Pro 11″', 'MacBook Pro 14″', 'iMac 24″', 'Studio Display 27″', 'Pro Display XDR 32″'].every((n) => appleRows.includes(n)) && appleRows.length >= 20, `${appleRows.length} rows`);
  const rowText = (label) => panel.evaluate((l) => [...document.querySelectorAll('.list-item')].find((r) => r.querySelector('strong')?.textContent === l)?.textContent ?? '', label);
  const iphoneText = await rowText('iPhone 14');
  check('each row shows CSS size, pixel ratio, physical resolution and aspect ratio', /390 × 844 @3×/.test(iphoneText) && /1170 × 2532 px/.test(iphoneText) && /\d+(\.\d+)?:\d+|:1/.test(iphoneText) && /6\.1″/.test(iphoneText), iphoneText.slice(0, 120));
  await panel.type('.search', 'ipad pro');
  await sleep(150);
  const searched = await panel.$$eval('.list .list-item strong', (els) => els.map((e) => e.textContent));
  check('search narrows across categories', searched.length >= 2 && searched.every((n) => /ipad pro/i.test(n)), searched.join(' | '));
  await panel.click('.search', { clickCount: 3 });
  await panel.keyboard.press('Backspace');
  await sleep(150);
  await clickText('.chip-btn', 'Apple');
  const shootRow = async (label) => {
    const row = await panel.evaluateHandle((l) => [...document.querySelectorAll('.list-item')].find((r) => r.querySelector('strong')?.textContent === l), label);
    if (!row.asElement()) throw new Error(`no preset row ${label}`);
    return captured(async () => (await row.asElement().$$('button'))[1].click());
  };
  const ip = await shootRow('iPhone 14');
  check('iPhone 14 screenshot is 390×844 CSS px at 3× = 1170 × 2532', ip.width === 1170 && ip.height === 2532, `${ip.width}×${ip.height}`);
  const studio = await shootRow('Studio Display 27″');
  check('Studio Display screenshot is 2560×1440 at 2× = 5120 × 2880', studio.width === 5120 && studio.height === 2880, `${studio.width}×${studio.height}`);
  await panel.evaluate(() => { window.__clip = null; navigator.clipboard.writeText = async (t) => { window.__clip = t; }; });
  const copyRow = await panel.evaluateHandle(() => [...document.querySelectorAll('.list-item')].find((r) => r.querySelector('strong')?.textContent === 'MacBook Pro 14″'));
  await copyRow.asElement().$('button[aria-label^="Copy"]').then((b) => b.click());
  await sleep(300);
  const clip = await panel.evaluate(() => window.__clip);
  check('copy puts size, ratio, physical resolution and a media query on the clipboard', /1512 × 982 px @2×/.test(clip ?? '') && /3024 × 1964 px/.test(clip ?? '') && /@media \(width: 1512px\) and \(height: 982px\)/.test(clip ?? ''), (clip ?? '').replace(/\n/g, ' | '));
  await clickText('.chip-btn', 'Phones');
  const landscapeBox = await panel.evaluateHandle(() => [...document.querySelectorAll('label')].find((l) => /Landscape/.test(l.textContent))?.querySelector('input'));
  await landscapeBox.asElement().click();
  await sleep(150);
  const landscapeText = await rowText('iPhone 14 (landscape)');
  check('landscape toggle swaps width and height for phones and tablets', /844 × 390/.test(landscapeText), landscapeText.slice(0, 80));
  await landscapeBox.asElement().click();
  await clickText('.chip-btn', 'TVs');
  const tvRows = await panel.$$eval('.list .list-item strong', (els) => els.map((e) => e.textContent));
  check('TV section has 43–75″ TVs, Apple TV and 21:9 ultrawide 55″ and 60″', ['TV 43″ Full HD', 'TV 50″ 4K', 'TV 55″ 4K', 'TV 60″ 4K native', 'TV 65″ 4K', 'TV 75″ 4K', 'Ultrawide TV 55″ (21:9)', 'Ultrawide TV 60″ (21:9)', 'Apple TV 4K'].every((n) => tvRows.includes(n)), tvRows.join(' | '));
  const uwtv = await shootRow('Ultrawide TV 55″ (21:9)');
  check('55″ ultrawide TV screenshot is 2560 × 1080', uwtv.width === 2560 && uwtv.height === 1080, `${uwtv.width}×${uwtv.height}`);
  await clickText('button', 'Reset');
  await sleep(300);

  console.log('\nAssets');
  await panel.evaluate(() => { window.__dl = []; const orig = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__dl.push({ name: this.download, href: this.href }); return; } return orig.call(this); }; });
  await clickText('[role=tab]', 'Assets');
  check('assets tab explains itself before scanning', !!(await panel.$('.empty')));
  await clickText('button', 'Scan assets');
  await waitFor(() => document.querySelectorAll('.asset').length > 5, undefined, 30000);
  const chipsText = await panel.$$eval('.chips .chip-btn', (els) => els.map((e) => e.textContent.trim()));
  check('assets are grouped by type', ['Images', 'Inline SVG', 'Icons', 'Fonts', 'CSS', 'Documents'].every((t) => chipsText.some((c) => c.startsWith(t))), chipsText.join(' | '));
  const names = await panel.$$eval('.asset .asset-name', (els) => els.map((e) => e.textContent));
  const wanted = ['big.png', 'lazy.png', 'lazy2.png', 'lazy3.png', 'search-icon.svg', 'favicon.svg', 'fx.woff2', 'external.css', 'report.pdf'];
  check('finds <img>, lazy data-src, picture srcset, inline SVG, favicon, @font-face, stylesheet and linked PDF', wanted.every((n) => names.includes(n)) && names.some((n) => /^inline-image-\d+\.png$/.test(n)), `missing: ${wanted.filter((n) => !names.includes(n)).join(', ') || 'none'}; got ${names.length}`);
  const thumbs = await panel.$$eval('.asset-thumb img', (els) => els.length);
  check('image assets show thumbnails', thumbs >= 4, `${thumbs}`);
  await sleep(1500);
  const sizeText = await panel.evaluate(() => [...document.querySelectorAll('.asset')].find((r) => r.querySelector('.asset-name')?.textContent === 'big.png')?.textContent ?? '');
  check('file sizes are filled in', /\d+(\.\d+)? (KB|MB)/.test(sizeText), sizeText.slice(0, 100));

  // single download
  const pdfRow = await panel.evaluateHandle(() => [...document.querySelectorAll('.asset')].find((r) => r.querySelector('.asset-name')?.textContent === 'report.pdf'));
  await pdfRow.asElement().$('button[aria-label^="Download"]').then((b) => b.click());
  await panel.waitForFunction(() => window.__dl.some((d) => d.name === 'report.pdf'), { timeout: 15000 });
  const pdfText = await panel.evaluate(async () => { const d = window.__dl.find((x) => x.name === 'report.pdf'); return await (await fetch(d.href)).text(); });
  check('single-file download saves the right bytes under its own name', pdfText.startsWith('%PDF-1.4'), pdfText);

  // filter + ZIP of everything
  await clickText('.chip-btn', 'Fonts');
  const fontOnly = await panel.$$eval('.asset .asset-name', (els) => els.map((e) => e.textContent));
  check('type filter narrows the list', fontOnly.length >= 1 && fontOnly.every((n) => /\.(woff2?|ttf|otf)$/.test(n)), fontOnly.join(','));
  await clickText('.chip-btn', 'All');
  await clickText('button', 'Download all as ZIP');
  await panel.waitForFunction(() => window.__dl.some((d) => /\.zip$/.test(d.name)), { timeout: 60000 });
  const zipInfo = await panel.evaluate(async () => {
    const d = window.__dl.find((x) => /\.zip$/.test(x.name));
    const buf = new Uint8Array(await (await fetch(d.href)).arrayBuffer());
    let bin = ''; for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode(...buf.subarray(i, i + 8192));
    return { name: d.name, b64: btoa(bin) };
  });
  const files = unzipSync(new Uint8Array(Buffer.from(zipInfo.b64, 'base64')));
  const paths = Object.keys(files);
  check('ZIP is named after the site', /^127-0-0-1-assets\.zip$/.test(zipInfo.name), zipInfo.name);
  check('ZIP organises files into folders by type', ['images/big.png', 'images/lazy.png', 'images/lazy2.png', 'svg/search-icon.svg', 'icons/favicon.svg', 'fonts/fx.woff2', 'css/external.css', 'documents/report.pdf', 'assets.json'].every((p) => paths.includes(p)), paths.filter((p) => !p.startsWith('images/')).join(', '));
  check('PNG is byte-exact (signature and size)', files['images/big.png']?.[1] === 0x50 && files['images/big.png']?.[2] === 0x4e && files['images/big.png']?.length === PNG.length, `${files['images/big.png']?.length} vs ${PNG.length}`);
  check('inline SVG is exported as markup', /^<svg[^>]*>/.test(strFromU8(files['svg/search-icon.svg'] ?? new Uint8Array())) && /circle/.test(strFromU8(files['svg/search-icon.svg'] ?? new Uint8Array())));
  check('data-URI image is decoded to a real PNG', Object.entries(files).some(([p, b]) => /^images\/inline-image-\d+\.png$/.test(p) && b[1] === 0x50));
  check('stylesheet text is intact', /--ext-brand/.test(strFromU8(files['css/external.css'] ?? new Uint8Array())));
  const index = JSON.parse(strFromU8(files['assets.json']));
  check('assets.json indexes every file with its source URL', index.count === paths.length - 1 - (files['_failed.txt'] ? 1 : 0) && index.assets.every((a) => a.path && a.url) && /127\.0\.0\.1/.test(index.source.url), `${index.count} files`);
  check('nothing failed to download', !files['_failed.txt'], files['_failed.txt'] ? strFromU8(files['_failed.txt']) : '');
  await shot('16-assets');
  // selection download
  await clickText('.chip-btn', 'Images');
  await panel.evaluate(() => document.querySelector('.asset input[type=checkbox]').click());
  const beforeZips = await panel.evaluate(() => window.__dl.filter((d) => /\.zip$/.test(d.name)).length);
  await clickText('button', 'Download selected');
  await panel.waitForFunction((n) => window.__dl.filter((d) => /\.zip$/.test(d.name)).length > n, { timeout: 30000 }, beforeZips);
  const selZip = await panel.evaluate(async () => { const d = window.__dl.filter((x) => /\.zip$/.test(x.name)).at(-1); const buf = new Uint8Array(await (await fetch(d.href)).arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode(...buf.subarray(i, i + 8192)); return btoa(bin); });
  const selFiles = Object.keys(unzipSync(new Uint8Array(Buffer.from(selZip, 'base64')))).filter((p) => p !== 'assets.json');
  check('"Download selected" zips only the selected asset', selFiles.length === 1 && selFiles[0].startsWith('images/'), selFiles.join(','));

  console.log('\nResponsive extension UI');
  const widths = [280, 360, 520, 760, 1100, 1600, 2560];
  for (const w of widths) {
    await panel.setViewport({ width: w, height: 820 });
    await sleep(250);
    const layout = await panel.evaluate(() => {
      const list = document.querySelector('.tabs-list');
      const main = document.querySelector('.main');
      const first = main.firstElementChild?.getBoundingClientRect();
      return { sidebar: getComputedStyle(list).flexDirection === 'column', iconShown: getComputedStyle(document.querySelector('.tab-icon')).display !== 'none', hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth, mainW: Math.round(main.getBoundingClientRect().width), font: parseFloat(getComputedStyle(document.body).fontSize), colW: first ? Math.round(first.width) : 0 };
    });
    check(`${w}px: ${w >= 760 ? 'sidebar navigation' : 'compact tab bar'}, no horizontal scroll`, layout.sidebar === (w >= 760) && layout.iconShown === (w >= 760) && !layout.hscroll, JSON.stringify(layout));
    for (const tab of ['Overview', 'Responsive', 'Screenshots']) {
      await clickText('[role=tab]', tab);
      await sleep(120);
      const over = await panel.evaluate(() => { const m = document.querySelector('.main'); return m.scrollWidth > m.clientWidth + 1; });
      if (over) check(`${w}px: ${tab} content fits`, false);
    }
  }
  await panel.setViewport({ width: 3440, height: 1100 });
  const big = await panel.evaluate(() => ({ font: parseFloat(getComputedStyle(document.body).fontSize), col: Math.round(document.querySelector('.main').firstElementChild.getBoundingClientRect().width), main: Math.round(document.querySelector('.main').getBoundingClientRect().width) }));
  check('on a 3440px ultrawide screen the UI scales up and the reading column stays bounded and centred', big.font >= 19 && big.col <= 1700 && big.col < big.main, JSON.stringify(big));
  await shot('13-wide-3440');
  await panel.setViewport({ width: 1100, height: 820 });
  await clickText('[role=tab]', 'Overview');
  await sleep(200);
  await shot('14-sidebar-1100');
  await panel.setViewport({ width: 400, height: 860 });

  console.log('\nFooter credit');
  await panel.setViewport({ width: 400, height: 860 });
  const credit = await panel.$eval('.footer .credit', (el) => ({ text: el.textContent.replace(/\s+/g, ' ').trim(), link: el.querySelector('a')?.getAttribute('href'), rel: el.querySelector('a')?.getAttribute('rel'), target: el.querySelector('a')?.getAttribute('target'), label: el.querySelector('a')?.getAttribute('aria-label') }));
  check('footer credits the author with a GitHub link', /Karan Chourasia/.test(credit.text) && credit.link === 'https://github.com/Karan071' && /Karan071/.test(credit.text), credit.text);
  check('credit link opens safely in a new tab and is labelled', credit.target === '_blank' && /noopener/.test(credit.rel) && /GitHub/.test(credit.label));
  check('credit shows the extension version', new RegExp(`v${await panel.evaluate(() => chrome.runtime.getManifest().version)}`.replace(/\./g, '\\.')).test(credit.text));
  await shot('15-credit-footer');

  console.log('\nTheme');
  await panel.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await sleep(150);
  const bgLight = await panel.$eval('body', (e) => getComputedStyle(e).backgroundColor);
  await shot('11-light');
  await panel.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await sleep(150);
  const bgDark = await panel.$eval('body', (e) => getComputedStyle(e).backgroundColor);
  check('follows system dark mode', bgLight !== bgDark, `${bgLight} → ${bgDark}`);
  await shot('11-dark');
  await panel.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await panel.click('.header button[aria-label^="Theme"]'); // system → light
  await panel.click('.header button[aria-label^="Theme"]'); // light → dark
  await sleep(150);
  check('manual dark theme overrides system light', (await panel.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
  const fonts = await panel.evaluate(async () => { await Promise.all([document.fonts.load('13px Inter'), document.fonts.load('600 14px Geist'), document.fonts.load('12px "Geist Mono"')]); return { inter: document.fonts.check('13px Inter'), geist: document.fonts.check('600 14px Geist'), mono: document.fonts.check('12px "Geist Mono"') }; });
  check('Inter, Geist and Geist Mono fonts load', fonts.inter && fonts.geist && fonts.mono, JSON.stringify(fonts));

  console.log('\nNarrow width (280px)');
  await panel.setViewport({ width: 280, height: 800 });
  await sleep(300);
  const hscroll = await panel.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check('no horizontal page scroll at 280px', !hscroll);
  for (const tab of ['Overview', 'Responsive', 'Screenshots']) {
    await clickText('[role=tab]', tab);
    await sleep(200);
    const over = await panel.evaluate(() => { const m = document.querySelector('.main'); return m.scrollWidth > m.clientWidth + 1; });
    check(`${tab} fits in 280px`, !over);
  }
  await shot('12-narrow');

  console.log('\nCleanup on panel close');
  await panel.setViewport({ width: 400, height: 860 });
  await panel.close();
  await sleep(1500);
  const left = await page.evaluate(() => ({ fix: !!document.getElementById('__ftk-fixes'), host: document.getElementById('__ftk-host')?.shadowRoot?.querySelectorAll('.layer,.issue').length ?? 0 }));
  check('closing the panel removes temporary fixes and overlays', !left.fix && left.host === 0, JSON.stringify(left));

  check('no console/page errors in the panel', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  console.error('\nE2E crashed:', e);
  exitCode = 1;
} finally {
  await browser.close().catch(() => undefined);
  server.close();
  cssServer.close();
}
console.log(exitCode ? '\nE2E did not complete' : failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures || exitCode ? 1 : 0);
