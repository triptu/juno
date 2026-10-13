// Renders sheet.html to PNGs, one per family section.
// Run from the repo root: node docs/design/channel-marks/render.mjs
import { createRequire } from 'node:module';
const require = createRequire(path.join(process.cwd(), 'apps/gallery/package.json'));
const { chromium } = require('@playwright/test');
import { fileURLToPath } from 'node:url';
import path from 'node:path';


const dir = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1480, height: 1000 }, deviceScaleFactor: 2 });
await page.goto('file://' + path.join(dir, 'sheet.html'));
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(200);
const sections = await page.$$('section.family');
for (const s of sections) {
  const key = await s.getAttribute('data-family');
  await s.screenshot({ path: path.join(dir, `family-${key}.png`) });
  console.log('wrote', `family-${key}.png`);
}
await browser.close();
