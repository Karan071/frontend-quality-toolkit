// End-to-end check: loads the built extension into a Chromium browser, drives the real
// side panel (opened as a tab bound to the fixture tab), and verifies behaviour.
import http from 'node:http';
import { deflateSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

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
const HTML = readFileSync(join(ROOT, 'tests/fixtures/broken.html'));
const server = http.createServer((req, res) => {
  if (req.url === '/big.png') { res.writeHead(200, { 'content-type': 'image/png', 'content-length': PNG.length }); return res.end(PNG); }
  res.writeHead(200, { 'content-type': 'text/html' }); res.end(HTML);
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const URL_ = `http://127.0.0.1:${server.address().port}/`;

const browser = await puppeteer.launch({
  executablePath,
  headless: process.env.HEADED ? false : 'new',
  userDataDir: mkdtempSync(join(tmpdir(), 'ftk-e2e-')),
  args: [`--disable-extensions-except=${join(ROOT, 'dist')}`, `--load-extension=${join(ROOT, 'dist')}`, '--disable-features=DisableLoadExtensionCommandLineSwitch', '--no-first-run', '--no-default-browser-check', '--window-size=1200,900'],
  defaultViewport: null,
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

  console.log('\nResponsive');
  await clickText('[role=tab]', 'Responsive');
  await clickText('button', 'Test all');
  await waitFor(() => document.querySelectorAll('.card .list-item .badge.ok, .card .list-item .badge.error').length >= 5, undefined, 60000);
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
  check('mobile screenshot is exactly the emulated viewport', m && Math.round(m.width / dpr) === 390 && Math.round(m.height / dpr) === 844, `${m?.width}×${m?.height} @${dpr}x`);
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
  const fonts = await panel.evaluate(async () => { await document.fonts.ready; return { inter: document.fonts.check('13px Inter'), geist: document.fonts.check('600 14px Geist'), mono: document.fonts.check('12px "Geist Mono"') }; });
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
}
console.log(exitCode ? '\nE2E did not complete' : failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures || exitCode ? 1 : 0);
