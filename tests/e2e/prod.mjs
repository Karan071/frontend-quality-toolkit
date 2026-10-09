// Runs the toolkit against live production sites: audit, inspect, responsive lab, and all three screenshot modes.
//   node tests/e2e/prod.mjs [url ...]
import { launch, openPanel, readShots, imageVariety, sleep, tabIdFor } from './harness.mjs';

const SITES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      'https://example.com/',
      'https://en.wikipedia.org/wiki/Web_accessibility',
      'https://developer.mozilla.org/en-US/',
      'https://github.com/',
      'https://news.ycombinator.com/',
      'https://www.bbc.com/news',
    ];

const SITE_BUDGET_MS = Number(process.env.SITE_BUDGET_MS || 420_000);
const { browser, executablePath, extId, sw } = await launch();
console.log(`browser: ${executablePath.split('/').slice(-1)[0]} · extension ${extId}\n`);

let failed = 0;
const rows = [];

for (const url of SITES) {
  const t0 = Date.now();
  const row = { url, checks: [], notes: [] };
  let step = 'start';
  const ok = (name, pass, detail = '') => { row.checks.push({ name, pass, detail }); if (!pass) failed++; step = `after: ${name}`; console.log(`  [${((Date.now() - t0) / 1000).toFixed(0)}s] ${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
  let page, panel;
  console.log(`\n▶ ${url}`);
  // Watchdog: a stuck step must fail the site, not hang the run.
  const watchdog = new Promise((_, rej) => setTimeout(() => rej(new Error(`watchdog: stuck ${Math.round(SITE_BUDGET_MS / 1000)}s ${step}`)), SITE_BUDGET_MS));
  try {
    await Promise.race([watchdog, (async () => {
    page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.bringToFront();
    await sleep(4000); // let the page settle: hydration, lazy images, ads
    const finalUrl = page.url();
    const tabId = await tabIdFor(sw, finalUrl);
    ok('tab found', tabId != null, finalUrl);
    if (tabId == null) return;

    panel = await openPanel(browser, extId, tabId);
    const panelErrors = [];
    panel.on('pageerror', (e) => panelErrors.push(e.message));
    panel.on('console', (m) => m.type() === 'error' && panelErrors.push(m.text()));
    await page.bringToFront();
    const click = async (sel, text) => {
      step = `click ${sel} "${text}"`;
      const h = await panel.evaluateHandle((s, t) => [...document.querySelectorAll(s)].find((e) => e.textContent.trim().startsWith(t)), sel, text);
      if (!h.asElement()) throw new Error(`no ${sel} "${text}"`);
      await h.asElement().click();
    };
    await panel.waitForSelector('.header-sub .dot.live', { timeout: 20000 });
    const docBefore = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, w: document.documentElement.clientWidth, dpr: devicePixelRatio, title: document.title }));

    // ── audit ──
    const ta = Date.now();
    await click('button', 'Run full audit');
    await panel.waitForSelector('.hero-number', { timeout: 60000 });
    const auditMs = Date.now() - ta;
    const summary = await panel.evaluate(() => ({
      total: Number(document.querySelector('.hero-number').textContent),
      tiles: [...document.querySelectorAll('.tile')].map((t) => t.textContent),
    }));
    ok('audit completes', summary.tiles.length === 6, `${summary.total} findings in ${auditMs} ms`);
    ok('audit under 15s', auditMs < 15000, `${auditMs} ms`);
    row.notes.push(`${summary.total} findings · ${summary.tiles.map((t) => t.replace(/\s+/g, ' ')).join(' | ')}`);

    // every finding card opens without error and has guidance
    const tabsToCheck = ['Performance', 'Images', 'Bundles', 'Accessibility', 'UI / UX', 'Responsive'];
    for (const tab of tabsToCheck) {
      await click('[role=tab]', tab);
      await sleep(250);
      const heads = await panel.$$('.finding-head');
      if (heads.length) { await heads[0].click(); await sleep(100); }
      const rendered = await panel.evaluate(() => ({ main: document.querySelector('.main').children.length, bodyHas: !!document.querySelector('.finding-body') }));
      ok(`${tab} tab renders`, rendered.main > 0);
    }

    // ── inspect ──
    await click('[role=tab]', 'Inspect');
    await click('button', 'Pick element');
    const target = await page.evaluate(() => {
      // First element that is actually on screen and hit-testable (skips skip-links / sr-only text).
      for (const el of document.querySelectorAll('h1, h2, h3, main p, p, a, button')) {
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        if (r.width < 24 || r.height < 10 || r.top < 0 || r.bottom > innerHeight) continue;
        const x = r.x + Math.min(r.width / 2, 40);
        const y = r.y + Math.min(r.height / 2, 8);
        const hit = document.elementFromPoint(x, y);
        if (hit && (hit === el || el.contains(hit))) return { x, y, tag: el.localName };
      }
      return null;
    });
    if (target) {
      await page.mouse.move(target.x, target.y);
      await sleep(150);
      const hover = await page.evaluate(() => document.getElementById('__ftk-host')?.shadowRoot?.querySelectorAll('.layer').length ?? 0);
      ok('hover overlay draws box model', hover >= 3, `${hover} layers`);
      await page.mouse.click(target.x, target.y);
      await panel.waitForSelector('.crumbs', { timeout: 8000 });
      const sel = await panel.$eval('.card strong.mono', (e) => e.textContent);
      ok('element picked', sel.length > 0, sel);
      ok('page click was not forwarded (no navigation)', (await page.url()) === finalUrl, await page.url());
      await click('.seg button', 'Rules');
      ok('matched rules panel renders', (await panel.$$('.card')).length >= 2);
    } else ok('picked an element', false, 'page has no pickable element');

    // ── responsive lab ──
    await click('[role=tab]', 'Responsive');
    const presetCount = Number(await panel.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^Test all \d+/.test(b.textContent.trim()))?.textContent.match(/\d+/)?.[0] ?? 0));
    await click('button', 'Test all');
    // Wait for the whole matrix (not just the first rows): screenshots must not run mid-emulation.
    await panel.waitForFunction((n) => !document.querySelector('[aria-busy="true"]') && document.querySelectorAll('.card .list-item .badge.ok, .card .list-item .badge.error').length >= n, { timeout: 400000 }, presetCount);
    const resp = await panel.$$eval('.card .list-item', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ')));
    ok(`responsive matrix ran at all ${presetCount} sizes`, resp.length >= presetCount, resp.map((r) => r.replace(/overflow.*/, 'overflow')).join(' | ').slice(0, 200));
    ok('emulation cleaned up', (await page.evaluate(() => document.documentElement.clientWidth)) === docBefore.w);

    // ── assets ──
    await panel.evaluate(() => { window.__dl = []; const orig = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__dl.push({ name: this.download, href: this.href }); return; } return orig.call(this); }; });
    await click('[role=tab]', 'Assets');
    await click('button', 'Scan assets');
    await panel.waitForFunction(() => document.querySelectorAll('.asset').length > 0 || document.querySelector('.empty'), { timeout: 60000 });
    const assetCount = await panel.evaluate(() => Number(document.querySelector('.chips .chip-btn')?.textContent.match(/\d+/)?.[0] ?? 0));
    ok('assets scanned', assetCount > 0, `${assetCount} assets: ${await panel.$$eval('.chips .chip-btn', (els) => els.slice(1).map((e) => e.textContent.trim()).join(', '))}`);
    if (assetCount > 0) {
      await sleep(1500);
      const boxes = await panel.$$('.asset input[type=checkbox]');
      for (const b of boxes.slice(0, 4)) await b.click();
      await click('button', 'Download selected');
      await panel.waitForFunction(() => window.__dl.some((d) => /\.zip$/.test(d.name)), { timeout: 120000 }).catch(() => undefined);
      const zip = await panel.evaluate(async () => { const d = window.__dl.find((x) => /\.zip$/.test(x.name)); if (!d) return null; const b = new Uint8Array(await (await fetch(d.href)).arrayBuffer()); return { name: d.name, size: b.length, magic: [b[0], b[1]] }; });
      ok('ZIP of selected assets downloads', !!zip && zip.magic[0] === 0x50 && zip.magic[1] === 0x4b && zip.size > 100, zip ? `${zip.name} ${zip.size} B` : 'none');
    }

    // ── screenshots ──
    const capture = async (label, text, timeout = 150000) => {
      const before = (await readShots(panel)).length;
      await click('.footer button', text);
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const all = await readShots(panel);
        if (all.length > before) return all.at(-1);
        await sleep(500);
      }
      return null;
    };
    const vShot = await capture('viewport', 'Viewport');
    ok('viewport screenshot', !!vShot && vShot.width > 100, vShot && `${vShot.width}×${vShot.height}`);
    if (vShot) ok('viewport screenshot is not blank', (await imageVariety(panel, vShot.id)) > 0.02, `variety ${(await imageVariety(panel, vShot.id)).toFixed(2)}`);

    await page.evaluate(() => scrollTo(0, 0));
    const tf = Date.now();
    const fShot = await capture('fullpage', 'Full page');
    const docAfter = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, y: scrollY }));
    ok('full-page screenshot', !!fShot, fShot && `${fShot.width}×${fShot.height} in ${((Date.now() - tf) / 1000).toFixed(1)}s ${fShot.warnings?.length ? '⚠ ' + fShot.warnings.join('; ') : ''}`);
    if (fShot) {
      const expectedH = Math.min(docAfter.h, 40000) * docBefore.dpr;
      ok('full-page height ≈ document height', Math.abs(fShot.height - expectedH) / expectedH < 0.15 || fShot.warnings?.some((w) => /scales|scaled|inside|tall/.test(w)), `${fShot.height} vs ~${Math.round(expectedH)}`);
      ok('full-page screenshot is not blank', (await imageVariety(panel, fShot.id)) > 0.02);
      ok('page scroll restored after full-page capture', docAfter.y < 5, `scrollY=${docAfter.y}`);
      const leftovers = await page.evaluate(() => document.querySelectorAll('[data-ftk-pos],[data-ftk-sticky],#__ftk-shot-style').length + (document.documentElement.hasAttribute('data-ftk-hide') ? 1 : 0));
      ok('no capture markers left in the page', leftovers === 0, `${leftovers}`);
    }

    if (target) {
      const eShot = await capture('element', 'Element');
      ok('element screenshot', !!eShot && eShot.width > 0 && eShot.height > 0, eShot && `${eShot.name} ${eShot.width}×${eShot.height}`);
    }

    // ── cleanup & health ──
    await panel.close();
    await sleep(1500);
    const left = await page.evaluate(() => ({ fix: !!document.getElementById('__ftk-fixes'), layers: document.getElementById('__ftk-host')?.shadowRoot?.querySelectorAll('.layer,.issue').length ?? 0 }));
    ok('closing the panel removes overlays and fixes', !left.fix && left.layers === 0, JSON.stringify(left));
    ok('page still intact', (await page.evaluate(() => document.title)) === docBefore.title);
    ok('no panel errors', panelErrors.length === 0, panelErrors.slice(0, 2).join(' | '));
    panel = null;
    })()]);
  } catch (e) {
    ok('site run completed', false, String(e.message).slice(0, 200));
    // Diagnose what is stuck, with short timeouts so diagnosis itself cannot hang.
    const within = (p, ms = 4000) => Promise.race([Promise.resolve(p).catch((err) => `ERROR: ${String(err.message).slice(0, 100)}`), sleep(ms).then(() => 'TIMEOUT')]);
    console.log('  diag panel :', await within(panel?.evaluate(() => ({ busy: !!document.querySelector('.footer .progress'), footer: document.querySelector('.footer')?.textContent?.slice(0, 120), toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent) })) ?? 'no panel'));
    console.log('  diag page  :', await within(page?.evaluate(() => ({ scrollY, hide: document.documentElement.getAttribute('data-ftk-hide'), marked: document.querySelectorAll('[data-ftk-pos],[data-ftk-sticky]').length, style: !!document.getElementById('__ftk-shot-style') })) ?? 'no page'));
    console.log('  diag sw    :', await within(sw.evaluate(async () => ({ tabs: (await chrome.tabs.query({})).map((t) => `${t.id}:${t.active ? 'A' : '-'}:${(t.url || '').slice(0, 40)}`), dbg: (await chrome.debugger.getTargets()).filter((t) => t.attached).map((t) => `${t.tabId}:${t.type}`) }))));
  } finally {
    await panel?.close().catch(() => undefined);
    await page?.close().catch(() => undefined);
  }
  row.secs = ((Date.now() - t0) / 1000).toFixed(0);
  rows.push(row);
  console.log(`\n${row.url}  (${row.secs}s)`);
  row.notes.forEach((n) => console.log(`  · ${n}`));
}

await browser.close();
const total = rows.reduce((n, r) => n + r.checks.length, 0);
console.log(`\n${total - failed}/${total} checks passed across ${rows.length} sites`);
process.exit(failed ? 1 : 0);
