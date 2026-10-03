// Shared helpers for driving the built extension in a Chromium-based browser.
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

export const ROOT = resolve(import.meta.dirname, '../..');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('No Chromium-based browser found. Set CHROME_PATH.');
  return found;
}

export async function launch({ headed = !!process.env.HEADED } = {}) {
  const executablePath = findBrowser();
  const dist = join(ROOT, 'dist');
  const browser = await puppeteer.launch({
    executablePath,
    headless: headed ? false : 'new',
    userDataDir: mkdtempSync(join(tmpdir(), 'ftk-e2e-')),
    args: [
      `--disable-extensions-except=${dist}`,
      `--load-extension=${dist}`,
      // Chrome 137+ ignores --load-extension unless this feature is disabled.
      '--disable-features=DisableLoadExtensionCommandLineSwitch',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1280,900',
    ],
    defaultViewport: null,
    // Long waits (56-size device matrix, big ZIPs) legitimately exceed puppeteer's 180s default.
    protocolTimeout: 900_000,
    ignoreDefaultArgs: ['--disable-extensions'],
  });
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('service-worker.js'), { timeout: 20000 });
  const extId = new URL(swTarget.url()).host;
  const sw = await swTarget.worker();
  return { browser, executablePath, extId, sw };
}

/** Opens the side panel document in its own window, bound to `tabId`, at side-panel size. */
export async function openPanel(browser, extId, tabId, { width = 400, height = 860 } = {}) {
  const cdp = await browser.target().createCDPSession();
  const { targetId } = await cdp.send('Target.createTarget', {
    url: `chrome-extension://${extId}/sidepanel.html?tab=${tabId}`,
    newWindow: true,
    width,
    height,
  });
  const target = await browser.waitForTarget((t) => t._targetId === targetId);
  const panel = await target.asPage();
  await panel.setViewport({ width, height });
  await panel.waitForSelector('.app');
  return panel;
}

export async function tabIdFor(sw, url) {
  return sw.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id ?? null, url);
}

/** Reads screenshot records (metadata only) from the panel's IndexedDB. */
export const readShots = (panel) =>
  panel.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open('ftk', 1);
        open.onsuccess = () => {
          const all = open.result.transaction('screenshots').objectStore('screenshots').getAll();
          all.onsuccess = () =>
            resolve(
              all.result
                .map((r) => ({ id: r.id, name: r.name, type: r.type, width: r.width, height: r.height, format: r.format, bytes: r.bytes, warnings: r.warnings, createdAt: r.createdAt }))
                .sort((a, b) => a.createdAt - b.createdAt),
            );
        };
      }),
  );

/** Fraction of sampled pixels that differ from the most common colour (0 = blank image). */
export const imageVariety = (panel, id) =>
  panel.evaluate(async (shotId) => {
    const db = await new Promise((r) => { const o = indexedDB.open('ftk', 1); o.onsuccess = () => r(o.result); });
    const rec = await new Promise((r) => { const g = db.transaction('screenshots').objectStore('screenshots').get(shotId); g.onsuccess = () => r(g.result); });
    const bmp = await createImageBitmap(rec.blob);
    const c = new OffscreenCanvas(Math.min(bmp.width, 400), Math.min(bmp.height, 1200));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const counts = new Map();
    for (let i = 0; i < d.length; i += 40) { const k = `${d[i] >> 3},${d[i + 1] >> 3},${d[i + 2] >> 3}`; counts.set(k, (counts.get(k) ?? 0) + 1); }
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    return 1 - Math.max(...counts.values()) / total;
  }, id);
