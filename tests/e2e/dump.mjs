// Prints the findings the toolkit reports for a live URL (for eyeballing accuracy).
import { launch, openPanel, sleep, tabIdFor } from './harness.mjs';
const urls = process.argv.slice(2);
const { browser, extId, sw } = await launch();
for (const url of urls) {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.bringToFront();
  await sleep(4000);
  const panel = await openPanel(browser, extId, await tabIdFor(sw, page.url()));
  await page.bringToFront();
  await panel.waitForSelector('.header-sub .dot.live');
  await (await panel.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Run full audit')))).asElement().click();
  await panel.waitForSelector('.hero-number', { timeout: 60000 });
  const out = [];
  for (const tab of ['Performance', 'Responsive', 'Accessibility', 'Images', 'Bundles', 'UI / UX']) {
    await (await panel.evaluateHandle((t) => [...document.querySelectorAll('[role=tab]')].find((e) => e.textContent.trim().startsWith(t)), tab)).asElement().click();
    await sleep(200);
    const items = await panel.$$eval('.finding', (els) => els.map((e) => `${e.querySelector('.sev-icon').getAttribute('aria-label').padEnd(7)} ${e.querySelector('.finding-title').textContent} — ${e.querySelector('.finding-sub')?.textContent ?? ''}`));
    out.push(`  [${tab}]`, ...items.map((i) => `    ${i.slice(0, 230)}`));
  }
  console.log(`\n${url}\n${out.join('\n')}`);
  await panel.close(); await page.close();
}
await browser.close();
