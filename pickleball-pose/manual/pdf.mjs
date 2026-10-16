import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
const [,, html, out] = process.argv;
const b = await chromium.launch(); const p = await b.newPage();
await p.goto('file://' + html, { waitUntil: 'networkidle' });
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(800);
await p.pdf({ path: out, format: 'A4', printBackground: true, preferCSSPageSize: true });
await b.close();
