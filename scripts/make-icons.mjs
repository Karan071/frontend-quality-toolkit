// Renders extension/icons/*.svg to PNGs at every size Chrome needs, using the installed browser
// (no image libraries). Run after editing an SVG:  node scripts/make-icons.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { findBrowser } from '../tests/e2e/harness.mjs';
import puppeteer from 'puppeteer-core';

const full = readFileSync('extension/icons/icon.svg', 'utf8');
const small = readFileSync('extension/icons/icon-small.svg', 'utf8');
// 16/32px get the bolder variant: fine detail turns to mush at toolbar size.
const jobs = [
  [16, small, 'extension/icons/icon-16.png'],
  [32, small, 'extension/icons/icon-32.png'],
  [48, full, 'extension/icons/icon-48.png'],
  [128, full, 'extension/icons/icon-128.png'],
  [512, full, 'docs/icon-512.png'],
];

mkdirSync('docs', { recursive: true });
const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: 'new' });
const page = await browser.newPage();
for (const [size, svg, out] of jobs) {
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  const sized = svg.replace(/width="128" height="128"/, `width="${size}" height="${size}"`);
  await page.setContent(`<!doctype html><body style="margin:0;background:transparent">${sized}</body>`);
  writeFileSync(out, await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }));
  console.log(`${out} (${size}px)`);
}
await browser.close();
